/**
 * Vehicles (Phase 2b, migration 0021) — shipped-path tests.
 *
 * Vehicles are real gear: item_instances kind 'vehicle' in the
 * loadout's 'vehicle' slot. The model is YIELD, never cadence — the
 * equipped vehicle multiplies per-tick claim yields by
 *   1 + (baseYield − 1) × (1 + yieldAffixPct) × conditionFraction × scalar
 * derived server-side from the instance. Fuel burns per fueled tick;
 * out of fuel = ×1.0 on foot, never a block. Condition decays per
 * fueled tick scaled by area danger; at zero condition the factor is
 * exactly ×1.0. Boss attempts never read the vehicle.
 *
 * Layers covered:
 *   1. Pure math owners (src/lib/vehicles/vehicles.ts) — per-class
 *      factors, affix-modified factors, degradation endpoints.
 *   2. The Chef engine (processRoamingClaim) at real Dustwaste rates
 *      (0.75 credits/tick, 0.15 scrap/tick, 1.0 XP/tick): yield
 *      scaling, fuel burn + partial-fuel fallback, condition decay
 *      by area danger, the vehicleYieldScalar lever.
 *   3. Route parity: POST /api/claim vs POST /api/settle-offline on
 *      identical seeded state produce identical rewards, identical
 *      vehicle blocks, and identical persisted fuel/condition.
 *   4. The writes mirror (InMemoryWriteStore): starter grant
 *      idempotency, the equip level gate, refuel, patch kit, and a
 *      market sale that delivers the vehicle intact with the fee
 *      destroyed.
 *   5. Boss isolation: the boss loadout derivation excludes the
 *      vehicle, and a verify-boss attempt pays identically with and
 *      without a vehicle equipped.
 *   6. The generator: class weighting by area (Skimmer is high-area
 *      only), affix rolls from the one pool.
 *   7. Source pins on migration 0021 (slot list, kind constraint,
 *      vendor staples, SQL unlock-level twin vs the TS class table).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { processRoamingClaim, type ClaimRequest } from '../server/chef';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import {
  VEHICLE_CLASSES,
  VEHICLE_AFFIX_POOL,
  effectiveVehicleYield,
  getVehicleClass,
  vehicleBurnPerTick,
  vehicleDecayPerTick,
  vehicleMaterialBonusChance,
} from '../lib/vehicles/vehicles';
import { generateVehicle, buildStarterVehicle, vehicleClassWeights } from '../server/lib/generators/vehicleGenerator';
import { createRNG } from '../lib/utils/rng';
import { DropSource, Rarity, RiskSetting } from '../types/game';
import type { Affix, Vehicle } from '../types/items';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PLAYER = '44444444-4444-4444-8444-444444444444';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'veh-1',
    name: 'Scrap Bike',
    vehicleClassId: 'scrap_bike',
    level: 1,
    rarity: Rarity.Common,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 1,
    ...overrides,
  };
}

function affix(stat: string, value: number): Affix {
  return { id: `aff-${stat}`, category: 'activity', stat, value, displayText: `${stat} +${Math.round(value * 100)}%` };
}

function claimRequest(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    playerId: PLAYER,
    areaId: 'dustwaste_frontier',
    ticks: 20,
    tickCount: 2000,
    playerLevel: 10,
    survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0, mitigation: 0 },
    ...overrides,
  };
}

function withVehicle(vehicle: Vehicle, fuelUnits = 100000, conditionCurrent = 100, conditionMax = 100): Partial<ClaimRequest> {
  return { vehicle: { vehicle, conditionCurrent, conditionMax, fuelUnits } };
}

const totalPaid = (awarded: number, remainder: number) => awarded + remainder;

// ---------------------------------------------------------------------------
// 1. Pure math owners
// ---------------------------------------------------------------------------

describe('vehicle math owners', () => {
  it('the class table carries the approved unlock levels and yields', () => {
    const expected: Array<[string, number, number]> = [
      ['scrap_bike', 1, 1.15],
      ['dune_buggy', 8, 1.35],
      ['utility_rover', 18, 1.25],
      ['cargo_hauler', 28, 1.1],
      ['armored_crawler', 42, 1.05],
      ['relay_skimmer', 60, 1.6],
      ['leviathan_rig', 75, 1.5],
    ];
    expect(VEHICLE_CLASSES.map((c) => [c.id, c.unlockLevel, c.baseYield])).toEqual(expected);
  });

  it('full condition pays the full class bonus; zero condition is exactly ×1.0 for every class', () => {
    for (const def of VEHICLE_CLASSES) {
      const v = makeVehicle({ vehicleClassId: def.id });
      expect(effectiveVehicleYield(v, 1, 1)).toBeCloseTo(def.baseYield, 10);
      expect(effectiveVehicleYield(v, 0, 1)).toBe(1);
    }
  });

  it('the degradation curve is linear in the condition fraction', () => {
    const buggy = makeVehicle({ vehicleClassId: 'dune_buggy' });
    expect(effectiveVehicleYield(buggy, 0.5, 1)).toBeCloseTo(1 + 0.35 * 0.5, 10);
    expect(effectiveVehicleYield(buggy, 0.25, 1)).toBeCloseTo(1 + 0.35 * 0.25, 10);
  });

  it('yield affixes multiply the bonus; the scalar lever scales it (0 parks at ×1.0)', () => {
    const bike = makeVehicle({ affixes: [affix('vehicleYieldPct', 0.1)] });
    expect(effectiveVehicleYield(bike, 1, 1)).toBeCloseTo(1 + 0.15 * 1.1, 10);
    expect(effectiveVehicleYield(bike, 1, 2)).toBeCloseTo(1 + 0.15 * 1.1 * 2, 10);
    expect(effectiveVehicleYield(bike, 1, 0)).toBe(1);
  });

  it('fuel efficiency affixes cut the burn (floored at 10%); frame affixes cut decay', () => {
    const skimmer = makeVehicle({ vehicleClassId: 'relay_skimmer' });
    expect(vehicleBurnPerTick(skimmer)).toBe(2.0);
    const efficient = makeVehicle({ vehicleClassId: 'relay_skimmer', affixes: [affix('vehicleFuelEfficiencyPct', 0.5)] });
    expect(vehicleBurnPerTick(efficient)).toBeCloseTo(1.0, 10);
    const capped = makeVehicle({ vehicleClassId: 'relay_skimmer', affixes: [affix('vehicleFuelEfficiencyPct', 0.99)] });
    expect(vehicleBurnPerTick(capped)).toBeCloseTo(0.2, 10);

    const bike = makeVehicle();
    const lowDanger = vehicleDecayPerTick(bike, 'Low');
    const highDanger = vehicleDecayPerTick(bike, 'High');
    expect(highDanger).toBeGreaterThan(lowDanger * 2.5);
    const framed = makeVehicle({ affixes: [affix('vehicleFramePct', 0.3)] });
    expect(vehicleDecayPerTick(framed, 'Low')).toBeCloseTo(lowDanger * 0.7, 10);
    // The Crawler's durability identity: near-negligible decay even in High danger.
    const crawler = makeVehicle({ vehicleClassId: 'armored_crawler' });
    expect(vehicleDecayPerTick(crawler, 'High')).toBeLessThan(vehicleDecayPerTick(bike, 'High') * 0.3);
  });

  it('cargo identity: only the Hauler carries a base material bonus; cargo affixes add', () => {
    expect(vehicleMaterialBonusChance(makeVehicle({ vehicleClassId: 'cargo_hauler' }))).toBeCloseTo(0.3, 10);
    expect(vehicleMaterialBonusChance(makeVehicle({ vehicleClassId: 'dune_buggy' }))).toBe(0);
    expect(
      vehicleMaterialBonusChance(makeVehicle({ vehicleClassId: 'dune_buggy', affixes: [affix('vehicleCargoPct', 0.2)] })),
    ).toBeCloseTo(0.2, 10);
  });

  it('unknown classes read as no vehicle (×1.0, no burn, no decay)', () => {
    const ghost = makeVehicle({ vehicleClassId: 'not_a_class' });
    expect(getVehicleClass('not_a_class')).toBeNull();
    expect(effectiveVehicleYield(ghost, 1, 1)).toBe(1);
    expect(vehicleBurnPerTick(ghost)).toBe(0);
    expect(vehicleDecayPerTick(ghost, 'High')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Chef engine — yield / fuel / condition through processRoamingClaim
// ---------------------------------------------------------------------------

describe('vehicle yield in the claim engine', () => {
  it('baseline: no vehicle pays the designed Dustwaste rates exactly', () => {
    const result = processRoamingClaim(claimRequest());
    expect(result.rewards.creditsAwarded).toBe(15);
    expect(result.vehicle.equipped).toBe(false);
    expect(result.vehicle.inactiveReason).toBe('no_vehicle');
    expect(result.vehicle.activeTicks).toBe(0);
  });

  it('Scrap Bike at full condition scales credits, scrap, and XP by ~×1.15', () => {
    const result = processRoamingClaim(claimRequest(withVehicle(makeVehicle())));
    expect(totalPaid(result.rewards.creditsAwarded, result.rewards.creditsRemainder)).toBeCloseTo(15 * 1.15, 1);
    expect(totalPaid(result.rewards.scrapAwarded, result.rewards.scrapRemainder)).toBeCloseTo(3 * 1.15, 1);
    expect(totalPaid(result.rewards.xpAwarded, result.rewards.xpRemainder)).toBeCloseTo(20 * 1.15, 1);
    expect(result.vehicle.equipped).toBe(true);
    expect(result.vehicle.activeTicks).toBe(20);
    expect(result.vehicle.inactiveReason).toBeNull();
  });

  it('Dune Buggy scales by ~×1.35 and a yield affix multiplies the bonus', () => {
    const plain = processRoamingClaim(
      claimRequest(withVehicle(makeVehicle({ vehicleClassId: 'dune_buggy', name: 'Dune Buggy' }))),
    );
    expect(totalPaid(plain.rewards.creditsAwarded, plain.rewards.creditsRemainder)).toBeCloseTo(15 * 1.35, 1);

    const affixed = processRoamingClaim(
      claimRequest(withVehicle(makeVehicle({ affixes: [affix('vehicleYieldPct', 0.1)] }))),
    );
    expect(totalPaid(affixed.rewards.creditsAwarded, affixed.rewards.creditsRemainder)).toBeCloseTo(15 * 1.165, 1);
  });

  it('half condition pays half the bonus (degradation curve through the engine)', () => {
    const result = processRoamingClaim(claimRequest(withVehicle(makeVehicle(), 100000, 50, 100)));
    expect(totalPaid(result.rewards.creditsAwarded, result.rewards.creditsRemainder)).toBeCloseTo(15 * 1.075, 1);
  });

  it('zero condition pays exactly the on-foot baseline while fuel still burns', () => {
    const result = processRoamingClaim(claimRequest(withVehicle(makeVehicle(), 100000, 0, 100)));
    expect(result.rewards.creditsAwarded).toBe(15);
    expect(result.rewards.creditsRemainder).toBe(0);
    expect(result.vehicle.conditionCurrent).toBe(0);
    expect(result.vehicle.activeTicks).toBe(20);
    expect(result.vehicle.fuelConsumed).toBeCloseTo(20 * 0.9, 6);
  });

  it('the vehicleYieldScalar lever scales the bonus; 0 parks the vehicle at ×1.0', () => {
    const parked = processRoamingClaim(
      claimRequest({ ...withVehicle(makeVehicle()), economy: { vehicleYieldScalar: 0 } }),
    );
    expect(parked.rewards.creditsAwarded).toBe(15);
    expect(parked.rewards.creditsRemainder).toBe(0);

    const boosted = processRoamingClaim(
      claimRequest({ ...withVehicle(makeVehicle()), economy: { vehicleYieldScalar: 2 } }),
    );
    expect(totalPaid(boosted.rewards.creditsAwarded, boosted.rewards.creditsRemainder)).toBeCloseTo(15 * 1.3, 1);
  });
});

describe('vehicle fuel in the claim engine', () => {
  it('an empty tank pays exactly ×1.0, burns nothing, and roaming is uninterrupted', () => {
    const result = processRoamingClaim(claimRequest(withVehicle(makeVehicle(), 0)));
    expect(result.rewards.creditsAwarded).toBe(15);
    expect(result.rewards.killsRecorded).toBeGreaterThan(0);
    expect(result.vehicle.inactiveReason).toBe('out_of_fuel');
    expect(result.vehicle.activeTicks).toBe(0);
    expect(result.vehicle.fuelConsumed).toBe(0);
    expect(result.vehicle.conditionCurrent).toBe(100); // no wear without fuel
  });

  it('fuel for only some ticks: the bonus stops mid-claim and the rest pays baseline', () => {
    // Bike burns 0.9/tick: 4.5 units = exactly 5 fueled ticks.
    const result = processRoamingClaim(claimRequest(withVehicle(makeVehicle(), 4.5)));
    expect(result.vehicle.activeTicks).toBe(5);
    expect(result.vehicle.fuelConsumed).toBeCloseTo(4.5, 6);
    expect(result.vehicle.fuelUnitsRemaining).toBe(0);
    const expected = 5 * 0.75 * 1.15 + 15 * 0.75;
    expect(totalPaid(result.rewards.creditsAwarded, result.rewards.creditsRemainder)).toBeCloseTo(expected, 1);
  });

  it('per-class burn rates: the Skimmer drains the same tank far faster than the Rover', () => {
    const rover = processRoamingClaim(
      claimRequest(withVehicle(makeVehicle({ vehicleClassId: 'utility_rover', name: 'Utility Rover' }), 14)),
    );
    expect(rover.vehicle.activeTicks).toBe(20); // 14 / 0.7 = 20 ticks exactly
    const skimmer = processRoamingClaim(
      claimRequest(withVehicle(makeVehicle({ vehicleClassId: 'relay_skimmer', name: 'Relay Skimmer' }), 14)),
    );
    expect(skimmer.vehicle.activeTicks).toBe(7); // 14 / 2.0 = 7 ticks
  });
});

describe('vehicle condition in the claim engine', () => {
  it('decay scales with area danger: High danger wears the bike ~2.67× faster than Low', () => {
    const low = processRoamingClaim(claimRequest(withVehicle(makeVehicle())));
    const high = processRoamingClaim(
      claimRequest({ ...withVehicle(makeVehicle()), areaId: 'helixworks_labyrinth', playerLevel: 30 }),
    );
    const lowLoss = 100 - low.vehicle.conditionCurrent;
    const highLoss = 100 - high.vehicle.conditionCurrent;
    expect(lowLoss).toBeCloseTo(20 * 0.02 * 0.6 * 1.1, 6);
    expect(highLoss).toBeCloseTo(20 * 0.02 * 1.6 * 1.1, 6);
    expect(highLoss / lowLoss).toBeCloseTo(1.6 / 0.6, 5);
  });

  it('condition never drops below zero and never blocks the claim', () => {
    const result = processRoamingClaim(
      claimRequest({ ...withVehicle(makeVehicle(), 100000, 0.01, 100), ticks: 20 }),
    );
    expect(result.vehicle.conditionCurrent).toBe(0);
    expect(result.rewards.creditsAwarded).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Route parity — claim vs offline settlement on identical state
// ---------------------------------------------------------------------------

const G = '77777777-7777-4777-8777-777777777777';
const VEHICLE_ROW_ID = 'veh-row-1';

function seedParityStore(settledAgoMs: number): InMemoryChefGameplayStore {
  const store = new InMemoryChefGameplayStore();
  store.seedProfile({
    id: G,
    player_level: 10,
    credits: 0,
    scrap: 0,
    vehicle_fuel: 500,
    last_claimed_tick: 2000,
    last_roaming_settled_at: new Date(Date.now() - settledAgoMs).toISOString(),
  });
  store.seedItem({
    id: VEHICLE_ROW_ID,
    owner_user_id: G,
    kind: 'vehicle',
    runtime_state: 'equipped',
    equipped_slot: 'vehicle',
    rarity: 'Rare',
    item_level: 10,
    condition_current: 80,
    condition_max: 100,
    payload: {
      ...makeVehicle({ id: VEHICLE_ROW_ID, vehicleClassId: 'dune_buggy', name: 'Dune Buggy', rarity: Rarity.Rare, level: 10 }),
    } as unknown as Record<string, unknown>,
  });
  store.seedActiveAction({
    user_id: G,
    active_action: 'roaming_loot',
    target_id: 'dustwaste_frontier',
    started_at: new Date(Date.now() - settledAgoMs).toISOString(),
    last_heartbeat_at: null,
    activity_payload: {},
  });
  return store;
}

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

async function makeGameplayServer(store: InMemoryChefGameplayStore): Promise<{ base: string; token: string }> {
  const app = express();
  app.use(express.json());
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  openServers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, token: issueAccessToken(SECRET, G, false) };
}

type JsonRecord = Record<string, unknown>;
const rec = (v: unknown): JsonRecord => (v && typeof v === 'object' ? (v as JsonRecord) : {});

async function postJson(base: string, path: string, token: string, body: unknown): Promise<{ status: number; json: JsonRecord }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as JsonRecord };
}

describe('offline settlement parity (routes)', () => {
  it('claim and settle-offline produce identical rewards, vehicle blocks, and persisted state', async () => {
    // Foreground: 20 ticks claimed live.
    const claimStore = seedParityStore(20 * 3000 + 1500);
    const claimServer = await makeGameplayServer(claimStore);
    const claimRes = await postJson(claimServer.base, '/api/claim', claimServer.token, {
      playerId: G,
      areaId: 'dustwaste_frontier',
      ticks: 20,
      tickCount: 2020,
      playerLevel: 10,
      survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0 },
    });
    expect(claimRes.status).toBe(200);

    // Offline: the same 20 ticks settled from the same seeded state.
    const settleStore = seedParityStore(20 * 3000 + 1500);
    const settleServer = await makeGameplayServer(settleStore);
    const settleRes = await postJson(settleServer.base, '/api/settle-offline', settleServer.token, {
      playerId: G,
      settlementNonce: 'parity-nonce-0001',
    });
    expect(settleRes.status).toBe(200);
    expect(settleRes.json.settled).toBe(true);
    expect(settleRes.json.ticksSettled).toBe(20);

    expect(settleRes.json.rewards).toEqual(claimRes.json.rewards);
    expect(settleRes.json.vehicle).toEqual(claimRes.json.vehicle);
    expect(rec(claimRes.json.vehicle).activeTicks).toBe(20);
    expect(rec(claimRes.json.vehicle).fuelConsumed).toBeCloseTo(20 * 1.1, 6);

    const claimProfile = claimStore.profiles.get(G)!;
    const settleProfile = settleStore.profiles.get(G)!;
    expect(settleProfile.vehicle_fuel).toBe(claimProfile.vehicle_fuel);
    expect(settleProfile.credits).toBe(claimProfile.credits);
    const claimItem = claimStore.items.get(VEHICLE_ROW_ID)!;
    const settleItem = settleStore.items.get(VEHICLE_ROW_ID)!;
    expect(settleItem.condition_current).toBe(claimItem.condition_current);
    expect(claimItem.condition_current).toBeLessThan(80);
  });
});

// ---------------------------------------------------------------------------
// 4. Writes mirror — grant, gate, refuel, patch kit, market
// ---------------------------------------------------------------------------

const S = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function profile(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 1, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2026-10-29T10:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-10-28T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0,
    ...overrides,
  };
}

function writeItem(overrides: Partial<WriteItemData> & { id: string; owner_user_id: string }): WriteItemData {
  return {
    kind: 'weapon', static_item_id: null, item_level: 5, rarity: 'Rare', quality: null,
    material_tier: null, condition_state: null, condition_current: null, condition_max: null,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null, payload: { weaponType: 'Pistol' }, runtime_state: 'available',
    is_locked: false, equipped_slot: null, estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeWriteStore(seed: WriteSeed): InMemoryWriteStore {
  return new InMemoryWriteStore(seed, {
    now: () => new Date(Date.parse('2026-10-30T12:00:00.000Z')),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  });
}

const VEH_ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';

function vehicleWriteItem(overrides: Partial<WriteItemData> = {}): WriteItemData {
  return writeItem({
    id: VEH_ITEM,
    owner_user_id: S,
    kind: 'vehicle',
    item_level: 10,
    rarity: 'Rare',
    condition_current: 37,
    condition_max: 100,
    estimated_value: 2000,
    payload: {
      ...makeVehicle({ id: VEH_ITEM, vehicleClassId: 'dune_buggy', name: 'Dune Buggy', rarity: Rarity.Rare, level: 10, affixes: [affix('vehicleYieldPct', 0.08)] }),
    } as unknown as WriteItemData['payload'],
    ...overrides,
  });
}

describe('starter grant (writes mirror)', () => {
  it('the initial bundle grants one Scrap Bike, auto-equipped; replay and re-claim never duplicate it', async () => {
    const seed = emptyWriteSeed();
    seed.profiles = [profile({ id: S })];
    const store = makeWriteStore(seed);

    const first = rec(await store.initialBundle(S, 'bundle-nonce-0001'));
    expect(rec(first.item).kind).toBe('vehicle');
    expect(rec(first.loadout).vehicle).toBe(rec(first.item).id);
    const bikes = store.seed.items.filter((i) => i.owner_user_id === S && i.kind === 'vehicle');
    expect(bikes).toHaveLength(1);
    expect(bikes[0].condition_current).toBe(100);
    expect((bikes[0].payload as Record<string, unknown>).vehicleClassId).toBe('scrap_bike');

    // Nonce replay returns the recorded result — still one bike.
    const replay = rec(await store.initialBundle(S, 'bundle-nonce-0001'));
    expect(rec(replay.item).id).toBe(rec(first.item).id);
    expect(store.seed.items.filter((i) => i.kind === 'vehicle')).toHaveLength(1);

    // A fresh nonce hits the once-only bundle claim.
    await expect(store.initialBundle(S, 'bundle-nonce-0002')).rejects.toThrow('Initial bundle already claimed');
    expect(store.seed.items.filter((i) => i.kind === 'vehicle')).toHaveLength(1);
  });

  it('buildStarterVehicle matches the granted payload shape', () => {
    const starter = buildStarterVehicle('veh-starter');
    expect(starter.vehicleClassId).toBe('scrap_bike');
    expect(starter.rarity).toBe(Rarity.Common);
    expect(starter.affixes).toEqual([]);
    expect(starter.level).toBe(1);
  });
});

describe('equip level gate (writes mirror)', () => {
  it('a level-5 hunter cannot equip a Dune Buggy (L8); a level-8 hunter can', async () => {
    const seed = emptyWriteSeed();
    seed.profiles = [profile({ id: S, player_level: 5 })];
    seed.items = [vehicleWriteItem()];
    const store = makeWriteStore(seed);

    await expect(store.equipItem(S, 'equip-nonce-0001', VEH_ITEM, 'vehicle')).rejects.toThrow(
      'Vehicle requires hunter level 8',
    );
    expect(store.seed.items.find((i) => i.id === VEH_ITEM)?.equipped_slot).toBeNull();

    // The store clones the seed at construction — level up ITS copy.
    store.seed.profiles[0].player_level = 8;
    const equipped = rec(await store.equipItem(S, 'equip-nonce-0002', VEH_ITEM, 'vehicle'));
    expect(rec(equipped.loadout).vehicle).toBe(VEH_ITEM);
    expect(store.seed.items.find((i) => i.id === VEH_ITEM)?.runtime_state).toBe('equipped');
  });

  it('gear payloads cannot enter the vehicle slot and vehicles cannot enter gear slots', async () => {
    const seed = emptyWriteSeed();
    seed.profiles = [profile({ id: S, player_level: 60 })];
    seed.items = [vehicleWriteItem(), writeItem({ id: 'gun-1', owner_user_id: S })];
    const store = makeWriteStore(seed);
    await expect(store.equipItem(S, 'equip-nonce-0003', 'gun-1', 'vehicle')).rejects.toThrow(
      'Item type does not match loadout slot',
    );
    await expect(store.equipItem(S, 'equip-nonce-0004', VEH_ITEM, 'relic')).rejects.toThrow(
      'Item type does not match loadout slot',
    );
  });
});

describe('refuel + patch kit (writes mirror)', () => {
  function fuelSeed(): WriteSeed {
    const seed = emptyWriteSeed();
    seed.profiles = [profile({ id: S, consumables: { GenericFuelCell: 3, PatchKit: 2 }, vehicle_fuel: 0 })];
    seed.items = [vehicleWriteItem()];
    seed.consumableBatches = [
      {
        id: 'batch-fuel', owner_user_id: S, consumable_type: 'GenericFuelCell', quality_percent: 100,
        quantity: 3, origin: 'vendor', creator_user_id: null, source_recipe_id: null, metadata: {},
        created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'batch-kit', owner_user_id: S, consumable_type: 'PatchKit', quality_percent: 50,
        quantity: 2, origin: 'vendor', creator_user_id: null, source_recipe_id: null, metadata: {},
        created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      },
    ];
    return seed;
  }

  it('refuel moves cells into the tank at 100 units each and is nonce-idempotent', async () => {
    const store = makeWriteStore(fuelSeed());
    const result = rec(await store.refuelVehicle(S, 'refuel-nonce-0001', 2));
    expect(result.vehicle_fuel).toBe(200);
    expect(rec(result.profile).vehicle_fuel).toBe(200);
    expect(rec(rec(result.profile).consumables).GenericFuelCell).toBe(1);

    const replay = rec(await store.refuelVehicle(S, 'refuel-nonce-0001', 2));
    expect(replay.vehicle_fuel).toBe(200);

    await expect(store.refuelVehicle(S, 'refuel-nonce-0002', 2)).rejects.toThrow('Insufficient consumable');
  });

  it('self-repair is a timed job (0025): a patch kit restores 30 × quality% once the work lands', async () => {
    // The instant cc_use_patch_kit is retired: repair is work. This
    // store gets a mutable clock so the job's timed unit can elapse.
    let clock = Date.parse('2026-10-30T12:00:00.000Z');
    let n = 0;
    const store = new InMemoryWriteStore(fuelSeed(), {
      now: () => new Date(clock),
      rng: () => 0.5,
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    });
    const enqueued = rec(await store.enqueueRepairJob(S, 'repair-nonce-0001', {
      itemId: VEH_ITEM, kitType: 'PatchKit', units: 1,
    }));
    const job = rec(enqueued.job);
    // Untrained: 30 base points at 20 pts/h = 1.5h per kit.
    expect(job.unitDurationMs).toBe(5_400_000);
    expect(job.kind).toBe('repair');
    // The kit escrows at enqueue; nothing is restored yet.
    expect(rec(rec(enqueued.profile).consumables).PatchKit).toBe(1);
    expect(store.seed.items.find((i) => i.id === VEH_ITEM)?.condition_current).toBe(37);

    await store.setActiveAction(S, 'repair-nonce-0002', {
      activity_kind: 'workshop_service', target_type: 'workshop_job',
      target_id: job.id as string, activity_payload: {}, public_payload: {},
    });
    clock += 5_400_000 + 60_000;
    const state = rec(await store.getWorkshopState(S));
    const done = (state.jobs as Array<Record<string, unknown>>).find((j) => j.id === job.id)!;
    expect(done.state).toBe('complete');
    // FIFO batch is 50% quality: 30 × 0.5 × 1.0 efficiency = 15 → 37 → 52.
    expect(done.repairPointsRestored).toBe(15);
    expect(store.seed.items.find((i) => i.id === VEH_ITEM)?.condition_current).toBe(52);

    // Non-vehicle targets are rejected.
    await expect(store.enqueueRepairJob(S, 'repair-nonce-0003', {
      itemId: 'batch-kit', kitType: 'PatchKit', units: 1,
    })).rejects.toThrow();
  });
});

describe('vehicle market sale (writes mirror)', () => {
  it('lists as kind vehicle and sells intact — payload and condition preserved, 5% fee destroyed', async () => {
    const seed = emptyWriteSeed();
    seed.profiles = [
      profile({ id: S, credits: 0 }),
      profile({ id: B, credits: 100_000 }),
    ];
    seed.items = [vehicleWriteItem()];
    const store = makeWriteStore(seed);

    const created = rec(await store.marketCreate(S, 'list-nonce-0001', VEH_ITEM, 10_000));
    expect(rec(created.listing).listing_kind).toBe('vehicle');
    expect(rec(created.listing).category).toBe('vehicle');
    expect(rec(created.listing).identity_key).toBe('vehicle:dune_buggy:Rare');

    const accepted = rec(await store.acceptListing(B, 'accept-nonce-0001', rec(created.listing).id as string));
    expect(rec(accepted.market_fee).fee_credits).toBe(500);
    const moved = store.seed.items.find((i) => i.id === VEH_ITEM)!;
    expect(moved.owner_user_id).toBe(B);
    expect(moved.condition_current).toBe(37);
    expect((moved.payload as Record<string, unknown>).vehicleClassId).toBe('dune_buggy');
    expect((rec(moved.payload).affixes as unknown[]).length).toBe(1);
    const sellerProfile = [...store.seed.profiles].find((p) => p.id === S);
    expect(sellerProfile?.credits).toBe(9500);
  });
});

// ---------------------------------------------------------------------------
// 5. Boss isolation
// ---------------------------------------------------------------------------

describe('boss attempts are unaffected by vehicles', () => {
  it('the boss loadout derivation excludes the equipped vehicle', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: PLAYER, player_level: 50, credits: 10000 });
    store.seedItem({
      id: VEHICLE_ROW_ID, owner_user_id: PLAYER, kind: 'vehicle', runtime_state: 'equipped',
      equipped_slot: 'vehicle', rarity: 'Epic', item_level: 50, condition_current: 90, condition_max: 100,
      payload: { ...makeVehicle({ id: VEHICLE_ROW_ID, vehicleClassId: 'relay_skimmer', name: 'Relay Skimmer' }) } as unknown as Record<string, unknown>,
    });
    const gear = await store.getEquippedGear(PLAYER);
    expect(gear).toHaveLength(0);
    const vehicle = await store.getEquippedVehicle(PLAYER);
    expect(vehicle?.vehicle.vehicleClassId).toBe('relay_skimmer');
    expect(vehicle?.conditionCurrent).toBe(90);
  });

  it('a verify-boss attempt pays identically with and without a vehicle equipped', async () => {
    const strongGun = {
      id: 'boss-gun', name: 'Server Owned Boss Gun', level: 50, rarity: 'Legendary',
      weaponType: 'SMG', manufacturer: 'Redline', element: 'Fire', rollQuality: 100,
      baseDamage: 10000, attackSpeed: 10, critChance: 0.5, critDamage: 2, statusChance: 0,
      statusDamage: 0, bossDamageMod: 2, waveDamageMod: 0, shieldDamageMod: 1, armorDamageMod: 1,
      offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0, parts: [], affixes: [],
      sourceTag: 'World Drop', isLocked: false, pixelSeed: 1, combatPower: 0, bossPower: 0,
      farmPower: 0, economyScore: 0,
    };

    async function attempt(withVehicle: boolean): Promise<JsonRecord> {
      const store = new InMemoryChefGameplayStore();
      store.seedProfile({
        id: PLAYER, player_level: 50, credits: 10000,
        boss_state: { unlockedBossIds: ['dune_tyrant'], defeatedBossIds: [], pityCounters: {} },
      });
      store.seedItem({
        id: 'boss-gun-row', owner_user_id: PLAYER, kind: 'weapon', runtime_state: 'equipped',
        equipped_slot: 'primary', rarity: 'Legendary', item_level: 50,
        payload: { ...strongGun } as unknown as Record<string, unknown>,
      });
      if (withVehicle) {
        store.seedItem({
          id: VEHICLE_ROW_ID, owner_user_id: PLAYER, kind: 'vehicle', runtime_state: 'equipped',
          equipped_slot: 'vehicle', rarity: 'Epic', item_level: 50, condition_current: 90, condition_max: 100,
          payload: { ...makeVehicle({ id: VEHICLE_ROW_ID, vehicleClassId: 'relay_skimmer', name: 'Relay Skimmer' }) } as unknown as Record<string, unknown>,
        });
      }
      const server = await makeGameplayServer(store);
      const res = await postJson(server.base, '/api/verify-boss', issueAccessToken(SECRET, PLAYER, false), {
        playerId: PLAYER, bossId: 'dune_tyrant', attemptNonce: 123, risk: RiskSetting.Balanced, consumables: {},
      });
      expect(res.status).toBe(200);
      return res.json;
    }

    const without = await attempt(false);
    const withVeh = await attempt(true);
    expect(withVeh.victory).toBe(without.victory);
    expect(withVeh.creditsDelta).toBe(without.creditsDelta);
    expect(withVeh.xpAwarded).toBe(without.xpAwarded);
    expect(withVeh.scrapAwarded).toBe(without.scrapAwarded);
    expect((withVeh.items as unknown[]).length).toBe((without.items as unknown[]).length);
    expect(withVeh.bossVictoriesToday).toBe(without.bossVictoriesToday);
  });
});

// ---------------------------------------------------------------------------
// 6. Generator
// ---------------------------------------------------------------------------

describe('vehicle generator', () => {
  it('the Relay Skimmer never drops in low areas and can drop in high areas', () => {
    expect(vehicleClassWeights(1).some((e) => e.def.id === 'relay_skimmer')).toBe(false);
    expect(vehicleClassWeights(25).some((e) => e.def.id === 'relay_skimmer')).toBe(true);

    const rng = createRNG(42);
    for (let i = 0; i < 200; i++) {
      const v = generateVehicle({ level: 10, areaUnlockLevel: 1 }, rng);
      expect(v.vehicleClassId).not.toBe('relay_skimmer');
    }
    const highRng = createRNG(7);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      seen.add(generateVehicle({ level: 60, areaUnlockLevel: 25 }, highRng).vehicleClassId);
    }
    expect(seen.has('relay_skimmer')).toBe(true);
  });

  it('rolled affixes come from the one pool, counts follow rarity, values in range', () => {
    const rng = createRNG(99);
    const poolStats = new Set(VEHICLE_AFFIX_POOL.map((a) => a.stat));
    for (let i = 0; i < 100; i++) {
      const v = generateVehicle({ level: 20, areaUnlockLevel: 12, forcedRarity: Rarity.Legendary }, rng);
      expect(v.affixes.length).toBeGreaterThanOrEqual(4);
      expect(v.affixes.length).toBeLessThanOrEqual(5);
      const stats = new Set(v.affixes.map((a) => a.stat));
      expect(stats.size).toBe(v.affixes.length); // no replacement
      for (const a of v.affixes) {
        expect(poolStats.has(a.stat as string)).toBe(true);
        const def = VEHICLE_AFFIX_POOL.find((d) => d.stat === a.stat)!;
        expect(a.value).toBeGreaterThanOrEqual(def.min - 1e-9);
        expect(a.value).toBeLessThanOrEqual(def.max + 1e-9);
      }
    }
    const common = generateVehicle({ level: 1, areaUnlockLevel: 1, forcedRarity: Rarity.Common }, createRNG(3));
    expect(common.affixes.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Migration 0021 source pins
// ---------------------------------------------------------------------------

describe('migration 0021 source pins', () => {
  const sql = readFileSync(resolve(__dirname, '../../db/migrations/0021_vehicles.sql'), 'utf8');

  it('carries the vehicle slot, kind constraint, and fuel column', () => {
    expect(sql).toContain("'vehicle'");
    expect(sql).toContain('add column if not exists vehicle_fuel');
    expect(sql).toContain("'gear'::text, 'consumable'::text, 'material'::text, 'vehicle'::text");
    expect(sql).toContain('cc_refuel_vehicle');
    expect(sql).toContain('cc_use_patch_kit');
    expect(sql).toContain('cc_apply_vehicle_usage');
  });

  it('the vendor catalog twin gains the two baseline staples at the def prices', () => {
    expect(sql).toContain("('GenericFuelCell', 40, 'staple')");
    expect(sql).toContain("('PatchKit', 150, 'staple')");
  });

  it('the SQL unlock-level twin matches the TS class table for every class', () => {
    // The twin's current body lives in 0032 (the Leviathan restate);
    // 0021 carries the original six rows.
    const sql0032 = readFileSync(resolve(__dirname, '../../db/migrations/0032_dispatch.sql'), 'utf8');
    for (const def of VEHICLE_CLASSES) {
      expect(sql + sql0032).toContain(`when '${def.id}' then ${def.unlockLevel}`);
    }
    expect(sql).toContain("'Vehicle requires hunter level %'");
  });

  it('the starter grant and the equip gate live in the SQL bundle/equip functions', () => {
    expect(sql).toContain("'grantSource', 'initial_bundle'");
    expect(sql).toContain('cc_vehicle_unlock_level');
    expect(sql).toContain("payload ? 'vehicleClassId'");
  });
});
