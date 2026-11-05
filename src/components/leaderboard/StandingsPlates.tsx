/**
 * StandingsPlates — PROTOTYPE presentation for the Standings surface
 * (branch design/hunter-subpages-standings, 2026-11-05; NEVER shipped
 * from this branch). The Arena Plates register (approved for the
 * Hunter menu) given this page's own composition: THE STANDINGS
 * BRACKET.
 *
 * The shipped Standings renders every block as the same MobileCard —
 * earnings, races, and the global board are indistinguishable lists.
 * Here the board is ONE machined plate: rank is the hero numeral in
 * a milled well, the top three form a podium head, ordinary entries
 * are bracket rungs ruled off by steel hairlines INSIDE the plate,
 * and the player's own row — in the list or pinned below it — is a
 * bolted-on plate of its own, so it can never be lost in the list.
 * Races are heat plates; the earnings record is a pay plate stamped
 * PAID BY SETTLEMENT (race rewards auto-pay — DESIGN.md §3; there
 * is no claim, and the plate says so in plain words).
 *
 * Props mirror the shipped panels (WeeklyEarningsPanel,
 * WeeklyRacesPanel, LeaderboardMetricPicker + LeaderboardList), and
 * the earnings state folds through the real deriveWeeklyEarnings —
 * this file is presentation only, over the real payload shapes.
 *
 * Laws: no colored side bars (color lives in numerals, chips, foot
 * strips, light); PxIcon only; 11px type floor; targets ≥44px;
 * numbers never truncate; amber = action waiting only (settled
 * money prints in the key-yellow glow, the game's cash color).
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { listEntranceProps } from '@/lib/animation/uiMotion';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { resolveLookView } from '@/lib/pixel/lookResolution';
import { bossArt } from '@/lib/pixel/bossIdentity';
import { markStandingsEarningsSeen } from '@/components/profile/standingsBadge';
import { deriveWeeklyEarnings, type WeeklyEarningRow } from '@/components/leaderboard/weeklyEarnings';
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardPeriod,
  MyLeaderboardRank,
  WeeklyLeaderboards,
  WeeklyRaceBoard,
} from '@/lib/api/leaderboardService';
import type { HunterLookView } from '@/content/skins';

/* ------------------------------------------------------------------ */
/* Plate grammar — the pass-2 plates register, shared with the menu.  */
/* ------------------------------------------------------------------ */

const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
const BONE_FAINT = '#968A78';
const STEEL = '#6B6257';
const AMBER = '#FF9000';
const GLOW = '#FFEA3A';
const UP = '#5FD95F';
const DOWN = '#FF4B5C';

const PLATE_CLIP =
  'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)';
const MINI_CLIP =
  'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)';

const plateShell: React.CSSProperties = {
  clipPath: PLATE_CLIP,
  border: '2px solid #000',
  background: 'linear-gradient(158deg, #1D1811 0%, #12100C 58%, #0C0A08 100%)',
  boxShadow: '5px 5px 0 rgba(0,0,0,0.75), inset 0 0 0 1px rgba(163,152,134,0.28)',
};

const wellStyle: React.CSSProperties = {
  backgroundColor: '#060504',
  boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(163,152,134,0.22)',
};

/** Machined corner bolts — 5px squares, black with a steel top edge. */
const Bolts: React.FC = () => (
  <>
    {['left-[7px] top-[7px]', 'right-[7px] top-[7px]', 'bottom-[7px] left-[7px]', 'bottom-[7px] right-[7px]'].map(
      (pos) => (
        <span
          key={pos}
          aria-hidden="true"
          className={`absolute ${pos} h-[5px] w-[5px]`}
          style={{ backgroundColor: '#060504', boxShadow: 'inset 0 1px 0 rgba(201,187,166,0.5)' }}
        />
      ),
    )}
  </>
);

const FootStrip: React.FC<{ color: string; height?: number }> = ({ color, height = 4 }) => (
  <div aria-hidden="true" className="absolute inset-x-0 bottom-0" style={{ height, backgroundColor: color }} />
);

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const weekRangeLabel = (startIso: string, endsAtIso: string): string => {
  const lastDay = new Date(Date.parse(endsAtIso) - 86_400_000).toISOString();
  return `${shortDay(startIso)} – ${shortDay(lastDay)}`;
};

/** A value in its metric's own shape: K/D keeps its decimals, tiers
 *  and counts print whole with grouping. Numbers never ellipsize. */
const formatMetricValue = (metric: LeaderboardMetric, value: number): string =>
  metric === 'kdr' ? value.toFixed(2) : Math.round(value).toLocaleString('en-US');

