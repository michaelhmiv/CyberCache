/**
 * StandingsConsoleDemo — PROTOTYPE harness
 * (design/hunter-subpages-standings-b, 2026-11-05). NOT shipped UI:
 * a fixture stage for the Standings Instrument-panel pass, served
 * only at /standings-console-demo (main.tsx branches before the
 * real app mounts).
 *
 * It renders the REAL app chrome (the Strip + bottom nav) over a
 * seeded player store, and drives the StandingsConsole presentation
 * with fixture payloads shaped exactly like the Chef's:
 * WeeklyLeaderboards (GET /api/leaderboard/weekly), LeaderboardEntry[]
 * (GET /api/leaderboard), MyLeaderboardRank (GET /api/leaderboard/me),
 * and HunterLookView portraits. The fixtures are the SAME facts as
 * variant A's pass (same 14 hunters, same weekly payload), so the
 * two looks compare on identical data. Metric/period switching
 * re-sorts and re-values the fixture board; row taps report through
 * the same onSelectPlayer callback the production screen wires to
 * the public profile sheet. No Chef session is created.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { BottomNav } from '@/components/layout/BottomNav';
import {
  BoardConsole,
  ConsoleHead,
  FinalsArchive,
  RaceChannels,
  SettlementReadout,
} from '@/components/leaderboard/StandingsConsole';
import { usePlayerStore } from '@/store';
import { xpToNextLevel } from '@/content/simulation';
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardPeriod,
  MyLeaderboardRank,
  WeeklyLeaderboards,
  WeeklyRaceBoard,
} from '@/lib/api/leaderboardService';
import type { HunterLookView } from '@/content/skins';

const ME = 'fx-rook';
const MY_NAME = 'Rook Sandoval';
const TOTAL_PLAYERS = 128;

/* ---------------- fixture hunters (identical to variant A) ---------------- */

interface FixtureHunter {
  id: string;
  name: string;
  headVariant: string;
  /** all-time values per metric */
  stats: Record<LeaderboardMetric, number>;
  trend: number;
  /** deterministic weekly/daily pace (share of all-time made per period) */
  weekPace: number;
  dayPace: number;
}

const H = (
  id: string,
  name: string,
  headVariant: string,
  stats: Record<LeaderboardMetric, number>,
  trend: number,
  weekPace: number,
  dayPace: number,
): FixtureHunter => ({ id, name, headVariant, stats, trend, weekPace, dayPace });

