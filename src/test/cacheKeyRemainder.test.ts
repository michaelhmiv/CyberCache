/**
 * Cache-key remainder round-trip (F3 fix; migration 0082 design).
 *
 * 0082 pays roaming cache keys as whole keys at 0.00012/tick with the
 * fraction carried silently in profiles.cache_key_remainder: each
 * claim/settlement seeds the engine from the banked remainder and
 * persists the engine's new banked remainder, so fractions SUM across
 * batches. The F3 defect: the Pg gameplay store's profile SELECTs
 * never fetched the column (and the in-memory twin's getters dropped
 * it from the returned row), so every batch restarted accrual from 0
 * and a key paid only when a single batch crossed a whole key alone.
 *
 * These tests pin the round-trip at every layer:
 *  - both stores' profile getters return the bank;
 *  - the Pg write legs pass the remainder to the 0082/0083 appliers
 *    (params pinned so the legs cannot silently regress);
 *  - sequential HTTP claims sum fractions across a whole key with
 *    the exact engine arithmetic (banked at 6dp, floor + 1e-9);
 *  - sequential offline settlements do the same through the 0083
 *    hold path (whole keys land in the hold, the fraction banks).
 *
 * Exactness: the economy double sets eventChanceBase 0, which
 * silences the event roll entirely — no Silt Storm doubling — so
 * per-tick key accrual is exactly the configured cacheKeyChance.
 * Claims carry no survival block, so the death-loop trickle guard
 * (which reads death only from a modeled survival state) pays every
 * tick, exactly as it does for the June claim fixtures.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { PgChefGameplayStore } from '../server/gameplay/store';
import { EconomyConfig } from '../server/economy/config';
import { issueAccessToken } from '../server/auth/tokens';

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

function claimBody(ticks: number, tickCount: number): Record<string, unknown> {
  return {
    playerId: A,
    areaId: 'dustwaste_frontier',
    ticks,
    tickCount,
    playerLevel: 1,
    idleMods: { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0 },
  };
}

function economy(values: Record<string, number>): EconomyConfig {
  return new EconomyConfig({ loadConfigValues: async () => values });
}

interface ClaimRewards {
  cacheKeysAwarded: number;
  cacheKeyRemainder: number;
}

describe('cache-key remainder round-trip (F3)', () => {
  it('in-memory profile getters return the banked remainder', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, cache_key_remainder: 0.6 });
    expect((await store.getRoamingProfile(A))?.cache_key_remainder).toBe(0.6);
    expect((await store.getSettlementProfile(A))?.cache_key_remainder).toBe(0.6);
  });

  it('Pg profile getters select cache_key_remainder and map the numeric string', async () => {
    const pgRow: Record<string, unknown> = {
      player_level: 1,
      skill_spends: {},
      last_claimed_tick: 0,
      consumables: {},
      scrap_remainder: '0',
      credits_remainder: '0',
      xp_remainder: '0',
      // pg returns numeric columns as strings.
      cache_key_remainder: '0.6',
      vehicle_fuel: 0,
      cache_rank_spends: {},
      last_roaming_settled_at: null,
      last_settlement_nonce: null,
      offline_cap_hours: null,
    };
    const sqlSeen: string[] = [];
    const fakePool = {
      query: async (sql: string) => {
        sqlSeen.push(sql);
        return { rows: [pgRow] };
      },
    };
    const store = new PgChefGameplayStore(fakePool as unknown as Pool);
    const roaming = await store.getRoamingProfile(A);
    const settlement = await store.getSettlementProfile(A);
    expect(sqlSeen).toHaveLength(2);
    for (const sql of sqlSeen) expect(sql).toContain('cache_key_remainder');
    expect(roaming?.cache_key_remainder).toBe(0.6);
    expect(settlement?.cache_key_remainder).toBe(0.6);
  });

  it('Pg round-trip: applyChefRewards persists the remainder the next profile read returns', async () => {
    const state = { remainder: '0.6', tokens: 3 };
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const fakePool = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes('cc_apply_chef_rewards')) {
          // Mirror the 0082 applier: whole keys land on cache_tokens,
          // the trailing remainder arg banks via coalesce.
          state.tokens += Number(params[4]);
          if (params[13] != null) state.remainder = String(params[13]);
          return { rows: [{ result: {} }] };
        }
        return {
          rows: [
            {
              player_level: 1,
              skill_spends: {},
              last_claimed_tick: 0,
              consumables: {},
              scrap_remainder: '0',
              credits_remainder: '0',
              xp_remainder: '0',
              cache_key_remainder: state.remainder,
              vehicle_fuel: 0,
              cache_rank_spends: {},
            },
          ],
        };
      },
    };
    const store = new PgChefGameplayStore(fakePool as unknown as Pool);
    expect((await store.getRoamingProfile(A))?.cache_key_remainder).toBe(0.6);
    await store.applyChefRewards(
      A,
      { credits: 0, scrap: 0, xp: 0, keys: 1, keysRemainder: 0.2, materials: {}, essences: {}, kills: 0 },
      20,
      'dustwaste_frontier',
    );
    const applyCall = calls.find((c) => c.sql.includes('cc_apply_chef_rewards'))!;
    expect(applyCall.params[13]).toBe(0.2);
    expect((await store.getRoamingProfile(A))?.cache_key_remainder).toBe(0.2);
  });

  it('Pg settleOfflineRoaming passes the remainder as the $13 applier arg', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const fakePool = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [{ result: {} }] };
      },
    };
    const store = new PgChefGameplayStore(fakePool as unknown as Pool);
    await store.settleOfflineRoaming(
      A,
      'nonce-1',
      { credits: 0, scrap: 0, xp: 0, keys: 0, keysRemainder: 0.45, materials: {}, essences: {}, kills: 0 },
      {},
      24,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('cc_settle_offline_roaming');
    expect(calls[0].params[12]).toBe(0.45);
  });

  it('sequential claims sum fractions across a whole key: 0.6 + 0.6 pays exactly 1 key, 0.2 carried', async () => {
    // 0.03/tick x 20 ticks = 0.6 of a key per claim batch.
    const { base, store, tokenA } = await makeServer(new InMemoryChefGameplayStore(), {
      economyConfig: economy({ cacheKeyChance: 0.03, eventChanceBase: 0 }),
    });
    store.seedProfile({ id: A });

    const first = await post(base, '/api/claim', claimBody(20, 20), tokenA);
    expect(first.status).toBe(200);
    const firstRewards = first.json.rewards as ClaimRewards;
    expect(firstRewards.cacheKeysAwarded).toBe(0);
    expect(firstRewards.cacheKeyRemainder).toBe(0.6);
    const afterFirst = store.profiles.get(A)!;
    expect(afterFirst.cache_tokens).toBe(0);
    expect(afterFirst.cache_key_remainder).toBe(0.6);

    const second = await post(base, '/api/claim', claimBody(20, 40), tokenA);
    expect(second.status).toBe(200);
    const secondRewards = second.json.rewards as ClaimRewards;
    expect(secondRewards.cacheKeysAwarded).toBe(1);
    expect(secondRewards.cacheKeyRemainder).toBe(0.2);
    const afterSecond = store.profiles.get(A)!;
    expect(afterSecond.cache_tokens).toBe(1);
    expect(afterSecond.cache_key_remainder).toBe(0.2);
    expect(afterSecond.cache_key_remainder).toBeGreaterThanOrEqual(0);
    expect(afterSecond.cache_key_remainder).toBeLessThan(1);
  });

  it('a claim batch crossing multiple keys pays all of them', async () => {
    // 0.15/tick x 20 ticks = 3.0 keys in a single batch.
    const { base, store, tokenA } = await makeServer(new InMemoryChefGameplayStore(), {
      economyConfig: economy({ cacheKeyChance: 0.15, eventChanceBase: 0 }),
    });
    store.seedProfile({ id: A });
    const res = await post(base, '/api/claim', claimBody(20, 20), tokenA);
    expect(res.status).toBe(200);
    const rewards = res.json.rewards as ClaimRewards;
    expect(rewards.cacheKeysAwarded).toBe(3);
    expect(rewards.cacheKeyRemainder).toBe(0);
    const profile = store.profiles.get(A)!;
    expect(profile.cache_tokens).toBe(3);
    expect(profile.cache_key_remainder).toBe(0);
  });

  it('a near-full bank plus one tick pays one key and banks only the spill', async () => {
    // Default faucet rate (0.00012/tick), events silenced: the bank
    // sits at the engine's clamp maximum, one tick spills it over.
    const { base, store, tokenA } = await makeServer(new InMemoryChefGameplayStore(), {
      economyConfig: economy({ eventChanceBase: 0 }),
    });
    store.seedProfile({ id: A, cache_key_remainder: 0.999999 });
    const res = await post(base, '/api/claim', claimBody(1, 1), tokenA);
    expect(res.status).toBe(200);
    const rewards = res.json.rewards as ClaimRewards;
    expect(rewards.cacheKeysAwarded).toBe(1);
    expect(rewards.cacheKeyRemainder).toBe(0.000119);
    const profile = store.profiles.get(A)!;
    expect(profile.cache_tokens).toBe(1);
    expect(profile.cache_key_remainder).toBe(0.000119);
    expect(profile.cache_key_remainder).toBeGreaterThanOrEqual(0);
    expect(profile.cache_key_remainder).toBeLessThan(1);
  });

  it('offline settlements sum fractions across settlements: banked 0.9 + two windows pays 1 key, 0.04352 carried', async () => {
    const { base, store, tokenA } = await makeServer(new InMemoryChefGameplayStore(), {
      economyConfig: economy({ eventChanceBase: 0 }),
    });
    const ticks = 598;
    // 598 ticks x 0.00012 = 0.07176 of a key per settlement window.
    const settleFrom = () => new Date(Date.now() - (ticks * 3000 + 1500)).toISOString();
    store.seedProfile({
      id: A,
      player_level: 10,
      credits: 0,
      last_claimed_tick: 100,
      last_roaming_settled_at: settleFrom(),
      cache_key_remainder: 0.9,
    });
    store.seedActiveAction({
      user_id: A,
      active_action: 'roaming_loot',
      target_id: 'dustwaste_frontier',
      started_at: settleFrom(),
      last_heartbeat_at: null,
      activity_payload: {},
    });

    const first = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'f3-settle-1' }, tokenA);
    expect(first.status).toBe(200);
    expect(first.json.settled).toBe(true);
    const firstRewards = first.json.rewards as ClaimRewards;
    expect(firstRewards.cacheKeysAwarded).toBe(0);
    expect(firstRewards.cacheKeyRemainder).toBeCloseTo(0.97176, 6);
    expect(store.profiles.get(A)!.cache_key_remainder).toBeCloseTo(0.97176, 6);

    // Simulate the next away window: rewind the settlement watermark
    // on the twin so a second 598-tick window elapses.
    const profile = store.profiles.get(A)!;
    profile.last_roaming_settled_at = settleFrom();
    const second = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'f3-settle-2' }, tokenA);
    expect(second.status).toBe(200);
    expect(second.json.settled).toBe(true);
    const secondRewards = second.json.rewards as ClaimRewards;
    // 0.97176 + 0.07176 = 1.04352: one whole key into the 0083 hold,
    // the 0.04352 fraction stays banked on the profile.
    expect(secondRewards.cacheKeysAwarded).toBe(1);
    expect(secondRewards.cacheKeyRemainder).toBeCloseTo(0.04352, 6);
    const after = store.profiles.get(A)!;
    expect(after.cache_key_remainder).toBeCloseTo(0.04352, 6);
    expect(after.cache_key_remainder).toBeGreaterThanOrEqual(0);
    expect(after.cache_key_remainder).toBeLessThan(1);
  });
});
