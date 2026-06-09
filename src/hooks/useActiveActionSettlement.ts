import { useEffect } from 'react';
import { settleActiveActivityRewards, markActiveActionRewardTick } from '@/lib/activity/activitySettlement';
import { useActivityStore, usePlayerStore } from '@/store';

const SETTLE_INTERVAL_MS = 30000;
const REWARD_TICK_STAMP_THROTTLE_MS = 1200;

export function useActiveActionSettlement(enabled: boolean, userId?: string | null): void {
  useEffect(() => {
    if (!enabled) return undefined;

    let mounted = true;
    let lastRewardStamp = 0;

    const settle = () => {
      if (!mounted) return;
      void settleActiveActivityRewards({ userId }).catch((error) => {
        console.warn('Active action settlement skipped:', error instanceof Error ? error.message : error);
      });
    };

    const unsubscribePlayer = usePlayerStore.subscribe((state, previous) => {
      const action = useActivityStore.getState().current;
      if (action.kind !== 'roaming_loot') return;

      const rewardChanged = state.xp !== previous.xp
        || state.credits !== previous.credits
        || state.scrap !== previous.scrap
        || state.cacheKeys !== previous.cacheKeys
        || state.cacheKeyFragments !== previous.cacheKeyFragments
        || state.materials !== previous.materials
        || state.essences !== previous.essences;

      if (!rewardChanged) return;
      const now = Date.now();
      if (now - lastRewardStamp < REWARD_TICK_STAMP_THROTTLE_MS) return;
      lastRewardStamp = now;
      markActiveActionRewardTick();
    });

    settle();
    const interval = window.setInterval(settle, SETTLE_INTERVAL_MS);
    const onResume = () => settle();
    const onVisibility = () => {
      if (!document.hidden) settle();
    };

    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onResume);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribePlayer();
    };
  }, [enabled, userId]);
}
