import React, { useEffect, useRef, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import {
  markStandingsEarningsSeen,
} from '@/components/profile/standingsBadge';
import {
  deriveWeeklyEarnings,
  type WeeklyEarningRow,
} from '@/components/leaderboard/weeklyEarnings';
import type {
  WeeklyLeaderboards,
} from '@/lib/api/leaderboardService';

/**
 * Your Weekly Earnings (Standings) — the destination the Hunter
 * Standings badge points at. Weekly race rewards are PAID
 * AUTOMATICALLY by settlement (src/server/leaderboards/store.ts:
 * cache keys credited and the drop-luck buff started inside the
 * settlement transaction; there is no claim op for race rewards).
 * This panel is the record the player was promised: per settled
 * week, the race, their finish, and the reward — hero-sized, per
 * the numbers law — with the auto-pay stated in plain words so
 * nobody hunts for a claim button that does not exist.
 *
 * Viewing the panel marks the week seen (standingsBadge seen
 * marker), which clears the door pill / rail chip notice: the
 * signal exists to bring the player here, and here is where it
 * resolves. Guests see the panel's shape with the honest empty
 * state — guests cannot place under a name, so they never carry
 * earnings (guest-visibility law: the surface renders for everyone).
 */

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const weekRangeLabel = (startIso: string, endsAtIso: string): string => {
  const lastDay = new Date(Date.parse(endsAtIso) - 86_400_000).toISOString();
  return `${shortDay(startIso)} – ${shortDay(lastDay)}`;
};

const EarningRow: React.FC<{ row: WeeklyEarningRow }> = ({ row }) => {
  const { reward } = row;
  const buffPct = Math.round(reward.buff_bonus * 100);
  return (
    <div
      data-testid={`weekly-earnings-row-${row.raceId}`}
      className="flex items-center gap-3 border border-amber/40 bg-amber/10 px-2.5 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-black uppercase tracking-wide text-text-primary">{row.label}</div>
        <div className="mt-0.5 text-[11px] text-text-muted">Finished #{reward.rank}</div>
        {reward.cache_keys > 0 && reward.buff_bonus > 0 && (
          <div className="mt-0.5 text-[11px] font-bold text-green">
            +{buffPct}% drop luck for {reward.buff_hours}h
          </div>
        )}
      </div>
      {reward.cache_keys > 0 ? (
        <div className="shrink-0 text-right">
          <div className="text-[26px] font-black leading-none tabular-nums text-amber">
            +{reward.cache_keys}
          </div>
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-text-muted">
            Cache {reward.cache_keys === 1 ? 'key' : 'keys'}
          </div>
        </div>
      ) : (
        <div className="shrink-0 text-right">
          <div className="text-[26px] font-black leading-none tabular-nums text-green">
            +{buffPct}%
          </div>
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-text-muted">
            Drop luck · {reward.buff_hours}h
          </div>
        </div>
      )}
    </div>
  );
};

export const WeeklyEarningsPanel: React.FC<{
  data: WeeklyLeaderboards | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Incremented by the Hunter door tap: scroll to + highlight the panel. */
  focusNonce?: number;
}> = ({ data, loading, error, onRetry, focusNonce = 0 }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const handledNonce = useRef(0);

  const state = deriveWeeklyEarnings(data);
  const prev = data?.previous_week ?? null;

  // Viewing the panel with earnings on it marks the week seen —
  // the badge notice that pointed here clears.
  useEffect(() => {
    if (state.kind === 'earnings' && prev?.key) {
      markStandingsEarningsSeen(prev.key);
    }
  }, [state.kind, prev?.key]);

  // The door/badge tap lands the player ON the panel: scroll it
  // into view and hold a highlight ring briefly, once the payload
  // has landed (the panel may mount before the fetch resolves).
  useEffect(() => {
    if (focusNonce === 0 || loading || handledNonce.current === focusNonce) return;
    handledNonce.current = focusNonce;
    const el = panelRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    setHighlighted(true);
    const timer = window.setTimeout(() => setHighlighted(false), 2600);
    return () => window.clearTimeout(timer);
  }, [focusNonce, loading]);

  const scrollToRaces = () => {
    const el = document.getElementById('weekly-races-card');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  return (
    <div
      ref={panelRef}
      id="weekly-earnings-panel"
      data-testid="weekly-earnings-panel"
      className={`scroll-mt-2 transition-shadow ${highlighted ? 'ring-2 ring-amber' : ''}`}
    >
      <MobileCard rarityColor="#FF9000">
        <div className="flex items-center gap-2">
          <PxIcon name="trophy" size={13} className="text-amber" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">
            Your Weekly Earnings
          </div>
          {prev && (
            <div className="ml-auto whitespace-nowrap text-[10px] text-text-muted">
              {weekRangeLabel(prev.start, prev.ends_at)}
            </div>
          )}
        </div>

        {loading ? (
          <div className="mt-2 space-y-2" data-testid="weekly-earnings-loading">
            <div className="h-4 w-2/3 animate-pulse rounded bg-bg" />
            <div className="h-10 animate-pulse rounded bg-bg" />
          </div>
        ) : error || !data ? (
          <div className="mt-2" data-testid="weekly-earnings-error">
            <div className="text-[11px] text-text-muted">
              Your weekly earnings could not be loaded.
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="bl-primary mt-2 px-3 py-1.5 text-[11px] font-black"
            >
              Retry
            </button>
          </div>
        ) : state.kind === 'earnings' ? (
          <div className="mt-2 space-y-1.5">
            <div
              data-testid="weekly-earnings-autopay-note"
              className="text-[11px] leading-snug text-text-muted"
            >
              Race rewards pay out automatically when the week settles — no claim needed.
              These are already in your account.
            </div>
            {state.rows.map((row) => (
              <EarningRow key={row.raceId} row={row} />
            ))}
            {state.rows.length > 1 && state.totalCacheKeys > 0 && (
              <div className="text-right text-[11px] font-bold text-text-muted">
                Total paid: {state.totalCacheKeys} cache {state.totalCacheKeys === 1 ? 'key' : 'keys'}
              </div>
            )}
          </div>
        ) : state.kind === 'pending' ? (
          <div className="mt-2 text-[11px] leading-snug text-text-muted" data-testid="weekly-earnings-pending">
            Last week&apos;s races are final. Your rewards settle at the next daily heartbeat —
            they pay automatically and land right here.
          </div>
        ) : state.kind === 'placed' ? (
          <div className="mt-2 space-y-2" data-testid="weekly-earnings-placed">
            <div className="text-[11px] leading-snug text-text-muted">
              You raced last week but finished outside the rewards — paid places are the
              top 10 at each race&apos;s qualifying minimum.
            </div>
            <button
              type="button"
              onClick={scrollToRaces}
              className="border border-amber/60 bg-amber/15 px-3 py-1.5 text-[11px] font-black text-amber"
            >
              See this week&apos;s races
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-2" data-testid="weekly-earnings-empty">
            <div className="text-[11px] leading-snug text-text-muted">
              No weekly earnings yet — your best placements land here Mondays.
            </div>
            <button
              type="button"
              onClick={scrollToRaces}
              className="border border-amber/60 bg-amber/15 px-3 py-1.5 text-[11px] font-black text-amber"
            >
              See this week&apos;s races
            </button>
          </div>
        )}
      </MobileCard>
    </div>
  );
};
