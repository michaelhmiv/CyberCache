/**
 * Endless mode (0028) — the Chaos Chamber.
 *
 * Layers, all through shipped paths:
 *  1. Content rules (src/content/endless.ts): rotation, escalation,
 *     escrow curves, fee schedule, milestone shaping, and the INTEL
 *     LAW key-walk (no readiness figure at any payload depth — the
 *     #218 pattern).
 *  2. Engine sims (processEndlessEncounter): depth is BOUNDED at
 *     several player levels (escalation always wins eventually) and
 *     a level-appropriate build reaches a reasonable early depth.
 *  3. Shipped-path HTTP (express + InMemoryChefGameplayStore): slot
 *     exclusivity, escrow integrity against forged bodies, death /
 *     bank settlement math incl. the fraction, best-depth records,
 *     nonce replays, and the contained-death ruling (an endless
 *     death NEVER writes the roaming death record).
 *  4. Economy twin: the daily endless meters move, in lockstep with
 *     cc_compute_economy_metrics' attribution rules (0028).
 *  5. SQL parity pins: the migration's lever reads and the TS
 *     defaults can never drift apart silently.
 *
 * Encounter outcomes are deterministic: the route derives its engine
 * request from server records, so the tests precompute the exact
 * outcome with the engine itself (the bossLoopShippedPath pattern)
 * and assert the HTTP layer lands it faithfully.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { GearItem, Weapon } from '@/types/items';
import {
  ENDLESS_BOSS_EVERY,
  endlessEncounterForDepth,
  endlessEntryFeeFor,
  endlessIntel,
  endlessMilestoneLegendaryShare,
  endlessRewardsForDepth,
  parBossForLevel,
} from '@/content/endless';
import { processEndlessEncounter, type EndlessEncounterChefResult, type EndlessEncounterRequest } from '../server/chef';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { bossSlotsFromEquipped, skillBonusesFromRecords } from '../server/gameplay/serverLoadout';
import { issueAccessToken } from '../server/auth/tokens';
import { createTickRng } from '@/lib/rng/tickRng';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { generateShield } from '../server/lib/generators/shieldGenerator';
import { generateClassMod } from '../server/lib/generators/classModGenerator';
import { generateOrdnance } from '../server/lib/generators/ordnanceGenerator';
import { generateRelic } from '../server/lib/generators/relicGenerator';
import { InMemoryEconomyStore } from '../server/economy/memory';
import { ECONOMY_CONFIG_DEFAULTS, validateEconomyConfigValue } from '../server/economy/config';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const BANNED_INTEL_KEY = /win|chance|readiness|odds|probabilit|success.?rate/i;

function walkKeys(value: unknown, path: string[], hits: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, i) => walkKeys(entry, [...path, String(i)], hits));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (BANNED_INTEL_KEY.test(key)) hits.push([...path, key].join('.'));
      walkKeys(entry, [...path, key], hits);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Content rules
// ---------------------------------------------------------------------------

describe('endless content rules', () => {
  it('rotates packs through all 7 areas and boss kits through all 13 bosses', () => {
    const packAreas: string[] = [];
    const bossIds: string[] = [];
    for (let d = 1; d <= 91; d++) {
      const enc = endlessEncounterForDepth(d, 20);
      if (d % ENDLESS_BOSS_EVERY === 0) {
        expect(enc.kind).toBe('boss');
        bossIds.push(enc.id);
      } else {
        expect(enc.kind).toBe('pack');
        expect(enc.areaId).toBe(ROAMING_AREAS[(d - 1) % ROAMING_AREAS.length].id);
        if (d <= 15) packAreas.push(enc.areaId);
      }
      expect(enc.level).toBe(20 + d - 1);
    }
    expect(new Set(packAreas).size).toBe(7);
    expect(bossIds.slice(0, 13)).toEqual(REGION_1_BOSSES.map((b) => b.id));
    expect(bossIds[13]).toBe(REGION_1_BOSSES[0].id); // rotation wraps
  });

  it('escalates monotonically: depth 1 pack prices at 35% of the par kit, pools compound', () => {
    const par = parBossForLevel(20);
    const d1 = endlessEncounterForDepth(1, 20);
    expect(d1.health).toBe(Math.round(par.health * 0.35));
    let prev = d1;
    for (let d = 2; d <= 40; d++) {
      const enc = endlessEncounterForDepth(d, 20);
      if (enc.kind === 'pack' && prev.kind === 'pack') {
        // Pack-to-pack, the compounding curve is strictly monotone.
        expect(enc.health).toBeGreaterThan(prev.health);
        expect(enc.dps).toBeGreaterThanOrEqual(prev.dps);
      }
      if (enc.kind === 'boss') {
        // A boss depth spikes above the pack before it (full kit vs 55%).
        expect(enc.health).toBeGreaterThan(prev.health);
      }
      prev = enc;
    }
    // Compounding is the lever curve: HP at depth 11 = base × 1.12^10 (boss kit at depth 10 aside).
    const d11 = endlessEncounterForDepth(11, 20);
    const expected = Math.round(par.health * 0.35 * Math.pow(1.12, 10));
    expect(Math.abs(d11.health - expected)).toBeLessThanOrEqual(1);
  });

  it('boss depths floor the rotated kit at the par kit — always a spike over the packs', () => {
    const par = parBossForLevel(20);
    const d4 = endlessEncounterForDepth(4, 20);
    const d5 = endlessEncounterForDepth(5, 20);
    expect(d5.kind).toBe('boss');
    expect(d5.id).toBe(REGION_1_BOSSES[0].id); // rotation starts at the first kit
    // Dune Tyrant's own health is far below the L20 par kit; the floor
    // prices the depth off the par kit so the spike is real.
    expect(d5.health).toBe(Math.round(Math.max(REGION_1_BOSSES[0].health, par.health) * Math.pow(1.12, 4)));
    expect(d5.health).toBeGreaterThan(d4.health);
  });

  it('par boss is the highest-level shipped boss at or below the anchor', () => {
    expect(parBossForLevel(1).id).toBe('dune_tyrant');
    expect(parBossForLevel(30).level).toBeLessThanOrEqual(30);
    const levels = REGION_1_BOSSES.map((b) => b.level);
    expect(parBossForLevel(1000).level).toBe(Math.max(...levels));
  });

  it('escrow rewards follow the documented curves', () => {
    expect(endlessRewardsForDepth(1, 20)).toEqual({ xp: 120, credits: 440, scrap: 10 });
    // +4%/depth compounding on the per-level rates.
    expect(endlessRewardsForDepth(11, 30)).toEqual({
      xp: Math.round(30 * 6 * 1.4),
      credits: Math.round(30 * 22 * 1.4),
      scrap: Math.round(30 * 0.5 * 1.4),
    });
    // Boss comparison anchor: a boss victory pays level × 50 XP — an
    // endless encounter pays level × 6, so endless never dominates.
    expect(endlessRewardsForDepth(1, 50).xp).toBeLessThan(50 * 50);
  });

  it('entry fee doubles per run started today, capped at ×8', () => {
    expect(endlessEntryFeeFor(20, 0)).toEqual({ fee: 200, baseFee: 200, multiplier: 1 });
    expect(endlessEntryFeeFor(20, 1).multiplier).toBe(2);
    expect(endlessEntryFeeFor(20, 2).multiplier).toBe(4);
    expect(endlessEntryFeeFor(20, 3).multiplier).toBe(8);
    expect(endlessEntryFeeFor(20, 12).multiplier).toBe(8);
    expect(endlessEntryFeeFor(20, 12).fee).toBe(1600);
  });

  it('milestone legendary share grows with depth but stays under the boss dedicated rate', () => {
    const s5 = endlessMilestoneLegendaryShare(5);
    const s25 = endlessMilestoneLegendaryShare(25);
    const s50 = endlessMilestoneLegendaryShare(50);
    expect(s5).toBeGreaterThan(0.01);
    expect(s5).toBeLessThan(0.02);
    expect(s25).toBeGreaterThan(s5);
    expect(s50).toBeGreaterThan(s25);
    expect(s50).toBeLessThan(0.1); // bosses' dedicated-drop rate (tuning #208)
  });

  it('INTEL LAW: the prep payload carries no readiness figure at any depth', () => {
    for (const level of [1, 20, 57, 100]) {
      const hits: string[] = [];
      walkKeys(endlessIntel(level, 2), [], hits);
      expect(hits).toEqual([]);
    }
    const intel = endlessIntel(20, 0);
    expect(intel.firstEncounter.name).toBeTruthy();
    expect(intel.deathRule.roamingDeathRecord).toBe(false);
    expect(intel.deathRule.payoutPercentOnDeath).toBe(50);
    expect(intel.entry.feeCredits).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 2. Engine boundedness sims
// ---------------------------------------------------------------------------

/** A full seven-slot level-appropriate build — what "level-appropriate" means in this game. */
interface SimLoadout {
  primary: Weapon;
  secondary: Weapon;
  heavy: Weapon;
  ordnance: ReturnType<typeof generateOrdnance>;
  shield: ReturnType<typeof generateShield>;
  classMod: ReturnType<typeof generateClassMod>;
  relic: ReturnType<typeof generateRelic>;
}

