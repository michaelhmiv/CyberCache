/**
 * Legacy Chef gameplay routes (Route B, slice B6) — HTTP tests over
 * express with the InMemoryChefGameplayStore.
 *
 * The four original Chef endpoints (/api/claim, /api/settle-offline,
 * /api/verify-boss, /api/salvage) keep their June contracts on the new
 * plumbing: Chef JWT auth (header or body `jwt`), 403 on a mismatched
 * body playerId, the June 400/409 shapes, server-authoritative profile
 * reads, and persistence through the gameplay store whose Postgres
 * implementation calls the ported cc_* appliers
 * (db/migrations/0007_chef_gameplay_appliers.sql). Exact end-state
 * assertions use deterministic inputs: formula-driven roaming credits
 * (the phase-3 skill-wiring fixtures pin 1 credit/tick for this area
 * and level) and the closed-form salvage award.
 *
 * PgChefGameplayStore + the 0007 SQL functions are verified against
 * real Postgres by the embedded-Postgres harness (same pattern as
 * B1–B5).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { salvageScrap } from '../server/writes/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

interface Harness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
  tokenB: string;
}

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

async function makeServer(store = new InMemoryChefGameplayStore()): Promise<Harness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  openServers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, false),
  };
}

async function post(base: string, path: string, body: unknown, token?: string): Promise<{ status: number; json: Record<string, unknown> }> {
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

const CLAIM_BODY = {
  playerId: A,
  areaId: 'dustwaste_frontier',
  ticks: 5,
  tickCount: 5,
  playerLevel: 10,
  idleMods: { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0 },
};

describe('legacy Chef gameplay routes (B6)', () => {
  it('serves the June health shape without any configuration', async () => {
    const { base } = await makeServer();
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', chef: 'ready' });
  });

  it('rejects unauthenticated calls with the June 401 shape', async () => {
    const { base, store } = await makeServer();
    store.seedProfile({ id: A });
    const res = await post(base, '/api/claim', CLAIM_BODY);
    expect(res.status).toBe(401);
    expect(res.json.error).toBe('Authentication required');
  });

  it('rejects a body playerId that disagrees with the token (403)', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A });
    const res = await post(base, '/api/claim', { ...CLAIM_BODY, playerId: B }, tokenA);
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('Player mismatch');
  });

  it('accepts the body jwt field like the June client sends', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, credits: 100 });
    const res = await post(base, '/api/claim', { ...CLAIM_BODY, jwt: tokenA });
    expect(res.status).toBe(200);
  });

  it('claim: 400 on missing fields, exact June message', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A });
    const res = await post(base, '/api/claim', { playerId: A, areaId: 'dustwaste_frontier' }, tokenA);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('Missing required fields: areaId, ticks, tickCount');
  });

  it('claim: applies rewards through the store and advances last_claimed_tick', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, credits: 100 });
    const res = await post(base, '/api/claim', CLAIM_BODY, tokenA);
    expect(res.status).toBe(200);
    // Fractional credits (migration 0010): Dustwaste 0.75/tick x 5 ticks
    // = 3.75 -> +3 whole credits (100 -> 103), 0.75 banked on the profile.
    const profile = store.profiles.get(A)!;
    expect(profile.last_claimed_tick).toBe(5);
    expect(profile.credits).toBe(103);
    expect((res.json.profile as Record<string, unknown>).credits).toBe(103);
    expect(profile.last_roaming_settled_at).not.toBeNull();
  });

  it('claim: replaying a claimed tickCount is a 409 and changes nothing', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, credits: 100 });
    await post(base, '/api/claim', CLAIM_BODY, tokenA);
    const res = await post(base, '/api/claim', CLAIM_BODY, tokenA);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('tick_count already claimed');
    expect(res.json.lastClaimedTick).toBe(5);
    expect(store.profiles.get(A)!.credits).toBe(103);
  });

  it('claim: unknown profile is the June 500 read failure', async () => {
    const { base, tokenA } = await makeServer();
    const res = await post(base, '/api/claim', CLAIM_BODY, tokenA);
    expect(res.status).toBe(500);
    expect(res.json.error).toBe('Failed to read profile');
  });

  it('salvage: exact scrap award, item consumed, nonce replay does not double-pay', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, scrap: 7 });
    store.seedItem({ id: 'item-1', owner_user_id: A, rarity: 'Rare', item_level: 10 });
    const body = { playerId: A, itemId: 'item-1', nonce: 'salvage-nonce-0001' };
    const res = await post(base, '/api/salvage', body, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.salvaged).toBe(true);
    expect(res.json.verified).toBe(true);
    expect(res.json.scrapValue).toBe(salvageScrap('Rare', 10));
    expect(store.profiles.get(A)!.scrap).toBe(7 + salvageScrap('Rare', 10));
    expect(store.items.get('item-1')!.runtime_state).toBe('consumed');

    const replay = await post(base, '/api/salvage', body, tokenA);
    expect(replay.status).toBe(200);
    expect(replay.json.scrapValue).toBe(salvageScrap('Rare', 10));
    expect(store.profiles.get(A)!.scrap).toBe(7 + salvageScrap('Rare', 10));
  });

  it('salvage: another player\'s item fails with the June 500 shape', async () => {
    const { base, store, tokenB } = await makeServer();
    store.seedProfile({ id: A });
    store.seedProfile({ id: B });
    store.seedItem({ id: 'item-1', owner_user_id: A, rarity: 'Common', item_level: 1 });
    const res = await post(base, '/api/salvage', { playerId: B, itemId: 'item-1', nonce: 'salvage-nonce-0002' }, tokenB);
    expect(res.status).toBe(500);
    expect(res.json.error).toBe('Failed to recycle item');
    expect(store.items.get('item-1')!.runtime_state).toBe('available');
  });

  it('salvage: 400 on missing itemId', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A });
    const res = await post(base, '/api/salvage', { playerId: A }, tokenA);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('Missing itemId');
  });

  it('verify-boss: 400 on missing bossId; unknown profile is the June 500', async () => {
    const { base, store, tokenA } = await makeServer();
    const bad = await post(base, '/api/verify-boss', { playerId: A }, tokenA);
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('Missing required field: bossId');
    const missing = await post(base, '/api/verify-boss', { playerId: A, bossId: 'dune_tyrant', attemptNonce: 1 }, tokenA);
    expect(missing.status).toBe(500);
    expect(missing.json.error).toBe('Failed to read player profile');
    void store;
  });

  it('verify-boss: server state drives the outcome and persists exactly once per nonce', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, player_level: 50, credits: 1000, consumables: { MedKit: 3 }, boss_state: {} });
    const boss = REGION_1_BOSSES[0];
    // The engine's known-good fixture weapon (chefBossVerification).
    const strongWeapon: Weapon = {
      id: 'server-owned-boss-gun',
      name: 'Server Owned Boss Gun',
      level: 50,
      rarity: Rarity.Legendary,
      weaponType: WeaponType.SMG,
      manufacturer: Manufacturer.Redline,
      element: Element.Fire,
      rollQuality: 100,
      baseDamage: 10000,
      attackSpeed: 10,
      critChance: 0.5,
      critDamage: 2,
      statusChance: 0,
      statusDamage: 0,
      bossDamageMod: 2,
      waveDamageMod: 0,
      shieldDamageMod: 1,
      armorDamageMod: 1,
      offlineEarningsMod: 0,
      rareDropChanceMod: 0,
      scrapYieldMod: 0,
      parts: [],
      affixes: [],
      sourceTag: DropSource.WorldDrop,
      isLocked: false,
      pixelSeed: 1,
      combatPower: 0,
      bossPower: 0,
      farmPower: 0,
      economyScore: 0,
    };
    const body = {
      playerId: A,
      bossId: boss.id,
      attemptNonce: 424242,
      primary: strongWeapon,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: { MedKit: 1 }, // the prepared set — validated against server inventory (3 owned)
      risk: RiskSetting.Balanced,
      playerLevel: 99, // client lies — server level (50) wins
      playerCredits: 999999, // client lies — server credits (1000) win
      pityCount: 99, // client lies — server pity (0) wins
      skillBonuses: {},
    };
    const res = await post(base, '/api/verify-boss', body, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.verified).toBe(true);
    const profile = store.profiles.get(A)!;
    const bossState = profile.boss_state as { defeatedBossIds?: string[]; pityCounters?: Record<string, number> };
    if (res.json.victory === true) {
      expect(bossState.defeatedBossIds).toContain(boss.id);
      expect(bossState.pityCounters?.[boss.id] ?? 0).toBe(0);
    } else {
      expect(bossState.pityCounters?.[boss.id]).toBe(1);
    }
    const creditsAfterFirst = profile.credits;
    const replay = await post(base, '/api/verify-boss', body, tokenA);
    expect(replay.status).toBe(200);
    // Same nonce: the ledger result is returned, nothing is applied twice.
    expect(store.profiles.get(A)!.credits).toBe(creditsAfterFirst);
    expect((replay.json.profile as Record<string, unknown>).credits).toBe(
      (res.json.profile as Record<string, unknown>).credits,
    );
  });

  it('settle-offline: not_roaming and no_elapsed no-ops keep the June shapes', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, player_level: 10 });
    const notRoaming = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'nonce-00000001' }, tokenA);
    expect(notRoaming.status).toBe(200);
    expect(notRoaming.json).toEqual({ settled: false, reason: 'not_roaming' });

    store.seedActiveAction({
      user_id: A,
      active_action: 'roaming_loot',
      target_id: 'dustwaste_frontier',
      started_at: new Date().toISOString(),
      last_heartbeat_at: null,
      activity_payload: {},
    });
    const noElapsed = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'nonce-00000002' }, tokenA);
    expect(noElapsed.status).toBe(200);
    expect(noElapsed.json).toEqual({ settled: false, reason: 'no_elapsed' });
  });

  it('settle-offline: settles the elapsed ticks atomically and replays idempotently', async () => {
    const { base, store, tokenA } = await makeServer();
    const ticks = 598;
    const settleFromMs = Date.now() - (ticks * 3000 + 1500);
    store.seedProfile({
      id: A,
      player_level: 10,
      credits: 0,
      last_claimed_tick: 100,
      last_roaming_settled_at: new Date(settleFromMs).toISOString(),
    });
    store.seedActiveAction({
      user_id: A,
      active_action: 'roaming_loot',
      target_id: 'dustwaste_frontier',
      started_at: new Date(settleFromMs).toISOString(),
      last_heartbeat_at: null,
      activity_payload: {},
    });
    const body = { playerId: A, settlementNonce: 'settle-nonce-0001' };
    const res = await post(base, '/api/settle-offline', body, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.settled).toBe(true);
    expect(res.json.ticksSettled).toBe(ticks);
    expect(res.json.startTick).toBe(100);
    expect(res.json.endTick).toBe(100 + ticks);
    expect(res.json.idempotent).toBe(false);
    const profile = store.profiles.get(A)!;
    expect(profile.last_claimed_tick).toBe(100 + ticks);
    expect(profile.last_settlement_nonce).toBe('settle-nonce-0001');
    expect((res.json.profile as Record<string, unknown>).credits).toBe(profile.credits);

    const replay = await post(base, '/api/settle-offline', body, tokenA);
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual({ settled: false, reason: 'idempotent' });
    expect(store.profiles.get(A)!.last_claimed_tick).toBe(100 + ticks);
  });

  it('settle-offline: 400 on missing settlementNonce', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A });
    const res = await post(base, '/api/settle-offline', { playerId: A }, tokenA);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('Missing settlementNonce');
  });
});