const HUNTERS: FixtureHunter[] = [
  H('fx-mara', 'Mara Voss', 'hood',
    { level: 31, xp: 132400, net_worth: 412000, total_kills: 18930, kdr: 2.61, highest_boss_tier: 9, total_mastery_xp: 9640, highest_mastery_level: 14, legendary_items: 11, total_items: 342 },
    0.08, 0.031, 0.006),
  H('fx-dex', 'Dex Calloway', 'fin',
    { level: 29, xp: 118750, net_worth: 358400, total_kills: 17420, kdr: 2.34, highest_boss_tier: 9, total_mastery_xp: 8810, highest_mastery_level: 13, legendary_items: 9, total_items: 318 },
    0.05, 0.028, 0.005),
  H('fx-ilya', 'Ilya Petrov', 'ironwood',
    { level: 28, xp: 109300, net_worth: 301200, total_kills: 15280, kdr: 2.12, highest_boss_tier: 10, total_mastery_xp: 7950, highest_mastery_level: 12, legendary_items: 10, total_items: 286 },
    -0.02, 0.024, 0.004),
  H('fx-sana', 'Sana Iqbal', 'optic',
    { level: 27, xp: 101860, net_worth: 289700, total_kills: 14960, kdr: 1.98, highest_boss_tier: 8, total_mastery_xp: 8420, highest_mastery_level: 13, legendary_items: 7, total_items: 301 },
    0.11, 0.036, 0.007),
  H('fx-bruno', 'Bruno Ferreira', 'redline',
    { level: 26, xp: 95420, net_worth: 264800, total_kills: 13840, kdr: 1.87, highest_boss_tier: 8, total_mastery_xp: 6980, highest_mastery_level: 11, legendary_items: 8, total_items: 264 },
    0.03, 0.022, 0.004),
  H('fx-kit', 'Kit Nakamura', 'helixworks',
    { level: 25, xp: 90210, net_worth: 243100, total_kills: 19650, kdr: 2.47, highest_boss_tier: 7, total_mastery_xp: 6540, highest_mastery_level: 11, legendary_items: 6, total_items: 249 },
    0.14, 0.041, 0.008),
  H(ME, MY_NAME, 'visor',
    { level: 24, xp: 88340, net_worth: 231900, total_kills: 12740, kdr: 1.42, highest_boss_tier: 7, total_mastery_xp: 6120, highest_mastery_level: 10, legendary_items: 5, total_items: 233 },
    0.12, 0.034, 0.006),
  H('fx-ada', 'Ada Kowalski', 'prismatek',
    { level: 23, xp: 81960, net_worth: 402600, total_kills: 11080, kdr: 1.76, highest_boss_tier: 7, total_mastery_xp: 5890, highest_mastery_level: 10, legendary_items: 9, total_items: 275 },
    0.06, 0.026, 0.005),
  H('fx-yusuf', 'Yusuf Adeyemi', 'throwtech',
    { level: 22, xp: 76480, net_worth: 198300, total_kills: 10240, kdr: 1.64, highest_boss_tier: 6, total_mastery_xp: 5310, highest_mastery_level: 9, legendary_items: 12, total_items: 208 },
    -0.04, 0.019, 0.003),
  H('fx-lena', 'Lena Fischer', 'blastforge',
    { level: 21, xp: 71320, net_worth: 176900, total_kills: 9680, kdr: 1.58, highest_boss_tier: 6, total_mastery_xp: 4970, highest_mastery_level: 9, legendary_items: 4, total_items: 196 },
    0.02, 0.021, 0.004),
  H('fx-marco', 'Marco Ruiz', 'hood',
    { level: 20, xp: 66840, net_worth: 158200, total_kills: 8910, kdr: 1.49, highest_boss_tier: 5, total_mastery_xp: 4430, highest_mastery_level: 8, legendary_items: 4, total_items: 181 },
    0.09, 0.029, 0.005),
  H('fx-petra', 'Petra Lindqvist', 'fin',
    { level: 19, xp: 61750, net_worth: 141600, total_kills: 8240, kdr: 1.37, highest_boss_tier: 5, total_mastery_xp: 3980, highest_mastery_level: 8, legendary_items: 3, total_items: 167 },
    -0.01, 0.018, 0.003),
  H('fx-cole', 'Cole Bennett', 'optic',
    { level: 18, xp: 56980, net_worth: 126400, total_kills: 7630, kdr: 1.29, highest_boss_tier: 4, total_mastery_xp: 3520, highest_mastery_level: 7, legendary_items: 3, total_items: 152 },
    0.04, 0.02, 0.004),
  H('fx-hana', 'Hana Sato', 'ironwood',
    { level: 17, xp: 52410, net_worth: 112800, total_kills: 6980, kdr: 1.21, highest_boss_tier: 4, total_mastery_xp: 3110, highest_mastery_level: 7, legendary_items: 2, total_items: 139 },
    0.07, 0.023, 0.004),
];

const LOOKS: Record<string, HunterLookView> = Object.fromEntries(
  HUNTERS.map((h) => [
    h.id,
    { playerId: h.id, username: h.name, headVariant: h.headVariant, parts: {} } as HunterLookView,
  ]),
);

/** Period boards: counting metrics scale by the hunter's period pace;
 *  level and boss tier are standing facts and carry across periods. */
const periodValue = (h: FixtureHunter, metric: LeaderboardMetric, period: LeaderboardPeriod): number => {
  const base = h.stats[metric];
  if (period === 'all_time' || metric === 'level' || metric === 'highest_boss_tier' || metric === 'highest_mastery_level') {
    return base;
  }
  const pace = period === 'weekly' ? h.weekPace : h.dayPace;
  return metric === 'kdr' ? Math.max(0.4, base * (0.82 + pace * 6)) : Math.round(base * pace);
};

const buildBoard = (metric: LeaderboardMetric, period: LeaderboardPeriod): LeaderboardEntry[] => {
  const sorted = [...HUNTERS]
    .map((h) => ({ h, value: periodValue(h, metric, period) }))
    .sort((a, b) => b.value - a.value);
  return sorted.map(({ h, value }, i) => ({
    rank: i + 1,
    player_id: h.id,
    username: h.name,
    value,
    previous_value: Math.round(value / (1 + h.trend)),
    trend: h.trend,
  }));
};

/** On K/D the fixture field is deep: my 1.42 sits at #23 of 128, so
 *  the shown entries exclude me and the board pins my reading at its
 *  foot — the real payload shape (GET /api/leaderboard/me). */
