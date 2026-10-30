/**
 * Phase 0 Slice 1 — the SHIPPED boss path, end to end over HTTP.
 *
 * The audit found the shipped boss fight never resolved and the one
 * real resolution path (a) discarded the player's prepared consumables
 * for their whole inventory, (b) charged no entry fee, (c) enforced
 * no unlocks, and (d) ignored dedicated drops. These tests drive the
 * actual route (express + InMemoryChefGameplayStore, the repo's HTTP
 * harness pattern) and assert the persisted end state — profile
 * credits, consumable counts, boss_state — not just response shapes.
 *
 * Expected outcomes are precomputed with the Chef engine itself
 * (processBossAttempt with the exact request the route constructs
 * from server state), so nonce selection is deterministic, never a
 * coin flip against the seeded RNG.
 *
 * Slice 6 conversion note: the bodies below originally carried the
 * loadout (primary: strongWeapon(), ...) — the route took its sim
 * inputs from the body. Since the trust hardening, the route derives
 * gear from item_instances and skill bonuses from skill_spends, so
 * the strong weapon is SEEDED as an equipped server record and the
 * bodies carry intent only (boss, nonce, prepared consumables, risk,
 * plus the level/credits/pity lies whose server overrides predate
 * this slice).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { processBossAttempt, type BossAttemptChefResult, type BossAttemptRequest } from '../server/chef';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';

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
  entryFee?: number;
  creditsDelta?: number;
  dedicatedDropAwarded?: boolean;
  idempotentReplay?: boolean;
  pityIncremented?: boolean;
  error?: string;
  result?: { creditsLost?: number };
  items?: Array<{ legendaryEffectId?: string; sourceTag: string; rarity: string }>;
}

async function post(base: string, path: string, body: unknown, token?: string): Promise<{ status: number; json: VerifyBossHttpResult }> {
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

function strongWeapon(): Weapon {
  return {
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
}

/** Find a nonce whose Chef outcome (for the route-built request) matches the predicate. */
function findNonce(base: Omit<BossAttemptRequest, 'attemptNonce'>, predicate: (r: BossAttemptChefResult) => boolean): { nonce: number; expected: BossAttemptChefResult } {
  for (let nonce = 1; nonce <= 2000; nonce++) {
    const result = processBossAttempt({ ...base, attemptNonce: nonce });
    if (predicate(result)) return { nonce, expected: result };
  }
  throw new Error('no matching nonce found');
}

const bossById = (id: string) => REGION_1_BOSSES.find((b) => b.id === id)!;

/** Seed the strong weapon as the player's equipped primary in server records. */
function seedStrongWeapon(store: InMemoryChefGameplayStore) {
  const weapon = strongWeapon();
  store.seedItem({
    id: weapon.id,
    owner_user_id: A,
    kind: 'weapon',
    runtime_state: 'equipped',
    equipped_slot: 'primary',
    payload: weapon as unknown as Record<string, unknown>,
  });
  return weapon;
}

