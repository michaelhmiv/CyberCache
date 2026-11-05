/**
 * Standings — Variant E: "Quiet plates" (PROTOTYPE, design pass
 * 2026-11-05; never shipped from this branch).
 *
 * The boards at rest. Where variant A machined the page into
 * plates, wells, bolts and stamps, E removes the furniture: no
 * cards, no frames, no gauge wells, no rotated stamps — the page
 * is set like the standings page of a broadsheet. Structure comes
 * from air, one hairline at a time, and a strict type scale.
 * Rank is oversized type (the monument at the head, big numerals
 * down the board); everything else is prose at reading size.
 * Amber appears only where the money or the reader is: the paid
 * amounts in the earnings record, and the word YOU beside the
 * reader's own name. Found vs not-found, mine vs theirs, reads
 * through ink and weight, never through chrome.
 *
 * The components consume the REAL payload types and the shipped
 * derivations (deriveWeeklyEarnings, formatLeaderboardValue,
 * LEADERBOARD_METRIC_UNITS, markStandingsEarningsSeen) with the
 * same props the shipped panels take, so a production slice swaps
 * fixtures for the screen's service calls without touching the
 * presentation. All shipped copy is carried verbatim — including
 * the auto-pay sentence: race rewards are paid by settlement and
 * there is no claim operation on this page, in any register.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { resolveLookView } from '@/lib/pixel/lookResolution';
import type { HunterLookView } from '@/content/skins';
import {
  LEADERBOARD_METRIC_UNITS,
  formatLeaderboardValue,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type MyLeaderboardRank,
  type WeeklyLeaderboards,
  type WeeklyRaceBoard,
} from '@/lib/api/leaderboardService';
import {
  deriveWeeklyEarnings,
  type WeeklyEarningRow,
} from '@/components/leaderboard/weeklyEarnings';
import { markStandingsEarningsSeen } from '@/components/profile/standingsBadge';

/* ---------------- voice ---------------- */

/** Bebas Neue without the shipped .bl-title's stacked shadows —
 *  the quiet register sets display type plain. */
const DISPLAY: React.CSSProperties = {
  fontFamily: "'Bebas Neue', 'Chakra Petch', system-ui, sans-serif",
  letterSpacing: '0.04em',
};

const HAIRLINE = 'border-white/10';

const METRIC_LABELS: Record<LeaderboardMetric, string> = {
  level: 'Level',
  xp: 'XP',
  net_worth: 'Net Worth',
  total_kills: 'Kills',
  kdr: 'K/D',
  highest_boss_tier: 'Boss Tier',
  total_mastery_xp: 'Mastery XP',
  highest_mastery_level: 'Mastery Lv',
  legendary_items: 'Legendaries',
  total_items: 'Items',
};

const METRIC_ORDER: LeaderboardMetric[] = [
  'level',
  'xp',
  'net_worth',
  'total_kills',
  'kdr',
  'highest_boss_tier',
  'total_mastery_xp',
  'highest_mastery_level',
  'legendary_items',
  'total_items',
];

const PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
  all_time: 'All Time',
  weekly: 'Weekly',
  daily: 'Daily',
};

const PERIOD_ORDER: LeaderboardPeriod[] = ['all_time', 'weekly', 'daily'];

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const weekRangeLabel = (startIso: string, endsAtIso: string): string => {
  const lastDay = new Date(Date.parse(endsAtIso) - 86_400_000).toISOString();
  return `${shortDay(startIso)} – ${shortDay(lastDay)}`;
};

const trendLine = (entry: { previous_value: number | null; trend: number }): string =>
  entry.previous_value != null ? `${Math.round(entry.trend * 100)}% vs prior` : 'No prior data';

/* ---------------- the opening ---------------- */

/**
 * Title, one honest paragraph, and the reader's own standing set
 * as the page's monument: the rank as a single oversized numeral,
 * the facts resting at its baseline. The monument follows the
 * board's current metric/period — it is myRank, printed large.
 */