function levelAppropriateLoadout(level: number, seed: number, rarity: Rarity): SimLoadout {
  const rng = createTickRng('endless-sim', 'loadout', seed);
  return {
    primary: generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng),
    secondary: generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng),
    heavy: generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng),
    ordnance: generateOrdnance(level, rng, { [rarity]: 1 }),
    shield: generateShield(level, rng, { [rarity]: 1 }),
    classMod: generateClassMod(level, rng, { [rarity]: 1 }),
    relic: generateRelic(level, rng, { [rarity]: 1 }),
  };
}

function simulateRun(level: number, loadout: SimLoadout, runId: string): { depth: number; victories: number } {
  let depth = 0;
  for (let d = 1; d <= 250; d++) {
    const outcome = processEndlessEncounter({
      playerId: A,
      runId,
      startLevel: level,
      depth: d,
      primary: loadout.primary,
      secondary: loadout.secondary,
      heavy: loadout.heavy,
      ordnance: loadout.ordnance,
      shield: loadout.shield,
      classMod: loadout.classMod,
      relic: loadout.relic,
      consumables: {},
      risk: RiskSetting.Balanced,
      playerLevel: level,
      skillBonuses: {},
      pityCount: 0,
      playerCredits: 100000,
    });
    if (!outcome.result.victory) return { depth, victories: depth };
    depth = d;
  }
  return { depth, victories: depth };
}