describe('shipped boss loop (POST /api/verify-boss)', () => {
  it('victory: charges exactly the prepared set + entry fee, grants loot incl. the dedicated-drop path, advances unlocks', async () => {
    const { base, store, tokenA } = await makeServer();
    const boss = bossById('ashgut'); // entry 600, dedicated: salvage_rights / overclocked
    store.seedProfile({
      id: A,
      player_level: 20,
      credits: 10000,
      consumables: { MedKit: 5, ShieldCell: 3, AmmoPack: 2, LuckBooster: 1, BossScanner: 2 },
      boss_state: { unlockedBossIds: ['dune_tyrant', 'siltstalker', 'heap_guard', 'ashgut'], defeatedBossIds: [], pityCounters: {} },
    });
    const prepared = { MedKit: 2, ShieldCell: 1, AmmoPack: 1 };
    // The weapon lives in server records; the route derives it.
    seedStrongWeapon(store);
    // The exact request the route builds from server state.
    const { nonce, expected } = findNonce(
      {
        playerId: A,
        bossId: boss.id,
        primary: strongWeapon(),
        secondary: null,
        heavy: null,
        ordnance: null,
        shield: null,
        classMod: null,
        relic: null,
        consumables: prepared,
        risk: RiskSetting.Balanced,
        playerLevel: 20,
        skillBonuses: {},
        pityCount: 0,
        playerCredits: 10000,
        entryFee: boss.entryCost,
      },
      (r) => r.result.victory && r.dedicatedDropAwarded,
    );
    // Survival is genuinely stressed here (level-20 HP pool vs Ashgut
    // DPS), so the ifUsed prep is spent on a win too.
    expect(expected.consumedConsumables).toEqual({ MedKit: 2, ShieldCell: 1, AmmoPack: 1 });

    const body = {
      playerId: A,
      bossId: boss.id,
      attemptNonce: nonce,
      consumables: prepared,
      risk: RiskSetting.Balanced,
      playerLevel: 99, // client lies — server level wins
      playerCredits: 999999, // client lies — server credits win
      pityCount: 99, // client lies — server pity wins
    };
    const res = await post(base, '/api/verify-boss', body, tokenA);

    expect(res.status).toBe(200);
    expect(res.json.verified).toBe(true);
    expect(res.json.victory).toBe(true);
    expect(res.json.entryFee).toBe(600);
    expect(res.json.dedicatedDropAwarded).toBe(true);
    expect(res.json.creditsDelta).toBe(expected.creditsDelta);

    const profile = store.profiles.get(A)!;
    // Fee + victory credits landed as one net delta.
    expect(profile.credits).toBe(10000 + expected.creditsDelta);
    // EXACTLY the policy-applied prepared subset was charged: the two
    // prepared MedKits are gone, the three unprepared ones remain; the
    // unprepared LuckBooster / BossScanner stacks are untouched.
    expect(profile.consumables).toEqual({ MedKit: 3, ShieldCell: 2, AmmoPack: 1, LuckBooster: 1, BossScanner: 2 });
    const bossState = profile.boss_state as { defeatedBossIds: string[]; unlockedBossIds: string[]; pityCounters: Record<string, number> };
    expect(bossState.defeatedBossIds).toContain('ashgut');
    expect(bossState.unlockedBossIds).toContain('mirage_duster');
    expect(bossState.pityCounters.ashgut ?? 0).toBe(0);

    // Loot: the dedicated-drop path produced a weapon carrying one of
    // the boss's declared dedicated legendary effects.
    const items = res.json.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    const dedicated = items.find((item) => item.legendaryEffectId && boss.dedicatedDrops.includes(item.legendaryEffectId));
    expect(dedicated).toBeDefined();
    expect(dedicated!.rarity).toBe(Rarity.Legendary);
    expect(dedicated!.sourceTag).toBe(DropSource.BossDrop);
    // Stored items = the loot + the one seeded equipped weapon row.
    expect(store.items.size).toBe(items.length + 1);

    // Replay of the same nonce applies nothing twice — no second fee,
    // no second consumption, and no duplicated loot storage (the June
    // handler re-stored freshly re-rolled items on a replay).
    const replay = await post(base, '/api/verify-boss', body, tokenA);
    expect(replay.status).toBe(200);
    expect(replay.json.idempotentReplay).toBe(true);
    expect(replay.json.items).toEqual([]);
    const after = store.profiles.get(A)!;
    expect(after.credits).toBe(10000 + expected.creditsDelta);
    expect(after.consumables).toEqual({ MedKit: 3, ShieldCell: 2, AmmoPack: 1, LuckBooster: 1, BossScanner: 2 });
    expect(store.items.size).toBe(items.length + 1);
  });

  it('defeat: applies entry fee + (insurance-halved) death fee and pity, charges the prepared set', async () => {
    const { base, store, tokenA } = await makeServer();
    const boss = bossById('siltstalker'); // entry 200, tier 2 → 5% death fee
    store.seedProfile({
      id: A,
      player_level: 5,
      credits: 10000,
      consumables: { MedKit: 4, InsuranceToken: 1 },
      boss_state: { unlockedBossIds: ['dune_tyrant', 'siltstalker'], defeatedBossIds: [], pityCounters: {} },
    });
    const prepared = { MedKit: 2, InsuranceToken: 1 };
    const { nonce, expected } = findNonce(
      {
        playerId: A,
        bossId: boss.id,
        primary: null,
        secondary: null,
        heavy: null,
        ordnance: null,
        shield: null,
        classMod: null,
        relic: null,
        consumables: prepared,
        risk: RiskSetting.Balanced,
        playerLevel: 5,
        skillBonuses: {},
        pityCount: 0,
        playerCredits: 10000,
        entryFee: boss.entryCost,
      },
      (r) => !r.result.victory,
    );
    expect(expected.result.creditsLost).toBe(200 + 250); // fee + 5% of 10000 halved by Insurance Token

    const body = {
      playerId: A,
      bossId: boss.id,
      attemptNonce: nonce,
      consumables: prepared,
      risk: RiskSetting.Balanced,
    };
    const res = await post(base, '/api/verify-boss', body, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.victory).toBe(false);
    expect(res.json.entryFee).toBe(200);
    expect(res.json.pityIncremented).toBe(true);
    expect(res.json.result.creditsLost).toBe(450);

    const profile = store.profiles.get(A)!;
    expect(profile.credits).toBe(10000 - 450);
    expect(profile.consumables).toEqual({ MedKit: 2, InsuranceToken: 0 });
    const bossState = profile.boss_state as { pityCounters: Record<string, number>; defeatedBossIds: string[] };
    expect(bossState.pityCounters.siltstalker).toBe(1);
    expect(bossState.defeatedBossIds).not.toContain('siltstalker');
  });

  it('rejects a locked boss with 403 and changes nothing', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, player_level: 50, credits: 10000, consumables: {}, boss_state: {} });
    const res = await post(
      base,
      '/api/verify-boss',
      { playerId: A, bossId: 'scrap_bishop', attemptNonce: 7, consumables: {}, risk: RiskSetting.Balanced },
      tokenA,
    );
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('Boss locked');
    expect(store.profiles.get(A)!.credits).toBe(10000);
  });

  it('rejects preparation beyond owned inventory and unknown types with 400', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, player_level: 50, credits: 10000, consumables: { MedKit: 3 }, boss_state: {} });
    const over = await post(
      base,
      '/api/verify-boss',
      { playerId: A, bossId: 'dune_tyrant', attemptNonce: 8, consumables: { MedKit: 99 }, risk: RiskSetting.Balanced },
      tokenA,
    );
    expect(over.status).toBe(400);
    expect(over.json.error).toBe('Invalid prepared consumables');
    const unknown = await post(
      base,
      '/api/verify-boss',
      { playerId: A, bossId: 'dune_tyrant', attemptNonce: 9, consumables: { stim: 1 }, risk: RiskSetting.Balanced },
      tokenA,
    );
    expect(unknown.status).toBe(400);
    expect(store.profiles.get(A)!.consumables).toEqual({ MedKit: 3 });
  });

  it('rejects an attempt the player cannot afford the entry fee for', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({
      id: A,
      player_level: 50,
      credits: 100, // siltstalker entry is 200
      consumables: {},
      boss_state: { unlockedBossIds: ['dune_tyrant', 'siltstalker'], defeatedBossIds: [], pityCounters: {} },
    });
    const res = await post(
      base,
      '/api/verify-boss',
      { playerId: A, bossId: 'siltstalker', attemptNonce: 10, consumables: {}, risk: RiskSetting.Balanced },
      tokenA,
    );
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('Insufficient credits for boss entry fee');
    expect(store.profiles.get(A)!.credits).toBe(100);
  });

  it('charges the rematch cost — not the entry cost — for an already-defeated boss', async () => {
    const { base, store, tokenA } = await makeServer();
    const boss = bossById('dune_tyrant'); // entry 0, rematch 100
    store.seedProfile({
      id: A,
      player_level: 50,
      credits: 1000,
      consumables: {},
      boss_state: { unlockedBossIds: ['dune_tyrant', 'siltstalker'], defeatedBossIds: ['dune_tyrant'], pityCounters: {} },
    });
    seedStrongWeapon(store);
    const res = await post(
      base,
      '/api/verify-boss',
      { playerId: A, bossId: boss.id, attemptNonce: 11, consumables: {}, risk: RiskSetting.Balanced },
      tokenA,
    );
    expect(res.status).toBe(200);
    expect(res.json.entryFee).toBe(100);
    expect(store.profiles.get(A)!.credits).toBe(1000 + (res.json.creditsDelta ?? 0));
  });
});
