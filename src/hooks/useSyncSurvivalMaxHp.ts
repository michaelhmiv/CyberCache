/**
 * useSyncSurvivalMaxHp — keep `useSurvivalStore.maxHp` aligned with the
 * loadout-based max HP computed by `computeHunterMaxHp`.
 *
 * `useSurvivalStore` initializes `maxHp` to a constant (700) and only
 * updates through `recomputeMaxHp`, which was previously never called
 * outside tests. As a result, the HUD's source strip would correctly
 * show the loadout-based max HP while the health chip showed the stale
 * store value, and any capacity increase (e.g. equip a shield) was not
 * reflected in the HP pool.
 *
 * The hook compares the expected value to the store's current value and
 * only calls `recomputeMaxHp` when they differ, so it never churns state
 * on every render.
 */
import { useEffect } from 'react';
import { computeHunterMaxHp } from '@/lib/combat/damageContract';
import { useSurvivalStore } from '@/store/slices/survivalSlice';

export function useSyncSurvivalMaxHp(playerLevel: number, shieldHp: number) {
  useEffect(() => {
    const expected = computeHunterMaxHp(playerLevel, shieldHp);
    const currentMax = useSurvivalStore.getState().maxHp;
    if (expected !== currentMax) {
      useSurvivalStore.getState().recomputeMaxHp(playerLevel, shieldHp);
    }
  }, [playerLevel, shieldHp]);
}