/** Trend = value movement vs the prior snapshot (the real payload
 *  field) — a stamped movement chip, never an invented rank delta. */
const TrendChip: React.FC<{ trend: number; hasPrior: boolean }> = ({ trend, hasPrior }) => {
  if (!hasPrior) {
    return <span className="whitespace-nowrap text-[11px] font-bold" style={{ color: BONE_FAINT }}>NO PRIOR</span>;
  }
  const pct = Math.round(trend * 100);
  if (pct > 0) {
    return (
      <span className="flex items-center gap-1 whitespace-nowrap text-[11px] font-black tabular-nums" style={{ color: UP }}>
        <PxIcon name="chevU" size={13} />
        {pct}%
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="flex items-center gap-1 whitespace-nowrap text-[11px] font-black tabular-nums" style={{ color: DOWN }}>
        <PxIcon name="chevD" size={13} />
        {Math.abs(pct)}%
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 whitespace-nowrap text-[11px] font-black tabular-nums" style={{ color: BONE_FAINT }}>
      — 0%
    </span>
  );
};

/** The milled rank well: rank as the hero numeral. The podium wells
 *  are heavier; #1 carries the glow ring. */
const RankWell: React.FC<{ rank: number; podium?: boolean; mine?: boolean }> = ({ rank, podium, mine }) => (
  <div
    aria-hidden="true"
    className={`flex shrink-0 items-center justify-center ${podium ? 'h-11 w-11' : 'h-9 w-9'}`}
    style={{
      ...wellStyle,
      ...(rank === 1 || mine
        ? { boxShadow: `${wellStyle.boxShadow}, inset 0 0 0 2px ${GLOW}` }
        : rank <= 3
          ? { boxShadow: `${wellStyle.boxShadow}, inset 0 0 0 1px rgba(201,187,166,0.6)` }
          : {}),
    }}
  >
    <span
      className={`font-black tabular-nums leading-none ${podium ? 'text-[20px]' : 'text-[15px]'}`}
      style={{ color: rank === 1 || mine ? GLOW : rank <= 3 ? BONE : BONE_MUTED }}
    >
      {rank}
    </span>
  </div>
);

const Portrait: React.FC<{ look: HunterLookView | null | undefined; size: number }> = ({ look, size }) =>
  look ? (
    <span className="shrink-0 overflow-hidden" style={{ width: size, height: size, ...wellStyle }}>
      <HunterPortrait look={resolveLookView(look)} className="h-full w-full" />
    </span>
  ) : null;

/* ------------------------------------------------------------------ */
/* Title plate — the results wall's nameplate, arena art behind it.   */
/* ------------------------------------------------------------------ */

export const StandingsTitlePlate: React.FC<{ week: WeeklyLeaderboards['week'] | null }> = ({ week }) => {
  const art = bossArt('dune_tyrant');
  return (
    <div className="relative overflow-hidden" style={plateShell} data-testid="standings-title-plate">
      {art && (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${art.arenaUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: '50% 30%',
            filter: 'brightness(0.55)',
          }}
        />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg, rgba(10,7,5,0.95) 46%, rgba(10,7,5,0.42) 100%)' }}
      />
      <Bolts />
      <div className="relative flex items-center gap-3 px-4 pb-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="bl-title text-[34px] leading-none tracking-wide" style={{ color: BONE }}>
            Standings
          </div>
          <div className="mt-1.5 text-[11px] font-semibold leading-snug" style={{ color: BONE_MUTED }}>
            Weekly races and the global board — every number folded from verified play.
          </div>
        </div>
        {week && (
          <div className="shrink-0 px-2.5 py-2 text-center" style={wellStyle}>
            <div className="whitespace-nowrap text-[13px] font-black tabular-nums" style={{ color: BONE }}>
              {weekRangeLabel(week.start, week.ends_at)}
            </div>
            <div className="mt-0.5 whitespace-nowrap text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
              This week
            </div>
          </div>
        )}
      </div>
      <FootStrip color={STEEL} />
    </div>
  );
};

/** A bolted nameplate strip that heads a group of plates. */
const Nameplate: React.FC<{
  icon: PxIconName;
  title: string;
  right?: React.ReactNode;
  stamp?: string;
}> = ({ icon, title, right, stamp }) => (
  <div className="relative overflow-hidden" style={plateShell}>
    <Bolts />
    <div className="relative flex items-center gap-2.5 px-3.5 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center" style={wellStyle}>
        <PxIcon name={icon} size={17} style={{ color: AMBER }} />
      </span>
      <span className="bl-title whitespace-nowrap text-[19px] leading-none tracking-wide" style={{ color: BONE }}>
        {title}
      </span>
      {stamp && (
        <span
          className="ml-1 shrink-0 px-1.5 py-0.5 text-[11px] font-black uppercase tracking-widest"
          style={{ border: `2px solid ${BONE_FAINT}`, color: BONE_FAINT, transform: 'rotate(-2deg)' }}
        >
          {stamp}
        </span>
      )}
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
    <FootStrip color={STEEL} height={3} />
  </div>
);

/* ------------------------------------------------------------------ */
/* Earnings plate — the door badge's destination (DESIGN.md §3).      */
/* Race rewards auto-pay at settlement; this plate is the RECORD,     */
/* stamped as paid, and viewing it clears the door notice.            */
/* ------------------------------------------------------------------ */

const EarningTallyRow: React.FC<{ row: WeeklyEarningRow }> = ({ row }) => {
  const { reward } = row;
  const buffPct = Math.round(reward.buff_bonus * 100);
  return (
    <div
      data-testid={`weekly-earnings-row-${row.raceId}`}
      className="flex items-center gap-3 px-1 py-2"
      style={{ borderTop: '1px solid rgba(163,152,134,0.18)' }}
    >
      <div
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 flex-col items-center justify-center"
        style={wellStyle}
      >
        <span className="text-[13px] font-black tabular-nums leading-none" style={{ color: GLOW }}>
          {reward.rank}
        </span>
        <span className="mt-0.5 text-[11px] font-bold uppercase leading-none" style={{ color: BONE_FAINT }}>
          Place
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>
          {row.label}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: BONE_MUTED }}>
          Finished #{reward.rank}
          {reward.cache_keys > 0 && reward.buff_bonus > 0 && (
            <span style={{ color: UP }}> · +{buffPct}% drop luck for {reward.buff_hours}h</span>
          )}
        </div>
      </div>
      {reward.cache_keys > 0 ? (
        <div className="shrink-0 text-right">
          <div className="text-[26px] font-black leading-none tabular-nums" style={{ color: GLOW }}>
            +{reward.cache_keys}
          </div>
          <div className="mt-1 flex items-center justify-end gap-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
            <PxIcon name="key" size={13} />
            Cache {reward.cache_keys === 1 ? 'key' : 'keys'}
          </div>
        </div>
      ) : (
        <div className="shrink-0 text-right">
          <div className="text-[26px] font-black leading-none tabular-nums" style={{ color: UP }}>
            +{buffPct}%
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
            Drop luck · {reward.buff_hours}h
          </div>
        </div>
      )}
    </div>
  );
};

