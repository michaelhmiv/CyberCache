/**
 * Weekly leaderboards + rewards (migration 0035) — shipped-path tests.
 *
 * The laws under test:
 *  - Weeks are ISO weeks (UTC): Monday 00:00 opens, next Monday
 *    closes; the week's identity is its Monday. The race rotation
 *    is a pure function of the week key — the whole server agrees
 *    with no coordination and no stored state.
 *  - Standings fold ONLY from server records in-window (the same
 *    record families the lifetime fold reads). Ties break by
 *    earliest-to-reach, then account creation, then player id — no
 *    shared ranks. Market sales belong to the SELLER named in the
 *    result; the NPC market account never ranks; an ACTIVE endless
 *    run proves no depth.
 *  - Settlement runs inside the daily heartbeat and is exactly-once:
 *    the settlement claim and the payments are one unit, re-runs pay
 *    nothing twice, and catch-up settles every closed week,
 *    including zero-activity ones.
 *  - Rewards: podium keys 3/2/1, drop-luck buffs by rank, gated by
 *    each race's qualifying minimum. Buffs are server rows with an
 *    expiry; the MAX unexpired grant is the active bonus (never a
 *    stack), and the real engines consume it — roaming rarity
 *    weights and the boss dedicated-drop chance — while unbuffed
 *    play stays bit-identical.
 *  - GET /api/leaderboard/weekly resolves identity from the JWT
 *    only; query/body player ids name nobody.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Rarity, RiskSetting } from '@/types/game';
import { createTickRng } from '@/lib/rng/tickRng';
import {
  LAST_REWARDED_RANK,
  LEADERBOARD_RACES,
  RACES_PER_WEEK,
  racesForWeek,
  rewardForRank,
  weekKeyOf,
  weekKeyOffset,
  weekWindow,
} from '../content/leaderboards';
import {
  computeRaceStandings,
  type WeeklyFoldInput,
  type WeeklyLedgerData,
} from '../server/leaderboards/fold';
import {
  InMemoryLeaderboardStore,
  emptyLeaderboardSeed,
  planWeekRewardsFor,
  type LeaderboardSeed,
} from '../server/leaderboards/store';
import { NPC_MARKET_USER_ID } from '../server/lib/npcMarket';
import { processBossAttempt, processRoamingClaim, type BossAttemptRequest, type ClaimRequest } from '../server/chef';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { generateShield } from '../server/lib/generators/shieldGenerator';
import { generateClassMod } from '../server/lib/generators/classModGenerator';
import { generateOrdnance } from '../server/lib/generators/ordnanceGenerator';
import { generateRelic } from '../server/lib/generators/relicGenerator';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { mountReadRoutes } from '../server/reads/routes';
import {
  InMemoryReadStore, emptyReadSeed,
  type ProfileRowData, type ReadSeed,
} from '../server/reads/store';
import { mountJobRoutes } from '../server/jobs/routes';
import { InMemoryJobStore, emptyJobSeed } from '../server/jobs/memory';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const JOB_SECRET = 'test-job-secret';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444'; // valid id, no profile

const W1 = '2026-10-19'; // Monday
const W1_START = '2026-10-19T00:00:00.000Z';
const W1_END = '2026-10-26T00:00:00.000Z';

// ---------------------------------------------------------------------------
// 1. Content: week math, rotation, reward table
// ---------------------------------------------------------------------------

describe('weekly leaderboards — content', () => {
  it('ISO weeks open Monday 00:00 UTC; a Sunday belongs to the prior Monday', () => {
    expect(weekKeyOf(new Date('2026-10-19T00:00:00.000Z'))).toBe('2026-10-19'); // Monday
    expect(weekKeyOf(new Date('2026-10-25T23:59:59.000Z'))).toBe('2026-10-19'); // Sunday
    expect(weekKeyOf(new Date('2026-10-26T00:00:00.000Z'))).toBe('2026-10-26'); // next Monday
    expect(weekWindow(W1)).toEqual({ start: W1_START, end: W1_END });
    expect(weekKeyOffset(new Date('2026-10-28T12:00:00.000Z'), -1)).toBe(W1);
    expect(weekKeyOffset(new Date('2026-10-21T12:00:00.000Z'), 1)).toBe('2026-10-26');
  });

  it('rotation: RACES_PER_WEEK distinct races, deterministic from the week key', () => {
    const first = racesForWeek(W1);
    expect(first).toHaveLength(RACES_PER_WEEK);
    expect(new Set(first.map((r) => r.id)).size).toBe(RACES_PER_WEEK);
    expect(racesForWeek(W1).map((r) => r.id)).toEqual(first.map((r) => r.id));
    for (const race of first) {
      expect(LEADERBOARD_RACES.map((r) => r.id)).toContain(race.id);
    }
    // The slate actually rotates across weeks (not one fixed set).
    const slates = new Set(
      ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']
        .map((k) => racesForWeek(k).map((r) => r.id).join(',')),
    );
    expect(slates.size).toBeGreaterThan(1);
  });

  it('reward table: podium keys 3/2/1, finisher buffs to rank 10, nothing past', () => {
    expect(rewardForRank(1)).toEqual({ cacheKeys: 3, buffBonus: 0.25, buffHours: 48 });
    expect(rewardForRank(2)).toEqual({ cacheKeys: 2, buffBonus: 0.2, buffHours: 36 });
    expect(rewardForRank(3)).toEqual({ cacheKeys: 1, buffBonus: 0.15, buffHours: 24 });
    expect(rewardForRank(4)).toEqual({ cacheKeys: 0, buffBonus: 0.1, buffHours: 12 });
    expect(rewardForRank(LAST_REWARDED_RANK)).toEqual({ cacheKeys: 0, buffBonus: 0.1, buffHours: 12 });
    expect(rewardForRank(LAST_REWARDED_RANK + 1)).toBeNull();
    expect(rewardForRank(0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. The weekly fold
// ---------------------------------------------------------------------------

function foldProfiles() {
  return [
    { id: A, username: 'alpha', created_at: '2026-10-01T00:00:00.000Z' },
    { id: B, username: 'bravo', created_at: '2026-10-02T00:00:00.000Z' },
    { id: C, username: 'charlie', created_at: '2026-10-03T00:00:00.000Z' },
    { id: NPC_MARKET_USER_ID, username: 'npc', created_at: '2026-09-01T00:00:00.000Z' },
  ];
}

function foldInput(ledger: WeeklyLedgerData[], endlessRuns: WeeklyFoldInput['endlessRuns'] = []): WeeklyFoldInput {
  return { profiles: foldProfiles(), ledger, endlessRuns, excludedPlayerIds: [NPC_MARKET_USER_ID] };
}

const row = (
  user_id: string, action_type: string, result_payload: Record<string, unknown>, created_at: string,
): WeeklyLedgerData => ({ user_id, action_type, result_payload, created_at });

describe('weekly leaderboards — fold', () => {
  it('roaming kills fold from claim + offline rows, in-window only', () => {
    const standings = computeRaceStandings(foldInput([
      row(A, 'cc_apply_chef_rewards', { rewards: { kills_recorded: 30 } }, '2026-10-19T10:00:00.000Z'),
      row(A, 'cc_settle_offline_roaming', { rewards: { kills_recorded: 5 } }, '2026-10-20T10:00:00.000Z'),
      row(B, 'cc_apply_chef_rewards', { rewards: { kills_recorded: 40 } }, '2026-10-21T10:00:00.000Z'),
      // Outside the window on both sides — never counted.
      row(A, 'cc_apply_chef_rewards', { rewards: { kills_recorded: 999 } }, '2026-10-18T23:59:59.000Z'),
      row(A, 'cc_apply_chef_rewards', { rewards: { kills_recorded: 999 } }, W1_END),
      // A request-shaped payload proves nothing (no rewards record).
      row(B, 'cc_apply_chef_rewards', { kills: 500 }, '2026-10-21T11:00:00.000Z'),
    ]), 'roaming_kills', W1_START, W1_END);
    expect(standings.map((s) => [s.player_id, s.value, s.rank])).toEqual([
      [B, 40, 1],
      [A, 35, 2],
    ]);
    expect(standings[1].reached_at).toBe('2026-10-20T10:00:00.000Z');
  });

  it('ties break by earliest-to-reach, then account creation', () => {
    const standings = computeRaceStandings(foldInput([
      row(B, 'cc_apply_chef_rewards', { rewards: { kills_recorded: 50 } }, '2026-10-20T10:00:00.000Z'),
      row(A, 'cc_apply_chef_rewards', { rewards: { kills_recorded: 50 } }, '2026-10-19T10:00:00.000Z'),
      row(C, 'cc_apply_chef_rewards', { rewards: { kills_recorded: 50 } }, '2026-10-19T10:00:00.000Z'),
    ]), 'roaming_kills', W1_START, W1_END);
    // A and C reached 50 at the same instant; A is the older account.
    expect(standings.map((s) => s.player_id)).toEqual([A, C, B]);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it('boss victories count verified victories only; elites and caches sum their records', () => {
    const ledger = [
      row(A, 'cc_apply_boss_attempt', { attempt: { victory: true } }, '2026-10-19T10:00:00.000Z'),
      row(A, 'cc_apply_boss_attempt', { attempt: { victory: false } }, '2026-10-19T11:00:00.000Z'),
      row(A, 'cc_apply_boss_attempt', { attempt: { victory: true } }, '2026-10-19T12:00:00.000Z'),
      row(B, 'roaming.elite_kill', { elite_kills: 2 }, '2026-10-19T10:00:00.000Z'),
      row(B, 'roaming.elite_kill', { elite_kills: 3 }, '2026-10-19T11:00:00.000Z'),
      row(C, 'cc_make_item', {}, '2026-10-19T10:00:00.000Z'),
      row(C, 'cc_draw_item', {}, '2026-10-19T11:00:00.000Z'),
      row(C, 'cc_recycle_item', { item: { rarity: 'Epic' } }, '2026-10-19T12:00:00.000Z'),
      row(C, 'cc_apply_extraction', { passes_completed: 2 }, '2026-10-19T13:00:00.000Z'),
    ];
    const input = foldInput(ledger);
    expect(computeRaceStandings(input, 'boss_victories', W1_START, W1_END)
      .map((s) => [s.player_id, s.value])).toEqual([[A, 2]]);
    expect(computeRaceStandings(input, 'elite_kills', W1_START, W1_END)
      .map((s) => [s.player_id, s.value])).toEqual([[B, 5]]);
    expect(computeRaceStandings(input, 'caches_opened', W1_START, W1_END)
      .map((s) => [s.player_id, s.value])).toEqual([[C, 2]]);
    expect(computeRaceStandings(input, 'items_salvaged', W1_START, W1_END)
      .map((s) => [s.player_id, s.value])).toEqual([[C, 1]]);
    expect(computeRaceStandings(input, 'extraction_passes', W1_START, W1_END)
      .map((s) => [s.player_id, s.value])).toEqual([[C, 2]]);
  });

  it('market sales belong to the seller; the NPC account never ranks', () => {
    const standings = computeRaceStandings(foldInput([
      // B buys from A: the sale is A's, though the row is B's.
      row(B, 'cc_accept_listing', { listing: { seller_user_id: A, price_credits: 500 } }, '2026-10-19T10:00:00.000Z'),
      row(C, 'cc_accept_listing', { listing: { seller_user_id: A, price_credits: 700 } }, '2026-10-19T11:00:00.000Z'),
      // NPC vendor sales never put the house on the board.
      row(A, 'cc_accept_listing', { listing: { seller_user_id: NPC_MARKET_USER_ID, price_credits: 100 } }, '2026-10-19T12:00:00.000Z'),
      // A sale row naming no seller proves nothing.
      row(B, 'cc_accept_listing', { listing: { price_credits: 100 } }, '2026-10-19T13:00:00.000Z'),
    ]), 'market_sales', W1_START, W1_END);
    expect(standings.map((s) => [s.player_id, s.value])).toEqual([[A, 2]]);
  });

  it('endless depth: max of ended runs in-window; active runs prove nothing; earliest max wins ties', () => {
    const standings = computeRaceStandings(foldInput([], [
      { user_id: A, status: 'completed', depth_reached: 10, ended_at: '2026-10-19T10:00:00.000Z' },
      { user_id: A, status: 'died', depth_reached: 14, ended_at: '2026-10-21T10:00:00.000Z' },
      { user_id: A, status: 'active', depth_reached: 99, ended_at: null },
      { user_id: B, status: 'completed', depth_reached: 14, ended_at: '2026-10-20T10:00:00.000Z' },
      // Ended last week — outside this window.
      { user_id: C, status: 'completed', depth_reached: 30, ended_at: '2026-10-18T10:00:00.000Z' },
    ]), 'endless_depth', W1_START, W1_END);
    expect(standings.map((s) => [s.player_id, s.value, s.rank])).toEqual([
      [B, 14, 1], // reached 14 a day before A did
      [A, 14, 2],
    ]);
    expect(standings[1].reached_at).toBe('2026-10-21T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// 3. Settlement planning + the in-memory store (exactly-once)
// ---------------------------------------------------------------------------

describe('weekly leaderboards — reward planning', () => {
  it('qualification gates payment: below the race minimum pays nothing', () => {
    const standings = new Map([
      ['roaming_kills', [
        { rank: 1, player_id: A, username: 'alpha', value: 24, reached_at: '2026-10-20T00:00:00.000Z' },
      ]],
    ] as const);
    expect(planWeekRewardsFor(W1, new Map(standings), new Date('2026-10-27T06:00:00.000Z'))
      .filter((r) => r.raceId === 'roaming_kills')).toEqual([]);
    standings.set('roaming_kills', [
      { rank: 1, player_id: A, username: 'alpha', value: 25, reached_at: '2026-10-20T00:00:00.000Z' },
    ]);
    const planned = planWeekRewardsFor(W1, new Map(standings), new Date('2026-10-27T06:00:00.000Z'))
      .filter((r) => r.raceId === 'roaming_kills');
    // Only if roaming_kills is actually featured in W1 does the plan pay it.
    const featured = racesForWeek(W1).some((r) => r.id === 'roaming_kills');
    expect(planned.length).toBe(featured ? 1 : 0);
    if (featured) {
      expect(planned[0]).toMatchObject({ playerId: A, cacheKeys: 3, buffBonus: 0.25, buffHours: 48 });
      expect(planned[0].buffExpiresAt).toBe('2026-10-29T06:00:00.000Z');
    }
  });

  it('ranks past LAST_REWARDED_RANK plan nothing', () => {
    const ids = [A, B, C, D,
      '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888',
      '99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
    const standings = new Map([
      ['boss_victories', ids.map((id, i) => ({
        rank: i + 1, player_id: id, username: null, value: 100 - i, reached_at: '2026-10-20T00:00:00.000Z',
      }))],
    ] as const);
    const planned = planWeekRewardsFor(W1, new Map(standings), new Date('2026-10-27T06:00:00.000Z'))
      .filter((r) => r.raceId === 'boss_victories');
    const featured = racesForWeek(W1).some((r) => r.id === 'boss_victories');
    expect(planned.length).toBe(featured ? LAST_REWARDED_RANK : 0);
    expect(planned.every((r) => r.rank <= LAST_REWARDED_RANK)).toBe(true);
  });
});

/** One qualifying winner per race family, all inside W1. */
function winnersSeed(): LeaderboardSeed {
  const seed = emptyLeaderboardSeed();
  seed.profiles = [
    { id: A, username: 'alpha', created_at: '2026-10-01T00:00:00.000Z', cache_tokens: 0 },
    { id: B, username: 'bravo', created_at: '2026-10-02T00:00:00.000Z', cache_tokens: 0 },
    { id: C, username: 'charlie', created_at: '2026-10-03T00:00:00.000Z', cache_tokens: 0 },
  ];
  seed.ledger = [
    row(A, 'cc_apply_chef_rewards', { rewards: { kills_recorded: 100 } }, '2026-10-19T10:00:00.000Z'),
    row(A, 'cc_apply_boss_attempt', { attempt: { victory: true } }, '2026-10-19T11:00:00.000Z'),
    row(B, 'roaming.elite_kill', { elite_kills: 5 }, '2026-10-19T12:00:00.000Z'),
    row(B, 'cc_make_item', {}, '2026-10-19T13:00:00.000Z'),
    ...Array.from({ length: 9 }, (_, i) =>
      row(C, 'cc_recycle_item', { item: { rarity: 'Rare' } }, `2026-10-19T14:0${i}:00.000Z`)),
    row(B, 'cc_accept_listing', { listing: { seller_user_id: A, price_credits: 900 } }, '2026-10-19T15:00:00.000Z'),
    row(B, 'cc_apply_extraction', { passes_completed: 2 }, '2026-10-19T16:00:00.000Z'),
  ];
  seed.endlessRuns = [
    { user_id: C, status: 'completed', depth_reached: 12, ended_at: '2026-10-20T10:00:00.000Z' },
  ];
  return seed;
}