const buildMyRank = (metric: LeaderboardMetric, period: LeaderboardPeriod): MyLeaderboardRank | null => {
  const me = HUNTERS.find((h) => h.id === ME)!;
  const value = periodValue(me, metric, period);
  if (metric === 'kdr') {
    return { rank: 23, value, previous_value: Math.round((value / (1 + me.trend)) * 100) / 100, trend: me.trend, total_players: TOTAL_PLAYERS };
  }
  const board = buildBoard(metric, period);
  const mine = board.find((e) => e.player_id === ME);
  return mine
    ? { rank: mine.rank, value: mine.value, previous_value: mine.previous_value, trend: mine.trend, total_players: TOTAL_PLAYERS }
    : null;
};

const boardEntriesFor = (metric: LeaderboardMetric, period: LeaderboardPeriod): LeaderboardEntry[] => {
  const board = buildBoard(metric, period);
  if (metric !== 'kdr') return board;
  // The real payload returns the field's actual top entries — ranks
  // run unbroken, and my #23 simply is not among them.
  return board
    .filter((e) => e.player_id !== ME)
    .slice(0, 12)
    .map((e, i) => ({ ...e, rank: i + 1 }));
};

const ALL_METRICS = Object.keys(HUNTERS[0].stats) as LeaderboardMetric[];

/** My rank on every channel for a period — the selector bank's
 *  readouts, derived from the same fixture boards. */
const myRanksFor = (period: LeaderboardPeriod): Partial<Record<LeaderboardMetric, number | null>> =>
  Object.fromEntries(ALL_METRICS.map((m) => [m, buildMyRank(m, period)?.rank ?? null]));

/* ---------------- fixture weekly payload (identical to variant A) ---------------- */

const race = (
  id: string,
  label: string,
  unit: string,
  blurb: string,
  min: number,
  participants: number,
  entries: [string, number][],
  me: { rank: number; value: number } | null,
  myReward: WeeklyRaceBoard['my_reward'] = null,
): WeeklyRaceBoard => ({
  id,
  label,
  unit,
  blurb,
  min_qualifying_value: min,
  participant_count: participants,
  entries: entries.map(([pid, value], i) => ({
    rank: i + 1,
    player_id: pid,
    username: HUNTERS.find((h) => h.id === pid)?.name ?? null,
    value,
    reached_at: '2026-11-04T18:22:00Z',
  })),
  me,
  my_reward: myReward,
});

const WEEKLY: WeeklyLeaderboards = {
  week: { key: '2026-W45', start: '2026-11-02T00:00:00Z', ends_at: '2026-11-09T00:00:00Z' },
  races: [
    race('roaming_kills', 'Roaming Kills', 'kills', 'Hunter kills confirmed by roaming claims and offline settlements.', 25, 212,
      [['fx-mara', 486], ['fx-dex', 452], ['fx-kit', 431], [ME, 398], ['fx-sana', 377]],
      { rank: 4, value: 398 }),
    race('boss_victories', 'Boss Victories', 'victories', 'Verified boss kills this week.', 1, 96,
      [['fx-ilya', 14], ['fx-mara', 12], ['fx-bruno', 11], ['fx-dex', 9], ['fx-ada', 8]],
      { rank: 9, value: 6 }),
    race('caches_opened', 'Caches Opened', 'caches', 'Caches opened this week.', 1, 154,
      [['fx-yusuf', 21], [ME, 19], ['fx-lena', 17], ['fx-marco', 15], ['fx-petra', 14]],
      { rank: 2, value: 19 }),
    race('endless_depth', 'Endless Depth', 'depth', 'Deepest Endless depth reached in a run that ended this week.', 1, 88,
      [['fx-cole', 34], ['fx-hana', 31], ['fx-kit', 29], ['fx-sana', 27], ['fx-ilya', 25]],
      null),
  ],
  previous_week: {
    key: '2026-W44',
    start: '2026-10-26T00:00:00Z',
    ends_at: '2026-11-02T00:00:00Z',
    settled: true,
    settled_at: '2026-11-02T06:00:00Z',
    races: [
      race('roaming_kills', 'Roaming Kills', 'kills', 'Hunter kills confirmed by roaming claims and offline settlements.', 25, 208,
        [['fx-dex', 512], ['fx-mara', 498], ['fx-kit', 460], [ME, 433], ['fx-bruno', 402]],
        { rank: 4, value: 433 },
        { rank: 4, cache_keys: 3, buff_bonus: 0, buff_hours: 0, buff_expires_at: null }),
      race('market_sales', 'Market Sales', 'sales', 'Player-market listings you sold this week.', 1, 121,
        [['fx-ada', 38], ['fx-yusuf', 35], ['fx-lena', 31], ['fx-marco', 28], ['fx-petra', 26]],
        { rank: 6, value: 24 },
        { rank: 6, cache_keys: 2, buff_bonus: 0.25, buff_hours: 24, buff_expires_at: '2026-11-03T06:00:00Z' }),
      race('items_salvaged', 'Items Salvaged', 'items', 'Items recycled through salvage.', 5, 167,
        [['fx-kit', 214], ['fx-sana', 196], ['fx-mara', 181], ['fx-dex', 168], ['fx-bruno', 152]],
        { rank: 11, value: 87 }),
      race('boss_victories', 'Boss Victories', 'victories', 'Verified boss kills this week.', 1, 91,
        [['fx-ilya', 13], ['fx-mara', 12], ['fx-dex', 10], ['fx-bruno', 9], ['fx-sana', 8]],
        null),
    ],
  },
  my_drop_buff: { bonus: 0.25, expires_at: '2026-11-08T00:00:00Z' },
};