export const EarningsPlate: React.FC<{
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
    <div
      ref={panelRef}
      id="weekly-earnings-panel"
      data-testid="weekly-earnings-panel"
      className="scroll-mt-2"
      style={highlighted ? { filter: 'drop-shadow(0 0 6px rgba(255,144,0,0.8))' } : undefined}
    >
      <div className="relative overflow-hidden" style={plateShell}>
        <Bolts />
        <div className="relative px-4 pb-4 pt-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center" style={wellStyle}>
              <PxIcon name="trophy" size={17} style={{ color: GLOW }} />
            </span>
            <div className="text-[15px] font-black uppercase tracking-wide" style={{ color: BONE }}>
              Your Weekly Earnings
            </div>
            {prev && (
              <div className="ml-auto whitespace-nowrap text-[11px] font-bold tabular-nums" style={{ color: BONE_FAINT }}>
                {weekRangeLabel(prev.start, prev.ends_at)}
              </div>
            )}
          </div>

          {loading ? (
            <div className="mt-3 space-y-2" data-testid="weekly-earnings-loading">
              <div className="h-4 w-2/3 animate-pulse" style={{ backgroundColor: 'rgba(163,152,134,0.15)' }} />
              <div className="h-11 animate-pulse" style={{ backgroundColor: 'rgba(163,152,134,0.15)' }} />
            </div>
          ) : error || !data ? (
            <div className="mt-3" data-testid="weekly-earnings-error">
              <div className="text-[11px] leading-snug" style={{ color: BONE_MUTED }}>
                Your weekly earnings could not be loaded.
              </div>
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 min-h-[44px] px-4 text-[11px] font-black uppercase tracking-wide text-black"
                style={{ backgroundColor: AMBER, border: '2px solid #000', boxShadow: '3px 3px 0 rgba(0,0,0,0.7)' }}
              >
                Retry
              </button>
            </div>
          ) : state.kind === 'earnings' ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className="px-2 py-1 text-[11px] font-black uppercase tracking-widest"
                  style={{ border: `2px solid ${GLOW}`, color: GLOW, transform: 'rotate(-1.5deg)' }}
                >
                  Paid by settlement
                </span>
                <span
                  className="text-[11px] leading-snug"
                  style={{ color: BONE_MUTED }}
                  data-testid="weekly-earnings-autopay-note"
                >
                  Race rewards pay out automatically when the week settles — no claim needed. These are already in your account.
                </span>
              </div>
              <div className="mt-1.5">
                {state.rows.map((row) => (
                  <EarningTallyRow key={row.raceId} row={row} />
                ))}
              </div>
              {state.totalCacheKeys > 0 && (
                <div className="mt-2 flex items-baseline justify-end gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
                    Total paid
                  </span>
                  <span className="text-[17px] font-black tabular-nums" style={{ color: GLOW }}>
                    {state.totalCacheKeys} cache {state.totalCacheKeys === 1 ? 'key' : 'keys'}
                  </span>
                </div>
              )}
            </div>
          ) : state.kind === 'pending' ? (
            <div className="mt-3 text-[11px] leading-snug" style={{ color: BONE_MUTED }} data-testid="weekly-earnings-pending">
              Last week&apos;s races are final. Your rewards settle at the next daily heartbeat — they pay automatically and land right here.
            </div>
          ) : state.kind === 'placed' ? (
            <div className="mt-3 space-y-2.5" data-testid="weekly-earnings-placed">
              <div className="text-[11px] leading-snug" style={{ color: BONE_MUTED }}>
                You raced last week but finished outside the rewards — paid places are the top 10 at each race&apos;s qualifying minimum.
              </div>
              <button
                type="button"
                onClick={scrollToRaces}
                className="min-h-[44px] px-3.5 text-[11px] font-black uppercase tracking-wide"
                style={{ border: `2px solid ${AMBER}`, color: AMBER, backgroundColor: 'rgba(6,5,4,0.7)' }}
              >
                See this week&apos;s races
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5" data-testid="weekly-earnings-empty">
              <div className="text-[11px] leading-snug" style={{ color: BONE_MUTED }}>
                No weekly earnings yet — your best placements land here Mondays.
              </div>
              <button
                type="button"
                onClick={scrollToRaces}
                className="min-h-[44px] px-3.5 text-[11px] font-black uppercase tracking-wide"
                style={{ border: `2px solid ${AMBER}`, color: AMBER, backgroundColor: 'rgba(6,5,4,0.7)' }}
              >
                See this week&apos;s races
              </button>
            </div>
          )}
        </div>
        <FootStrip color={state.kind === 'earnings' ? GLOW : STEEL} />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Race plates — each race a heat plate; my finish rides its foot.    */
