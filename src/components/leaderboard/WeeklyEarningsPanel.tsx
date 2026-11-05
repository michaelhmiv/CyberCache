import React, { useEffect, useRef, useState } from 'react';
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
import { LcdWell, Led, Panel, PanelLabel } from './StandingsConsoleKit';
import {
  AMBER,
  FAINT,
  GOLD,
  GREEN,
  INK,
  MUT,
  STEEL_DARK,
  headStyle,
  monoStyle,
} from './standingsConsoleTokens';

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
 * Restyled 2026-11-05 to the Standings "Instrument panel" register
 * (owner pick B): the record now reads as a settlement readout —
 * a lit PAYOUT · AUTO — NO CLAIM lamp over the shipped auto-pay
 * sentence verbatim, totals in an LCD bank, per-race tally lines.
 * Every state, string, and testid of the shipped panel is kept.
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
      className="flex items-center gap-3 px-2.5 py-2"
      style={{ border: `1px solid ${STEEL_DARK}`, background: 'rgba(0,0,0,0.35)' }}
    >
      <Led lit color={GOLD} size={8} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold uppercase" style={{ ...headStyle, color: INK }}>{row.label}</div>
        <div className="mt-0.5" style={{ ...monoStyle, fontSize: 11, color: FAINT }}>
          Finished #{reward.rank}
        </div>
        {reward.cache_keys > 0 && reward.buff_bonus > 0 && (
          <div className="mt-0.5 text-[11px] font-bold" style={{ color: GREEN }}>
            +{buffPct}% drop luck for {reward.buff_hours}h
          </div>
        )}
      </div>
      {reward.cache_keys > 0 ? (
        <div className="shrink-0 text-right">
          <div className="font-bold leading-none" style={{ ...monoStyle, fontSize: 26, color: GOLD }}>
            +{reward.cache_keys}
          </div>
          <div
            className="mt-0.5 text-[11px] font-bold uppercase"
            style={{ ...monoStyle, color: FAINT, letterSpacing: '0.08em' }}
          >
            Cache {reward.cache_keys === 1 ? 'key' : 'keys'}
          </div>
        </div>
      ) : (
        <div className="shrink-0 text-right">
          <div className="font-bold leading-none" style={{ ...monoStyle, fontSize: 26, color: GREEN }}>
            +{buffPct}%
          </div>
          <div
            className="mt-0.5 text-[11px] font-bold uppercase"
            style={{ ...monoStyle, color: FAINT, letterSpacing: '0.08em' }}
          >
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

  const racesButtonStyle: React.CSSProperties = {
    border: `1px solid ${AMBER}`,
    color: '#FFB03A',
    background: 'rgba(255,144,0,0.12)',
  };

  return (
    <div
      ref={panelRef}
      id="weekly-earnings-panel"
      data-testid="weekly-earnings-panel"
      className={`scroll-mt-2 transition-shadow ${highlighted ? 'ring-2 ring-amber' : ''}`}
    >
      <Panel>
        <PanelLabel
          label="Settlement readout"
          right={prev ? `LAST WEEK · ${weekRangeLabel(prev.start, prev.ends_at).toUpperCase()}` : undefined}
        />

        {loading ? (
          <div className="space-y-2" data-testid="weekly-earnings-loading">
            <div className="h-4 w-2/3 animate-pulse rounded bg-bg" />
            <div className="h-10 animate-pulse rounded bg-bg" />
          </div>
        ) : error || !data ? (
          <div data-testid="weekly-earnings-error">
            <div className="text-[11px]" style={{ color: MUT }}>
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
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5" style={{ ...monoStyle, fontSize: 11, color: GREEN }}>
              <Led lit color={GREEN} size={8} />
              PAYOUT · AUTO — NO CLAIM
            </div>
            <div
              data-testid="weekly-earnings-autopay-note"
              className="text-[11px] leading-snug"
              style={{ color: MUT }}
            >
              Race rewards pay out automatically when the week settles — no claim needed.
              These are already in your account.
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              <LcdWell value={`+${state.totalCacheKeys}`} label="Keys paid" color={GOLD} valueSize={24} />
              <LcdWell
                value={`#${Math.min(...state.rows.map((r) => r.reward.rank))}`}
                label="Best finish"
                valueSize={24}
              />
              {state.rows.some((r) => r.reward.buff_bonus > 0) ? (
                <LcdWell
                  value={`+${Math.round(Math.max(...state.rows.map((r) => r.reward.buff_bonus)) * 100)}%`}
                  label="Drop luck"
                  color={GREEN}
                  valueSize={24}
                />
              ) : (
                <LcdWell value={String(state.rows.length)} label="Races paid" valueSize={24} />
              )}
            </div>
            {state.rows.map((row) => (
              <EarningRow key={row.raceId} row={row} />
            ))}
            {state.rows.length > 1 && state.totalCacheKeys > 0 && (
              <div className="text-right text-[11px] font-bold" style={{ ...monoStyle, color: MUT }}>
                Total paid: {state.totalCacheKeys} cache {state.totalCacheKeys === 1 ? 'key' : 'keys'}
              </div>
            )}
          </div>
        ) : state.kind === 'pending' ? (
          <div className="text-[11px] leading-snug" style={{ color: MUT }} data-testid="weekly-earnings-pending">
            Last week&apos;s races are final. Your rewards settle at the next daily heartbeat —
            they pay automatically and land right here.
          </div>
        ) : state.kind === 'placed' ? (
          <div className="space-y-2" data-testid="weekly-earnings-placed">
            <div className="text-[11px] leading-snug" style={{ color: MUT }}>
              You raced last week but finished outside the rewards — paid places are the
              top 10 at each race&apos;s qualifying minimum.
            </div>
            <button
              type="button"
              onClick={scrollToRaces}
              className="px-3 py-1.5 text-[11px] font-black"
              style={racesButtonStyle}
            >
              See this week&apos;s races
            </button>
          </div>
        ) : (
          <div className="space-y-2" data-testid="weekly-earnings-empty">
            <div className="text-[11px] leading-snug" style={{ color: MUT }}>
              No weekly earnings yet — your best placements land here Mondays.
            </div>
            <button
              type="button"
              onClick={scrollToRaces}
              className="px-3 py-1.5 text-[11px] font-black"
              style={racesButtonStyle}
            >
              See this week&apos;s races
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
};
