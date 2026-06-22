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
import type { GearItem, Weapon } from '@/types/items';

/**
 * Input type for pure DPS computation — no Zustand dependency.
 * Used by both the client (loadoutEffectiveDps) and the server
 * (claim route re-derivation) to ensure the server doesn't trust
 * client-supplied DPS values.
 */
export type EffectiveDpsInput = {
  weapons: Weapon[];
  ordnance: GearItem | null;
  relic: GearItem | null;
  classMod: GearItem | null;
  skillDpsMult: number;
};

/**
 * Pure function that computes effective DPS from gear + skill multiplier.
 * No Zustand dependency — both client and server use this.
 *
 * This mirrors the logic that was previously inside loadoutEffectiveDps(),
 * extracted so the server can re-derive DPS from the equippedGear array
 * instead of trusting the client's effectiveDps value.
 */
export function computeEffectiveDpsFromGear(input: EffectiveDpsInput): number {
  const { weapons, ordnance, relic, classMod, skillDpsMult } = input;

  // 1. Weapon DPS (primary/secondary/heavy)
  let weaponDps = 0;
  let shieldBreakDps = 0;
  let armorBreakDps = 0;
  for (const weapon of weapons) {
    const std = computeStandardDps(weapon);
    weaponDps += std * (1 + (weapon.waveDamageMod || 0));
    shieldBreakDps += std * Math.max(0, weapon.shieldDamageMod || 0);
    armorBreakDps += std * Math.max(0, weapon.armorDamageMod || 0);
  }

  // 2. Ordnance DPS (flat damage, scaled for idle cadence)
  let ordnanceDps = 0;
  if (ordnance && 'damage' in ordnance) {
    ordnanceDps = (ordnance as { damage: number }).damage * 0.3;
    shieldBreakDps += ((ordnance as { shieldDamage?: number }).shieldDamage ?? 0) * 0.3;
    armorBreakDps += ((ordnance as { armorDamage?: number }).armorDamage ?? 0) * 0.3;
  }

  // 3. Relic affixes — sum any damage-affecting stats
  let relicBonus = 0;
  if (relic && 'affixes' in relic && Array.isArray(relic.affixes)) {
    for (const affix of relic.affixes as Array<{ stat?: string; category?: string; subStats?: Record<string, number> }>) {
      if (affix.stat === 'bossDamageMod') {
        relicBonus += weaponDps * (affix as { value: number }).value;
      }
      if (affix.category === 'activity' && affix.subStats?.waveDamageMod) {
        weaponDps += weaponDps * affix.subStats.waveDamageMod;
      }
    }
  }

  // 4. ClassMod affixes — weaponDamage, critChance
  let classModBonus = 0;
  if (classMod && 'affixes' in classMod && Array.isArray(classMod.affixes)) {
    for (const affix of classMod.affixes as Array<{ stat?: string; value?: number; category?: string; subStats?: Record<string, number> }>) {
      if (affix.stat === 'weaponDamage') {
        classModBonus += weaponDps * (affix.value ?? 0);
      }
      if (affix.stat === 'critChance') {
        classModBonus += weaponDps * (affix.value ?? 0) * 0.5;
      }
      if (affix.category === 'activity' && affix.subStats?.waveDamageMod) {
        weaponDps += weaponDps * affix.subStats.waveDamageMod;
      }
    }
  }

  // 5. Activity modules on weapons (roaming waveDamageMod)
  let activityWaveBonus = 0;
  const allGear: GearItem[] = [...weapons, relic, classMod].filter((g): g is GearItem => Boolean(g));
  for (const item of allGear) {
    if (!('affixes' in item) || !Array.isArray(item.affixes)) continue;
    for (const affix of item.affixes as Array<{ category?: string; subStats?: Record<string, number> }>) {
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

  const weapons: Weapon[] = [];
  for (const slot of slots) {
    const weapon = loadout.getWeapon(slot);
    if (weapon) weapons.push(weapon);
  }

  return computeEffectiveDpsFromGear({
    weapons,
    ordnance: loadout.getOrdnance(),
    relic: loadout.getRelic(),
    classMod: loadout.getClassMod(),
    skillDpsMult,
  });
}