/* ------------------------------------------------------------------ */

const RaceRung: React.FC<{
  rank: number;
  playerId: string;
  username: string | null;
  value: number;
  unit: string;
  look: HunterLookView | null | undefined;
  isMe: boolean;
  first: boolean;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ rank, playerId, username, value, unit, look, isMe, first, onSelectPlayer }) => (
  <button
    type="button"
    data-testid={`standings-row-${playerId}`}
    aria-label={`Open ${username ?? 'Hunter'}'s profile`}
    onClick={() => onSelectPlayer?.(playerId)}
    className="flex min-h-[48px] w-full items-center gap-2.5 px-3 py-1.5 text-left"
    style={{
      borderTop: first ? undefined : '1px solid rgba(163,152,134,0.16)',
      backgroundColor: isMe ? 'rgba(255,234,58,0.07)' : undefined,
    }}
  >
    <RankWell rank={rank} mine={isMe} />
    <Portrait look={look} size={34} />
    <span
      className="min-w-0 flex-1 truncate text-[13px] font-bold"
      style={{ color: isMe ? GLOW : BONE }}
    >
      {username ?? 'Hunter'}
      {isMe && <span className="ml-1.5 text-[11px] font-black uppercase" style={{ color: BONE_FAINT }}>You</span>}
    </span>
    <span className="whitespace-nowrap text-[15px] font-black tabular-nums" style={{ color: BONE }}>
      {value.toLocaleString('en-US')}
    </span>
    <span className="whitespace-nowrap text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
      {unit}
    </span>
  </button>
);

/** My finish as the race plate's bolted foot strip — used when my
 *  rung is outside the shown entries, and to carry a final reward. */
