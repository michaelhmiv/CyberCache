/**
 * Phase 0 Slice 5 — MASTERY ALIGNMENT, exercised through the shipped
 * paths (HTTP claim / verify-boss / settle-offline over the
 * InMemoryChefGameplayStore, which mirrors the SQL ledger trigger's
 * shipped branches from migration 0014).
 *
 * The mechanics audit found the mastery engine starved: the trigger
 * only understood the legacy action vocabulary, so the shipped Chef
 * flows granted no location/combat/consumable mastery; weapons.*
 * masteries had no grantor at all; locations.* was only ever fed a
 * hardcoded Dustwaste.
 *
 * Proven here, from persisted store state (store.masteries):
 *  1. A roaming claim grants location mastery for the ACTUAL area
 *     farmed (Redline Circuit, not Dustwaste) and weapon mastery for
 *     the equipped primary weapon's type.
 *  2. A Dustwaste claim still lands on the original
 *     'locations.dustwaste' definition (the legacy id mapping).
 *  3. A boss victory grants combat.boss_attempts / boss_defeats,
 *     weapon mastery = the XP the attempt awarded, and consumable
 *     mastery from the prepared set actually consumed — and NO
 *     location mastery (bosses have no area). A nonce replay does
 *     not grant twice.
 *  4. An offline settlement grants the same roaming categories for
 *     the settled area.
 *  5. Migration 0014 carries the SQL half: definition seeds, the
 *     trigger's shipped branches, and the two payload completions.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { processBossAttempt, type BossAttemptChefResult, type BossAttemptRequest } from '../server/chef';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore, type InMemoryMastery } from '../server/gameplay/memory';
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
  await new Promise<void>((resolveListen) => server.once('listening', resolveListen));
  openServers.push(
    () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
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

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'mastery-fixture-gun',
    name: 'Mastery Fixture Gun',
    level: 10,
    rarity: Rarity.Common,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 100,
    baseDamage: 50,
    attackSpeed: 2,
    critChance: 0,
    critDamage: 1,
    statusChance: 0,
    statusDamage: 0,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 1,
    ...overrides,
  };
}

const ALIVE = { currentHp: 100000, shieldHp: 0, maxHp: 100000 };

function masteryXp(store: InMemoryChefGameplayStore, masteryId: string): number | undefined {
  const row: InMemoryMastery | undefined = store.masteries.find((m) => m.user_id === A && m.mastery_id === masteryId);
  return row?.mastery_xp;
}

/** Equip the weapon in the server's own records (item_instances mirror). */
function equipPrimary(store: InMemoryChefGameplayStore, weapon: Weapon) {
  store.seedItem({
    id: `equipped-${weapon.id}`,
    owner_user_id: A,
    kind: 'weapon',
    runtime_state: 'equipped',
    equipped_slot: 'primary',
    payload: weapon as unknown as Record<string, unknown>,
  });
}

