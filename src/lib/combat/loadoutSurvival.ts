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
 * Read the hunter's total effective DPS from the equipped weapons.
 * Used by the kill cycle to compute per-tick damage to the current
 * monster target. Returns 0 if no weapons are equipped.
 *
 * Implementation note: we sum `computeStandardDps` across all
 * equipped weapons. Standard DPS is the right baseline for the
 * roaming kill cycle (no boss-relative context). Future PRs may
 * swap to a context-aware value when the hunter is in a boss fight.
 */
export function loadoutEffectiveDps(): number {
  const loadout = useLoadoutStore.getState();
  const skillBonuses = useSkillStore.getState().getBonuses();
  const skillDpsMult = 1 + (skillBonuses.dps || 0);
  const slots: Array<'primary' | 'secondary' | 'heavy'> = ['primary', 'secondary', 'heavy'];
  let total = 0;
  for (const slot of slots) {
    const weapon = loadout.getWeapon(slot);
    if (weapon) {
      total += computeStandardDps(weapon) * (1 + (weapon.waveDamageMod || 0));
    }
  }
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
