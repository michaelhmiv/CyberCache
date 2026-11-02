/**
 * Regression: EVERY boss attempt failed with Chef 500
 * "items must be an array" (found live 2026-11-02, fresh guest and
 * fresh registered account, current-master client + live Chef).
 *
 * Root cause: the 0040 restatement (PR #245, e66a6f3) moved boss loot
 * storage INSIDE cc_apply_chef_boss_attempt, and the Pg store passed
 * the rolled loot as a BARE JS array. pg serializes a bare array as a
 * Postgres array literal — '{}' for an empty roll — which the jsonb
 * parameter parses as an OBJECT, so cc_store_chef_items raised
 * 'items must be an array' and the whole attempt rolled back. A
 * loot-bearing roll failed too (the literal is not valid JSON). The
 * InMemory store twin takes the array natively, which is why the
 * route suite never saw it. storeChefItems documents the rule the
 * boss call missed: JSON.stringify jsonb array params.
 *
 * These tests pin both layers:
 *  1. The shipped wire contract over HTTP — a fresh, empty-inventory
 *     player starting Dune Tyrant with the EXACT body the client
 *     sends (captured live: intent only, no items field) resolves
 *     and persists; a loot-bearing victory stores its items.
 *  2. The Pg store seam — applyChefBossAttempt must hand pg a JSON
 *     TEXT param for the items argument, for empty and non-empty
 *     rolls alike, so the wire bytes are the jsonb array document
 *     the SQL function contract requires.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error pg ships no types for its internal serializer; it is
// the exact function the driver runs over every parameter we hand it.
import { prepareValue } from 'pg/lib/utils';
import type { Pool } from 'pg';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { processBossAttempt, type BossAttemptChefResult, type BossAttemptRequest } from '../server/chef';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { PgChefGameplayStore, type ChefBossAttemptInput } from '../server/gameplay/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// HTTP harness (same pattern as bossLoopShippedPath.test.ts)
// ---------------------------------------------------------------------------

interface Harness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
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
  return { store, base: `http://127.0.0.1:${port}`, tokenA: issueAccessToken(SECRET, A, false) };
}

interface VerifyBossHttpResult {
  verified?: boolean;
  victory?: boolean;
  pityIncremented?: boolean;
  error?: string;
  detail?: string;
  items?: Array<{ id: string; sourceTag: string; rarity: string }>;
}

async function post(
  base: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: VerifyBossHttpResult }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as VerifyBossHttpResult };
}

const bossById = (id: string) => REGION_1_BOSSES.find((b) => b.id === id)!;

describe('boss encounter start — empty-inventory wire contract (POST /api/verify-boss)', () => {
  it('fresh player, zero items anywhere, starts Dune Tyrant with the exact client body and the attempt persists', async () => {
    const { base, store, tokenA } = await makeServer();
    // A fresh account's server state: level 1, starter credits, no
    // consumables, no boss progress, and NO item rows at all.
    store.seedProfile({ id: A, credits: 5100, scrap: 500 });
    expect(store.items.size).toBe(0);

    // The body the shipped client actually sends (captured live
    // 2026-11-02): intent only — boss, nonce, empty prepared set,
    // risk. There is no items field; loot is the Chef's own roll.
    const body = {
      playerId: A,
      bossId: 'dune_tyrant',
      attemptNonce: 1793622313753,
      consumables: {},
      risk: RiskSetting.Balanced,
      fireActionSkill: false,
    };
    const res = await post(base, '/api/verify-boss', body, tokenA);

    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    expect(res.json.verified).toBe(true);
    expect(typeof res.json.victory).toBe('boolean');
    expect(Array.isArray(res.json.items)).toBe(true);

    // The attempt persisted through the applier: boss_state carries
    // the attempt record, and the victory/pity bookkeeping agrees
    // with the reported outcome.
    const profile = store.profiles.get(A)!;
    const bossState = profile.boss_state as {
      defeatedBossIds?: string[];
      pityCounters?: Record<string, number>;
      lastBossAttempt?: { victory?: boolean };
    };
    expect(bossState.lastBossAttempt?.victory).toBe(res.json.victory);
    if (res.json.victory) {
      expect(bossState.defeatedBossIds ?? []).toContain('dune_tyrant');
      expect(bossState.pityCounters?.dune_tyrant ?? 0).toBe(0);
    } else {
      expect(bossState.defeatedBossIds ?? []).not.toContain('dune_tyrant');
      expect(bossState.pityCounters?.dune_tyrant ?? 0).toBe(1);
    }
    // Every item the response reports was actually stored — no
    // orphan victories, no phantom loot.
    expect(store.items.size).toBe((res.json.items ?? []).length);
  });

  it('loot-bearing victory: rolled items ride the attempt and land in the store', async () => {
    const { base, store, tokenA } = await makeServer();
    const boss = bossById('dune_tyrant');
    store.seedProfile({
      id: A,
      player_level: 20,
      credits: 10000,
      consumables: {},
      boss_state: { unlockedBossIds: ['dune_tyrant'], defeatedBossIds: [], pityCounters: {} },
    });
    const weapon: Weapon = {
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
    store.seedItem({
      id: weapon.id,
      owner_user_id: A,
      kind: 'weapon',
      runtime_state: 'equipped',
      equipped_slot: 'primary',
      payload: weapon as unknown as Record<string, unknown>,
    });

    const findNonce = (
      baseReq: Omit<BossAttemptRequest, 'attemptNonce'>,
      predicate: (r: BossAttemptChefResult) => boolean,
    ): number => {
      for (let nonce = 1; nonce <= 2000; nonce++) {
        if (predicate(processBossAttempt({ ...baseReq, attemptNonce: nonce }))) return nonce;
      }
      throw new Error('no matching nonce found');
    };
    const nonce = findNonce(
      {
        playerId: A,
        bossId: boss.id,
        primary: weapon,
        secondary: null,
        heavy: null,
        ordnance: null,
        shield: null,
        classMod: null,
        relic: null,
        consumables: {},
        risk: RiskSetting.Balanced,
        playerLevel: 20,
        skillBonuses: {},
        pityCount: 0,
        playerCredits: 10000,
        entryFee: boss.entryCost,
      },
      (r) => r.result.victory && r.items.length > 0,
    );

    const res = await post(
      base,
      '/api/verify-boss',
      { playerId: A, bossId: boss.id, attemptNonce: nonce, consumables: {}, risk: RiskSetting.Balanced },
      tokenA,
    );
    expect(res.status).toBe(200);
    expect(res.json.victory).toBe(true);
    expect((res.json.items ?? []).length).toBeGreaterThan(0);
    // Loot stored by the attempt + the one seeded equipped weapon.
    expect(store.items.size).toBe((res.json.items ?? []).length + 1);
  });
});

// ---------------------------------------------------------------------------
// The Pg seam — the layer that actually broke. A fake pool captures the
// exact parameters applyChefBossAttempt hands the driver; the items
// argument must be JSON TEXT (the jsonb document), never a bare array.
// ---------------------------------------------------------------------------

describe('PgChefGameplayStore.applyChefBossAttempt — items param wire format', () => {
  function attemptWith(items: unknown[]): ChefBossAttemptInput {
    return {
      bossId: 'dune_tyrant',
      attemptNonce: 42,
      victory: items.length > 0,
      creditsDelta: 0,
      xp: 0,
      consumables: {},
      attempt: { victory: items.length > 0 },
      unlockedBossId: null,
      scrap: 0,
      entryFee: 0,
      actionSkillTree: null,
      items: items as ChefBossAttemptInput['items'],
    };
  }

  async function captureParams(items: unknown[]): Promise<unknown[]> {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const fakePool = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [{ result: { action_type: 'cc_apply_boss_attempt' } }] };
      },
    };
    const store = new PgChefGameplayStore(fakePool as unknown as Pool);
    await store.applyChefBossAttempt(A, attemptWith(items));
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('cc_apply_chef_boss_attempt');
    return calls[0].params;
  }

  it('empty roll: the items param is the JSON text "[]", not a bare array', async () => {
    const params = await captureParams([]);
    const itemsParam = params[12];
    expect(typeof itemsParam).toBe('string');
    expect(itemsParam).toBe('[]');
    // The wire contract: what pg will actually transmit for this param
    // is a valid jsonb array document.
    expect(prepareValue(itemsParam)).toBe('[]');
    expect(JSON.parse(prepareValue(itemsParam) as string)).toEqual([]);
  });

  it('loot-bearing roll: the items param is JSON text that round-trips to the rolled items', async () => {
    const loot = [{ id: 'loot-1', name: 'Rolled Loot', weaponType: 'pistol', rarity: 'Rare' }];
    const params = await captureParams(loot);
    const itemsParam = params[12];
    expect(typeof itemsParam).toBe('string');
    expect(JSON.parse(itemsParam as string)).toEqual(loot);
    expect(JSON.parse(prepareValue(itemsParam) as string)).toEqual(loot);
  });
});
