/**
 * 0098 — the global leaderboard counts only hunters with a kill
 * (owner ruling 2026-11-15; display filter only, nothing deleted).
 *
 * Two pins, one per side of the twin discipline:
 *  - the SQL: migration 0098 restates cc_get_leaderboard from its
 *    only definition (0003) VERBATIM plus exactly the kill
 *    predicate, and does not restate cc_get_my_leaderboard_rank
 *    (it composes the filtered function, so ranks and
 *    total_players inherit the filter);
 *  - the in-memory twin: computeLeaderboard skips any player whose
 *    latest in-window snapshot has (total_kills ?? 0) < 1, ranks
 *    re-number contiguously, and the filter keys on LIFETIME kills
 *    (a hunter with lifetime kills but none inside a week/day
 *    window still stands on that window's board).
 * Store-level rank/total pins live in chefReads.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeLeaderboard,
  type ProgressionSnapshotData,
} from '../server/reads/store';

const MIGRATION_0098 = readFileSync(
  join(__dirname, '..', '..', 'db', 'migrations', '0098_leaderboard_kill_filter.sql'),
  'utf8',
);
const MIGRATION_0003 = readFileSync(
  join(__dirname, '..', '..', 'db', 'migrations', '0003_read_apis.sql'),
  'utf8',
);

function leaderboardFn(sql: string): string {
  const start = sql.indexOf('create or replace function public.cc_get_leaderboard');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end + 3);
}

describe('0098 SQL — verbatim restatement plus the kill predicate', () => {
  it('carries the predicate and the selected-CTE kill column', () => {
    const fn = leaderboardFn(MIGRATION_0098);
    expect(fn).toContain('and coalesce(s.total_kills, 0) >= 1');
    const selected = fn.slice(fn.indexOf('selected as ('), fn.indexOf('from latest l'));
    expect(selected).toContain('l.total_kills,');
  });

  it('is the 0003 body with ONLY the two marked changes', () => {
    const fn0098 = leaderboardFn(MIGRATION_0098)
      .replace('\n      l.total_kills,', '')
      .replace('\n    and coalesce(s.total_kills, 0) >= 1', '');
    expect(fn0098).toBe(leaderboardFn(MIGRATION_0003));
  });

  it('does not restate cc_get_my_leaderboard_rank (it composes the board)', () => {
    expect(MIGRATION_0098).not.toContain(
      'create or replace function public.cc_get_my_leaderboard_rank',
    );
    // The composition it relies on is the shipped 0003 shape.
    expect(MIGRATION_0003).toContain(
      'select * from public.cc_get_leaderboard(_metric, _period, 100000)',
    );
  });
});

const NOW = new Date('2026-10-29T12:00:00Z');

const PACIFIST = '11111111-1111-4111-8111-111111111111'; // 0 kills, top XP
const UNRECORDED = '22222222-2222-4222-8222-222222222222'; // null kills
const ONE_KILL = '33333333-3333-4333-8333-333333333333'; // exactly 1 kill
const VETERAN = '44444444-4444-4444-8444-444444444444'; // 5 kills
const QUIET = '55555555-5555-4555-8555-555555555555'; // lifetime kills, none this week

let snapId = 0;
function snap(
  overrides: Partial<ProgressionSnapshotData> & { player_id: string; snapshot_at: string },
): ProgressionSnapshotData {
  snapId += 1;
  return {
    id: snapId, source: 'daily', snapshot_version: 1, level: null, xp: null, credits: null,
    scrap: null, total_kills: null, total_deaths: null, net_worth: null, total_items: null,
    weapons_owned: null, legendary_items: null, highest_item_level: null, total_mastery_xp: null,
    highest_mastery_level: null, highest_boss_tier: null, active_action: null, metadata: {},
    ...overrides,
  };
}

const USERNAMES = new Map([
  [PACIFIST, 'pacifist'], [UNRECORDED, 'unrecorded'], [ONE_KILL, 'one_kill'],
  [VETERAN, 'veteran'], [QUIET, 'quiet_week'],
]);

const SNAPSHOTS: ProgressionSnapshotData[] = [
  snap({ player_id: PACIFIST, snapshot_at: '2026-10-28T00:00:00.000Z', xp: 9999, total_kills: 0, total_deaths: 3 }),
  snap({ player_id: UNRECORDED, snapshot_at: '2026-10-28T00:00:00.000Z', xp: 8000, total_kills: null }),
  snap({ player_id: ONE_KILL, snapshot_at: '2026-10-28T00:00:00.000Z', xp: 500, total_kills: 1, total_deaths: 0 }),
  snap({ player_id: VETERAN, snapshot_at: '2026-10-28T00:00:00.000Z', xp: 100, total_kills: 5, total_deaths: 1 }),
  // QUIET: lifetime 3 kills banked before the week; the in-window
  // snapshot changes XP only — the kill count does not move.
  snap({ player_id: QUIET, snapshot_at: '2026-10-01T00:00:00.000Z', xp: 100, total_kills: 3, total_deaths: 2 }),
  snap({ player_id: QUIET, snapshot_at: '2026-10-28T00:00:00.000Z', xp: 400, total_kills: 3, total_deaths: 2 }),
];

describe('computeLeaderboard — 0098 kill filter (twin of the SQL)', () => {
  it('excludes 0-kill and null-kill profiles; ranks re-number contiguously', () => {
    const board = computeLeaderboard(SNAPSHOTS, USERNAMES, 'xp', 'all_time', 100, NOW);
    expect(board.map((e) => [e.player_id, e.value, e.rank])).toEqual([
      [ONE_KILL, 500, 1],
      [QUIET, 400, 2],
      [VETERAN, 100, 3],
    ]);
  });

  it('keys on lifetime kills: no kills inside the week still stands on the weekly board', () => {
    const board = computeLeaderboard(SNAPSHOTS, USERNAMES, 'xp', 'weekly', 100, NOW);
    const quiet = board.find((e) => e.player_id === QUIET);
    expect(quiet).toMatchObject({ value: 400, rank: 2 });
    expect(board.some((e) => e.player_id === PACIFIST)).toBe(false);
    expect(board.some((e) => e.player_id === UNRECORDED)).toBe(false);
  });

  it('the kills channel itself no longer lists a 0-kill hunter at value 0', () => {
    const board = computeLeaderboard(SNAPSHOTS, USERNAMES, 'total_kills', 'all_time', 100, NOW);
    expect(board.map((e) => e.player_id)).toEqual([VETERAN, QUIET, ONE_KILL]);
  });
});
