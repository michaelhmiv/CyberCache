/**
 * Phase 0 Slice 6 — TRUST HARDENING, exercised through the shipped
 * paths (HTTP claim + verify-boss routes over the InMemory gameplay
 * store), with adversarial bodies.
 *
 * The mechanics audit (boss-flow.md, stats-and-areas.md) found both
 * routes accepted `equippedGear` objects and `skillBonuses` from the
 * request body. The engines re-derived modifiers from whatever gear
 * they were handed — internal consistency — but never verified the
 * player OWNED that gear or had earned those bonuses, so a forged
 * body fabricated claim payouts and boss victories. Both routes now
 * derive gear (equipped item_instances) and skills
 * (profiles.skill_spends + equipped class mod) from server records
 * and ignore body copies entirely.
 *
 * Claim equality method: the engine RNG seeds from
 * (playerId, areaId, tickCount), so two harnesses seeded identically
 * (same player id, same records, same claim) must produce identical
 * rewards/killCycle/survival when the bodies differ only in forged
 * gear/skills — any leak of body gear into the math breaks the
 * equality loudly.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { getRoamingArea } from '@/constants/roamingAreas';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { processBossAttempt, type BossAttemptChefResult, type BossAttemptRequest } from '../server/chef';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { issueAccessToken } from '../server/auth/tokens';
import { EconomyConfig } from '../server/economy/config';

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

async function makeServer(
  store = new InMemoryChefGameplayStore(),
  routeOverrides: { economyConfig?: EconomyConfig; now?: () => Date } = {},
): Promise<Harness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET, ...routeOverrides });
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

// --- Fixtures ----------------------------------------------------------------

function honestWeapon(): Weapon {
  return {
    id: 'honest-pistol',
    name: 'Honest Pistol',
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
  };
}

/** The fabricated god-tier weapon the audit's attack carries. */
function godWeapon(): Weapon {
  return {
    ...honestWeapon(),
    id: 'forged-god-gun',
    name: 'Forged God Gun',
    level: 999,
    rarity: Rarity.Legendary,
    baseDamage: 100000,
    attackSpeed: 50,
    critChance: 1,
    critDamage: 10,
    bossDamageMod: 50,
    shieldDamageMod: 50,
    armorDamageMod: 50,
    offlineEarningsMod: 100,
    scrapYieldMod: 100,
    rareDropChanceMod: 0.9,
  };
}

const FORGED_SKILLS = {
  dps: 25,
  offlineEarnings: 50,
  scrapYield: 50,
  rareDropChance: 0.9,
  xpBoostMod: 50,
  survival: 50,
};

/** The fabricated god shield: if body gear leaked, roaming damage collapses. */
const GOD_SHIELD = {
  id: 'forged-god-shield',
  name: 'Forged God Shield',
  level: 999,
  rarity: Rarity.Legendary,
  hp: 100000,
  rechargeRate: 10000,
  mitigation: 0.8,
  element: Element.Kinetic,
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 1,
};

/**
 * The bootstrap Starter Pistol payload EXACTLY as migration 0004
 * writes it into item_instances: sparse (no baseDamage/attackSpeed/
 * ...). The client adapter hides such payloads from the loadout, so
 * an honest fresh guest's claim runs weaponless — derivation must
 * treat it the same way.
 */
const STARTER_PISTOL_PAYLOAD = {
  id: 'bootstrap-starter-pistol',
  name: 'Starter Pistol',
  weaponType: 'Pistol',
  element: 'Kinetic',
  manufacturer: 'Redline',
  rarity: 'Common',
  level: 1,
  combatPower: 5,
  bossPower: 3,
  dps: 5,
  sourceTag: 'Starter Kit',
};

const ALIVE = { currentHp: 100000, shieldHp: 0, maxHp: 100000 };

function seedClaimPlayer(store: InMemoryChefGameplayStore, withStarterRow: boolean) {
  store.seedProfile({ id: A, player_level: 10, credits: 0, scrap: 0 });
  if (withStarterRow) {
    store.seedItem({
      id: 'starter-row',
      owner_user_id: A,
      kind: 'weapon',
      runtime_state: 'equipped',
      equipped_slot: 'primary',
      payload: { ...STARTER_PISTOL_PAYLOAD },
    });
  }
}

function seedHonestWeapon(store: InMemoryChefGameplayStore) {
  const weapon = honestWeapon();
  store.seedItem({
    id: `equipped-${weapon.id}`,
    owner_user_id: A,
    kind: 'weapon',
    runtime_state: 'equipped',
    equipped_slot: 'primary',
    payload: weapon as unknown as Record<string, unknown>,
  });
  return weapon;
}

