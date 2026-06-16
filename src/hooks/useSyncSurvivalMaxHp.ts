/**
 * Keeps the survival store's live HP capacity aligned with the same
 * loadout-based max-HP contract used by the Hunter Totals HUD.
 *
 * The survival slice starts at a fallback maxHp and only updates through
 * recomputeMaxHp(). Comparing before recomputing avoids per-render churn while
 * ensuring the HP chip and stat source strip do not disagree after shield or
 * level changes.
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
