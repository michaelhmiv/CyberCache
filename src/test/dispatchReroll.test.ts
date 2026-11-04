/**
 * Dispatch board reroll (migration 0068, economy brief §7.3) —
 * a credit-priced re-deal of the daily dispatch board.
 *
 * Laws under test:
 *  - BOARD 0 IS BYTE-IDENTICAL: the free daily board keeps the
 *    shipped hash inputs and ids; board n ≥ 1 deals the same
 *    six-slot composition (courier at 1 and 4) under fresh seeds
 *    with ids d<day>-r<n>-<i>.
 *  - PRICE ESCALATES: reroll k costs dispatchRerollBaseCredits ×
 *    2^(k−1) (250/500/1000/2000/4000 at defaults), capped at
 *    dispatchRerollDailyCap rerolls per UTC day (default 5); both
 *    are economy-config keys with the brief's clamps.
 *  - DEPARTED STAYS DEPARTED: an offer id departed today is
 *    filtered from every board's presentable set and refuses
 *    re-departure; identical terms under a NEW id are a new offer.
 *  - RUNNING CONTRACTS NEVER REPRICE: a reroll touches only
 *    un-departed offers; a running mission's snapshot settles at
 *    its departure terms.
 *  - VALIDATION REJECTS NON-CURRENT BOARDS: yesterday's board,
 *    a previous board, and an unpurchased future board never
 *    price or depart.
 *  - STATE IS PER-PLAYER PER-DAY AND LAZY: board index / rerolls
 *    used / day key live on the profile and reset on read at the
 *    UTC rollover — no cron.
 *  - THE BURN IS METERED: cc_reroll_dispatch_board rows fold into
 *    credits_destroyed_dispatch_rerolls, inside the destroyed
 *    total (InMemory economy twin; SQL pinned textually).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dispatchOffersForBoard,
  dispatchOffersForDate,
  dispatchRerollPrice,
  dispatchRerollsRemaining,
  findDispatchOfferForBoard,
  resolveDispatchBoardState,
  resolveDispatchLevers,
  utcDayKey,
  type DispatchLeverValues,
} from '@/content/dispatch';
import { ECONOMY_CONFIG_DEFAULTS, ECONOMY_CONFIG_KEYS, validateEconomyConfigValue } from '../server/economy/config';
import { InMemoryEconomyStore } from '../server/economy/memory';
import { mountDispatchRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
type Json = Record<string, unknown>;

const LEVERS: DispatchLeverValues = resolveDispatchLevers();
const DAY = new Date('2026-11-03T12:00:00.000Z');

// ---------------------------------------------------------------------------
// 1. Content: boards, prices, state resolution
// ---------------------------------------------------------------------------

describe('dispatch reroll content: boards', () => {
  it('board 0 is byte-identical to the shipped daily board', () => {
    const board0 = dispatchOffersForBoard(DAY, 0);
    expect(board0).toEqual(dispatchOffersForDate(DAY));
    // The shipped board for 2026-11-03, pinned literally (ids,
    // families, areas, durations) so any drift in the board-0 hash
    // inputs fails here.
    expect(board0).toEqual(BOARD0_2026_11_03);
  });

  it('rerolled boards keep the six-slot composition under fresh seeds and ids', () => {
    for (const n of [1, 2, 5]) {
      const board = dispatchOffersForBoard(DAY, n);
      expect(board).toHaveLength(6);
      expect(board.map((o) => o.family)).toEqual(['foot', 'courier', 'foot', 'foot', 'courier', 'foot']);
      expect(board.map((o) => o.id)).toEqual([0, 1, 2, 3, 4, 5].map((i) => `d20261103-r${n}-${i}`));
    }
    // Fresh seeds: across a week of days, board 1 differs from
    // board 0 in at least one slot every day (a reroll that dealt
    // the identical board would be a seed bug).
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(Date.UTC(2026, 10, 3 + offset, 12, 0, 0));
      const b0 = dispatchOffersForBoard(day, 0).map((o) => `${o.areaId}:${o.durationHours}`);
      const b1 = dispatchOffersForBoard(day, 1).map((o) => `${o.areaId}:${o.durationHours}`);
      expect(b1).not.toEqual(b0);
    }
    // Round-trip on the current board only.
    const board2 = dispatchOffersForBoard(DAY, 2);
    expect(findDispatchOfferForBoard(DAY, 2, board2[3].id)).toEqual(board2[3]);
    expect(findDispatchOfferForBoard(DAY, 1, board2[3].id)).toBeNull();
    expect(findDispatchOfferForBoard(DAY, 0, board2[3].id)).toBeNull();
  });

  it('price escalates base x 2^(k-1) and the cap counts down', () => {
    expect([0, 1, 2, 3, 4].map((used) => dispatchRerollPrice(used, LEVERS)))
      .toEqual([250, 500, 1000, 2000, 4000]);
    expect([0, 1, 4, 5, 9].map((used) => dispatchRerollsRemaining(used, LEVERS)))
      .toEqual([5, 4, 1, 0, 0]);
    const custom = resolveDispatchLevers({ dispatchRerollBaseCredits: 100, dispatchRerollDailyCap: 2 });
    expect([0, 1].map((used) => dispatchRerollPrice(used, custom))).toEqual([100, 200]);
    expect(dispatchRerollsRemaining(2, custom)).toBe(0);
  });

  it('board state resolves lazily: a stale day key reads as the fresh day', () => {
    expect(resolveDispatchBoardState({ boardIndex: 3, rerollsUsed: 2, day: '2026-11-03' }, DAY))
      .toEqual({ boardIndex: 3, rerollsUsed: 2, day: '2026-11-03' });
    expect(resolveDispatchBoardState({ boardIndex: 3, rerollsUsed: 2, day: '2026-11-02' }, DAY))
      .toEqual({ boardIndex: 0, rerollsUsed: 0, day: '2026-11-03' });
    expect(resolveDispatchBoardState(null, DAY))
      .toEqual({ boardIndex: 0, rerollsUsed: 0, day: utcDayKey(DAY) });
    expect(resolveDispatchBoardState({ boardIndex: null, rerollsUsed: null, day: null }, DAY))
      .toEqual({ boardIndex: 0, rerollsUsed: 0, day: '2026-11-03' });
  });

  it('both reroll levers are economy-config keys pinned to the content defaults', () => {
    expect(ECONOMY_CONFIG_KEYS).toHaveProperty('dispatchRerollBaseCredits');
    expect(ECONOMY_CONFIG_KEYS).toHaveProperty('dispatchRerollDailyCap');
    expect(ECONOMY_CONFIG_DEFAULTS.dispatchRerollBaseCredits).toBe(250);
    expect(ECONOMY_CONFIG_DEFAULTS.dispatchRerollDailyCap).toBe(5);
    // The brief's clamps: base [0, 10000], cap [0, 20], both integer.
    expect(validateEconomyConfigValue('dispatchRerollBaseCredits', 0)).toBe(0);
    expect(validateEconomyConfigValue('dispatchRerollBaseCredits', 10000)).toBe(10000);
    expect(validateEconomyConfigValue('dispatchRerollBaseCredits', 10001)).toBeNull();
    expect(validateEconomyConfigValue('dispatchRerollBaseCredits', 2.5)).toBeNull();
    expect(validateEconomyConfigValue('dispatchRerollDailyCap', 20)).toBe(20);
    expect(validateEconomyConfigValue('dispatchRerollDailyCap', 21)).toBeNull();
    expect(resolveDispatchLevers({ dispatchRerollBaseCredits: 99999 }).dispatchRerollBaseCredits).toBe(10000);
    expect(resolveDispatchLevers({ dispatchRerollDailyCap: -1 }).dispatchRerollDailyCap).toBe(0);
  });
});

const BOARD0_2026_11_03: ReturnType<typeof dispatchOffersForDate> = [
  { id: 'd20261103-0', family: 'foot', areaId: 'blastforge_yards', durationHours: 24 },
  { id: 'd20261103-1', family: 'courier', areaId: 'dustwaste_frontier', durationHours: 8 },
  { id: 'd20261103-2', family: 'foot', areaId: 'helixworks_labyrinth', durationHours: 2 },
  { id: 'd20261103-3', family: 'foot', areaId: 'throwtech_dumpnet', durationHours: 24 },
  { id: 'd20261103-4', family: 'courier', areaId: 'ironwood_bastion', durationHours: 8 },
  { id: 'd20261103-5', family: 'foot', areaId: 'ironwood_bastion', durationHours: 24 },
];

// ---------------------------------------------------------------------------
// 2. Routes + in-memory twin
// ---------------------------------------------------------------------------

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface RouteHarness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
  setNow: (d: Date) => void;
}

async function makeRouteServer(
  startNow: Date,
  leverProvider?: () => Partial<DispatchLeverValues>,
): Promise<RouteHarness> {
  let now = startNow;
  const nowFn = () => now;
  const store = new InMemoryChefGameplayStore(nowFn, undefined, leverProvider);
  const app = express();
  app.use(express.json());
  const economyConfig = leverProvider
    ? { snapshot: async () => leverProvider() as Record<string, unknown> }
    : undefined;
  mountDispatchRoutes(app, store, {
    jwtSecret: SECRET, now: nowFn,
    ...(economyConfig ? { economyConfig: economyConfig as never } : {}),
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    tokenA: issueAccessToken(SECRET, A, false),
    setNow: (d: Date) => { now = d; },
  };
}

async function get(h: RouteHarness, path: string, token?: string) {
  const res = await fetch(`${h.base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function post(h: RouteHarness, path: string, body: unknown, token?: string) {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

type RerollState = {
  credits: number;
  boardIndex: number;
  rerollsUsed: number;
  rerollsRemaining: number;
  rerollPrice: number | null;
  departedOfferIds: string[];
  offers: Array<{ id: string; family: string; areaId: string; durationHours: number }>;
  missions: Array<Json>;
};

async function stateOf(h: RouteHarness): Promise<RerollState> {
  const res = await get(h, '/api/dispatch/me', h.tokenA);
  expect(res.status).toBe(200);
  return res.json.dispatch as RerollState;
}

function seedSpareWeapons(store: InMemoryChefGameplayStore, prefix: string, count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `${prefix}-${i}`;
    store.seedItem({
      id, owner_user_id: A, kind: 'weapon', item_level: 25, rarity: 'Uncommon',
      payload: { name: `Spare Gun ${i}` },
    });
    ids.push(id);
  }
  return ids;
}

describe('dispatch reroll routes', () => {
  it('reroll burns the escalating price, advances the board, and replays by nonce', async () => {
    const h = await makeRouteServer(DAY);
    h.store.seedProfile({ id: A, player_level: 50, credits: 10000 });
    const before = await stateOf(h);
    expect(before.boardIndex).toBe(0);
    expect(before.rerollPrice).toBe(250);
    expect(before.rerollsRemaining).toBe(5);
    expect(before.offers.map((o) => o.id)).toEqual(dispatchOffersForDate(DAY).map((o) => o.id));

    const first = await post(h, '/api/dispatch/reroll', { nonce: 'reroll-nonce-0001' }, h.tokenA);
    expect(first.status).toBe(200);
    expect((first.json.rerolled as Json).credits_charged).toBe(250);
    expect((first.json.rerolled as Json).board_index).toBe(1);
    expect(h.store.profiles.get(A)!.credits).toBe(9750);

    const afterFirst = await stateOf(h);
    expect(afterFirst.boardIndex).toBe(1);
    expect(afterFirst.rerollPrice).toBe(500);
    expect(afterFirst.rerollsRemaining).toBe(4);
    expect(afterFirst.offers.map((o) => o.id))
      .toEqual(dispatchOffersForBoard(DAY, 1).map((o) => o.id));

    // Nonce replay: same stored result, no second burn.
    const replay = await post(h, '/api/dispatch/reroll', { nonce: 'reroll-nonce-0001' }, h.tokenA);
    expect(replay.status).toBe(200);
    expect(h.store.profiles.get(A)!.credits).toBe(9750);
    expect(h.store.dispatchRerollLog).toHaveLength(1);

    const second = await post(h, '/api/dispatch/reroll', { nonce: 'reroll-nonce-0002' }, h.tokenA);
    expect(second.status).toBe(200);
    expect((second.json.rerolled as Json).credits_charged).toBe(500);
    expect(h.store.profiles.get(A)!.credits).toBe(9250);
  });

  it('departed offers stay consumed across rerolls; a new id with matching terms may depart', async () => {
    const h = await makeRouteServer(DAY);
    h.store.seedProfile({ id: A, player_level: 50, credits: 10000 });
    const itemIds = seedSpareWeapons(h.store, 'stay-gun', 16);
    const board0 = await stateOf(h);
    const offer = board0.offers.find((o) => o.family === 'foot')!;
    const started = await post(h, '/api/dispatch/start', {
      offerId: offer.id, itemIds: itemIds.slice(0, 2), nonce: 'stay-start-0001',
    }, h.tokenA);
    expect(started.status).toBe(200);

    // The departed offer leaves the presentable set immediately.
    const midState = await stateOf(h);
    expect(midState.offers.map((o) => o.id)).not.toContain(offer.id);
    expect(midState.departedOfferIds).toContain(offer.id);

    const rerolled = await post(h, '/api/dispatch/reroll', { nonce: 'stay-reroll-001' }, h.tokenA);
    expect(rerolled.status).toBe(200);
    const board1 = await stateOf(h);
    // Still consumed on the new board — and it never validates again.
    expect(board1.offers.map((o) => o.id)).not.toContain(offer.id);
    expect(board1.departedOfferIds).toContain(offer.id);
    const restart = await post(h, '/api/dispatch/start', {
      offerId: offer.id, itemIds: itemIds.slice(2, 4), nonce: 'stay-start-0002',
    }, h.tokenA);
    expect(restart.status).toBe(400);

    // A board-1 offer departs normally — even if its terms (area +
    // duration) happened to match a departed board-0 offer, the new
    // id makes it a new offer.
    const fresh = board1.offers.find((o) => o.family === 'foot')!;
    const departed = await post(h, '/api/dispatch/start', {
      offerId: fresh.id, itemIds: itemIds.slice(2, 4), nonce: 'stay-start-0003',
    }, h.tokenA);
    expect(departed.status).toBe(200);
  });

  it('validation rejects non-current boards: previous, future, and yesterday', async () => {
    const h = await makeRouteServer(DAY);
    h.store.seedProfile({ id: A, player_level: 50, credits: 10000 });
    const itemIds = seedSpareWeapons(h.store, 'board-gun', 8);
    const board0 = await stateOf(h);
    const staleOffer = board0.offers.find((o) => o.family === 'foot')!;

    await post(h, '/api/dispatch/reroll', { nonce: 'board-reroll-001' }, h.tokenA);

    // Previous board (board 0) no longer validates.
    const stale = await post(h, '/api/dispatch/start', {
      offerId: staleOffer.id, itemIds: itemIds.slice(0, 2), nonce: 'board-start-001',
    }, h.tokenA);
    expect(stale.status).toBe(400);
    // Unpurchased future board (board 2) never validates.
    const future = dispatchOffersForBoard(DAY, 2).find((o) => o.family === 'foot')!;
    const forged = await post(h, '/api/dispatch/start', {
      offerId: future.id, itemIds: itemIds.slice(0, 2), nonce: 'board-start-002',
    }, h.tokenA);
    expect(forged.status).toBe(400);
    // Yesterday's board never validates.
    const yesterday = dispatchOffersForDate(new Date('2026-11-02T12:00:00.000Z'))[0];
    const old = await post(h, '/api/dispatch/start', {
      offerId: yesterday.id, itemIds: itemIds.slice(0, 2), nonce: 'board-start-003',
    }, h.tokenA);
    expect(old.status).toBe(400);
    // Preview agrees with start: a non-current offer is unknown.
    const preview = await post(h, '/api/dispatch/preview', {
      offerId: staleOffer.id, itemIds: itemIds.slice(0, 2),
    }, h.tokenA);
    expect(preview.status).toBe(400);
    expect(h.store.dispatchMissions).toHaveLength(0);
  });

  it('running contracts are never repriced by a reroll and settle at departure terms', async () => {
    const h = await makeRouteServer(DAY);
    h.store.seedProfile({ id: A, player_level: 50, credits: 10000 });
    const itemIds = seedSpareWeapons(h.store, 'fixed-gun', 4);
    const board0 = await stateOf(h);
    const offer = board0.offers.find((o) => o.family === 'foot')!;
    const started = await post(h, '/api/dispatch/start', {
      offerId: offer.id, itemIds: itemIds.slice(0, 2), nonce: 'fixed-start-001',
    }, h.tokenA);
    expect(started.status).toBe(200);
    const missionBefore = { ...h.store.dispatchMissions.find((m) => m.user_id === A)! };

    await post(h, '/api/dispatch/reroll', { nonce: 'fixed-reroll-001' }, h.tokenA);
    await post(h, '/api/dispatch/reroll', { nonce: 'fixed-reroll-002' }, h.tokenA);

    const missionAfter = h.store.dispatchMissions.find((m) => m.user_id === A)!;
    expect(missionAfter).toEqual(missionBefore);
    expect(missionAfter.status).toBe('active');

    // Settlement pays the departure snapshot, not any re-dealt terms.
    h.setNow(new Date(DAY.getTime() + (offer.durationHours + 1) * 3600_000));
    const settled = await stateOf(h);
    expect(settled.missions.find((m) => m.offer_id === offer.id)?.status).toBe('settled');
    expect(h.store.profiles.get(A)!.credits)
      .toBe(10000 - 250 - 500 + missionBefore.payout_credits);
  });

  it('the daily cap refuses the sixth reroll with its remedy; insufficient credits refuses too', async () => {
    const h = await makeRouteServer(DAY);
    h.store.seedProfile({ id: A, player_level: 50, credits: 100000 });
    const prices: number[] = [];
    for (let k = 0; k < 5; k += 1) {
      const res = await post(h, '/api/dispatch/reroll', { nonce: `cap-reroll-000${k}` }, h.tokenA);
      expect(res.status).toBe(200);
      prices.push(Number((res.json.rerolled as Json).credits_charged));
    }
    expect(prices).toEqual([250, 500, 1000, 2000, 4000]);
    expect(h.store.profiles.get(A)!.credits).toBe(100000 - 7750);
    const capped = await stateOf(h);
    expect(capped.rerollsRemaining).toBe(0);
    expect(capped.rerollPrice).toBeNull();
    const sixth = await post(h, '/api/dispatch/reroll', { nonce: 'cap-reroll-0006' }, h.tokenA);
    expect(sixth.status).toBe(400);
    expect(String(sixth.json.detail ?? sixth.json.error)).toContain('reset at the day rollover');
    expect(h.store.profiles.get(A)!.credits).toBe(100000 - 7750);

    const poor = await makeRouteServer(DAY);
    poor.store.seedProfile({ id: A, player_level: 50, credits: 100 });
    const broke = await post(poor, '/api/dispatch/reroll', { nonce: 'poor-reroll-001' }, poor.tokenA);
    expect(broke.status).toBe(400);
    expect(String(broke.json.detail ?? broke.json.error)).toContain('Insufficient credits');
    expect(poor.store.profiles.get(A)!.credits).toBe(100);
  });

  it('the day rollover lazily resets board, price, and count on read', async () => {
    const h = await makeRouteServer(DAY);
    h.store.seedProfile({ id: A, player_level: 50, credits: 10000 });
    await post(h, '/api/dispatch/reroll', { nonce: 'roll-reroll-0001' }, h.tokenA);
    expect((await stateOf(h)).boardIndex).toBe(1);

    const nextDay = new Date('2026-11-04T00:30:00.000Z');
    h.setNow(nextDay);
    const fresh = await stateOf(h);
    expect(fresh.boardIndex).toBe(0);
    expect(fresh.rerollsUsed).toBe(0);
    expect(fresh.rerollPrice).toBe(250);
    expect(fresh.offers.map((o) => o.id))
      .toEqual(dispatchOffersForDate(nextDay).map((o) => o.id));

    // The first reroll of the new day charges the base price again
    // and persists the new day key.
    const again = await post(h, '/api/dispatch/reroll', { nonce: 'roll-reroll-0002' }, h.tokenA);
    expect(again.status).toBe(200);
    expect((again.json.rerolled as Json).credits_charged).toBe(250);
    expect(h.store.profiles.get(A)!.dispatch_board_day).toBe('2026-11-04');
  });

  it('lever overrides move the price curve and the cap through both twins', async () => {
    const h = await makeRouteServer(DAY, () => ({
      dispatchRerollBaseCredits: 100, dispatchRerollDailyCap: 2,
    }));
    h.store.seedProfile({ id: A, player_level: 50, credits: 10000 });
    expect((await stateOf(h)).rerollPrice).toBe(100);
    const one = await post(h, '/api/dispatch/reroll', { nonce: 'lever-reroll-001' }, h.tokenA);
    expect((one.json.rerolled as Json).credits_charged).toBe(100);
    const two = await post(h, '/api/dispatch/reroll', { nonce: 'lever-reroll-002' }, h.tokenA);
    expect((two.json.rerolled as Json).credits_charged).toBe(200);
    const three = await post(h, '/api/dispatch/reroll', { nonce: 'lever-reroll-003' }, h.tokenA);
    expect(three.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 3. Economy fold + SQL twin pins
// ---------------------------------------------------------------------------

describe('dispatch reroll economy fold', () => {
  it('memory metrics fold the reroll burn into its own breakout inside the destroyed total', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const store = new InMemoryEconomyStore({
      config: {},
      items: [],
      ledger: [
        {
          action_type: 'cc_reroll_dispatch_board', created_at: `${today}T10:00:00.000Z`,
          result_payload: { credits_charged: 250 },
        },
        {
          action_type: 'cc_reroll_dispatch_board', created_at: `${today}T11:00:00.000Z`,
          result_payload: { credits_charged: 500 },
        },
      ],
    });
    const row = await store.computeMetricsForDay(today);
    expect(row.creditsDestroyedDispatchRerolls).toBe(750);
    expect(row.creditsDestroyedTotal).toBe(750);
    expect(row.netCreditChange).toBe(-750);
  });
});

describe('dispatch reroll SQL twin pins (0068)', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0068_dispatch_reroll.sql'), 'utf8');

  it('carries the profile board state and the reroll op with live levers', () => {
    for (const column of ['dispatch_board_index', 'dispatch_rerolls_used', 'dispatch_board_day']) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('cc_reroll_dispatch_board');
    expect(sql).toContain("cc_economy_config_number('dispatchRerollBaseCredits', 250)");
    expect(sql).toContain("cc_economy_config_number('dispatchRerollDailyCap', 5)");
    expect(sql).toContain('Dispatch reroll cap reached — board re-deals reset at the day rollover');
    expect(sql).toContain('Insufficient credits for a dispatch reroll');
  });

  it('restates depart with the board discipline and the courier tier gate intact', () => {
    expect(sql).toContain('Dispatch offer is not on the current board');
    expect(sql).toContain('Dispatch offer already departed');
    expect(sql).toContain('cc_vehicle_class_tier');
    expect(sql).toContain('Vehicle class cannot run this courier tier');
  });

  it('meters the burn as its own sink breakout inside the destroyed total', () => {
    expect(sql).toContain('credits_destroyed_dispatch_rerolls');
    expect(sql).toContain("action_type = 'cc_reroll_dispatch_board'");
    expect(sql).toContain('m.destroyed_dispatch_rerolls');
  });
});