describe('trust hardening — roaming claim (POST /api/claim)', () => {
  it('a forged god-tier body pays EXACTLY the honest claim from server records', async () => {
    // The roaming-variance systems are pinned OFF for both harnesses
    // (event roll + elite escalation via their economy levers): this
    // test isolates body-forgery, and escalation outcomes seed from
    // variance-shifted spawn ticks, which would desync the pair for
    // reasons unrelated to forgery. Event/elite behavior is covered
    // in overhaulMechanics.
    const pinVariance = {
      economyConfig: new EconomyConfig({
        loadConfigValues: async () => ({ eventChanceBase: 0, eliteEscalationChance: 0 }),
      }),
    };
    const honest = await makeServer(new InMemoryChefGameplayStore(), pinVariance);
    const forged = await makeServer(new InMemoryChefGameplayStore(), pinVariance);
    for (const h of [honest, forged]) {
      h.store.seedProfile({ id: A, player_level: 10, credits: 0, scrap: 0 });
      seedHonestWeapon(h.store);
    }

    const honestRes = await post(honest.base, '/api/claim', {
      playerId: A, areaId: 'dustwaste_frontier', ticks: 20, tickCount: 20, playerLevel: 10,
      survival: ALIVE,
    }, honest.tokenA);
    const forgedRes = await post(forged.base, '/api/claim', {
      playerId: A, areaId: 'dustwaste_frontier', ticks: 20, tickCount: 20, playerLevel: 10,
      equippedGear: [godWeapon(), GOD_SHIELD],
      skillBonuses: FORGED_SKILLS,
      idleMods: { offlineEarningsMod: 100, scrapYieldMod: 100, rareDropChanceMod: 0.9 },
      survival: ALIVE,
    }, forged.tokenA);

    expect(honestRes.status).toBe(200);
    expect(forgedRes.status).toBe(200);
    // Every economy number is identical: the forged gear/skills never
    // reached the engine. (Pre-fix the forged claim's multipliers and
    // kill cycle dwarf the honest one.)
    expect(forgedRes.json.rewards).toEqual(honestRes.json.rewards);
    // Kill-cycle counters derive from seeded RNG, but the kill TIMING
    // rides on per-hit damage variance (Math.random by design in
    // damageContract — a pre-existing unseeded roll), so a kill can
    // land one tick either side of the claim window: counters are
    // compared within ±1. The roaming-variance overhaul widened those
    // boundary windows (elite targets carry 3× HP), which is why the
    // band exists. If body gear leaked, the forged DPS would multiply
    // the counts several-fold — far outside a ±1 band — and the exact
    // rewards equality above would break first.
    const kcHonest = honestRes.json.killCycle as Record<string, number | string | null>;
    const kcForged = forgedRes.json.killCycle as Record<string, number | string | null>;
    const killDelta = Math.abs((kcForged.totalKills as number) - (kcHonest.totalKills as number));
    expect(killDelta).toBeLessThanOrEqual(1);
    expect(Math.abs((kcForged.monstersKilledCount as number) - (kcHonest.monstersKilledCount as number))).toBeLessThanOrEqual(1);
    // The kill cycle is a fixed rotation over the area roster, so a
    // ±1 kill divergence moves each state field by at most one
    // rotation step (wrapping). Anything further means the runs
    // diverged structurally — e.g. forged DPS killing deeper into
    // the rotation.
    const rotation = getRoamingArea('dustwaste_frontier').monsterIds ?? [];
    const rotationDistance = (a: string | null, b: string | null) => {
      const ia = rotation.indexOf(a as string);
      const ib = rotation.indexOf(b as string);
      if (ia === -1 || ib === -1) return Number.POSITIVE_INFINITY;
      const d = Math.abs(ia - ib);
      return Math.min(d, rotation.length - d);
    };
    expect(rotationDistance(kcForged.currentTargetId as string | null, kcHonest.currentTargetId as string | null)).toBeLessThanOrEqual(1);
    expect(rotationDistance(kcForged.lastKilledMonsterId as string | null, kcHonest.lastKilledMonsterId as string | null)).toBeLessThanOrEqual(1);
    // Survival: same unseeded-variance caveat for the hit rolls, so
    // damage taken is compared within a variance band. The band was
    // recalibrated in the overhaul slice: measured on UNMODIFIED
    // master, identical claims spread damage-taken across ~55–96
    // (kill timing shifts how many hits land), and the old 0.35 band
    // failed ~half of master runs — a pre-existing flake, verified by
    // running this file against pristine master 8× (4 failures). The
    // forged god shield's 80% mitigation, had it leaked, would cut
    // damage taken by ~80% (Δ ≈ 60 at these levels) — still far
    // outside the recalibrated band.
    const survHonest = honestRes.json.survival as { currentHp: number; isDead: boolean };
    const survForged = forgedRes.json.survival as { currentHp: number; isDead: boolean };
    expect(survForged.isDead).toBe(survHonest.isDead);
    const takenHonest = ALIVE.currentHp - survHonest.currentHp;
    const takenForged = ALIVE.currentHp - survForged.currentHp;
    expect(takenHonest).toBeGreaterThan(0);
    expect(Math.abs(takenForged - takenHonest)).toBeLessThanOrEqual(takenHonest * 0.6 + 2);
    expect((forgedRes.json.items as unknown[]).length).toBe((honestRes.json.items as unknown[]).length);
    expect(forged.store.profiles.get(A)!.credits).toBe(honest.store.profiles.get(A)!.credits);
    expect(forged.store.profiles.get(A)!.scrap).toBe(honest.store.profiles.get(A)!.scrap);
    expect(forged.store.profiles.get(A)!.player_xp).toBe(honest.store.profiles.get(A)!.player_xp);
    // Sanity: the honest claim itself paid real baseline rewards.
    expect((honestRes.json.rewards as { creditsAwarded: number }).creditsAwarded).toBeGreaterThan(0);
  });

  it('fresh guest: the first claim runs from server records alone (bootstrap Starter Pistol row, no gear in body)', async () => {
    const withRow = await makeServer();
    const bare = await makeServer();
    seedClaimPlayer(withRow.store, true);
    seedClaimPlayer(bare.store, false);

    const body = {
      playerId: A, areaId: 'dustwaste_frontier', ticks: 20, tickCount: 20, playerLevel: 10,
      survival: ALIVE,
    };
    const resRow = await post(withRow.base, '/api/claim', body, withRow.tokenA);
    const resBare = await post(bare.base, '/api/claim', body, bare.tokenA);

    expect(resRow.status).toBe(200);
    expect(resBare.status).toBe(200);
    // The sparse bootstrap payload is engine-inert (the client adapter
    // hides it from the loadout for the same reason), so the guest
    // pays the weaponless starter baseline — and pays it successfully,
    // from records alone, with no gear anywhere in the request.
    expect(resRow.json.rewards).toEqual(resBare.json.rewards);
    expect((resRow.json.rewards as { creditsAwarded: number }).creditsAwarded).toBeGreaterThan(0);
    expect(withRow.store.profiles.get(A)!.last_claimed_tick).toBe(20);
  });
});

