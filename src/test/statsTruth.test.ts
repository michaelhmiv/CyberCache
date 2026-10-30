/**
 * Phase 0 Slice 3 — STATS TRUTH, exercised through the shipped paths
 * (HTTP claim + settle-offline routes over the InMemory gameplay
 * store), not the engine in isolation.
 *
 * The mechanics audit (stats-and-areas.md) found:
 *  1. The Chef's roaming "relic" lookup returned the CLASS MOD, so
 *     relic damage affixes were silently lost in roaming.
 *  2. Relic "+% XP Gain" affixes (category 'idle') paid on bosses and
 *     showed in the snapshot but were ignored by the roaming XP mult.
 *  3. Roaming mitigation was always 0 (ticker never sent it, Chef
 *     defaulted 0) while the snapshot's Effective HP advertised it.
 *  4. The boss sim ran its own HP formula (500 + 40/level) instead of
 *     the shared computeHunterMaxHp (700 + 60/level + shield).
 *  5. Offline settlement built its claim with NO equippedGear and NO
 *     skillBonuses, so gear offline mods, the Scavenger offline tree,
 *     scrap mods and Salvage Rights paid zero offline.
 *  7. Area unlockLevel gates were UI-only; nothing server-side
 *     enforced them.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { computeHunterMaxHp } from '@/lib/combat/damageContract';
import { simulateBoss } from '@/lib/simulation/bossSimulator';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { ClassMod, Relic, Shield, Weapon } from '@/types/items';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
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

// --- Gear fixtures -----------------------------------------------------------

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'fixture-weapon',
    name: 'Fixture Gun',
    level: 10,
    rarity: Rarity.Common,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 100,
    baseDamage: 8,
    attackSpeed: 1,
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
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

function makeClassMod(): ClassMod {
  return {
    id: 'fixture-classmod',
    name: 'Fixture Class Mod',
    level: 10,
    rarity: Rarity.Rare,
    treeBonus: 'Gunslinger',
    nodeBoosts: {},
    affixes: [
      { id: 'cm_wd', category: 'combat', stat: 'weaponDamage', value: 0.5, displayText: '+50% Weapon Damage' },
    ],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
  };
}

function makeRelic(): Relic {
  return {
    id: 'fixture-relic',
    name: 'Fixture Relic',
    level: 10,
    rarity: Rarity.Rare,
    affixes: [
      { id: 'relic_bd', category: 'boss', stat: 'bossDamageMod', value: 2.0, displayText: '+200% Boss Damage' },
      { id: 'relic_xp', category: 'idle', stat: 'xpBoostMod', value: 1.0, displayText: '+100% XP Gain' },
    ],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
  };
}

function makeShield(mitigation: number): Shield {
  return {
    id: 'fixture-shield',
    name: 'Fixture Shield',
    level: 10,
    rarity: Rarity.Common,
    hp: 500,
    rechargeRate: 10,
    mitigation,
    element: Element.Kinetic,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 1,
  };
}

const ALIVE = { currentHp: 100000, shieldHp: 0, maxHp: 100000 };

/**
 * Slice 6 conversion note: these tests originally carried the gear in
 * the claim BODY — the forged-style setup the trust hardening removed.
 * Gear now lives only in item_instances (seedItem, runtime_state
 * 'equipped') and the route derives it; the bodies below send no gear
 * and no skillBonuses at all. Skill bonuses derive from skill_spends
 * (empty here) + the class mod's treeBonus via computeSkillBonuses —
 * the same record the honest client's getBonuses() would report.
 */
function seedEquipped(
  store: InMemoryChefGameplayStore,
  owner: string,
  slot: string,
  payload: unknown,
) {
  store.seedItem({
    id: `${owner}-${slot}`,
    owner_user_id: owner,
    kind: 'gear',
    runtime_state: 'equipped',
    equipped_slot: slot,
    payload: payload as Record<string, unknown>,
  });
}