describe('endless engine boundedness', () => {
  it('every run terminates: escalation kills any level-appropriate build', () => {
    for (const level of [10, 30, 60, 100]) {
      const depths: number[] = [];
      for (let seed = 1; seed <= 5; seed++) {
        const loadout = levelAppropriateLoadout(level, level * 1000 + seed, Rarity.Epic);
        const run = simulateRun(level, loadout, `sim-${level}-${seed}`);
        depths.push(run.depth);
        // Terminated by defeat, never by the 250 anti-pathology cap.
        expect(run.depth).toBeLessThan(250);
      }
      // A level-appropriate build reaches a reasonable early depth:
      // the first milestone (depth 5) is a normal outcome, not a fluke.
      const median = [...depths].sort((a, b) => a - b)[2];
      expect(median, `level ${level} depths ${depths}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('a stronger build descends strictly deeper than a weak one at the same level', () => {
    const strong: number[] = [];
    const weak: number[] = [];
    for (let seed = 1; seed <= 5; seed++) {
      strong.push(simulateRun(40, levelAppropriateLoadout(40, 40000 + seed, Rarity.Legendary), `sim-strong-${seed}`).depth);
      weak.push(simulateRun(40, levelAppropriateLoadout(40, 40000 + seed, Rarity.Common), `sim-weak-${seed}`).depth);
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[2];
    expect(median(strong)).toBeGreaterThan(median(weak));
  });

  it('victory escrow deltas equal the content curves for a plain build', () => {
    // Find a run whose depth-1 encounter is a victory, then pin the
    // escrow deltas to the documented reward function exactly.
    let found: EndlessEncounterChefResult | null = null;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const loadout = levelAppropriateLoadout(30, 30000 + seed, Rarity.Epic);
      const outcome = processEndlessEncounter({
        playerId: A,
        runId: `sim-rewards-${seed}`,
        startLevel: 30,
        depth: 1,
        primary: loadout.primary,
        secondary: loadout.secondary,
        heavy: loadout.heavy,
        ordnance: loadout.ordnance,
        shield: loadout.shield,
        classMod: loadout.classMod,
        relic: loadout.relic,
        consumables: {},
        risk: RiskSetting.Balanced,
        playerLevel: 30,
        skillBonuses: {},
        pityCount: 0,
        playerCredits: 100000,
      });
      if (outcome.result.victory) found = outcome;
    }
    expect(found).not.toBeNull();
    const expected = endlessRewardsForDepth(1, 30);
    // XP may carry the build's own xpBoostMod affixes (the boss-path
    // rule); credits/scrap are the raw curve for a non-legendary primary.
    expect(found!.rewards.credits).toBe(expected.credits);
    expect(found!.rewards.scrap).toBe(expected.scrap);
    expect(found!.rewards.xp).toBeGreaterThanOrEqual(expected.xp);
    expect(found!.milestone).toBe(false);
    expect(found!.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Shipped-path HTTP
// ---------------------------------------------------------------------------

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

type Json = Record<string, unknown>;

async function post(base: string, path: string, body: unknown, token?: string): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function get(base: string, path: string, token?: string): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${base}${path}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function strongWeapon(id = 'server-owned-endless-gun'): Weapon {
  return {
    id,
    name: 'Server Owned Endless Gun',
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
  } as Weapon;
}

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

/** The exact engine request the route builds for the run's next depth. */
async function precomputeNext(
  store: InMemoryChefGameplayStore,
  run: { id: string; start_level: number; prepared_consumables: Record<string, number>; risk: string; depth_reached: number },
  profile: { player_level: number; credits: number; skill_spends: unknown },
): Promise<EndlessEncounterChefResult> {
  const equipped = await store.getEquippedItems(A);
  const slots = bossSlotsFromEquipped(equipped);
  const skillBonuses = skillBonusesFromRecords(
    equipped.map((e) => e.item),
    (profile.skill_spends ?? {}) as Record<string, number>,
  );
  const request: EndlessEncounterRequest = {
    playerId: A,
    runId: run.id,
    startLevel: run.start_level,
    depth: run.depth_reached + 1,
    playerLevel: profile.player_level,
    playerCredits: profile.credits,
    consumables: run.prepared_consumables,
    risk: run.risk as RiskSetting,
    pityCount: 0,
    ...slots,
    skillBonuses,
  };
  return processEndlessEncounter(request);
}

/** The engine outcome for an explicit depth of a run (route-identical inputs, pure). */
async function engineAtDepth(
  store: InMemoryChefGameplayStore,
  run: { id: string; start_level: number; prepared_consumables: Record<string, number>; risk: string },
  depth: number,
): Promise<EndlessEncounterChefResult> {
  const profile = store.profiles.get(A)!;
  const equipped = await store.getEquippedItems(A);
  const slots = bossSlotsFromEquipped(equipped);
  const skillBonuses = skillBonusesFromRecords(
    equipped.map((e) => e.item),
    (profile.skill_spends ?? {}) as Record<string, number>,
  );
  return processEndlessEncounter({
    playerId: A,
    runId: run.id,
    startLevel: run.start_level,
    depth,
    playerLevel: profile.player_level,
    playerCredits: profile.credits,
    consumables: run.prepared_consumables,
    risk: run.risk as RiskSetting,
    pityCount: 0,
    ...slots,
    skillBonuses,
  });
}

interface WinningRunStart {
  /** The winning start's response body (run, entryFee, runsStartedToday). */
  json: Json;
  /** How many starts the search made, the winning start included. */
  attempts: number;
  /** Sum of the entry fees those starts charged, from their responses. */
  totalFees: number;
}

/**
 * Start runs until one whose first `wins` depths are precomputed
 * victories (run ids are random, so outcomes vary per run; precompute
 * ≡ route is proven by the advance test, so the chosen run's path is
 * guaranteed).
 *
 * The candidate starts are REAL starts, not free probes: each one
 * charges its (escalating) entry fee, bumps the per-day start
 * counter, and is abandoned by the next start (settling its escrow —
 * always 0, candidates never fight — at the death fraction). Tests
 * must therefore derive every fee / balance / run-row expectation
 * from this accounting or from live read-backs, never from
 * first-start assumptions: how many candidates a search burns is
 * run-id luck. (This coupling flaked three shipped-path tests —
 * advance's hardcoded post-fee balance, encounter replay's
 * endlessRuns[0], re-entry's abandoned count — whenever a search
 * needed a second candidate.)
 */
async function startWinningRun(h: Harness, wins: number): Promise<WinningRunStart> {
  let totalFees = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    const started = await startRun(h);
    expect(started.status).toBe(200);
    totalFees += started.json.entryFee as number;
    const run = started.json.run as { id: string; start_level: number; prepared_consumables: Record<string, number>; risk: string };
    let ok = true;
    for (let d = 1; d <= wins; d++) {
      const out = await engineAtDepth(h.store, run, d);
      if (!out.result.victory) {
        ok = false;
        break;
      }
    }
    if (ok) return { json: started.json, attempts: attempt + 1, totalFees };
  }
  throw new Error(`no run with ${wins} opening victories found`);
}

let nonceCounter = 0;
const nextNonce = (kind: string) => `endless-test-${kind}-${++nonceCounter}-${Date.now()}`;

async function startRun(h: Harness, body: Record<string, unknown> = {}): Promise<{ status: number; json: Json }> {
  return post(h.base, '/api/endless/start', { nonce: nextNonce('start'), consumables: {}, risk: 'Balanced', ...body }, h.tokenA);
}

describe('endless shipped path (HTTP)', () => {
  it('start: charges the fee, burns the belt once, takes the action slot', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 20, credits: 10000, consumables: { MedKit: 5, ShieldCell: 2 } });
    const res = await startRun(h, { consumables: { MedKit: 2 } });
    expect(res.status).toBe(200);
    expect(res.json.verified).toBe(true);
    expect(res.json.entryFee).toBe(200); // 10/level × 20, first run today
    expect(res.json.runsStartedToday).toBe(1);
    const run = res.json.run as { id: string; status: string; start_level: number; escrow_credits: number };
    expect(run.status).toBe('active');
    expect(run.start_level).toBe(20);
    expect(run.escrow_credits).toBe(0);

    const profile = h.store.profiles.get(A)!;
    expect(profile.credits).toBe(9800);
    expect(profile.consumables).toEqual({ MedKit: 3, ShieldCell: 2 });
    const action = await h.store.getActiveAction(A);
    expect(action?.active_action).toBe('endless_run');
    expect(action?.target_id).toBe(run.id);
  });

  it('start replay: the same nonce never double-charges or double-burns', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 20, credits: 10000, consumables: { MedKit: 5 } });
    const nonce = nextNonce('start');
    const first = await post(h.base, '/api/endless/start', { nonce, consumables: { MedKit: 1 }, risk: 'Balanced' }, h.tokenA);
    const replay = await post(h.base, '/api/endless/start', { nonce, consumables: { MedKit: 1 }, risk: 'Balanced' }, h.tokenA);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.json.idempotentReplay).toBe(true);
    const profile = h.store.profiles.get(A)!;
    expect(profile.credits).toBe(9800);
    expect(profile.consumables).toEqual({ MedKit: 4 });
    expect(h.store.endlessRuns.filter((r) => r.user_id === A)).toHaveLength(1);
  });

  it('start gates: dead hunters and empty wallets are refused', async () => {
    const h = await makeServer();
    h.store.seedProfile({
      id: A,
      player_level: 20,
      credits: 10000,
      death_state: { diedAtMs: Date.now(), areaId: 'dustwaste_frontier', monsterId: 'm1', monsterName: 'Test Mob' },
    });
    const dead = await startRun(h);
    expect(dead.status).toBe(409);

    const h2 = await makeServer();
    h2.store.seedProfile({ id: A, player_level: 20, credits: 50 });
    const broke = await startRun(h2);
    expect(broke.status).toBe(400);
    expect(h2.store.endlessRuns).toHaveLength(0);
  });

  it('auth: identity comes from the JWT — no token 401, mismatched body playerId 403', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 10, credits: 10000 });
    h.store.seedProfile({ id: B, player_level: 10, credits: 10000 });
    const noToken = await post(h.base, '/api/endless/start', { nonce: nextNonce('start') }, undefined);
    expect(noToken.status).toBe(401);
    const mismatch = await post(
      h.base,
      '/api/endless/start',
      { nonce: nextNonce('start'), playerId: B },
      h.tokenA,
    );
    expect(mismatch.status).toBe(403);
  });

  it('advance: escrow accrues server-side, profile is NOT paid mid-run, forged body fields are ignored', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 20, credits: 10000, consumables: {} });
    seedStrongWeapon(h.store);
    const start = await startWinningRun(h, 1);
    const run = start.json.run as { id: string; start_level: number; prepared_consumables: Record<string, number>; risk: string; depth_reached: number };
    const profileRow = h.store.profiles.get(A)!;
    const expected = await precomputeNext(h.store, run, profileRow);
    expect(expected.result.victory).toBe(true); // the seeded gun clears depth 1

    const res = await post(
      h.base,
      '/api/endless/encounter',
      {
        nonce: nextNonce('encounter'),
        // Adversarial dressing: none of this is read by the route.
        depth: 99,
        rewards: { xp: 999999, credits: 999999, scrap: 999999 },
        escrow: { credits: 999999 },
        runId: 'forged-run-id',
        playerId: A,
      },
      h.tokenA,
    );
    expect(res.status).toBe(200);
    expect(res.json.victory).toBe(true);
    expect((res.json.result as { depth: number }).depth).toBe(1);
    expect(res.json.rewards).toEqual(expected.rewards);
    expect(res.json.escrow).toEqual({
      credits: expected.rewards.credits,
      xp: expected.rewards.xp,
      scrap: expected.rewards.scrap,
    });
    // Escrow is not income yet: the profile still holds only the
    // post-fee balance — the seed minus EVERY fee the run search
    // charged (candidate starts settle at escrow 0, so nothing came
    // back). Deriving from the search accounting keeps this exact
    // however many candidates the search burned.
    expect(h.store.profiles.get(A)!.credits).toBe(10000 - start.totalFees);
    const storedRun = h.store.endlessRuns.find((r) => r.id === run.id)!;
    expect(storedRun.depth_reached).toBe(1);
    expect(storedRun.status).toBe('active');
  });

  it('encounter replay: the same nonce resolves once — no double escrow, no duplicate milestone', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 20, credits: 10000, consumables: {} });
    seedStrongWeapon(h.store);
    const start = await startWinningRun(h, 1);
    const winningRunId = (start.json.run as { id: string }).id;
    const nonce = nextNonce('encounter');
    const first = await post(h.base, '/api/endless/encounter', { nonce }, h.tokenA);
    const replay = await post(h.base, '/api/endless/encounter', { nonce }, h.tokenA);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.json.idempotentReplay).toBe(true);
    expect(replay.json.items).toEqual([]);
    // The winning run by id — endlessRuns[0] is a burned search
    // candidate whenever the search needed more than one start.
    const run = h.store.endlessRuns.find((r) => r.id === winningRunId)!;
    expect(run.depth_reached).toBe(1);
    expect(run.escrow_credits).toBe((first.json.rewards as { credits: number }).credits);
  });

  it('slot exclusivity: encounters refuse while another action holds the slot; banking always works', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 20, credits: 10000, consumables: {} });
    seedStrongWeapon(h.store);
    const started = await startRun(h);
    const run = started.json.run as { id: string };

    // The player switches to roaming mid-run (the slot machinery
    // allows the switch — the Chamber pauses, per the occupations law).
    h.store.seedActiveAction({
      user_id: A,
      active_action: 'roaming_loot',
      target_id: 'dustwaste_frontier',
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      activity_payload: {},
    });
    const blocked = await post(h.base, '/api/endless/encounter', { nonce: nextNonce('encounter') }, h.tokenA);
    expect(blocked.status).toBe(409);

    // Banking is the exit that always works — it ends the run.
    const banked = await post(h.base, '/api/endless/bank', { nonce: nextNonce('bank') }, h.tokenA);
    expect(banked.status).toBe(200);
    expect(banked.json.ended).toBe(true);
    expect(h.store.endlessRuns[0].status).toBe('banked');
    expect((run as unknown as { id: string }).id).toBe(h.store.endlessRuns[0].id);
  });

  it('bank: pays the full escrow, releases the slot, records best depth; replay pays once', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 20, credits: 10000, consumables: {} });
    seedStrongWeapon(h.store);
    const start = await startWinningRun(h, 2);
    const run = start.json.run as { id: string; start_level: number; prepared_consumables: Record<string, number>; risk: string; depth_reached: number };

    // Clear two depths (precomputed victories with the seeded gun).
    let escrow = { xp: 0, credits: 0, scrap: 0 };
    for (let i = 0; i < 2; i++) {
      const liveRun = h.store.endlessRuns.find((r) => r.id === run.id)!;
      const expected = await precomputeNext(h.store, liveRun, h.store.profiles.get(A)!);
      expect(expected.result.victory).toBe(true);
      const res = await post(h.base, '/api/endless/encounter', { nonce: nextNonce('encounter') }, h.tokenA);
      expect(res.status).toBe(200);
      escrow = res.json.escrow as typeof escrow;
    }
    expect(escrow.credits).toBeGreaterThan(0);

    const bankNonce = nextNonce('bank');
    const beforeRow = h.store.profiles.get(A)!;
    const before = { credits: beforeRow.credits, scrap: beforeRow.scrap, xp: beforeRow.player_xp, level: beforeRow.player_level };
    const banked = await post(h.base, '/api/endless/bank', { nonce: bankNonce }, h.tokenA);
    expect(banked.status).toBe(200);
    expect(banked.json.payout).toEqual({ ...escrow, fraction: 1 });
    const after = h.store.profiles.get(A)!;
    expect(after.credits).toBe(before.credits + escrow.credits);
    expect(after.scrap).toBe(before.scrap + escrow.scrap);
    // XP landed through the shared applyXp path (level/xp moved or banked).
    expect(after.player_xp + (after.player_level - before.level) * 100000).toBeGreaterThanOrEqual(before.xp + escrow.xp);
    const action = await h.store.getActiveAction(A);
    expect(action?.active_action).toBe('idle_standby');

    const replay = await post(h.base, '/api/endless/bank', { nonce: bankNonce }, h.tokenA);
    expect(replay.status).toBe(200);
    expect(replay.json.idempotentReplay).toBe(true);
    expect(h.store.profiles.get(A)!.credits).toBe(after.credits);

    const me = await get(h.base, '/api/endless/me', h.tokenA);
    expect(me.status).toBe(200);
    expect(me.json.bestDepth).toBe(2);
    expect(me.json.activeRun).toBeNull();
    // Run-search candidates may add abandoned depth-0 rows; exactly
    // one BANKED run exists and it is this run at depth 2.
    const recent = me.json.recentRuns as Array<{ id: string; status: string; depth_reached: number }>;
    const bankedRuns = recent.filter((r) => r.status === 'banked');
    expect(bankedRuns).toHaveLength(1);
    expect(bankedRuns[0].id).toBe(run.id);
    expect(bankedRuns[0].depth_reached).toBe(2);
  });

  it('death: pays the escrow at the 50% lever fraction, writes NO roaming death record, releases the slot', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 20, credits: 10000, consumables: {} });
    seedStrongWeapon(h.store);
    const start = await startWinningRun(h, 2);
    const runId = (start.json.run as { id: string }).id;

    // Advance while the precomputed outcome is a victory; stop at
    // the first precomputed defeat and send exactly that encounter.
    let escrowBeforeDeath = { xp: 0, credits: 0, scrap: 0 };
    let deathDepth = 0;
    for (let guard = 0; guard < 60; guard++) {
      const liveRun = h.store.endlessRuns.find((r) => r.id === runId)!;
      const attemptedDepth = liveRun.depth_reached + 1; // capture pre-post: the row is live
      const expected = await precomputeNext(h.store, liveRun, h.store.profiles.get(A)!);
      const res = await post(h.base, '/api/endless/encounter', { nonce: nextNonce('encounter') }, h.tokenA);
      expect(res.status).toBe(200);
      if (!expected.result.victory) {
        expect(res.json.victory).toBe(false);
        expect(res.json.runStatus).toBe('died');
        deathDepth = attemptedDepth;
        const payout = res.json.payout as { credits: number; xp: number; scrap: number; fraction: number };
        expect(payout.fraction).toBe(0.5);
        expect(payout.credits).toBe(Math.floor(escrowBeforeDeath.credits * 0.5));
        expect(payout.scrap).toBe(Math.floor(escrowBeforeDeath.scrap * 0.5));
        expect(payout.xp).toBe(Math.floor(escrowBeforeDeath.xp * 0.5));
        break;
      }
      escrowBeforeDeath = res.json.escrow as typeof escrowBeforeDeath;
      if (guard === 59) throw new Error('run never died within 60 depths');
    }
    expect(deathDepth).toBeGreaterThan(1);
    expect(escrowBeforeDeath.credits).toBeGreaterThan(0);

    const profile = h.store.profiles.get(A)!;
    // CONTAINMENT: the roaming death record is untouched — no
    // death_state, no death_log entry, no resurrection owed.
    expect(profile.death_state).toEqual({});
    expect(profile.death_log).toEqual([]);
    const death = await h.store.getDeathRecord(A);
    expect(death).toBeNull();
    const action = await h.store.getActiveAction(A);
    expect(action?.active_action).toBe('idle_standby');
    const me = await get(h.base, '/api/endless/me', h.tokenA);
    expect(me.json.bestDepth).toBe(deathDepth - 1);
    const storedRun = h.store.endlessRuns.find((r) => r.id === runId)!;
    expect(storedRun.status).toBe('died');
    expect(storedRun.payout_fraction).toBe(0.5);
  });

  it('re-entry over an active run: the old run is carried out at the death fraction, the new fee escalates', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 20, credits: 100000, consumables: {} });
    seedStrongWeapon(h.store);
    const first = await startWinningRun(h, 1);
    // The winning start may not be the day's first (run-search
    // candidates count too) — expectations derive from its own
    // response, and the NEXT start escalates from there.
    const startsToday = first.json.runsStartedToday as number;
    expect(first.json.entryFee).toBe(200 * Math.min(8, 2 ** (startsToday - 1)));
    // Bank some escrow with one victory.
    const won = await post(h.base, '/api/endless/encounter', { nonce: nextNonce('encounter') }, h.tokenA);
    expect(won.json.victory).toBe(true);
    const escrow = won.json.escrow as { credits: number; xp: number; scrap: number };
    const creditsBefore = h.store.profiles.get(A)!.credits;

    const second = await startRun(h);
    expect(second.status).toBe(200);
    const secondFee = 200 * Math.min(8, 2 ** startsToday);
    expect(second.json.entryFee).toBe(secondFee); // one more start today: ×2 again
    const settlement = second.json.abandonedSettlement as { depth_reached: number; payout: { credits: number; fraction: number } };
    expect(settlement.depth_reached).toBe(1);
    expect(settlement.payout.fraction).toBe(0.5);
    expect(settlement.payout.credits).toBe(Math.floor(escrow.credits * 0.5));
    expect(h.store.profiles.get(A)!.credits).toBe(creditsBefore + settlement.payout.credits - secondFee);
    // The winning run is the one the second start carried out; the
    // abandoned rows are it PLUS every candidate the search burned
    // (each superseded by the next start) — first.attempts in total.
    const firstRunId = (first.json.run as { id: string }).id;
    expect(h.store.endlessRuns.find((r) => r.id === firstRunId)!.status).toBe('abandoned');
    expect(h.store.endlessRuns.filter((r) => r.status === 'abandoned')).toHaveLength(first.attempts);
    const activeRuns = h.store.endlessRuns.filter((r) => r.status === 'active');
    expect(activeRuns).toHaveLength(1);
    expect(activeRuns[0].id).toBe((second.json.run as { id: string }).id);
  });

  it('milestone: the depth-5 victory drops ONE generated item, stored immediately and recorded on the run', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 30, credits: 100000, consumables: {} });
    seedStrongWeapon(h.store);
    const start = await startWinningRun(h, 5);
    const runId = (start.json.run as { id: string }).id;

    let milestoneRes: Json | null = null;
    for (let guard = 0; guard < 5; guard++) {
      const liveRun = h.store.endlessRuns.find((r) => r.id === runId)!;
      const depth = liveRun.depth_reached + 1; // capture pre-post: the row is live
      const expected = await precomputeNext(h.store, liveRun, h.store.profiles.get(A)!);
      expect(expected.result.victory).toBe(true);
      const res = await post(h.base, '/api/endless/encounter', { nonce: nextNonce('encounter') }, h.tokenA);
      expect(res.status).toBe(200);
      if (depth === 5) {
        expect(expected.milestone).toBe(true);
        milestoneRes = res.json;
      }
    }
    expect(milestoneRes).not.toBeNull();
    const items = milestoneRes!.items as GearItem[];
    expect(items).toHaveLength(1);
    expect(items[0].level).toBe(34); // encounter level = start 30 + (5 − 1)
    expect(items[0].sourceTag).toBe(DropSource.BossDrop);
    // Stored server-side: storeChefItems re-keys the row, so match on
    // the payload's generator id (the boss-suite storage contract).
    const storedRow = [...h.store.items.values()].find(
      (row) => row.owner_user_id === A && (row.payload as { id?: string }).id === items[0].id,
    );
    expect(storedRow).toBeDefined();
    expect(storedRow!.runtime_state).toBe('available');
    const storedRun = h.store.endlessRuns.find((r) => r.id === runId)!;
    expect(storedRun.milestone_drops).toHaveLength(1);
    expect(storedRun.milestone_drops[0].depth).toBe(5);
    expect(storedRun.milestone_drops[0].rarity).toBe(items[0].rarity);
  });

  it('GET /api/endless/me: facts + intel obey the intel law over HTTP', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 25, credits: 5000, consumables: {} });
    const me = await get(h.base, '/api/endless/me', h.tokenA);
    expect(me.status).toBe(200);
    expect(me.json.bestDepth).toBe(0);
    expect(me.json.activeRun).toBeNull();
    const hits: string[] = [];
    walkKeys(me.json.intel, [], hits);
    expect(hits).toEqual([]);
    const intel = me.json.intel as { entry: { feeCredits: number }; firstEncounter: { level: number } };
    expect(intel.entry.feeCredits).toBe(250);
    expect(intel.firstEncounter.level).toBe(25);
  });

  it('bank with no active run is a 409, and the nonce is not poisoned', async () => {
    const h = await makeServer();
    h.store.seedProfile({ id: A, player_level: 10, credits: 10000, consumables: {} });
    const nonce = nextNonce('bank');
    const res = await post(h.base, '/api/endless/bank', { nonce }, h.tokenA);
    expect(res.status).toBe(409);
    // Same nonce works later once a run exists.
    seedStrongWeapon(h.store);
    await startRun(h);
    const ok = await post(h.base, '/api/endless/bank', { nonce }, h.tokenA);
    expect(ok.status).toBe(200);
    expect(ok.json.ended).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Economy twin meters
// ---------------------------------------------------------------------------

describe('endless economy meters (in-memory twin)', () => {
  it('daily meters attribute starts, endings, payouts, fees, deepest depth, milestone rarities', async () => {
    const day = '2026-10-31';
    const at = (time: string) => `${day}T${time}.000Z`;
    const store = new InMemoryEconomyStore({
      config: {},
      items: [],
      ledger: [
        { action_type: 'cc_start_endless_run', created_at: at('01:00:00'), result_payload: { entry_fee: 200 } },
        {
          action_type: 'cc_start_endless_run',
          created_at: at('02:00:00'),
          result_payload: {
            entry_fee: 400,
            abandoned_settlement: { depth_reached: 3, payout: { credits: 300, xp: 120, scrap: 9, fraction: 0.5 } },
          },
        },
        { action_type: 'cc_apply_endless_encounter', created_at: at('02:05:00'), result_payload: { victory: true, depth: 1, milestone_drop: null, payout: null } },
        { action_type: 'cc_apply_endless_encounter', created_at: at('02:06:00'), result_payload: { victory: true, depth: 5, milestone_drop: { rarity: 'Legendary', kind: 'weapon', name: 'Test Gun' }, payout: null } },
        {
          action_type: 'cc_apply_endless_encounter',
          created_at: at('02:07:00'),
          result_payload: { victory: false, depth: 9, run_status: 'died', milestone_drop: null, payout: { credits: 500, xp: 200, scrap: 4, fraction: 0.5 } },
        },
        {
          action_type: 'cc_end_endless_run',
          created_at: at('03:00:00'),
          result_payload: { ended: true, depth_reached: 7, payout: { credits: 1000, xp: 400, scrap: 20, fraction: 1 } },
        },
      ],
    });
    const row = await store.computeMetricsForDay(day);
    expect(row.endlessRunsStarted).toBe(2);
    expect(row.endlessRunsEnded).toBe(2); // bank row + death-closing encounter
    expect(row.endlessEncountersCleared).toBe(2);
    expect(row.endlessFeesDestroyed).toBe(600);
    expect(row.endlessCreditsPaid).toBe(300 + 500 + 1000);
    expect(row.endlessXpPaid).toBe(120 + 200 + 400);
    expect(row.endlessDeepestDepth).toBe(9);
    expect(row.endlessMilestoneDrops).toBe(1);
    expect(row.endlessMilestoneDropsByRarity).toEqual({ Legendary: 1 });
    // Folds: payouts mint, fees destroy.
    expect(row.creditsMintedTotal).toBe(1800);
    expect(row.creditsDestroyedTotal).toBe(600);
    expect(row.netCreditChange).toBe(1200);
  });
});

// ---------------------------------------------------------------------------
// 5. SQL parity pins
// ---------------------------------------------------------------------------

describe('endless SQL parity pins', () => {
  const migration = readFileSync(join(process.cwd(), 'db/migrations/0028_endless_mode.sql'), 'utf8');

  it('the appliers read the shared levers from economy_config with the content defaults', () => {
    expect(migration).toContain("cc_economy_config_number('endlessDeathPayoutFraction', 0.5)");
    expect(migration).toContain("cc_economy_config_number('endlessEntryFeePerLevel', 10)");
    expect(migration).toContain("cc_economy_config_number('endlessFeeEscalationCap', 8)");
  });

  it('the metrics function attributes abandoned settlements as run endings (twin lockstep)', () => {
    // The in-memory twin counts a start row carrying an
    // abandoned_settlement as a run ending; the SQL must too, or the
    // two metric paths disagree on endless_runs_ended (caught by the
    // embedded-Postgres harness during the slice's verification).
    const metricsFn = migration.slice(migration.indexOf('cc_compute_economy_metrics'));
    expect(metricsFn).toContain("result_payload -> 'abandoned_settlement' <> 'null'::jsonb");
    expect(metricsFn).toContain('endless_runs_ended');
  });

  it('the slot learns endless_run in the CHECK and in cc_set_active_action', () => {
    expect(migration).toContain("'endless_run'");
    const setAction = migration.slice(migration.indexOf('cc_set_active_action'));
    expect(setAction).toContain("'endless_run'");
    expect(migration).toContain('endless_runs');
  });

  it('economy config defaults equal the content defaults and validate in range', () => {
    expect(ECONOMY_CONFIG_DEFAULTS.endlessHpGrowth).toBe(1.12);
    expect(ECONOMY_CONFIG_DEFAULTS.endlessDpsGrowth).toBe(1.1);
    expect(ECONOMY_CONFIG_DEFAULTS.endlessDeathPayoutFraction).toBe(0.5);
    expect(ECONOMY_CONFIG_DEFAULTS.endlessEntryFeePerLevel).toBe(10);
    expect(ECONOMY_CONFIG_DEFAULTS.endlessFeeEscalationCap).toBe(8);
    expect(ECONOMY_CONFIG_DEFAULTS.endlessMaxDepth).toBe(250);
    for (const key of [
      'endlessHpGrowth',
      'endlessDpsGrowth',
      'endlessXpPerLevel',
      'endlessCreditsPerLevel',
      'endlessScrapPerLevel',
      'endlessRewardDepthGrowth',
      'endlessDeathPayoutFraction',
      'endlessEntryFeePerLevel',
      'endlessFeeEscalationCap',
      'endlessMilestoneLegendaryPerDepth',
      'endlessMilestoneEpicPerDepth',
      'endlessMaxDepth',
    ] as const) {
      expect(validateEconomyConfigValue(key, ECONOMY_CONFIG_DEFAULTS[key])).toBe(ECONOMY_CONFIG_DEFAULTS[key]);
    }
    // Clamp guards: the death fraction can never leave [0, 1] and the
    // growth levers can never make the Chamber shrink.
    expect(validateEconomyConfigValue('endlessDeathPayoutFraction', 1.5)).toBeNull();
    expect(validateEconomyConfigValue('endlessHpGrowth', 0.5)).toBeNull();
  });
});
