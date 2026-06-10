/**
 * loadoutSurvival — derive the hunter's effective max HP, shield HP,
 * dodge, and elemental resist from the player's equipped loadout and
 * level. Pure function (no internal state), but reads the relevant
 * slices at call time. Used by the idle ticker to compute the
 * per-tick damage application.
 *
 * The function reads the loadout slice, the player slice, and the
 * survival slice. The output feeds `computeMonsterDamageVsHunter` in
 * `damageContract.ts`.
 *
 * This is intentionally a separate module from the slice so it can be
 * unit-tested with explicit store state.
 */
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { computeHunterMaxHp, type HunterSurvivalStats } from './damageContract';
import { computeStandardDps } from '@/lib/stats/dpsChain';

/**
 * Read the equipped shield's full defensive profile.
 * Returns null if no shield equipped.
 */
function equippedShieldProfile(): {
  hp: number;
  mitigation: number;
  rechargeRate: number;
  element: import('@/types/game').Element | null;
} | null {
  const shield = useLoadoutStore.getState().getShield();
  if (!shield) return null;
  return {
    hp: shield.hp,
    mitigation: shield.mitigation,
    rechargeRate: shield.rechargeRate,
    element: shield.element,
  };
}

/**
 * Build the survival stats object the damage contract needs.
 * Exported for use by the idle ticker. Wraps a fresh read of the
 * relevant store state at call time.
 */
export function loadoutSurvivalStats(): HunterSurvivalStats {
  const level = usePlayerStore.getState().level;
  const shieldProfile = equippedShieldProfile();
  const shieldCapacity = shieldProfile?.hp ?? 0;
  const currentShieldHp = useSurvivalStore.getState().shieldHp;
  const skillBonuses = useSkillStore.getState().getBonuses();
  const survivalMult = 1 + (skillBonuses.survival || 0);
  // Stagger chance translates to monster miss chance (capped at 40%).
  const staggerDodge = Math.min(0.4, (skillBonuses.staggerChance || 0) * 0.5);
  return {
    maxHp: Math.round(computeHunterMaxHp(level, shieldCapacity) * survivalMult),
    shieldHp: currentShieldHp,
    dodgeChance: staggerDodge,
    elementalResist: 0, // no generic resist affix yet
    mitigation: shieldProfile?.mitigation ?? 0,
    shieldElement: shieldProfile?.element ?? undefined,
  };
}

/**
 * Read the hunter's total effective DPS — pooled from ALL damage sources.
 *
 * In an idle game, every damage source funnels into a single DPS number.
 * This function sums:
 *   1. Weapons (primary/secondary/heavy) via the DPS chain
 *   2. Ordnance flat damage (scaled by 0.3× for cooldown cadence)
 *   3. Weapon shield break / armor break modifiers as bonus DPS
 *   4. Relic affixes that affect damage (xpBoostMod contributes to kill speed indirectly)
 *   5. ClassMod affixes (weaponDamage, critChance)
 *   6. Activity modules on any equipped gear (roaming waveDamageMod)
 *   7. Skill bonuses (dps multiplier)
 *
 * Returns 0 if no weapons are equipped (ordnance alone doesn't enable kills).
 */
export function loadoutEffectiveDps(): number {
  const loadout = useLoadoutStore.getState();
  const skillBonuses = useSkillStore.getState().getBonuses();
  const skillDpsMult = 1 + (skillBonuses.dps || 0);
  const slots: Array<'primary' | 'secondary' | 'heavy'> = ['primary', 'secondary', 'heavy'];

  // 1. Weapon DPS (primary/secondary/heavy)
  let weaponDps = 0;
  let shieldBreakDps = 0;
  let armorBreakDps = 0;
  for (const slot of slots) {
    const weapon = loadout.getWeapon(slot);
    if (weapon) {
      const std = computeStandardDps(weapon);
      weaponDps += std * (1 + (weapon.waveDamageMod || 0));
      shieldBreakDps += std * Math.max(0, weapon.shieldDamageMod || 0);
      armorBreakDps += std * Math.max(0, weapon.armorDamageMod || 0);
    }
  }

  // 2. Ordnance DPS (flat damage, scaled for idle cadence)
  let ordnanceDps = 0;
  const ordnance = loadout.getOrdnance();
  if (ordnance) {
    // Ordnance fires periodically; 30% of listed damage per second
    ordnanceDps = ordnance.damage * 0.3;
    // Ordnance shield/armor break bonuses (additive on top of weapon break)
    shieldBreakDps += (ordnance.shieldDamage || 0) * 0.3;
    armorBreakDps += (ordnance.armorDamage || 0) * 0.3;
    // Ordnance combat affixes (damage, shieldDamage, armorDamage boosts are
    // already baked into the ordnance stats by the generator)
  }

  // 3. Relic affixes — sum any damage-affecting stats
  let relicBonus = 0;
  const relic = loadout.getRelic();
  if (relic) {
    for (const affix of relic.affixes) {
      // bossDamageMod on relics adds to general DPS for roaming (the hunter
      // is always fighting something)
      if (affix.stat === 'bossDamageMod') {
        relicBonus += weaponDps * affix.value;
      }
      // Activity modules on relics: check subStats for roaming mods
      if (affix.category === 'activity' && affix.subStats) {
        if (affix.subStats.waveDamageMod) {
          weaponDps += weaponDps * affix.subStats.waveDamageMod;
        }
      }
    }
  }

  // 4. ClassMod affixes — weaponDamage, critChance
  let classModBonus = 0;
  const classMod = loadout.getClassMod();
  if (classMod) {
    for (const affix of classMod.affixes) {
      if (affix.stat === 'weaponDamage') {
        classModBonus += weaponDps * affix.value;
      }
      if (affix.stat === 'critChance') {
        classModBonus += weaponDps * affix.value * 0.5; // crit chance → half DPS
      }
      // Activity modules on classMods
      if (affix.category === 'activity' && affix.subStats) {
        if (affix.subStats.waveDamageMod) {
          weaponDps += weaponDps * affix.subStats.waveDamageMod;
        }
      }
    }
  }

  // 5. Activity modules on shield and weapons (roaming waveDamageMod)
  const shield = loadout.getShield();
  const allGear = [...slots.map((s) => loadout.getWeapon(s)), shield, ordnance, relic, classMod].filter(Boolean);
  let activityWaveBonus = 0;
  for (const item of allGear) {
    if (!('affixes' in item) || !Array.isArray(item.affixes)) continue;
    for (const affix of item.affixes as Array<{ category?: string; stat?: string; subStats?: Record<string, number> }>) {
      if (affix.category === 'activity' && affix.subStats?.waveDamageMod) {
        activityWaveBonus += affix.subStats.waveDamageMod;
      }
    }
  }
  weaponDps *= (1 + activityWaveBonus);

  // 6. Pool everything
  const total = weaponDps + ordnanceDps + shieldBreakDps + armorBreakDps + relicBonus + classModBonus;

  return total * skillDpsMult;
}

/**
 * Read the equipped shield's recharge rate (HP per second).
 * Returns 0 if no shield equipped.
 */
export function equippedShieldRechargeRate(): number {
  const shield = useLoadoutStore.getState().getShield();
  return shield?.rechargeRate ?? 0;
}

/**
 * Read the equipped shield's damage mitigation (0-1).
 * Returns 0 if no shield equipped.
 */
export function equippedShieldMitigation(): number {
  const shield = useLoadoutStore.getState().getShield();
  return shield?.mitigation ?? 0;
}