describe('stats truth — roaming claim (HTTP)', () => {
  it('(a) relic affixes reach roaming: DPS (bossDamageMod) and XP (+% XP Gain) vs the same claim without the relic', async () => {
    const { base, store, tokenA, tokenB } = await makeServer();
    store.seedProfile({ id: A, player_level: 10 });
    store.seedProfile({ id: B, player_level: 10 });

    const weapon = makeWeapon();
    const classMod = makeClassMod();
    // Player A: weapon + class mod + relic. Player B: weapon + class mod
    // only. All in server records (item_instances), none in the body.
    seedEquipped(store, A, 'primary', weapon);
    seedEquipped(store, A, 'classMod', classMod);
    seedEquipped(store, A, 'relic', makeRelic());
    seedEquipped(store, B, 'primary', weapon);
    seedEquipped(store, B, 'classMod', classMod);
    const claimA = await post(base, '/api/claim', {
      playerId: A, areaId: 'dustwaste_frontier', ticks: 20, tickCount: 20, playerLevel: 10,
      survival: ALIVE,
    }, tokenA);
    const claimB = await post(base, '/api/claim', {
      playerId: B, areaId: 'dustwaste_frontier', ticks: 20, tickCount: 20, playerLevel: 10,
      survival: ALIVE,
    }, tokenB);
    expect(claimA.status).toBe(200);
    expect(claimB.status).toBe(200);

    const rewardsA = claimA.json.rewards as { xpAwarded: number };
    const rewardsB = claimB.json.rewards as { xpAwarded: number };
    // Dustwaste pays 1.0 XP/tick. The relic's +100% XP Gain affix must
    // exactly double the payout (pre-fix it paid 20 — the affix was
    // invisible to the roaming multiplier).
    expect(rewardsB.xpAwarded).toBe(20);
    expect(rewardsA.xpAwarded).toBe(40);

    // The relic's +200% bossDamageMod feeds computeEffectiveDpsFromGear's
    // relic pool. Pre-fix the "relic" lookup returned the class mod, so
    // adding the relic changed nothing; now the kill cycle must advance
    // strictly further with it equipped.
    const killsA = (claimA.json.killCycle as { totalKills: number }).totalKills;
    const killsB = (claimB.json.killCycle as { totalKills: number }).totalKills;
    expect(killsA).toBeGreaterThan(killsB);
  });

  it('(b) shield mitigation is real in roaming: an 80% mitigation shield cuts HP damage vs the same shield at 0%', async () => {
    const { base, store, tokenA, tokenB } = await makeServer();
    store.seedProfile({ id: A, player_level: 10 });
    store.seedProfile({ id: B, player_level: 10 });

    const survival = { currentHp: 10000, shieldHp: 0, maxHp: 10000 };
    seedEquipped(store, A, 'shield', makeShield(0.8));
    seedEquipped(store, B, 'shield', makeShield(0));
    const claimMit = await post(base, '/api/claim', {
      playerId: A, areaId: 'dustwaste_frontier', ticks: 20, tickCount: 20, playerLevel: 10,
      survival,
    }, tokenA);
    const claimRaw = await post(base, '/api/claim', {
      playerId: B, areaId: 'dustwaste_frontier', ticks: 20, tickCount: 20, playerLevel: 10,
      survival,
    }, tokenB);
    expect(claimMit.status).toBe(200);
    expect(claimRaw.status).toBe(200);

    const hpMit = (claimMit.json.survival as { currentHp: number }).currentHp;
    const hpRaw = (claimRaw.json.survival as { currentHp: number }).currentHp;
    const takenMit = 10000 - hpMit;
    const takenRaw = 10000 - hpRaw;
    // Sanity: the unmitigated hunter actually took damage (survival ran).
    expect(takenRaw).toBeGreaterThan(30);
    // Pre-fix both took the same damage — the Chef read mitigation from
    // a request field the ticker never sends, defaulting to 0.
    expect(takenMit).toBeLessThan(takenRaw * 0.5);
  });

  it('(d) area gate: an under-level claim on a gated area is rejected and pays nothing', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({ id: A, player_level: 1, credits: 50 });

    // HelixWorks Labyrinth unlocks at 25. The body even lies about the
    // level (25) — the DB level (1) is what the gate reads.
    const res = await post(base, '/api/claim', {
      playerId: A, areaId: 'helixworks_labyrinth', ticks: 5, tickCount: 5, playerLevel: 25,
      survival: ALIVE,
    }, tokenA);
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('Area locked for your level');
    expect(res.json.requiredLevel).toBe(25);
    const profile = store.profiles.get(A)!;
    expect(profile.credits).toBe(50);
    expect(profile.last_claimed_tick).toBe(0);

    // Control: the same player claims the level-1 area fine.
    const ok = await post(base, '/api/claim', {
      playerId: A, areaId: 'dustwaste_frontier', ticks: 5, tickCount: 5, playerLevel: 1,
      survival: ALIVE,
    }, tokenA);
    expect(ok.status).toBe(200);
  });
});

