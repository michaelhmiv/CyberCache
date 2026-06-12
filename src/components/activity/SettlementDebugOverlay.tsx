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
import { useActivityStore, useOfflineRecapStore, usePlayerStore } from '@/store';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';

// Read debug flag at module level
const DEBUG =
  typeof import.meta !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).env?.VITE_DEBUG_SETTLEMENT === 'true';

interface DiagnosticState {
  activeAction: string;
  lastHeartbeat: string | null;
  lastRoamingSettledAt: string | null;
  lastClaimedTick: number;
  lastSettlementResult: string;
  lastNoopReason: string | null;
  lastError: string | null;
  settledTicks: number;
  timeAway: string;
  visibleSince: number | null;
}

export function SettlementDebugOverlay() {
  if (!DEBUG) return null;

  const [visibleSince, setVisibleSince] = useState<number | null>(null);

  // Track visibility
  useEffect(() => {
    const handleVisible = () => setVisibleSince(Date.now());
    const handleHidden = () => setVisibleSince(null);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) handleHidden();
      else handleVisible();
    });
    window.addEventListener('focus', handleVisible);

    // Initial state
    if (!document.hidden) handleVisible();

    return () => {
      document.removeEventListener('visibilitychange', handleHidden);
      window.removeEventListener('focus', handleVisible);
    };
  }, []);

  // Read store state reactively
  const activity = useActivityStore((s) => s.current);
  const lastSettlement = useOfflineRecapStore((s) => s.lastSettlement);
  const dismissed = useOfflineRecapStore((s) => s.dismissed);
  const playerLevel = usePlayerStore((s) => s.playerLevel);

  const diag: DiagnosticState = {
    activeAction: activity.kind ?? 'unknown',
    lastHeartbeat: activity.lastHeartbeatAt ?? null,
    lastRoamingSettledAt:
      (lastSettlement?.profile as Record<string, unknown> | undefined)
        ?.last_roaming_settled_at as string ?? null,
    lastClaimedTick:
      ((lastSettlement?.profile as Record<string, unknown> | undefined)
        ?.last_claimed_tick as number) ?? 0,
    lastSettlementResult: lastSettlement
      ? `✅ ${lastSettlement.ticksSettled}t`
      : 'none',
    lastNoopReason: lastSettlement ? null : 'none',
    lastError: null,
    settledTicks: lastSettlement?.ticksSettled ?? 0,
    timeAway: lastSettlement?.timeAway ?? 'n/a',
    visibleSince,
  };

  const nowVisible = document.visibilityState === 'visible';
  const hiddenDuration = visibleSince ? Date.now() - visibleSince : 0;

  return (
    <div className="fixed bottom-20 right-2 z-[999] bg-black/85 border border-amber/30 rounded p-2 text-[9px] font-mono text-amber/70 max-w-[220px] backdrop-blur select-none pointer-events-none">
      <div className="text-[10px] font-black text-amber mb-1">🔍 SETTLEMENT DIAG</div>
      <div className="space-y-0.5">
        <Row label="Activity" value={diag.activeAction} />
        <Row label="Heartbeat" value={diag.lastHeartbeat ? fmtAgo(diag.lastHeartbeat) : 'none'} />
        <Row label="SettledAt" value={diag.lastRoamingSettledAt ? fmtAgo(diag.lastRoamingSettledAt) : 'null'} />
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

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}