/* ---------------- harness ---------------- */

const METRIC_PARAM = new URLSearchParams(
  typeof window !== 'undefined' ? window.location.search : '',
).get('metric');

export const StandingsConsoleDemo: React.FC = () => {
  const [metric, setMetric] = useState<LeaderboardMetric>(
    (METRIC_PARAM as LeaderboardMetric | null) ?? 'level',
  );
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time');
  const [tapped, setTapped] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      usePlayerStore.setState({
        name: MY_NAME,
        profileLoaded: true,
        level: 24,
        xp: Math.floor(xpToNextLevel(24) * 0.62),
        credits: 24100,
        scrap: 31600,
        cacheKeys: 15,
        cacheKeyFragments: 2,
        legendaryCores: 3,
        cacheRankTokens: 140,
      });
      setSeeded(true);
    }, 60);
    return () => clearTimeout(t);
  }, []);

  const entries = useMemo(() => boardEntriesFor(metric, period), [metric, period]);
  const myRank = useMemo(() => buildMyRank(metric, period), [metric, period]);
  const myRanks = useMemo(() => myRanksFor(period), [period]);
  const bestRank = useMemo(() => {
    const ranks = ALL_METRICS.map((m) => buildMyRank(m, 'all_time')?.rank).filter(
      (r): r is number => r != null,
    );
    return ranks.length > 0 ? Math.min(...ranks) : null;
  }, []);

  const onSelectPlayer = (playerId: string) => {
    const h = HUNTERS.find((x) => x.id === playerId);
    setTapped(h ? `${h.name} — profile sheet opens here in the shipped screen` : playerId);
  };

  return (
    <div className="flex h-dvh flex-col bg-bg" data-testid="standings-console-demo">
      {/* Capture switcher — scaffolding, not design. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-2 py-1">
        <span className="px-1 py-1 text-[11px] font-black uppercase text-text-muted">
          Prototype · Standings Console
        </span>
        {tapped && (
          <span className="truncate text-[11px] font-bold text-amber" data-testid="demo-tapped">
            {tapped}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" id="standings-scroll">
        <div className="space-y-3 p-3 pb-6">
          {seeded && <ResourceBar onOpenSettings={() => {}} />}
          <ConsoleHead
            week={WEEKLY.week}
            totalPlayers={TOTAL_PLAYERS}
            bestRank={bestRank}
            dropBuff={WEEKLY.my_drop_buff}
          />
          <SettlementReadout data={WEEKLY} loading={false} error={null} onRetry={() => {}} />
          <BoardConsole
            metric={metric}
            period={period}
            onMetricChange={setMetric}
            onPeriodChange={setPeriod}
            entries={entries}
            myPlayerId={ME}
            myRank={myRank}
            myRanks={myRanks}
            looks={LOOKS}
            totalPlayers={TOTAL_PLAYERS}
            onRowClick={onSelectPlayer}
          />
          <RaceChannels
            data={WEEKLY}
            loading={false}
            error={null}
            onRetry={() => {}}
            myPlayerId={ME}
            looks={LOOKS}
            onSelectPlayer={onSelectPlayer}
          />
          <FinalsArchive
            data={WEEKLY}
            loading={false}
            myPlayerId={ME}
            looks={LOOKS}
            onSelectPlayer={onSelectPlayer}
          />
        </div>
      </div>
      <BottomNav activeTab="hunter" onChange={() => {}} />
    </div>
  );
};

export default StandingsConsoleDemo;