describe('stats truth — offline settlement parity (HTTP)', () => {
  const TICKS = 600; // 30 minutes

  function seedOfflinePlayer(store: InMemoryChefGameplayStore, id: string, withBuild: boolean) {
    const settleFromMs = Date.now() - (TICKS * 3000 + 1500);
    store.seedProfile({
      id,
      player_level: 10,
      credits: 0,
      scrap: 0,
      last_claimed_tick: 0,
      last_roaming_settled_at: new Date(settleFromMs).toISOString(),
      ...(withBuild ? { skill_spends: { scav_idle_1: 5, scav_scrap_1: 5 } } : {}),
    });
    store.seedActiveAction({
      user_id: id,
      active_action: 'roaming_loot',
      target_id: 'dustwaste_frontier',
      started_at: new Date(settleFromMs).toISOString(),
      last_heartbeat_at: null,
      activity_payload: {},
    });
    if (withBuild) {
      // The equipped weapon lives ONLY in item_instances (the server's
      // records) — the settlement request carries no gear at all.
      store.seedItem({
        id: 'equipped-weapon-1',
        owner_user_id: id,
        kind: 'weapon',
        runtime_state: 'equipped',
        equipped_slot: 'primary',
        payload: makeWeapon({ offlineEarningsMod: 0.5 }) as unknown as Record<string, unknown>,
      });
    }
  }

  it('(c) offline settlement loads gear + skills from server records: Scavenger offline tree and gear offline mod pay', async () => {
    const { base, store, tokenA, tokenB } = await makeServer();
    seedOfflinePlayer(store, A, true);
    seedOfflinePlayer(store, B, false);

    const resA = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'stats-truth-a1' }, tokenA);
    const resB = await post(base, '/api/settle-offline', { playerId: B, settlementNonce: 'stats-truth-b1' }, tokenB);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.json.settled).toBe(true);
    expect(resB.json.settled).toBe(true);

    // Baseline (no gear, no skills): Dustwaste 0.75 cr/tick and
    // 0.15 scrap/tick at face value.
    const rewardsB = resB.json.rewards as { creditsAwarded: number; scrapAwarded: number };
    expect(rewardsB.creditsAwarded).toBe(450);
    expect(rewardsB.scrapAwarded).toBe(90);

    // With the build: offlineMult = (1 + 0.5 gear) + 0.75 (Uplink Tap
    // 5 × +15%) = 2.25 → 0.75 × 2.25 × 600 = 1012.5 → 1012 whole
    // credits. Scrap: Decompiler 5 × +20% → scrapMult 2.0 → 180.
    // Pre-fix both players settled at the stripped baseline.
    const rewardsA = resA.json.rewards as { creditsAwarded: number; scrapAwarded: number };
    expect(rewardsA.creditsAwarded).toBe(1012);
    expect(rewardsA.scrapAwarded).toBe(180);
    expect(store.profiles.get(A)!.credits).toBe(1012);
    expect(store.profiles.get(B)!.credits).toBe(450);
  });

  it('(d) area gate: offline settlement into an above-gate area settles nothing', async () => {
    const { base, store, tokenA } = await makeServer();
    const settleFromMs = Date.now() - (200 * 3000 + 1500);
    store.seedProfile({
      id: A,
      player_level: 1,
      credits: 25,
      last_claimed_tick: 0,
      last_roaming_settled_at: new Date(settleFromMs).toISOString(),
    });
    store.seedActiveAction({
      user_id: A,
      active_action: 'roaming_loot',
      target_id: 'helixworks_labyrinth',
      started_at: new Date(settleFromMs).toISOString(),
      last_heartbeat_at: null,
      activity_payload: {},
    });
    const res = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'stats-truth-gate' }, tokenA);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ settled: false, reason: 'area_locked' });
    expect(store.profiles.get(A)!.credits).toBe(25);
    expect(store.profiles.get(A)!.last_claimed_tick).toBe(0);
  });
});

describe('stats truth — one HP formula', () => {
  it('boss sim survival is computed from computeHunterMaxHp (the snapshot/roaming formula)', () => {
    const boss = REGION_1_BOSSES[0]; // Dune Tyrant, dps 30
    const sim = simulateBoss({
      primary: makeWeapon({ id: 'hp-pin-weapon' }),
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 20,
      skillBonuses: {},
    });
    // With no shield, consumables, relic/classMod boosts, or skill
    // survival, totalSurvival is exactly the hunter HP pool, and
    // survivalScore = pool / (boss.dps × 30). The pre-fix sim pool was
    // 500 + 40×20 = 1300; the shared formula gives 700 + 60×20 = 1900.
    expect(sim.survivalScore).toBeCloseTo(computeHunterMaxHp(20, 0) / (boss.dps * 30), 10);
  });
});
