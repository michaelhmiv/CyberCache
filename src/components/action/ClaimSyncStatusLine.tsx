import React from 'react';
import { useActivityStore } from '@/store/slices/activitySlice';
import { useIdleTickerStore } from '@/store/slices/idleTickerSlice';

/**
 * Claim sync stall notice (idle ticker): after two consecutive
 * roaming-claim cycles fail to land (initial attempt + the identical
 * same-batch retry), the ticker exposes `syncStalled` and this line
 * appears above the roaming stage. Without it the scene keeps
 * animating while nothing banks — the exact silent failure this
 * replaces. It clears on the next landed claim.
 *
 * Display only: it reads the ticker's flag and the current activity;
 * it starts, stops, and retries nothing itself.
 */
export const ClaimSyncStatusLine: React.FC = () => {
  const syncStalled = useIdleTickerStore((s) => s.syncStalled);
  const activityKind = useActivityStore((s) => s.current.kind);

  if (!syncStalled || activityKind !== 'roaming_loot') return null;

  return (
    <div
      data-testid="claim-sync-status"
      role="status"
      className="relative border border-border/60 bg-surface/80 px-2 py-1.5 text-[11px] leading-snug text-amber [overflow-wrap:anywhere]"
    >
      Connection interrupted — rewards paused, retrying.
    </div>
  );
};