const MyRaceStrip: React.FC<{
  rank: number;
  value: number;
  unit: string;
  reward: WeeklyRaceBoard['my_reward'];
}> = ({ rank, value, unit, reward }) => (
  <div
    className="relative mx-2 mb-2.5 mt-1 overflow-hidden"
    style={{
      clipPath: MINI_CLIP,
      border: '2px solid #000',
      background: 'linear-gradient(158deg, #241C12 0%, #171208 100%)',
      boxShadow: '3px 3px 0 rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,234,58,0.35)',
    }}
    data-testid="standings-row-me"
  >
    <div className="flex min-h-[44px] items-center gap-2.5 px-3 py-1.5">
      <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_FAINT }}>
        You
      </span>
      <span className="text-[17px] font-black tabular-nums leading-none" style={{ color: GLOW }}>
        #{rank}
      </span>
      <span className="whitespace-nowrap text-[13px] font-black tabular-nums" style={{ color: BONE }}>
        {value.toLocaleString('en-US')} {unit}
      </span>
      {reward && (
        <span className="ml-auto text-right text-[11px] font-black uppercase leading-snug">
          {reward.cache_keys > 0 && (
            <span style={{ color: GLOW }}>{reward.cache_keys} cache {reward.cache_keys === 1 ? 'key' : 'keys'} earned</span>
          )}
          {reward.buff_bonus > 0 && (
            <span style={{ color: UP }}>
              {reward.cache_keys > 0 ? ' · ' : ''}+{Math.round(reward.buff_bonus * 100)}% drop luck {reward.buff_hours}h
            </span>
          )}
        </span>
      )}
    </div>
  </div>
);

export const RacePlate: React.FC<{
  race: WeeklyRaceBoard;
  myPlayerId?: string | null;
  final?: boolean;
  index?: number;
  looks: Record<string, HunterLookView | null>;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ race, myPlayerId, final, index = 0, looks, onSelectPlayer }) => {
  const reduceMotion = useReducedMotion();
  const inTop = race.entries.some((e) => e.player_id === myPlayerId);
  const reward = final ? race.my_reward : null;
  return (
    <motion.div {...listEntranceProps(index, reduceMotion)} className="relative overflow-hidden" style={plateShell}>
      <Bolts />
      <div className="relative pt-3">
        <div className="flex items-baseline gap-2 px-3.5">
          <div className="bl-title text-[19px] leading-none tracking-wide" style={{ color: BONE }}>
            {race.label}
          </div>
          <div className="ml-auto shrink-0 px-2 py-1 text-center" style={wellStyle}>
            <span className="whitespace-nowrap text-[12px] font-black tabular-nums" style={{ color: BONE }}>
              {race.participant_count.toLocaleString('en-US')}
            </span>{' '}
            <span className="whitespace-nowrap text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
              racers
            </span>
          </div>
        </div>
        <div className="px-3.5 pb-1 pt-1 text-[11px] leading-snug" style={{ color: BONE_MUTED }}>
          {race.blurb}
        </div>
        {race.entries.length === 0 ? (
          <div className="px-3.5 py-2 text-[11px]" style={{ color: BONE_MUTED }}>
            No qualifying runs yet{final ? '' : ' this week'}.
          </div>
        ) : (
          <div className="pb-1.5">
            {race.entries.map((entry, i) => (
              <RaceRung
                key={entry.player_id}
                rank={entry.rank}
                playerId={entry.player_id}
                username={entry.username}
                value={entry.value}
                unit={race.unit}
                look={looks[entry.player_id]}
                isMe={entry.player_id === myPlayerId}
                first={i === 0}
                onSelectPlayer={onSelectPlayer}
              />
            ))}
          </div>
        )}
        {race.me && myPlayerId && (!inTop || reward) && (
          <MyRaceStrip rank={race.me.rank} value={race.me.value} unit={race.unit} reward={reward} />
        )}
      </div>
      <FootStrip color={STEEL} height={3} />
    </motion.div>
  );
};

