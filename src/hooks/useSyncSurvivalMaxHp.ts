import { useEffect } from 'react';
import { computeHunterMaxHp } from '@/lib/combat/damageContract';
import { useSurvivalStore } from '@/store/slices/survivalSlice';

/**
 * Keep the survival store's maxHp in sync with the hunter's current level
 * and equipped shield. The survival slice is the source of truth for combat
 * HP, but it only updates maxHp when recomputeMaxHp is called. This hook
 * bridges the loadout/player profile changes into the combat slice.
 *
 * Call it once at the dashboard level (or any screen that shows live HP).
 * It compares the expected max to the current max before dispatching so it
 * does not churn state on every render.
 */
export function useSyncSurvivalMaxHp(playerLevel: number, shieldHp: number) {
  useEffect(() => {
    const expected = computeHunterMaxHp(playerLevel, shieldHp);
    const currentMax = useSurvivalStore.getState().maxHp;
    if (expected !== currentMax) {
      useSurvivalStore.getState().recomputeMaxHp(playerLevel, shieldHp);
    }
  }, [playerLevel, shieldHp]);
}
