/**
 * Claim-overlap guard (owner ruling 2026-11-06; faucet-excess
 * diagnosis, cybercache-prep/faucet-excess-2026-11-06/DIAGNOSIS.md).
 *
 * The claim window a POST /api/claim simulates is
 * (tickCount − ticks, tickCount], and every per-tick RNG stream is
 * seeded by tick NUMBER. The standing guard only refused
 * tickCount <= last_claimed_tick, so a claim whose window reached
 * BACK over already-settled ticks — while still ending ahead of the
 * watermark — re-simulated those ticks and re-paid them in full:
 * keys, XP, loot, kills, and tick-seeded events (a Silt Storm /
 * Thornwind re-fired in every overlapping batch, its doubled key
 * ticks paid again and again). The shipped client never overlaps
 * (its serial advances by exactly the ticks it claims); the fleet
 * runner's old shape (ticks=20, serial +1 per batch) did, and
 * double-paid itself up to +62% of a block's key faucet.
 *
 * The fix: the routes stamp the profile watermark as
 * `lastClaimedTick` on the engine request (server-derived, never
 * the body) and processRoamingClaim clamps the simulated window to
 * the unsettled suffix (lastClaimedTick, tickCount]. An empty
 * suffix is the standing refusal (409, below). These tests pin:
 *   (a) an overlapping claim pays EXACTLY the unsettled suffix —
 *       the same rewards (keys, XP, credits, scrap, kills, loot)
 *       as the equivalent honest suffix claim;
 *   (b) a fully-overlapping repeat claim is refused exactly like
 *       a non-advancing claim, and pays nothing;
 *   (c) honest claims are byte-identical with the watermark
 *       stamped (engine A/B);
 *   (d) the runner's old claim shape, driven through the real
 *       route against a tick-seeded Thornwind, pays each tick
 *       exactly once — the per-claim banked key remainders match
 *       the honest one-tick-at-a-time sequence step for step.
 *
 * Exactness notes: (a)/(b) silence the event roll
 * (eventChanceBase 0) and use a configured cacheKeyChance so the
 * per-tick key accrual is exact, the F3 fixtures' pattern. (d)
 * deliberately runs the shipped defaults — real event chance, real
 * 0.00012 key chance — because the storm IS the subject. Claims
 * carry no survival block, so the death-loop trickle guard pays
 * every tick (the June claim fixtures' standing arrangement).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { EconomyConfig } from '../server/economy/config';
import { issueAccessToken } from '../server/auth/tokens';
import { processRoamingClaim, type ClaimRequest } from '../server/chef';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';

// Same cold-day clock as the June claim fixtures: Dustwaste is not
// the hot area on 2026-11-04 UTC, so claims pay base rates.
const COLD_DAY = () => new Date('2026-11-04T12:00:00.000Z');

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

interface Harness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
}

async function makeServer(
  store: InMemoryChefGameplayStore,
  overrides: { economyConfig?: EconomyConfig; now?: () => Date } = {},
): Promise<Harness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET, now: COLD_DAY, ...overrides });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  openServers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { store, base: `http://127.0.0.1:${port}`, tokenA: issueAccessToken(SECRET, A, false) };
}

async function post(
  base: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function claimBody(areaId: string, ticks: number, tickCount: number): Record<string, unknown> {
  return {
    playerId: A,
    areaId,
    ticks,
    tickCount,
    playerLevel: 1,
    idleMods: { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0 },
  };
}

function economy(values: Record<string, number>): EconomyConfig {
  return new EconomyConfig({ loadConfigValues: async () => values });
}

/** Drop outcomes compare modulo storage identity (id / pixelSeed
 * are randomUUID-derived per generation by design — the
 * dropReceipts precedent). */
function stripIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIdentity);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'id' && key !== 'pixelSeed')
        .map(([key, v]) => [key, stripIdentity(v)]),
    );
  }
  return value;
}