export const QuietOpening: React.FC<{
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  myRank: MyLeaderboardRank | null;
  myUsername: string;
}> = ({ metric, period, myRank, myUsername }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.header
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="pt-8"
    >
      <h1 style={DISPLAY} className="text-[54px] leading-none text-text-primary">
        Standings
      </h1>
      <p className="mt-4 max-w-[34ch] text-[13px] leading-relaxed text-text-secondary">
        Every hunter on one board. The week&apos;s races run above; the standings
        stand below. Race rewards are paid by settlement — there is nothing to
        claim here.
      </p>

      <div className="mt-12">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
          Your standing — {METRIC_LABELS[metric]} · {PERIOD_LABELS[period]}
        </div>
        {myRank ? (
          <div className="mt-3 flex items-end gap-5">
            <div
              style={DISPLAY}
              className="text-[112px] leading-[0.82] text-text-primary"
              data-testid="quiet-my-rank"
            >
              {myRank.rank}
            </div>
            <div className="pb-2">
              <div className="text-[17px] font-semibold text-text-primary">{myUsername}</div>
              <div className="mt-1 text-[15px] tabular-nums text-text-secondary">
                {formatLeaderboardValue(metric, myRank.value)}{' '}
                <span className="text-text-muted">{LEADERBOARD_METRIC_UNITS[metric]}</span>
              </div>
              <div className="mt-1 text-[12px] text-text-muted">
                of {myRank.total_players} hunters · {trendLine(myRank)}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
            You are not on this board yet — rankings fill in from play.
          </p>
        )}
      </div>
    </motion.header>
  );
};

/* ---------------- earnings ---------------- */

