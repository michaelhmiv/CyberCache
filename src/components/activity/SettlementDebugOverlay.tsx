/**
 * SettlementDebugOverlay — Dev-Only Settlement Diagnostic
 *
 * Renders a small translucent overlay in the bottom-right corner showing
 * key settlement state. Only rendered when VITE_DEBUG_SETTLEMENT is set.
 *
 * Displays:
 *   - Active action kind
 *   - Last heartbeat timestamp
 *   - last_roaming_settled_at
 *   - last_claimed_tick
 *   - Last settlement result summary
 *   - Last no-op reason (if any)
 *   - Last route error (if any)
 *
 * This makes mobile settlement issues immediately visible during
 * development without needing to inspect network/Supabase logs.
 */

import React, { useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { useActivityStore, useOfflineRecapStore, usePlayerStore } from '@/store';

// Read debug flag at module level
const DEBUG =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.VITE_DEBUG_SETTLEMENT === 'true';

export function SettlementDebugOverlay() {
  // Hooks must be called unconditionally — the if (!DEBUG) return null
  // gate applies only to rendering, not to hook declarations.
  const [visibleSince, setVisibleSince] = useState<number | null>(() =>
    DEBUG && typeof document !== 'undefined' && document.visibilityState === 'visible'
      ? Date.now()
      : null
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!DEBUG) return;
    const handleVisible = () => setVisibleSince(Date.now());
    const handleHidden = () => setVisibleSince(null);

    const onVisibility = () => {
      if (document.hidden) handleHidden();
      else handleVisible();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', handleVisible);

    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', handleVisible);
      window.clearInterval(timer);
    };
  }, []);

  const activity = useActivityStore((s) => s.current);
  const lastSettlement = useOfflineRecapStore((s) => s.lastSettlement);
  const dismissed = useOfflineRecapStore((s) => s.dismissed);
  const playerLevel = usePlayerStore((s) => s.level);

  // Render gate — only show the overlay when DEBUG is enabled
  if (!DEBUG) return null;

  const diag = {
    activeAction: activity.kind ?? 'unknown',
    lastHeartbeat: activity.lastHeartbeatAt ?? null,
    lastRoamingSettledAt:
      (lastSettlement?.profile as Record<string, unknown> | undefined)
        ?.last_roaming_settled_at as string ?? null,
    lastClaimedTick:
      ((lastSettlement?.profile as Record<string, unknown> | undefined)
        ?.last_claimed_tick as number) ?? 0,
    lastSettlementResult: lastSettlement
      ? `settled ${lastSettlement.ticksSettled}t`
      : 'none',
    lastNoopReason: lastSettlement ? null : 'none',
    lastError: null,
    settledTicks: lastSettlement?.ticksSettled ?? 0,
    timeAway: lastSettlement?.timeAway ?? 'n/a',
    visibleSince,
  };

  const nowVisible = document.visibilityState === 'visible';
  const hiddenDuration = visibleSince ? now - visibleSince : 0;

  return (
    <div className="fixed bottom-20 right-2 z-[999] bg-black/85 border border-amber/30 rounded p-2 text-[9px] font-mono text-amber/70 max-w-[220px] backdrop-blur select-none pointer-events-none">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-black text-amber"><PxIcon name="search" size={13} /> SETTLEMENT DIAG</div>
      <div className="space-y-0.5">
        <Row label="Activity" value={diag.activeAction} />
        <Row label="Heartbeat" value={diag.lastHeartbeat ? fmtAgo(diag.lastHeartbeat, now) : 'none'} />
        <Row label="SettledAt" value={diag.lastRoamingSettledAt ? fmtAgo(diag.lastRoamingSettledAt, now) : 'null'} />
        <Row label="Tick" value={String(diag.lastClaimedTick)} />
        <Row label="Result" value={diag.lastSettlementResult} />
        {dismissed && lastSettlement && <Row label="Dismissed" value="yes" warn />}
        <Row label="Hidden" value={nowVisible ? `${hiddenDuration / 1000}s visible` : 'hidden'} />
        <Row label="Lvl" value={String(playerLevel ?? '?')} />
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-amber/50">{label}</span>
      <span className={warn ? 'text-red/70' : 'text-amber/80'}>{value}</span>
    </div>
  );
}

function fmtAgo(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}
