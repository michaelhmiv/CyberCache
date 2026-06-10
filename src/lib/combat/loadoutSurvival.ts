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
import { computeHunterMaxHp, type HunterSurvivalStats } from './damageContract';
import { computeStandardDps } from '@/lib/stats/dpsChain';

/**
 * Build the survival stats object the damage contract needs.
 * Exported for use by the idle ticker. Wraps a fresh read of the
 * relevant store state at call time.
 */
export function loadoutSurvivalStats(): HunterSurvivalStats {
  const level = usePlayerStore.getState().level;
  const shieldCapacity = equippedShieldHp();
  const currentShieldHp = useSurvivalStore.getState().shieldHp;
  return {
    maxHp: computeHunterMaxHp(level, shieldCapacity),
    shieldHp: currentShieldHp,
    dodgeChance: 0, // no dodge affix yet — future PR
    elementalResist: 0, // no elemental resist affix yet — future PR
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
  const slots: Array<'primary' | 'secondary' | 'heavy'> = ['primary', 'secondary', 'heavy'];
  let total = 0;
  for (const slot of slots) {
    const weapon = loadout.getWeapon(slot);
    if (weapon) {
      total += computeStandardDps(weapon);
    }
  }
  return total;
}