export const RacesPlates: React.FC<{
  data: WeeklyLeaderboards | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  myPlayerId?: string | null;
  looks: Record<string, HunterLookView | null>;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ data, loading, error, onRetry, myPlayerId, looks, onSelectPlayer }) => {
  if (loading) {
    return (
      <div className="relative overflow-hidden" style={plateShell}>
        <div className="space-y-2.5 px-4 py-4">
          <div className="h-4 w-1/3 animate-pulse" style={{ backgroundColor: 'rgba(163,152,134,0.15)' }} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 animate-pulse" style={{ backgroundColor: 'rgba(163,152,134,0.15)' }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="relative overflow-hidden px-4 py-4 text-center" style={plateShell}>
        <div className="text-[15px] font-black uppercase" style={{ color: DOWN }}>Weekly races unavailable</div>
        <div className="mt-1 text-[11px]" style={{ color: BONE_MUTED }}>
          {error ?? 'Weekly races could not be loaded.'}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 min-h-[44px] px-4 text-[11px] font-black uppercase tracking-wide text-black"
          style={{ backgroundColor: AMBER, border: '2px solid #000', boxShadow: '3px 3px 0 rgba(0,0,0,0.7)' }}
        >
          Retry
        </button>
      </div>
    );
  }

  const prev = data.previous_week;
  const prevPlaced = prev.races.some((r) => r.my_reward !== null || r.me !== null);

  return (
    <div className="space-y-3" id="weekly-races-card">
      <Nameplate
        icon="flag"
        title="Weekly Races"
        right={
          <span className="whitespace-nowrap text-[11px] font-bold tabular-nums" style={{ color: BONE_FAINT }}>
            {weekRangeLabel(data.week.start, data.week.ends_at)}
          </span>
        }
      />
      <div className="-mt-1.5 px-1 text-[11px] leading-snug" style={{ color: BONE_MUTED }}>
        Top finishers win cache keys and drop luck when the week closes Monday 00:00 UTC.
      </div>
      {data.my_drop_buff && (
        <div
          className="flex min-h-[44px] items-center gap-2 px-3"
          style={{ ...wellStyle, boxShadow: `${wellStyle.boxShadow}, inset 0 0 0 1px rgba(255,234,58,0.45)` }}
        >
          <PxIcon name="bolt" size={13} style={{ color: GLOW }} />
          <span className="text-[12px] font-black uppercase tracking-wide" style={{ color: GLOW }}>
            Drop luck active: +{Math.round(data.my_drop_buff.bonus * 100)}% until {shortDay(data.my_drop_buff.expires_at)}
          </span>
        </div>
      )}
      {data.races.map((race, index) => (
        <RacePlate key={race.id} race={race} myPlayerId={myPlayerId} index={index} looks={looks} onSelectPlayer={onSelectPlayer} />
      ))}

      <Nameplate
        icon="flag"
        title="Last Week"
        stamp="Final"
        right={
          <span className="whitespace-nowrap text-[11px] font-bold tabular-nums" style={{ color: BONE_FAINT }}>
            {weekRangeLabel(prev.start, prev.ends_at)}
          </span>
        }
      />
      {!prev.settled && (
        <div className="-mt-1.5 px-1 text-[11px]" style={{ color: BONE_MUTED }}>
          Rewards settle at the next daily heartbeat.
        </div>
      )}
      {prev.races.map((race, index) => (
        <RacePlate key={race.id} race={race} myPlayerId={myPlayerId} final index={index} looks={looks} onSelectPlayer={onSelectPlayer} />
      ))}
      {prev.settled && !prevPlaced && (
        <div className="px-1 text-[11px]" style={{ color: BONE_MUTED }}>
          You didn&apos;t place last week — this week is open.
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Global board plate — the bracket. Metric rail of stamped tabs, a   */
/* machined period switch, a podium head, rungs, and my own plate.    */
/* ------------------------------------------------------------------ */

const METRICS: { value: LeaderboardMetric; label: string; color: string }[] = [
  { value: 'level', label: 'Level', color: '#FF9000' },
  { value: 'xp', label: 'XP', color: '#FF9000' },
  { value: 'net_worth', label: 'Net Worth', color: '#7CFC00' },
  { value: 'total_kills', label: 'Kills', color: '#FF4B5C' },
  { value: 'kdr', label: 'K/D', color: '#FF4B5C' },
  { value: 'highest_boss_tier', label: 'Boss Tier', color: '#FF4B5C' },
  { value: 'total_mastery_xp', label: 'Mastery XP', color: '#7CFC00' },
  { value: 'highest_mastery_level', label: 'Mastery Lv', color: '#7CFC00' },
  { value: 'legendary_items', label: 'Legendaries', color: '#FFEA3A' },
  { value: 'total_items', label: 'Items', color: '#FFEA3A' },
];

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'all_time', label: 'All Time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

const BoardRung: React.FC<{
  entry: LeaderboardEntry;
  metric: LeaderboardMetric;
  isMe: boolean;
  podium?: boolean;
  first: boolean;
  look: HunterLookView | null | undefined;
  onRowClick?: (playerId: string) => void;
}> = ({ entry, metric, isMe, podium, first, look, onRowClick }) => {
  if (isMe) {
    // My rung is not a rung: it is a plate bolted across the bracket.
    return (
      <div className="px-2 py-1.5">
        <button
          type="button"
          data-testid="standings-row-me"
          aria-label="Open your public profile"
          onClick={() => onRowClick?.(entry.player_id)}
          className="relative flex min-h-[52px] w-full items-center gap-2.5 overflow-hidden px-3 py-1.5 text-left"
          style={{
            clipPath: MINI_CLIP,
            border: '2px solid #000',
            background: 'linear-gradient(158deg, #261D11 0%, #171208 100%)',
            boxShadow: '3px 3px 0 rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,234,58,0.4)',
          }}
        >
          <RankWell rank={entry.rank} podium={podium} mine />
          <Portrait look={look} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-black" style={{ color: GLOW }}>
              {entry.username ?? 'Vault Runner'}
              <span className="ml-1.5 text-[11px] font-black uppercase" style={{ color: BONE_FAINT }}>You</span>
            </span>
            <span className="mt-0.5 block">
              <TrendChip trend={entry.trend} hasPrior={entry.previous_value != null} />
            </span>
          </span>
          <span
            className={`whitespace-nowrap font-black tabular-nums ${podium ? 'text-[19px]' : 'text-[16px]'}`}
            style={{ color: BONE }}
          >
            {formatMetricValue(metric, entry.value)}
          </span>
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid={`standings-row-${entry.player_id}`}
      aria-label={`Open ${entry.username ?? 'Hunter'}'s profile`}
      onClick={() => onRowClick?.(entry.player_id)}
      className={`flex w-full items-center gap-2.5 px-3 text-left ${podium ? 'min-h-[56px] py-2' : 'min-h-[48px] py-1.5'}`}
      style={{ borderTop: first ? undefined : '1px solid rgba(163,152,134,0.16)' }}
    >
      <RankWell rank={entry.rank} podium={podium} />
      <Portrait look={look} size={podium ? 40 : 34} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-bold ${podium ? 'text-[14px]' : 'text-[13px]'}`} style={{ color: BONE }}>
          {entry.username ?? 'Vault Runner'}
        </span>
        <span className="mt-0.5 block">
          <TrendChip trend={entry.trend} hasPrior={entry.previous_value != null} />
        </span>
      </span>
      {entry.rank === 1 && <PxIcon name="crown" size={13} style={{ color: GLOW }} />}
      <span
        className={`whitespace-nowrap font-black tabular-nums ${podium ? 'text-[19px]' : 'text-[16px]'}`}
        style={{ color: BONE }}
      >
        {formatMetricValue(metric, entry.value)}
      </span>
    </button>
  );
};

/** My plate pinned at the board's foot when my rung is outside the
 *  shown entries — the same bolted plate, so the device is one. */
const MyBoardPlate: React.FC<{
  myRank: MyLeaderboardRank;
  metric: LeaderboardMetric;
  username: string | null;
  look: HunterLookView | null | undefined;
  onRowClick?: () => void;
}> = ({ myRank, metric, username, look, onRowClick }) => (
  <div className="px-2 pb-2.5 pt-1.5">
    <button
      type="button"
      data-testid="standings-row-me"
      aria-label="Open your public profile"
      onClick={onRowClick}
      className="relative flex min-h-[52px] w-full items-center gap-2.5 overflow-hidden px-3 py-1.5 text-left"
      style={{
        clipPath: MINI_CLIP,
        border: '2px solid #000',
        background: 'linear-gradient(158deg, #261D11 0%, #171208 100%)',
        boxShadow: '3px 3px 0 rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,234,58,0.4)',
      }}
    >
      <RankWell rank={myRank.rank} mine />
      <Portrait look={look} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-black" style={{ color: GLOW }}>
          {username ?? 'Vault Runner'}
          <span className="ml-1.5 text-[11px] font-black uppercase" style={{ color: BONE_FAINT }}>You</span>
        </span>
        <span className="mt-0.5 block">
          <TrendChip trend={myRank.trend} hasPrior={myRank.previous_value != null} />
        </span>
      </span>
      <span className="text-right">
        <span className="block whitespace-nowrap text-[16px] font-black tabular-nums" style={{ color: BONE }}>
          {formatMetricValue(metric, myRank.value)}
        </span>
        <span className="block whitespace-nowrap text-[11px] font-bold tabular-nums" style={{ color: BONE_FAINT }}>
          of {myRank.total_players.toLocaleString('en-US')} hunters
        </span>
      </span>
    </button>
  </div>
);

export const BoardPlate: React.FC<{
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  onMetricChange: (metric: LeaderboardMetric) => void;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  entries: LeaderboardEntry[];
  myPlayerId?: string | null;
  myRank: MyLeaderboardRank | null;
  myUsername: string | null;
  looks: Record<string, HunterLookView | null>;
  loading?: boolean;
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
  loading,
  totalPlayers,
  onRowClick,
}) => {
  const myEntry = myPlayerId ? entries.find((e) => e.player_id === myPlayerId) : undefined;
  const podium = entries.slice(0, 3);
  const rungs = entries.slice(3);

  return (
    <div className="relative overflow-hidden" style={plateShell} data-testid="standings-board-plate">
      <Bolts />
      <div className="relative pt-3.5">
        <div className="flex items-center gap-2.5 px-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center" style={wellStyle}>
            <PxIcon name="crown" size={17} style={{ color: AMBER }} />
          </span>
          <div className="bl-title whitespace-nowrap text-[21px] leading-none tracking-wide" style={{ color: BONE }}>
            Global Rankings
          </div>
          <div className="ml-auto shrink-0 px-2 py-1 text-center" style={wellStyle}>
            <span className="whitespace-nowrap text-[12px] font-black tabular-nums" style={{ color: BONE }}>
              {totalPlayers.toLocaleString('en-US')}
            </span>{' '}
            <span className="whitespace-nowrap text-[11px] font-bold uppercase" style={{ color: BONE_FAINT }}>
              hunters
            </span>
          </div>
        </div>

        {/* Metric rail — stamped tabs; the active tab is pressed into
            a well and ticks in its metric's data color. Scrolls, never
            shrinks (DESIGN.md §6). */}
        <div className="relative mt-3">
          <div className="flex gap-1.5 overflow-x-auto px-3.5 pb-1" data-testid="standings-metric-rail">
            {METRICS.map((m) => {
              const active = metric === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => onMetricChange(m.value)}
                  aria-pressed={active}
                  className="relative min-h-[44px] shrink-0 whitespace-nowrap px-3 text-[11px] font-black uppercase tracking-wide"
                  style={
                    active
                      ? { ...wellStyle, color: BONE }
                      : { color: BONE_FAINT, boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.25)' }
                  }
                >
                  {m.label}
                  {active && (
                    <span aria-hidden="true" className="absolute inset-x-2 bottom-[3px] h-[3px]" style={{ backgroundColor: m.color }} />
                  )}
                </button>
              );
            })}
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8"
            style={{ background: 'linear-gradient(90deg, rgba(18,16,12,0) 0%, rgba(18,16,12,0.92) 100%)' }}
          />
        </div>

        {/* Period switch — one machined segmented frame. */}
        <div className="px-3.5 pt-2">
          <div
            className="flex overflow-hidden"
            style={{ clipPath: MINI_CLIP, boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.3)', backgroundColor: 'rgba(6,5,4,0.55)' }}
            role="group"
            aria-label="Leaderboard period"
          >
            {PERIODS.map((p) => {
              const active = period === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => onPeriodChange(p.value)}
                  aria-pressed={active}
                  className="relative min-h-[44px] flex-1 text-[11px] font-black uppercase tracking-wide"
                  style={active ? { ...wellStyle, color: BONE } : { color: BONE_FAINT }}
                >
                  {p.label}
                  {active && (
                    <span aria-hidden="true" className="absolute inset-x-6 bottom-[3px] h-[3px]" style={{ backgroundColor: AMBER }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 px-3.5 py-4">
            <div className="h-4 w-1/3 animate-pulse" style={{ backgroundColor: 'rgba(163,152,134,0.15)' }} />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse" style={{ backgroundColor: 'rgba(163,152,134,0.15)' }} />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <PxIcon name="crown" size={26} style={{ color: BONE_FAINT }} />
            <div className="mt-2 text-[13px] font-bold" style={{ color: BONE_MUTED }}>No leaderboard data yet.</div>
            <div className="mt-1 text-[11px]" style={{ color: BONE_FAINT }}>
              Rankings fill in from hunters&apos; play — check back after the next snapshot.
            </div>
          </div>
        ) : (
          <div className="pb-1.5 pt-2">
            {podium.length > 0 && (
              <div
                style={{
                  background: 'rgba(245,239,230,0.035)',
                  borderBottom: '2px solid rgba(0,0,0,0.65)',
                  boxShadow: 'inset 0 1px 0 rgba(201,187,166,0.10)',
                }}
              >
                {podium.map((entry, i) => (
                  <BoardRung
                    key={entry.player_id}
                    entry={entry}
                    metric={metric}
                    isMe={entry.player_id === myPlayerId}
                    podium
                    first={i === 0}
                    look={looks[entry.player_id]}
                    onRowClick={onRowClick}
                  />
                ))}
              </div>
            )}
            {rungs.map((entry) => (
              <BoardRung
                key={entry.player_id}
                entry={entry}
                metric={metric}
                isMe={entry.player_id === myPlayerId}
                first={false}
                look={looks[entry.player_id]}
                onRowClick={onRowClick}
              />
            ))}
            {!myEntry && myRank && myPlayerId && (
              <MyBoardPlate
                myRank={myRank}
                metric={metric}
                username={myUsername}
                look={looks[myPlayerId]}
                onRowClick={() => onRowClick?.(myPlayerId)}
              />
            )}
          </div>
        )}
      </div>
      <FootStrip color={STEEL} />
    </div>
  );
};
