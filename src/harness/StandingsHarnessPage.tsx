/**
 * Standings harness page (leaderboard-hub rendering, dev only) —
 * serves the REAL Standings screen composition at phone width for
 * before/after captures: ResourceBar chrome, ConsoleHead, the
 * Board Hub panel with its settlement sheet (BoardHubPanel +
 * SettlementReadoutSheet), BoardConsole and the
 * race channels, in the shipped LeaderboardsScreen order and page
 * classes, fed with production-shaped fixture payloads (the same
 * shapes the standings test suites pin). State (metric/period) is
 * held here exactly as LeaderboardBoard holds it, and the same
 * callbacks are wired to the same components — so a capture shows
 * the shipped screen, and (on the hub branch) the hub treatment,
 * with no harness-only UI.
 *
 * Nothing here is imported by the app bundle; standings-harness.html
 * is served by the Vite dev server only.
 */
import React, { useMemo, useState } from 'react';
import { ResourceBar } from '@/components/layout/ResourceBar';
import {
  BoardHubPanel,
  SettlementReadoutSheet,
} from '@/components/leaderboard/WeeklyEarningsPanel';
import {
  BoardConsole,
  ConsoleHead,
  FinalsArchive,
  RaceChannels,
} from '@/components/leaderboard/StandingsConsole';
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardPeriod,
  MyLeaderboardRank,
  WeeklyLeaderboards,
  WeeklyRaceBoard,
} from '@/lib/api/leaderboardService';

const MY_ID = 'p-me';
const TOTAL_PLAYERS = 77;

const NAMES = [
  'Marla Vane', 'Odo Kessler', 'Petra Lindqvist', 'Harrow', 'June Calloway',
  'Silas Rook', 'Ana Beltran', 'Casper Wynn', 'Ines Duarte', 'Milo Ferreira',
  'Tessa Vaughn', 'Rurik Hansen', 'Lena Moreau', 'Otto Lindgren', 'Sable Quinn',
  'Yara Haddad',
];

const METRIC_BASE: Record<LeaderboardMetric, number> = {
  level: 87,
  xp: 4_820_000,
  net_worth: 9_640_000,
  total_kills: 18_420,
  kdr: 3.84,
  highest_boss_tier: 12,
  total_mastery_xp: 612_000,
  highest_mastery_level: 24,
  legendary_items: 41,
  total_items: 2_366,
};

const PERIOD_SCALE: Record<LeaderboardPeriod, number> = {
  all_time: 1,
  weekly: 0.16,
  daily: 0.03,
};

const entriesFor = (metric: LeaderboardMetric, period: LeaderboardPeriod): LeaderboardEntry[] => {
  const base = METRIC_BASE[metric] * PERIOD_SCALE[period];
  return NAMES.map((name, i) => ({
    rank: i + 1,
    player_id: `p-${i + 1}`,
    username: name,
    value: Math.max(1, Math.round(base * (1 - i * 0.055) * 100) / 100),
    previous_value: i % 3 === 0 ? null : Math.round(base * (1 - i * 0.055) * 0.94 * 100) / 100,
    trend: i % 4 === 0 ? -0.04 : i % 3 === 0 ? 0 : 0.07,
  }));
};

const MY_RANKS: Record<LeaderboardMetric, { all_time: number; weekly: number; daily: number }> = {
  level: { all_time: 14, weekly: 9, daily: 6 },
  xp: { all_time: 17, weekly: 11, daily: 8 },
  net_worth: { all_time: 11, weekly: 7, daily: 5 },
  total_kills: { all_time: 12, weekly: 3, daily: 2 },
  kdr: { all_time: 21, weekly: 14, daily: 9 },
  highest_boss_tier: { all_time: 8, weekly: 6, daily: 4 },
  total_mastery_xp: { all_time: 19, weekly: 12, daily: 7 },
  highest_mastery_level: { all_time: 16, weekly: 10, daily: 6 },
  legendary_items: { all_time: 9, weekly: 5, daily: 3 },
  total_items: { all_time: 13, weekly: 8, daily: 5 },
};

const myRankFor = (metric: LeaderboardMetric, period: LeaderboardPeriod): MyLeaderboardRank => {
  const base = METRIC_BASE[metric] * PERIOD_SCALE[period];
  return {
    rank: MY_RANKS[metric][period],
    value: Math.round(base * 0.32 * 100) / 100,
    previous_value: Math.round(base * 0.3 * 100) / 100,
    trend: 0.06,
    total_players: TOTAL_PLAYERS,
  };
};