describe('mastery alignment — roaming claims (HTTP)', () => {
  it('a claim in Redline Circuit grants locations.redline_circuit (not Dustwaste) + weapons.pistol', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, player_level: 10 });
    const weapon = makeWeapon();
    equipPrimary(store, weapon);

    const res = await post(base, '/api/claim', {
      playerId: A, areaId: 'redline_circuit', ticks: 20, tickCount: 20, playerLevel: 10,
      equippedGear: [weapon], survival: ALIVE, skillBonuses: {},
    }, tokenA);
    expect(res.status).toBe(200);

    const xpAwarded = (res.json.rewards as { xpAwarded: number }).xpAwarded;
    expect(xpAwarded).toBeGreaterThan(0);
    // Location: the legacy idle-claim rule — greatest(1, xp) — fed
    // the REAL area farmed.
    expect(masteryXp(store, 'locations.redline_circuit')).toBe(Math.max(1, xpAwarded));
    // Weapon: 1 mastery XP per player XP earned with a pistol equipped.
    expect(masteryXp(store, 'weapons.pistol')).toBe(xpAwarded);
    // The hardcoded-Dustwaste era is over: farming Redline feeds no Dustwaste.
    expect(masteryXp(store, 'locations.dustwaste')).toBeUndefined();
  });

  it('a Dustwaste claim lands on the original locations.dustwaste definition', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, player_level: 10 });
    const weapon = makeWeapon();
    equipPrimary(store, weapon);

    const res = await post(base, '/api/claim', {
      playerId: A, areaId: 'dustwaste_frontier', ticks: 20, tickCount: 20, playerLevel: 10,
      equippedGear: [weapon], survival: ALIVE, skillBonuses: {},
    }, tokenA);
    expect(res.status).toBe(200);

    const xpAwarded = (res.json.rewards as { xpAwarded: number }).xpAwarded;
    expect(masteryXp(store, 'locations.dustwaste')).toBe(Math.max(1, xpAwarded));
    expect(masteryXp(store, 'weapons.pistol')).toBe(xpAwarded);
  });
});

describe('mastery alignment — boss attempts (HTTP)', () => {
  function strongSmg(): Weapon {
    return makeWeapon({
      id: 'mastery-boss-smg',
      name: 'Mastery Boss SMG',
      level: 50,
      rarity: Rarity.Legendary,
      weaponType: WeaponType.SMG,
      element: Element.Fire,
      baseDamage: 10000,
      attackSpeed: 10,
      critChance: 0.5,
      critDamage: 2,
      bossDamageMod: 2,
      shieldDamageMod: 1,
      armorDamageMod: 1,
    });
  }

  function findNonce(baseRequest: Omit<BossAttemptRequest, 'attemptNonce'>, predicate: (r: BossAttemptChefResult) => boolean): { nonce: number; expected: BossAttemptChefResult } {
    for (let nonce = 1; nonce <= 2000; nonce++) {
      const result = processBossAttempt({ ...baseRequest, attemptNonce: nonce });
      if (predicate(result)) return { nonce, expected: result };
    }
    throw new Error('no matching nonce found');
  }

  it('a victory grants combat + weapon + consumable mastery, no location — and a replay grants nothing twice', async () => {
    const { base, store, tokenA } = await makeServer();
    const boss = REGION_1_BOSSES.find((b) => b.id === 'ashgut')!;
    store.seedProfile({
      id: A,
      player_level: 20,
      credits: 10000,
      consumables: { MedKit: 5, ShieldCell: 3, AmmoPack: 2 },
      boss_state: { unlockedBossIds: ['dune_tyrant', 'siltstalker', 'heap_guard', 'ashgut'], defeatedBossIds: [], pityCounters: {} },
    });
    const smg = strongSmg();
    equipPrimary(store, smg);

    const prepared = { MedKit: 2, ShieldCell: 1, AmmoPack: 1 };
    const { nonce, expected } = findNonce(
      {
        playerId: A,
        bossId: boss.id,
        primary: smg,
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
      (r) => r.result.victory && Object.values(r.consumedConsumables).reduce((a, b) => a + b, 0) > 0,
    );
    const consumedTotal = Object.values(expected.consumedConsumables).reduce((a, b) => a + b, 0);
    expect(consumedTotal).toBeGreaterThan(0);
    expect(expected.xpAwarded).toBeGreaterThan(0);

    const body = {
      playerId: A,
      bossId: boss.id,
      attemptNonce: nonce,
      primary: smg,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: prepared,
      risk: RiskSetting.Balanced,
      skillBonuses: {},
    };
    const res = await post(base, '/api/verify-boss', body, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.victory).toBe(true);

    expect(masteryXp(store, 'combat.boss_attempts')).toBe(20);
    expect(masteryXp(store, 'combat.boss_defeats')).toBe(100);
    expect(masteryXp(store, 'weapons.smg')).toBe(expected.xpAwarded);
    expect(masteryXp(store, 'consumable.efficiency')).toBe(consumedTotal * 10);
    // Bosses have no area: no location mastery of any kind.
    expect(store.masteries.some((m) => m.mastery_id.startsWith('locations.'))).toBe(false);

    // Nonce replay: the applier returns the stored result and the
    // trigger never fires a second time — mastery must not double.
    const replay = await post(base, '/api/verify-boss', body, tokenA);
    expect(replay.status).toBe(200);
    expect(masteryXp(store, 'combat.boss_attempts')).toBe(20);
    expect(masteryXp(store, 'weapons.smg')).toBe(expected.xpAwarded);
  });
});

describe('mastery alignment — offline settlement (HTTP)', () => {
  it('a settlement grants location + weapon mastery for the settled area', async () => {
    const { base, store, tokenA } = await makeServer();
    const ticks = 600;
    const settleFromMs = Date.now() - (ticks * 3000 + 1500);
    store.seedProfile({
      id: A,
      player_level: 10,
      credits: 0,
      scrap: 0,
      last_claimed_tick: 0,
      last_roaming_settled_at: new Date(settleFromMs).toISOString(),
    });
    store.seedActiveAction({
      user_id: A,
      active_action: 'roaming_loot',
      target_id: 'redline_circuit',
      started_at: new Date(settleFromMs).toISOString(),
      last_heartbeat_at: null,
      activity_payload: {},
    });
    const weapon = makeWeapon();
    equipPrimary(store, weapon);

    const res = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'mastery-settle-1' }, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.settled).toBe(true);

    const xpAwarded = (res.json.rewards as { xpAwarded: number }).xpAwarded;
    expect(xpAwarded).toBeGreaterThan(0);
    expect(masteryXp(store, 'locations.redline_circuit')).toBe(Math.max(1, xpAwarded));
    expect(masteryXp(store, 'weapons.pistol')).toBe(xpAwarded);
    expect(masteryXp(store, 'locations.dustwaste')).toBeUndefined();
  });
});

