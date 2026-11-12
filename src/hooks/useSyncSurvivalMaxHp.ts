/**
 * Keeps the survival store's live HP capacity aligned with the ONE
 * canonical HP pool (computeCanonicalMaxHp — owner ruling, audit
 * HTR-03, 2026-11-12): chassis scaled by Cache Rank Thick Skin,
 * shield HP unscaled on top. The same pool the Hunter Totals
 * snapshot prints and the boss sim settles.
 *
 * The survival slice starts at a fallback maxHp and only updates
 * through recomputeMaxHp(). Comparing before recomputing avoids
 * per-render churn while ensuring the HP chip and stat source strip
 * do not disagree after shield, level, or Thick Skin changes.
 */
import { useEffect } from 'react';
import { computeCanonicalMaxHp } from '@/lib/combat/damageContract';
import { cacheRankBonuses } from '@/content/cacheRank';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';

export function useSyncSurvivalMaxHp(playerLevel: number, shieldHp: number) {
  const cacheRankSpends = usePlayerStore((s) => s.cacheRankSpends);
  const cacheRankMaxHpBonus = cacheRankBonuses(cacheRankSpends).maxHp;
  useEffect(() => {
    const expected = computeCanonicalMaxHp(playerLevel, shieldHp, cacheRankMaxHpBonus);
    const currentMax = useSurvivalStore.getState().maxHp;
    if (expected !== currentMax) {
      useSurvivalStore.getState().recomputeMaxHp(playerLevel, shieldHp, cacheRankMaxHpBonus);
    }
  }, [playerLevel, shieldHp, cacheRankMaxHpBonus]);
}