describe('claim-overlap guard', () => {
  it('(c) honest claims are byte-identical with the watermark stamped', () => {
    const request = (): ClaimRequest => ({
      playerId: A,
      areaId: 'dustwaste_frontier',
      ticks: 20,
      tickCount: 500,
      playerLevel: 1,
      equippedGear: [],
    });
    const outcome = (r: ReturnType<typeof processRoamingClaim>) => ({
      rewards: r.rewards,
      items: stripIdentity(r.items),
      killCycle: r.killCycle,
      survival: r.survival,
      consumedConsumables: r.consumedConsumables,
      eventsFired: r.eventsFired,
    });
    const base = processRoamingClaim(request());
    // Watermark far behind the window (start 480): no clamp.
    const stamped = processRoamingClaim({ ...request(), lastClaimedTick: 100 });
    // Watermark exactly AT the window start: still no overlap.
    const stampedEdge = processRoamingClaim({ ...request(), lastClaimedTick: 480 });
    expect(outcome(stamped)).toEqual(outcome(base));
    expect(outcome(stampedEdge)).toEqual(outcome(base));
  });

  it('(a) an overlapping claim pays only the unsettled suffix', async () => {
    // 0.03/tick x 20 ticks = 0.6 of a key per honest batch (the F3
    // arithmetic); the event roll is silenced for exactness.
    const overrides = { economyConfig: economy({ cacheKeyChance: 0.03, eventChanceBase: 0 }) };

    // Path 1: an honest 20-tick claim, then the runner's old shape
    // — 20 more ticks proposed, serial advanced by only 1. The
    // window as sent is (1, 21]; ticks 1..20 are already settled,
    // so only tick 21 may simulate and pay.
    const h1 = await makeServer(new InMemoryChefGameplayStore(), overrides);
    h1.store.seedProfile({ id: A });
    const first = await post(h1.base, '/api/claim', claimBody('dustwaste_frontier', 20, 20), h1.tokenA);
    expect(first.status).toBe(200);
    const p1 = h1.store.profiles.get(A)!;
    expect(p1.cache_key_remainder).toBe(0.6);
    expect(p1.last_claimed_tick).toBe(20);
    // Snapshot the banked values NOW: the store's profile row is a
    // live object the overlap claim below mutates in place, and
    // path 2 must be seeded with the post-claim-1 state, not the
    // post-claim-2 state.
    const banked = {
      cache_key_remainder: p1.cache_key_remainder,
      xp_remainder: p1.xp_remainder,
      credits_remainder: p1.credits_remainder,
      scrap_remainder: p1.scrap_remainder,
    };

    const overlap = await post(h1.base, '/api/claim', claimBody('dustwaste_frontier', 20, 21), h1.tokenA);
    expect(overlap.status).toBe(200);
    const overlapRewards = overlap.json.rewards as Record<string, unknown>;
    expect(overlapRewards.ticks).toBe(1);
    const pAfter = h1.store.profiles.get(A)!;
    // Exactly ONE tick of key accrual landed: 0.6 + 0.03, no whole
    // key. Unclamped, the claim would have re-paid 20 ticks
    // (0.6 + 0.6 -> 1 key + 0.2 carried).
    expect(pAfter.cache_tokens).toBe(0);
    expect(pAfter.cache_key_remainder).toBe(0.63);
    expect(pAfter.last_claimed_tick).toBe(21);

    // Path 2: the equivalent honest suffix claim — a fresh store
    // whose profile is seeded exactly where path 1 stood after its
    // honest claim (watermark 20, banked remainders), claiming the
    // single unsettled tick.
    const h2 = await makeServer(new InMemoryChefGameplayStore(), overrides);
    h2.store.seedProfile({
      id: A,
      last_claimed_tick: 20,
      ...banked,
    });
    const suffix = await post(h2.base, '/api/claim', claimBody('dustwaste_frontier', 1, 21), h2.tokenA);
    expect(suffix.status).toBe(200);

    // The overlapped claim's rewards — keys AND xp AND credits AND
    // scrap AND kills — are the honest suffix claim's rewards,
    // field for field, and the loot is the same loot.
    expect(overlapRewards).toEqual(suffix.json.rewards);
    expect(stripIdentity(overlap.json.items)).toEqual(stripIdentity(suffix.json.items));
  });

  it('(b) a fully-overlapping repeat claim is refused and pays nothing', async () => {
    const overrides = { economyConfig: economy({ cacheKeyChance: 0.03, eventChanceBase: 0 }) };
    const { base, store, tokenA } = await makeServer(new InMemoryChefGameplayStore(), overrides);
    store.seedProfile({ id: A });

    const first = await post(base, '/api/claim', claimBody('dustwaste_frontier', 20, 20), tokenA);
    expect(first.status).toBe(200);
    const settled = store.profiles.get(A)!;
    const snapshot = {
      tokens: settled.cache_tokens,
      remainder: settled.cache_key_remainder,
      xp: settled.player_xp,
      credits: settled.credits,
    };

    // The identical claim again: its whole window is settled.
    const repeat = await post(base, '/api/claim', claimBody('dustwaste_frontier', 20, 20), tokenA);
    expect(repeat.status).toBe(409);
    expect(repeat.json.error).toBe('tick_count already claimed');
    expect(repeat.json.lastClaimedTick).toBe(20);

    // A claim ending behind the watermark is refused the same way.
    const behind = await post(base, '/api/claim', claimBody('dustwaste_frontier', 20, 18), tokenA);
    expect(behind.status).toBe(409);
    expect(behind.json.lastClaimedTick).toBe(20);

    const after = store.profiles.get(A)!;
    expect({
      tokens: after.cache_tokens,
      remainder: after.cache_key_remainder,
      xp: after.player_xp,
      credits: after.credits,
    }).toEqual(snapshot);
    expect(after.last_claimed_tick).toBe(20);
  });

  it("(d) the runner's old claim shape cannot double-pay a tick-seeded storm", async () => {
    // Find a Thornwind firing tick for this player/area from the
    // engine itself (pure function of the tick-number streams).
    let stormTick = -1;
    for (let s = 0; s <= 20000 && stormTick < 0; s += 20) {
      const scan = processRoamingClaim({
        playerId: A,
        areaId: 'ironwood_bastion',
        ticks: 20,
        tickCount: s + 20,
        playerLevel: 1,
        equippedGear: [],
      });
      const fired = scan.eventsFired.find((e) => e.eventId === 'ironwood_thornwind');
      if (fired) stormTick = fired.tick;
    }
    expect(stormTick).toBeGreaterThan(0);
    // The storm fires 4 ticks into the 8-tick test window.
    const S = Math.max(0, stormTick - 4);
    expect(stormTick).toBeGreaterThan(S);
    expect(stormTick).toBeLessThanOrEqual(S + 8);

    // Shipped defaults throughout: real event chance, real key
    // chance. No economy override.
    // Phase 1 — ground truth: the window's 8 ticks claimed honestly,
    // one at a time. Banked key remainder after each claim.
    const h1 = await makeServer(new InMemoryChefGameplayStore());
    h1.store.seedProfile({ id: A, last_claimed_tick: S });
    const honest: number[] = [];
    for (let i = 1; i <= 8; i++) {
      const res = await post(h1.base, '/api/claim', claimBody('ironwood_bastion', 1, S + i), h1.tokenA);
      expect(res.status).toBe(200);
      honest.push((res.json.rewards as { cacheKeyRemainder: number }).cacheKeyRemainder);
    }
    expect(h1.store.profiles.get(A)!.cache_tokens).toBe(0);
    expect(h1.store.profiles.get(A)!.last_claimed_tick).toBe(S + 8);

    // Phase 2 — the runner's old shape: 20 ticks per batch, serial
    // re-read from the profile and advanced by exactly 1 per batch.
    // Every batch's window contains the storm tick; unclamped, each
    // batch re-simulates it and the banked remainders ramp past the
    // honest sequence. Clamped, each batch pays only its one fresh
    // tick and the sequences agree step for step.
    const h2 = await makeServer(new InMemoryChefGameplayStore());
    h2.store.seedProfile({ id: A, last_claimed_tick: S });
    const runnerShape: number[] = [];
    for (let i = 0; i < 8; i++) {
      const watermark = h2.store.profiles.get(A)!.last_claimed_tick;
      const res = await post(
        h2.base,
        '/api/claim',
        claimBody('ironwood_bastion', 20, watermark + 1),
        h2.tokenA,
      );
      expect(res.status).toBe(200);
      runnerShape.push((res.json.rewards as { cacheKeyRemainder: number }).cacheKeyRemainder);
    }
    expect(runnerShape).toEqual(honest);
    expect(h2.store.profiles.get(A)!.cache_tokens).toBe(0);
    expect(h2.store.profiles.get(A)!.last_claimed_tick).toBe(S + 8);
  });
});