describe('migration 0014 — mastery alignment (SQL)', () => {
  const migration = readFileSync(resolve(process.cwd(), 'db/migrations/0014_mastery_alignment.sql'), 'utf8');

  it('seeds the missing location + weapon mastery definitions', () => {
    for (const id of [
      'locations.redline_circuit',
      'locations.ironwood_bastion',
      'locations.blastforge_yards',
      'locations.prismatek_reactor',
      'locations.throwtech_dumpnet',
      'locations.helixworks_labyrinth',
      'weapons.sniper',
      'weapons.launcher',
      'weapons.beam',
    ]) {
      expect(migration).toContain(`'${id}'`);
    }
  });

  it('teaches the trigger the shipped action types without renaming them', () => {
    expect(migration).toContain("action = 'cc_apply_chef_rewards'");
    expect(migration).toContain("action = 'cc_apply_boss_attempt'");
    expect(migration).toContain("action = 'cc_settle_offline_roaming'");
    // Legacy branches survive for the legacy ops.
    expect(migration).toContain("action = 'cc_idle_claim'");
    // The shipped payload keys are read, not the legacy ones.
    expect(migration).toContain("reward_payload ->> 'xp_awarded'");
    expect(migration).toContain("result_payload -> 'consumed_batches'");
    expect(migration).toContain("result_payload -> 'consumed_consumables'");
  });

  it('completes the two payloads additively (same signatures, new fields)', () => {
    expect(migration).toContain("'area_id', _area_id");
    expect(migration).toContain("'xp_awarded', greatest(_xp, 0)");
    // Grants for locations/weapons are definition-guarded so a grant
    // can never fail the ledger insert (and with it the claim).
    expect(migration).toContain('cc_add_mastery_xp_if_defined');
    expect(migration).toContain('cc_location_mastery_id');
    expect(migration).toContain('cc_equipped_weapon_mastery_id');
  });
});
