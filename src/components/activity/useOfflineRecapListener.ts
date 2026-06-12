/**
 * Offline Recap Listener
 *
 * Listens for the 'cybercache:activity-settled' CustomEvent dispatched
 * by activitySettlement.ts after successful offline settlement.
 * Pushes the result into useOfflineRecapStore for the OfflineRecap
 * component to render.
 */

import { useEffect } from 'react';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';

export function useOfflineRecapListener() {
  const setSettlement = useOfflineRecapStore((s) => s.setSettlement);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SettlementRecap>).detail;
      if (detail && detail.settled) {
        setSettlement(detail);
      }
    };

    window.addEventListener('cybercache:activity-settled', handler);
    return () => window.removeEventListener('cybercache:activity-settled', handler);
  }, [setSettlement]);
}