describe('weekly leaderboards — settlement (in-memory store)', () => {
  const SETTLE_NOW = new Date('2026-10-27T06:00:00.000Z');

  it('pays each featured race\'s winner once: keys, buff, ledger meter rows', async () => {
    const store = new InMemoryLeaderboardStore(winnersSeed());
    const summary = await store.settleClosedWeeks(SETTLE_NOW);
    expect(summary.settledWeeks).toEqual([W1]);
    const featured = racesForWeek(W1);
    expect(summary.rewardsPaid).toBe(featured.length);
    expect(summary.cacheKeysPaid).toBe(featured.length * 3);

    const winnerByRace: Record<string, string> = {
      roaming_kills: A, boss_victories: A, elite_kills: B, caches_opened: B,
      items_salvaged: C, endless_depth: C, market_sales: A, extraction_passes: B,
    };
    for (const race of featured) {
      const rewards = store.seed.rewards.filter((r) => r.race_id === race.id);
      expect(rewards).toHaveLength(1);
      expect(rewards[0]).toMatchObject({
        week_key: W1, player_id: winnerByRace[race.id], rank: 1,
        cache_keys: 3, buff_bonus: 0.25, buff_hours: 48,
        buff_expires_at: '2026-10-29T06:00:00.000Z',
      });
    }
    // Non-featured races pay nothing.
    expect(store.seed.rewards.every((r) => featured.some((f) => f.id === r.race_id))).toBe(true);
    // Balances moved by exactly the paid keys.
    for (const profile of store.seed.profiles) {
      const won = store.seed.rewards
        .filter((r) => r.player_id === profile.id)
        .reduce((acc, r) => acc + r.cache_keys, 0);
      expect(profile.cache_tokens).toBe(won);
    }
    // Buff rows + the meter's source rows exist per reward.
    expect(store.seed.buffs).toHaveLength(featured.length);
    expect(store.seed.buffs.every((b) => b.expires_at === '2026-10-29T06:00:00.000Z')).toBe(true);
    expect(store.seed.settlementLedger).toHaveLength(featured.length);
    expect(store.seed.settlementLedger.every((r) => r.action_type === 'cc_leaderboard_settlement')).toBe(true);
    const metered = store.seed.settlementLedger
      .reduce((acc, r) => acc + Number(r.result_payload.cache_keys_awarded ?? 0), 0);
    expect(metered).toBe(summary.cacheKeysPaid);
  });

  it('exactly-once: a second settlement of the same week pays nothing again', async () => {
    const store = new InMemoryLeaderboardStore(winnersSeed());
    await store.settleClosedWeeks(SETTLE_NOW);
    const snapshot = JSON.stringify({
      rewards: store.seed.rewards, buffs: store.seed.buffs,
      ledger: store.seed.settlementLedger,
      balances: store.seed.profiles.map((p) => p.cache_tokens),
    });
    const again = await store.settleClosedWeeks(SETTLE_NOW);
    expect(again).toEqual({ settledWeeks: [], rewardsPaid: 0, cacheKeysPaid: 0 });
    expect(JSON.stringify({
      rewards: store.seed.rewards, buffs: store.seed.buffs,
      ledger: store.seed.settlementLedger,
      balances: store.seed.profiles.map((p) => p.cache_tokens),
    })).toBe(snapshot);
  });

  it('catch-up settles every closed week from the earliest record, empty weeks included', async () => {
    const seed = winnersSeed();
    seed.ledger.push(
      row(A, 'cc_apply_chef_rewards', { rewards: { kills_recorded: 30 } }, '2026-10-05T10:00:00.000Z'),
    );
    const store = new InMemoryLeaderboardStore(seed);
    const summary = await store.settleClosedWeeks(SETTLE_NOW);
    expect(summary.settledWeeks).toEqual(['2026-10-05', '2026-10-12', W1]);
    expect(store.seed.settlements.map((s) => s.week_key)).toEqual(['2026-10-05', '2026-10-12', W1]);
  });

  it('an unsettled current week never settles early', async () => {
    const store = new InMemoryLeaderboardStore(winnersSeed());
    const summary = await store.settleClosedWeeks(new Date('2026-10-25T23:59:59.000Z'));
    expect(summary.settledWeeks).toEqual([]);
    expect(store.seed.rewards).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Buff consumption — gameplay store read + the real engines
// ---------------------------------------------------------------------------

describe('weekly leaderboards — drop-luck consumption', () => {
  it('active bonus is the MAX unexpired grant; expired grants and other players do not count', async () => {
    const store = new InMemoryChefGameplayStore();
    const now = new Date('2026-10-28T00:00:00.000Z');
    store.seedDropBuff(A, 0.1, '2026-10-30T00:00:00.000Z');
    store.seedDropBuff(A, 0.25, '2026-10-29T00:00:00.000Z');
    store.seedDropBuff(A, 0.5, '2026-10-27T00:00:00.000Z'); // expired
    store.seedDropBuff(B, 0.25, '2026-10-30T00:00:00.000Z');
    await expect(store.getActiveDropBonus(A, now)).resolves.toBe(0.25);
    await expect(store.getActiveDropBonus(B, now)).resolves.toBe(0.25);
    await expect(store.getActiveDropBonus(C, now)).resolves.toBe(0);
    // At the expiry instant the grant is gone (strictly-greater rule).
    await expect(store.getActiveDropBonus(A, new Date('2026-10-29T00:00:00.000Z'))).resolves.toBe(0.1);
  });

  const claimRequest = (overrides: Partial<ClaimRequest> = {}): ClaimRequest => ({
    playerId: A,
    areaId: 'dustwaste_frontier',
    ticks: 1000,
    tickCount: 1000,
    playerLevel: 60,
    survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0, mitigation: 0 },
    ...overrides,
  });

  const topRarityDrops = (result: ReturnType<typeof processRoamingClaim>): number =>
    result.items.filter((item) => {
      const rarity = (item as { rarity?: unknown }).rarity;
      return rarity === Rarity.Epic || rarity === Rarity.Legendary;
    }).length;

  it('roaming: a live buff lifts Epic/Legendary drops; a zero buff changes nothing', () => {
    // Item identities draw on legacy unseeded generator fallbacks, so
    // claims are sampled in aggregate (the shipped determinism
    // surface is the rewards block, asserted below). The buff enters
    // the rarity shape only when > 0 — a zero buff must track the
    // unbuffed distribution while a live one separates decisively.
    const CLAIMS = 8;
    let baseTop = 0;
    let zeroTop = 0;
    let buffedTop = 0;
    let baseRewards: unknown = null;
    let zeroRewards: unknown = null;
    for (let i = 0; i < CLAIMS; i++) {
      const base = processRoamingClaim(claimRequest());
      const zero = processRoamingClaim(claimRequest({ economy: { dropLuckBonus: 0 } }));
      const buffed = processRoamingClaim(claimRequest({ economy: { dropLuckBonus: 4 } }));
      baseTop += topRarityDrops(base);
      zeroTop += topRarityDrops(zero);
      buffedTop += topRarityDrops(buffed);
      baseRewards ??= base.rewards;
      zeroRewards ??= zero.rewards;
    }
    expect(zeroRewards).toEqual(baseRewards);
    expect(buffedTop).toBeGreaterThanOrEqual(4);
    expect(buffedTop).toBeGreaterThan(baseTop + zeroTop);
  });

  it('boss: a live buff makes the dedicated drop land; the unbuffed roll is unchanged', () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'dune_tyrant') ?? REGION_1_BOSSES[0];
    const rng = createTickRng('leaderboard-test', 'loadout', 11);
    const loadout = {
      primary: generateWeapon({ source: DropSource.WorldDrop, level: 60, forcedRarity: Rarity.Epic }, rng),
      secondary: generateWeapon({ source: DropSource.WorldDrop, level: 60, forcedRarity: Rarity.Epic }, rng),
      heavy: generateWeapon({ source: DropSource.WorldDrop, level: 60, forcedRarity: Rarity.Epic }, rng),
      ordnance: generateOrdnance(60, rng, { [Rarity.Epic]: 1 }),
      shield: generateShield(60, rng, { [Rarity.Epic]: 1 }),
      classMod: generateClassMod(60, rng, { [Rarity.Epic]: 1 }),
      relic: generateRelic(60, rng, { [Rarity.Epic]: 1 }),
    };
    const attempt = (nonce: number, economy?: BossAttemptRequest['economy']): BossAttemptRequest => ({
      ...loadout,
      consumables: {},
      risk: RiskSetting.Balanced,
      bossId: boss.id,
      playerId: A,
      playerLevel: 60,
      skillBonuses: {},
      attemptNonce: nonce,
      entryFee: 0,
      economy,
    });
    // Find a winning nonce whose unbuffed victory roll does NOT land
    // the dedicated drop — the buff must flip exactly that outcome.
    let nonce = -1;
    for (let n = 1; n <= 80 && nonce < 0; n++) {
      const attemptResult = processBossAttempt(attempt(n));
      if (attemptResult.result.victory && !attemptResult.dedicatedDropAwarded) nonce = n;
    }
    expect(nonce).toBeGreaterThan(0);
    const unbuffed = processBossAttempt(attempt(nonce));
    expect(unbuffed.result.victory).toBe(true);
    expect(unbuffed.dedicatedDropAwarded).toBe(false);
    const zeroBuff = processBossAttempt(attempt(nonce, { dropLuckBonus: 0 }));
    expect(zeroBuff.dedicatedDropAwarded).toBe(false);
    const buffed = processBossAttempt(attempt(nonce, { dropLuckBonus: 50 }));
    expect(buffed.result.victory).toBe(true);
    expect(buffed.dedicatedDropAwarded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. The read route — JWT identity only, real wire shape
// ---------------------------------------------------------------------------

function profileRow(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 60, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 3, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

interface WeeklyResponse {
  week: { key: string; start: string; ends_at: string };
  races: Array<{
    id: string; entries: Array<{ player_id: string; value: number; rank: number }>;
    participant_count: number; me: { rank: number; value: number } | null;
    my_reward: { cache_keys: number } | null;
  }>;
  previous_week: {
    key: string; settled: boolean;
    races: Array<{
      id: string; me: { rank: number; value: number } | null;
      my_reward: { cache_keys: number; buff_bonus: number } | null;
    }>;
  };
  my_drop_buff: { bonus: number; expires_at: string } | null;
}

describe('weekly leaderboards — GET /api/leaderboard/weekly', () => {
  let base = '';
  let tokenA = '';
  let tokenB = '';
  let tokenD = '';
  const servers: Array<{ close: () => void }> = [];

  beforeAll(async () => {
    const now = new Date();
    const curKey = weekKeyOf(now);
    const prevKey = weekKeyOffset(now, -1);
    const cur = weekWindow(curKey);
    const prev = weekWindow(prevKey);
    const inCur = (h: number) => new Date(Date.parse(cur.start) + h * 3_600_000).toISOString();
    const inPrev = (h: number) => new Date(Date.parse(prev.start) + h * 3_600_000).toISOString();

    const seed: ReadSeed = emptyReadSeed();
    seed.profiles = [
      profileRow({ id: A, username: 'alpha', created_at: '2026-10-01T00:00:00.000Z' }),
      profileRow({ id: B, username: 'bravo', created_at: '2026-10-02T00:00:00.000Z' }),
    ];
    seed.ledger = [
      // Current week activity for A across families; B kills only.
      { user_id: A, action_type: 'cc_apply_chef_rewards', result_payload: { rewards: { kills_recorded: 30 } }, created_at: inCur(1) },
      { user_id: B, action_type: 'cc_apply_chef_rewards', result_payload: { rewards: { kills_recorded: 12 } }, created_at: inCur(2) },
      { user_id: A, action_type: 'cc_apply_boss_attempt', result_payload: { attempt: { victory: true } }, created_at: inCur(3) },
      // Previous week activity for A.
      { user_id: A, action_type: 'cc_apply_chef_rewards', result_payload: { rewards: { kills_recorded: 44 } }, created_at: inPrev(1) },
    ];
    seed.leaderboardSettlements = [{ week_key: prevKey, settled_at: inCur(0) }];
    const prevFeatured = racesForWeek(prevKey)[0];
    seed.leaderboardRewards = [{
      week_key: prevKey, race_id: prevFeatured.id, player_id: A, rank: 1,
      cache_keys: 3, buff_bonus: 0.25, buff_hours: 48,
      buff_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }];
    seed.dropBuffs = [{
      player_id: A, bonus: 0.25, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }];

    const app = express();
    app.use(express.json());
    mountReadRoutes(app, new InMemoryReadStore(seed), { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    servers.push(server);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tokenA = issueAccessToken(SECRET, A, false);
    tokenB = issueAccessToken(SECRET, B, false);
    tokenD = issueAccessToken(SECRET, D, false);
  });

  afterAll(() => { for (const s of servers) s.close(); });

  const get = async (path: string, token?: string) => {
    const res = await fetch(`${base}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, json: (await res.json()) as WeeklyResponse & { error?: string } };
  };

  it('serves the rotation for both weeks and the caller\'s own standings', async () => {
    const { status, json } = await get('/api/leaderboard/weekly', tokenA);
    expect(status).toBe(200);
    expect(json.week.key).toBe(weekKeyOf(new Date()));
    expect(json.races.map((r) => r.id)).toEqual(racesForWeek(json.week.key).map((r) => r.id));
    expect(json.previous_week.key).toBe(weekKeyOffset(new Date(), -1));
    expect(json.previous_week.settled).toBe(true);
    // A's kills lead the current roaming board when it is featured.
    const kills = json.races.find((r) => r.id === 'roaming_kills');
    if (kills) {
      expect(kills.entries[0]).toMatchObject({ player_id: A, value: 30, rank: 1 });
      expect(kills.me).toEqual({ rank: 1, value: 30 });
    }
    // Last week: A's seeded reward is attached to its race board.
    const rewarded = json.previous_week.races.find((r) => r.my_reward !== null);
    expect(rewarded?.my_reward).toMatchObject({ cache_keys: 3, buff_bonus: 0.25 });
    // A's live buff is reported.
    expect(json.my_drop_buff?.bonus).toBe(0.25);
  });

  it('identity comes from the JWT: a forged query id changes nothing', async () => {
    const asA = await get('/api/leaderboard/weekly', tokenA);
    const forged = await get(`/api/leaderboard/weekly?player_id=${B}&playerId=${B}`, tokenA);
    expect(forged.json).toEqual(asA.json);
    // B's own view: B's standings, no reward, no buff.
    const asB = await get('/api/leaderboard/weekly', tokenB);
    expect(asB.json.my_drop_buff).toBeNull();
    expect(asB.json.previous_week.races.every((r) => r.my_reward === null)).toBe(true);
    const kills = asB.json.races.find((r) => r.id === 'roaming_kills');
    if (kills) expect(kills.me).toEqual({ rank: 2, value: 12 });
  });

  it('requires auth and a profile', async () => {
    expect((await get('/api/leaderboard/weekly')).status).toBe(401);
    expect((await get('/api/leaderboard/weekly', tokenD)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 6. Heartbeat settlement — the shipped job route pays the week
// ---------------------------------------------------------------------------

describe('weekly leaderboards — daily heartbeat settlement', () => {
  let base = '';
  let leaderboardStore: InMemoryLeaderboardStore;
  const servers: Array<{ close: () => void }> = [];

  beforeAll(async () => {
    leaderboardStore = new InMemoryLeaderboardStore(winnersSeed());
    const app = express();
    app.use(express.json());
    mountJobRoutes(app, new InMemoryJobStore(emptyJobSeed()), {
      jwtSecret: SECRET,
      jobSecret: JOB_SECRET,
      fcmSender: null,
      leaderboardStore,
    });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    servers.push(server);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => { for (const s of servers) s.close(); });

  const heartbeat = async () => {
    const res = await fetch(`${base}/api/jobs/daily-heartbeat`, {
      method: 'POST',
      headers: { 'x-chef-job-secret': JOB_SECRET, 'content-type': 'application/json' },
      body: '{}',
    });
    return {
      status: res.status,
      json: (await res.json()) as {
        leaderboardSettlement?: { settledWeeks: string[]; rewardsPaid: number; cacheKeysPaid: number } | null;
      },
    };
  };

  it('the heartbeat settles the closed week and pays its winners', async () => {
    const { status, json } = await heartbeat();
    expect(status).toBe(200);
    expect(json.leaderboardSettlement?.settledWeeks).toContain(W1);
    const featured = racesForWeek(W1);
    expect(json.leaderboardSettlement?.rewardsPaid).toBe(featured.length);
    expect(json.leaderboardSettlement?.cacheKeysPaid).toBe(featured.length * 3);
    expect(leaderboardStore.seed.rewards.length).toBe(featured.length);
  });

  it('the next heartbeat is a no-op for that week (exactly-once)', async () => {
    const { status, json } = await heartbeat();
    expect(status).toBe(200);
    expect(json.leaderboardSettlement?.settledWeeks).toEqual([]);
    expect(json.leaderboardSettlement?.rewardsPaid).toBe(0);
    expect(json.leaderboardSettlement?.cacheKeysPaid).toBe(0);
  });
});