describe('trust hardening — boss attempts (POST /api/verify-boss)', () => {
  const boss = REGION_1_BOSSES.find((b) => b.id === 'dune_tyrant')!;

  function routeRequest(overrides: Partial<BossAttemptRequest>): BossAttemptRequest {
    return {
      playerId: A,
      bossId: boss.id,
      attemptNonce: 1,
      primary: null,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      playerLevel: 5,
      skillBonuses: {},
      pityCount: 0,
      playerCredits: 10000,
      entryFee: boss.entryCost,
      ...overrides,
    };
  }

  it('fabricated gear + skills in the body do not change the outcome: the sim runs the server-derived (empty) loadout', async () => {
    // Find a nonce with maximum discrimination: the server-derived
    // (empty) loadout LOSES, while the forged god loadout WINS with
    // the same seed — if the body leaked, the response would show
    // the forged victory and its deltas.
    let nonce = -1;
    let expected: BossAttemptChefResult | null = null;
    for (let n = 1; n <= 2000; n++) {
      const honestOutcome = processBossAttempt(routeRequest({ attemptNonce: n }));
      if (honestOutcome.result.victory) continue;
      const forgedOutcome = processBossAttempt(
        routeRequest({ attemptNonce: n, primary: godWeapon(), skillBonuses: FORGED_SKILLS }),
      );
      if (forgedOutcome.result.victory) {
        nonce = n;
        expected = honestOutcome;
        break;
      }
    }
    expect(nonce).toBeGreaterThan(0);
    expect(expected).not.toBeNull();

    // Spy at the store seam: prove the route consulted server records
    // for the loadout instead of the body.
    class SpyStore extends InMemoryChefGameplayStore {
      equippedItemsCalls: string[] = [];
      override async getEquippedItems(playerId: string) {
        this.equippedItemsCalls.push(playerId);
        return super.getEquippedItems(playerId);
      }
    }
    const { base, store, tokenA } = await makeServer(new SpyStore());
    store.seedProfile({
      id: A,
      player_level: 5,
      credits: 10000,
      consumables: {},
      boss_state: { unlockedBossIds: ['dune_tyrant'], defeatedBossIds: [], pityCounters: {} },
    });

    const res = await post(base, '/api/verify-boss', {
      playerId: A,
      bossId: boss.id,
      attemptNonce: nonce,
      primary: godWeapon(),
      secondary: godWeapon(),
      heavy: godWeapon(),
      skillBonuses: FORGED_SKILLS,
      playerLevel: 99, // lie — server level wins (already true pre-slice)
      playerCredits: 999999999, // lie — the death fee is a % of this if trusted
      pityCount: 99, // lie — server pity wins (already true pre-slice)
      consumables: {},
      risk: RiskSetting.Balanced,
    }, tokenA);

    expect(res.status).toBe(200);
    expect((store as SpyStore).equippedItemsCalls).toContain(A);
    // The outcome is the SERVER-DERIVED one: defeat, with its exact
    // deltas — not the forged victory.
    expect(res.json.victory).toBe(false);
    expect(res.json.creditsDelta).toBe(expected!.creditsDelta);
    expect(res.json.xpAwarded).toBe(expected!.xpAwarded);
    expect((res.json.telemetry as { effectiveDps: number }).effectiveDps).toBe(expected!.telemetry.effectiveDps);
    const profile = store.profiles.get(A)!;
    expect(profile.credits).toBe(10000 + expected!.creditsDelta);
    const bossState = profile.boss_state as { pityCounters: Record<string, number> };
    expect(bossState.pityCounters.dune_tyrant).toBe(1);
  });

  it('honest attempt: gear owned in server records (and nothing in the body) produces the precomputed outcome', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({
      id: A,
      player_level: 50,
      credits: 10000,
      consumables: {},
      boss_state: { unlockedBossIds: ['dune_tyrant'], defeatedBossIds: [], pityCounters: {} },
    });
    // A strong weapon the player genuinely owns, equipped in records.
    const strong: Weapon = {
      ...honestWeapon(),
      id: 'owned-strong-gun',
      baseDamage: 10000,
      attackSpeed: 10,
      critChance: 0.5,
      critDamage: 2,
      bossDamageMod: 2,
      shieldDamageMod: 1,
      armorDamageMod: 1,
    };
    store.seedItem({
      id: `equipped-${strong.id}`,
      owner_user_id: A,
      kind: 'weapon',
      runtime_state: 'equipped',
      equipped_slot: 'primary',
      payload: strong as unknown as Record<string, unknown>,
    });

    // The exact request the route must build from records.
    let expected: BossAttemptChefResult | null = null;
    let nonce = -1;
    for (let n = 1; n <= 2000; n++) {
      const outcome = processBossAttempt(routeRequest({ attemptNonce: n, primary: strong, playerLevel: 50 }));
      if (outcome.result.victory) {
        nonce = n;
        expected = outcome;
        break;
      }
    }
    expect(nonce).toBeGreaterThan(0);

    // The body carries NO gear at all — intent only.
    const res = await post(base, '/api/verify-boss', {
      playerId: A,
      bossId: boss.id,
      attemptNonce: nonce,
      consumables: {},
      risk: RiskSetting.Balanced,
    }, tokenA);

    expect(res.status).toBe(200);
    expect(res.json.victory).toBe(true);
    expect(res.json.creditsDelta).toBe(expected!.creditsDelta);
    expect(res.json.xpAwarded).toBe(expected!.xpAwarded);
    expect(store.profiles.get(A)!.credits).toBe(10000 + expected!.creditsDelta);
    expect((res.json.items as unknown[]).length).toBeGreaterThan(0);
  });

  it('the sparse bootstrap Starter Pistol is not a sim weapon: a guest attempt resolves on the empty slot, like the honest client', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({
      id: A,
      player_level: 5,
      credits: 10000,
      consumables: {},
      boss_state: { unlockedBossIds: ['dune_tyrant'], defeatedBossIds: [], pityCounters: {} },
    });
    store.seedItem({
      id: 'starter-row',
      owner_user_id: A,
      kind: 'weapon',
      runtime_state: 'equipped',
      equipped_slot: 'primary',
      payload: { ...STARTER_PISTOL_PAYLOAD },
    });

    // Expected: the route-built request with primary null (the
    // adapter-hidden starter never reaches the honest client's sim
    // either). Any nonce works — telemetry DPS pins the input.
    const expected = processBossAttempt(routeRequest({ attemptNonce: 42 }));
    const res = await post(base, '/api/verify-boss', {
      playerId: A,
      bossId: boss.id,
      attemptNonce: 42,
      consumables: {},
      risk: RiskSetting.Balanced,
    }, tokenA);

    expect(res.status).toBe(200);
    expect(res.json.victory).toBe(expected.result.victory);
    expect(res.json.creditsDelta).toBe(expected.creditsDelta);
    expect((res.json.telemetry as { effectiveDps: number }).effectiveDps).toBe(expected.telemetry.effectiveDps);
    expect(Number.isFinite((res.json.telemetry as { effectiveDps: number }).effectiveDps)).toBe(true);
  });
});