const raceEntries = (scale: number, offset: number) =>
  NAMES.slice(offset, offset + 5).map((name, i) => ({
    rank: i + 1,
    player_id: `p-${offset + i + 1}`,
    username: name,
    value: Math.round(scale * (1 - i * 0.09)),
    reached_at: '2026-11-12T18:04:00.000Z',
  }));

const race = (over: Partial<WeeklyRaceBoard>): WeeklyRaceBoard => ({
  id: 'race',
  label: 'Race',
  unit: 'kills',
  blurb: '',
  min_qualifying_value: 100,
  entries: [],
  participant_count: 42,
  me: null,
  my_reward: null,
  ...over,
});

const WEEKLY: WeeklyLeaderboards = {
  week: { key: '2026-11-09', start: '2026-11-09T00:00:00.000Z', ends_at: '2026-11-16T00:00:00.000Z' },
  races: [
    race({
      id: 'kills',
      label: 'Cache Hunter',
      unit: 'kills',
      blurb: 'Most kills this week.',
      min_qualifying_value: 250,
      entries: raceEntries(1_940, 0),
      participant_count: 58,
      me: { rank: 3, value: 1_712 },
    }),
    race({
      id: 'bosses',
      label: 'Boss Breaker',
      unit: 'boss kills',
      blurb: 'Most boss kills this week.',
      min_qualifying_value: 12,
      entries: raceEntries(46, 5),
      participant_count: 31,
    }),
  ],
  previous_week: {
    key: '2026-11-02',
    start: '2026-11-02T00:00:00.000Z',
    ends_at: '2026-11-09T00:00:00.000Z',
    settled: true,
    settled_at: '2026-11-10T00:00:00.000Z',
    races: [
      race({
        id: 'kills',
        label: 'Cache Hunter',
        unit: 'kills',
        min_qualifying_value: 250,
        entries: raceEntries(2_030, 2),
        participant_count: 54,
        me: { rank: 2, value: 1_886 },
        my_reward: { rank: 2, cache_keys: 3, buff_bonus: 0.25, buff_hours: 48, buff_expires_at: null },
      }),
      race({
        id: 'bosses',
        label: 'Boss Breaker',
        unit: 'boss kills',
        min_qualifying_value: 12,
        entries: raceEntries(51, 7),
        participant_count: 29,
        me: { rank: 1, value: 51 },
        my_reward: { rank: 1, cache_keys: 2, buff_bonus: 0, buff_hours: 0, buff_expires_at: null },
      }),
    ],
  },
  my_drop_buff: { bonus: 0.25, expires_at: '2026-11-20T00:00:00.000Z' },
};

const ALL_METRICS = Object.keys(METRIC_BASE) as LeaderboardMetric[];

export const StandingsHarnessPage: React.FC = () => {
  const [metric, setMetric] = useState<LeaderboardMetric>('level');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time');
  const [settlementOpen, setSettlementOpen] = useState(false);

  const entries = useMemo(() => entriesFor(metric, period), [metric, period]);
  const myRanks = useMemo(() => {
    const out: Partial<Record<LeaderboardMetric, number | null>> = {};
    for (const m of ALL_METRICS) out[m] = MY_RANKS[m][period];
    return out;
  }, [period]);

  return (
    <div className="bl-page space-y-3 p-4 pb-20">
      <ResourceBar onOpenSettings={() => {}} />
      <ConsoleHead
        week={WEEKLY.week}
        totalPlayers={TOTAL_PLAYERS}
        bestRank={3}
        dropBuff={WEEKLY.my_drop_buff}
        fieldedHunter="Vesper Cole · Gunslinger"
      />
      <BoardHubPanel
        hub={{
          metric,
          period,
          onMetricChange: setMetric,
          onPeriodChange: setPeriod,
          myRanks,
        }}
        data={WEEKLY}
        loading={false}
        focusNonce={0}
        onOpenSettlement={() => setSettlementOpen(true)}
      />
      <SettlementReadoutSheet
        open={settlementOpen}
        onClose={() => setSettlementOpen(false)}
        data={WEEKLY}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
      <BoardConsole
        metric={metric}
        period={period}
        onMetricChange={setMetric}
        onPeriodChange={setPeriod}
        entries={entries}
        loading={false}
        myPlayerId={MY_ID}
        myRank={myRankFor(metric, period)}
        myRanks={myRanks}
        looks={{}}
        totalPlayers={TOTAL_PLAYERS}
        hubControlled
      />
      <RaceChannels
        data={WEEKLY}
        loading={false}
        error={null}
        onRetry={() => {}}
        myPlayerId={MY_ID}
        looks={{}}
      />
      <FinalsArchive data={WEEKLY} loading={false} myPlayerId={MY_ID} looks={{}} />
    </div>
  );
};

export default StandingsHarnessPage;