const QuietEarningRow: React.FC<{ row: WeeklyEarningRow }> = ({ row }) => {
  const { reward } = row;
  const buffPct = Math.round(reward.buff_bonus * 100);
  return (
    <div
      data-testid={`weekly-earnings-row-${row.raceId}`}
      className={`flex items-center gap-4 border-t ${HAIRLINE} py-4`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-text-primary">{row.label}</div>
        <div className="mt-0.5 text-[12px] text-text-muted">Finished #{reward.rank}</div>
        {reward.cache_keys > 0 && reward.buff_bonus > 0 && (
          <div className="mt-0.5 text-[12px] text-text-secondary">
            +{buffPct}% drop luck for {reward.buff_hours}h
          </div>
        )}
      </div>
      {reward.cache_keys > 0 ? (
        <div className="shrink-0 text-right">
          <div style={DISPLAY} className="text-[38px] leading-none tabular-nums text-amber">
            +{reward.cache_keys}
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted">
            Cache {reward.cache_keys === 1 ? 'key' : 'keys'}
          </div>
        </div>
      ) : (
        <div className="shrink-0 text-right">
          <div style={DISPLAY} className="text-[38px] leading-none tabular-nums text-amber">
            +{buffPct}%
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted">
            Drop luck · {reward.buff_hours}h
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * The earnings record, in prose. Same states, same wiring, same
 * sentences as the shipped WeeklyEarningsPanel — viewing marks
 * the week seen; a door tap lands here with a calm tint that
 * fades, not a ring. The word "paid" set in type does the work
 * variant A's stamp did.
 */
export const QuietEarnings: React.FC<{
  data: WeeklyLeaderboards | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  focusNonce?: number;
}> = ({ data, loading, error, onRetry, focusNonce = 0 }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const handledNonce = useRef(0);

  const state = deriveWeeklyEarnings(data);
  const prev = data?.previous_week ?? null;

  useEffect(() => {
    if (state.kind === 'earnings' && prev?.key) {
      markStandingsEarningsSeen(prev.key);
    }
  }, [state.kind, prev?.key]);

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
    <section
      ref={panelRef}
      id="weekly-earnings-panel"
      data-testid="weekly-earnings-panel"
      className={`scroll-mt-2 transition-colors duration-1000 ${highlighted ? 'bg-amber/5' : ''}`}
      aria-label="Your weekly earnings"
    >
      <div className="flex items-baseline gap-3">
        <h2 style={DISPLAY} className="text-[30px] leading-none text-text-primary">
          Your weekly earnings
        </h2>
        {prev && (
          <div className="ml-auto whitespace-nowrap text-[11px] text-text-muted">
            {weekRangeLabel(prev.start, prev.ends_at)}
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-5 space-y-3" data-testid="weekly-earnings-loading">
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface" />
          <div className="h-10 animate-pulse rounded bg-surface" />
        </div>
      ) : error || !data ? (
        <div className="mt-5" data-testid="weekly-earnings-error">
          <p className="text-[13px] leading-relaxed text-text-secondary">
            Your weekly earnings could not be loaded.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 min-h-[44px] text-[13px] font-bold text-text-primary underline underline-offset-4"
          >
            Retry
          </button>
        </div>
      ) : state.kind === 'earnings' ? (
        <div className="mt-5">
          <p
            data-testid="weekly-earnings-autopay-note"
            className="max-w-[36ch] text-[13px] leading-relaxed text-text-secondary"
          >
            Race rewards pay out automatically when the week settles — no claim needed.
            These are already in your account.
          </p>
          <div className="mt-4">
            {state.rows.map((row) => (
              <QuietEarningRow key={row.raceId} row={row} />
            ))}
          </div>
          {state.rows.length > 1 && state.totalCacheKeys > 0 && (
            <div className={`flex items-baseline gap-3 border-t ${HAIRLINE} py-4`}>
              <div className="flex-1 text-[13px] font-semibold text-text-primary">Total paid</div>
              <div className="text-right">
                <span style={DISPLAY} className="text-[30px] leading-none tabular-nums text-amber">
                  {state.totalCacheKeys}
                </span>{' '}
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted">
                  Cache {state.totalCacheKeys === 1 ? 'key' : 'keys'}
                </span>
              </div>
            </div>
          )}
        </div>
      ) : state.kind === 'pending' ? (
        <p
          className="mt-5 max-w-[36ch] text-[13px] leading-relaxed text-text-secondary"
          data-testid="weekly-earnings-pending"
        >
          Last week&apos;s races are final. Your rewards settle at the next daily heartbeat —
          they pay automatically and land right here.
        </p>
      ) : state.kind === 'placed' ? (
        <div className="mt-5" data-testid="weekly-earnings-placed">
          <p className="max-w-[36ch] text-[13px] leading-relaxed text-text-secondary">
            You raced last week but finished outside the rewards — paid places are the
            top 10 at each race&apos;s qualifying minimum.
          </p>
          <button
            type="button"
            onClick={scrollToRaces}
            className="mt-1 min-h-[44px] text-[13px] font-bold text-amber underline underline-offset-4"
          >
            See this week&apos;s races
          </button>
        </div>
      ) : (
        <div className="mt-5" data-testid="weekly-earnings-empty">
          <p className="max-w-[36ch] text-[13px] leading-relaxed text-text-secondary">
            No weekly earnings yet — your best placements land here Mondays.
          </p>
          <button
            type="button"
            onClick={scrollToRaces}
            className="mt-1 min-h-[44px] text-[13px] font-bold text-amber underline underline-offset-4"
          >
            See this week&apos;s races
          </button>
        </div>
      )}
    </section>
  );
};

/* ---------------- races ---------------- */

const QuietRaceBlock: React.FC<{
  race: WeeklyRaceBoard;
  myPlayerId?: string | null;
  final?: boolean;
  looks: Record<string, HunterLookView>;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ race, myPlayerId, final, looks, onSelectPlayer }) => {
  const inTop = race.entries.some((e) => e.player_id === myPlayerId);
  const reward = final ? race.my_reward : null;
  const myLook = myPlayerId ? looks[myPlayerId] : undefined;
  return (
    <div className="mt-10">
      <div className="flex items-baseline gap-3">
        <h3 style={DISPLAY} className="text-[22px] leading-none text-text-primary">
          {race.label}
        </h3>
        <div className="ml-auto whitespace-nowrap text-[11px] text-text-muted">
          {race.participant_count === 1 ? '1 racer' : `${race.participant_count} racers`}
        </div>
      </div>
      <p className="mt-2 max-w-[38ch] text-[12px] leading-relaxed text-text-secondary">
        {race.blurb}
      </p>
      {race.min_qualifying_value > 1 && (
        <p className="mt-1 text-[11px] text-text-muted">
          Minimum to qualify: {race.min_qualifying_value.toLocaleString()}{' '}
          {race.unit}
        </p>
      )}

      {race.entries.length === 0 ? (
        <p className="mt-3 text-[12px] text-text-muted">
          No qualifying runs yet{final ? '' : ' this week'}.
        </p>
      ) : (
        <div className="mt-2">
          {race.entries.map((entry) => {
            const isMe = entry.player_id === myPlayerId;
            const look = looks[entry.player_id];
            return (
              <button
                key={entry.player_id}
                type="button"
                data-testid={`standings-row-${entry.player_id}`}
                aria-label={`Open ${entry.username ?? 'Hunter'}'s profile`}
                onClick={() => onSelectPlayer?.(entry.player_id)}
                className={`flex w-full items-center gap-3 border-t ${HAIRLINE} py-2.5 text-left ${
                  isMe ? 'bg-amber/5' : ''
                }`}
              >
                <span
                  style={DISPLAY}
                  className={`w-8 shrink-0 text-[20px] leading-none ${
                    isMe ? 'text-amber' : 'text-text-secondary'
                  }`}
                >
                  {entry.rank}
                </span>
                {look && (
                  <span className="w-7 shrink-0" data-testid={`standings-portrait-${entry.player_id}`}>
                    <HunterPortrait look={resolveLookView(look)} className="h-9" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text-primary">
                  {entry.username ?? 'Vault Runner'}
                  {isMe && (
                    <span className="ml-2 text-[11px] font-bold uppercase tracking-[0.12em] text-amber">
                      You
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap text-[15px] font-bold tabular-nums text-text-primary">
                  {entry.value.toLocaleString('en-US')}{' '}
                  <span className="text-[11px] font-semibold text-text-muted">{race.unit}</span>
                </span>
              </button>
            );
          })}
          {race.me && !inTop && myPlayerId && (
            <button
              type="button"
              data-testid="standings-row-me"
              aria-label="Open your public profile"
              onClick={() => onSelectPlayer?.(myPlayerId)}
              className={`flex w-full items-center gap-3 border-t ${HAIRLINE} bg-amber/5 py-2.5 text-left`}
            >
              <span style={DISPLAY} className="w-8 shrink-0 text-[20px] leading-none text-amber">
                {race.me.rank}
              </span>
              {myLook && (
                <span className="w-7 shrink-0" data-testid="standings-portrait-me">
                  <HunterPortrait look={resolveLookView(myLook)} className="h-9" />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text-primary">
                You
              </span>
              <span className="whitespace-nowrap text-[15px] font-bold tabular-nums text-text-primary">
                {race.me.value.toLocaleString('en-US')}{' '}
                <span className="text-[11px] font-semibold text-text-muted">{race.unit}</span>
              </span>
            </button>
          )}
        </div>
      )}

      {reward && (
        <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
          You finished <span className="font-bold text-text-primary">#{reward.rank}</span>
          {reward.cache_keys > 0 && (
            <>
              {' '}— {reward.cache_keys} cache {reward.cache_keys === 1 ? 'key' : 'keys'} earned
            </>
          )}
          {reward.buff_bonus > 0 && (
            <> · +{Math.round(reward.buff_bonus * 100)}% drop luck for {reward.buff_hours}h</>
          )}
          {reward.cache_keys > 0 && <>, paid at settlement</>}
          .
        </p>
      )}
    </div>
  );
};

/**
 * The races, read as a fixture list in a newspaper: this week's
 * heats, then last week's finals in the same grammar at the same
 * size — the record does not shout about being final.
 */
export const QuietRaces: React.FC<{
  data: WeeklyLeaderboards | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  myPlayerId?: string | null;
  looks: Record<string, HunterLookView>;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ data, loading, error, onRetry, myPlayerId, looks, onSelectPlayer }) => {
  if (loading) {
    return (
      <section aria-label="Weekly races" className="space-y-3">
        <div className="h-6 w-1/3 animate-pulse rounded bg-surface" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-surface" />
        ))}
      </section>
    );
  }

  if (error || !data) {
    return (
      <section aria-label="Weekly races">
        <h2 style={DISPLAY} className="text-[30px] leading-none text-text-primary">
          Weekly races
        </h2>
        <p className="mt-4 text-[13px] leading-relaxed text-text-secondary">
          Weekly races unavailable — {error ?? 'Weekly races could not be loaded.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 min-h-[44px] text-[13px] font-bold text-text-primary underline underline-offset-4"
        >
          Retry
        </button>
      </section>
    );
  }

  const prev = data.previous_week;
  const prevPlaced = prev.races.some((r) => r.my_reward !== null || r.me !== null);

  return (
    <section aria-label="Weekly races">
      <div className="flex items-baseline gap-3">
        <h2 style={DISPLAY} className="text-[30px] leading-none text-text-primary">
          This week
        </h2>
        <div className="ml-auto whitespace-nowrap text-[11px] text-text-muted">
          {weekRangeLabel(data.week.start, data.week.ends_at)}
        </div>
      </div>
      <p className="mt-3 max-w-[38ch] text-[13px] leading-relaxed text-text-secondary">
        Top finishers win cache keys and drop luck when the week closes Monday 00:00 UTC.
      </p>
      {data.my_drop_buff && (
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          Drop luck is running:{' '}
          <span className="font-bold text-text-primary">
            +{Math.round(data.my_drop_buff.bonus * 100)}%
          </span>{' '}
          until {shortDay(data.my_drop_buff.expires_at)}.
        </p>
      )}

      {data.races.map((race) => (
        <QuietRaceBlock
          key={race.id}
          race={race}
          myPlayerId={myPlayerId}
          looks={looks}
          onSelectPlayer={onSelectPlayer}
        />
      ))}

      <div className={`mt-16 border-t ${HAIRLINE} pt-10`}>
        <div className="flex items-baseline gap-3">
          <h2 style={DISPLAY} className="text-[30px] leading-none text-text-primary">
            Last week — final
          </h2>
          <div className="ml-auto whitespace-nowrap text-[11px] text-text-muted">
            {weekRangeLabel(prev.start, prev.ends_at)}
          </div>
        </div>
        {!prev.settled && (
          <p className="mt-3 text-[12px] text-text-muted">
            Rewards settle at the next daily heartbeat.
          </p>
        )}
        {prev.races.map((race) => (
          <QuietRaceBlock
            key={race.id}
            race={race}
            myPlayerId={myPlayerId}
            final
            looks={looks}
            onSelectPlayer={onSelectPlayer}
          />
        ))}
        {prev.settled && !prevPlaced && (
          <p className="mt-6 text-[13px] leading-relaxed text-text-secondary">
            You didn&apos;t place last week — this week is open.
          </p>
        )}
      </div>
    </section>
  );
};

/* ---------------- the board ---------------- */

const QuietBoardRow: React.FC<{
  entry: LeaderboardEntry;
  metric: LeaderboardMetric;
  isMe: boolean;
  look?: HunterLookView | null;
  onClick?: (playerId: string) => void;
}> = ({ entry, metric, isMe, look, onClick }) => (
  <button
    type="button"
    data-testid={`board-row-${entry.player_id}`}
    aria-label={`Open ${entry.username ?? 'Hunter'}'s profile`}
    onClick={() => onClick?.(entry.player_id)}
    className={`flex w-full items-center gap-4 border-t ${HAIRLINE} py-3 text-left ${
      isMe ? 'bg-amber/5' : ''
    }`}
  >
    <span
      style={DISPLAY}
      className={`w-12 shrink-0 leading-none ${
        entry.rank <= 3 ? 'text-[36px] text-text-primary' : 'text-[26px] text-text-secondary'
      } ${isMe ? 'text-amber' : ''}`}
    >
      {entry.rank}
    </span>
    {look && (
      <span className="w-8 shrink-0" data-testid={`standings-portrait-${entry.player_id}`}>
        <HunterPortrait look={resolveLookView(look)} className="h-10" />
      </span>
    )}
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[15px] font-semibold text-text-primary">
        {entry.username ?? 'Vault Runner'}
        {isMe && (
          <span className="ml-2 text-[11px] font-bold uppercase tracking-[0.12em] text-amber">
            You
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-[11px] text-text-muted">{trendLine(entry)}</span>
    </span>
    <span className="shrink-0 whitespace-nowrap text-right text-[17px] font-bold tabular-nums text-text-primary">
      {formatLeaderboardValue(metric, entry.value)}{' '}
      <span className="text-[11px] font-semibold text-text-muted">
        {LEADERBOARD_METRIC_UNITS[metric]}
      </span>
    </span>
  </button>
);

/**
 * The board itself: ten metrics and three periods as words in a
 * rail (they scroll, never shrink), then the field as hairline
 * rows. My row rides in place when it is shown; when it is not,
 * my standing returns at the foot of the board — the monument
 * device, repeated quietly, with "of N hunters" for scale.
 */
export const QuietBoard: React.FC<{
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  onMetricChange: (metric: LeaderboardMetric) => void;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  entries: LeaderboardEntry[];
  myPlayerId?: string | null;
  myRank: MyLeaderboardRank | null;
  myUsername: string;
  looks: Record<string, HunterLookView>;
  totalPlayers: number;
  onRowClick?: (playerId: string) => void;
}> = ({
  metric,
  period,
  onMetricChange,
  onPeriodChange,
  entries,
  myPlayerId,
  myRank,
  myUsername,
  looks,
  totalPlayers,
  onRowClick,
}) => {
  const myInList = myPlayerId ? entries.some((e) => e.player_id === myPlayerId) : false;
  const showPinned = !!myRank && !!myPlayerId && !myInList;

  return (
    <section aria-label="Global board">
      <div className="flex items-baseline gap-3">
        <h2 style={DISPLAY} className="text-[30px] leading-none text-text-primary">
          The board
        </h2>
        <div className="ml-auto whitespace-nowrap text-[11px] text-text-muted">
          {totalPlayers} hunters
        </div>
      </div>

      <div
        className="mt-4 flex gap-5 overflow-x-auto"
        role="tablist"
        aria-label="Board metric"
        data-testid="quiet-metric-rail"
      >
        {METRIC_ORDER.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={metric === m}
            onClick={() => onMetricChange(m)}
            style={DISPLAY}
            className={`flex min-h-[44px] shrink-0 items-center whitespace-nowrap text-[18px] ${
              metric === m
                ? 'text-text-primary underline decoration-[#F5F5F5] decoration-2 underline-offset-8'
                : 'text-text-muted'
            }`}
          >
            {METRIC_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="mt-1 flex gap-5" role="tablist" aria-label="Board period">
        {PERIOD_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={period === p}
            onClick={() => onPeriodChange(p)}
            className={`flex min-h-[44px] items-center whitespace-nowrap text-[12px] font-bold uppercase tracking-[0.12em] ${
              period === p
                ? 'text-text-primary underline underline-offset-8'
                : 'text-text-muted'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="mt-8">
          <p className="text-[15px] font-semibold text-text-primary">No leaderboard data yet.</p>
          <p className="mt-1 max-w-[36ch] text-[12px] leading-relaxed text-text-muted">
            Rankings fill in from hunters&apos; play — check back after the next snapshot.
          </p>
        </div>
      ) : (
        <div className="mt-2">
          {entries.map((entry) => (
            <QuietBoardRow
              key={entry.player_id}
              entry={entry}
              metric={metric}
              isMe={entry.player_id === myPlayerId}
              look={looks[entry.player_id] ?? null}
              onClick={onRowClick}
            />
          ))}
        </div>
      )}

      {showPinned && myRank && (
        <div className="mt-14" data-testid="quiet-pinned-me">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
            Your standing
          </div>
          <button
            type="button"
            aria-label="Open your public profile"
            onClick={() => myPlayerId && onRowClick?.(myPlayerId)}
            className="mt-3 flex w-full items-end gap-5 text-left"
          >
            <span style={DISPLAY} className="text-[64px] leading-[0.85] text-text-primary">
              {myRank.rank}
            </span>
            <span className="pb-1">
              <span className="block text-[16px] font-semibold text-text-primary">
                {myUsername}
                <span className="ml-2 text-[11px] font-bold uppercase tracking-[0.12em] text-amber">
                  You
                </span>
              </span>
              <span className="mt-0.5 block text-[14px] tabular-nums text-text-secondary">
                {formatLeaderboardValue(metric, myRank.value)}{' '}
                <span className="text-text-muted">{LEADERBOARD_METRIC_UNITS[metric]}</span>
                {' · '}
                of {myRank.total_players} hunters
              </span>
            </span>
          </button>
        </div>
      )}
    </section>
  );
};
