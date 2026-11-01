/**
 * Dispatch + Courier + Leviathan Rig (migration 0032) — timed
 * contracts for SPARE loadouts (foot) and SPARE vehicles (courier),
 * running PARALLEL to the personal action slot.
 *
 * Laws under test:
 *  - BOARD: the day's six offers are date-seeded and deterministic
 *    (foot/courier mix by index); the server recomputes the board at
 *    departure, so a forged offer id never validates.
 *  - RATES: foot payouts = duration x area idle rates x the dispatch
 *    levers (0.4 credits / 0.4 scrap / 1.0 materials at defaults) x
 *    loadout strength (clamped 0.5-1.5). Dispatch credits/hour at
 *    matched strength 1.0 are exactly 0.4x roaming's — never the
 *    best AFK income. No XP, no gear, no legendaries, no cores.
 *  - SLOTS: concurrency reads the dispatchQueueSlots lever (default
 *    2) everywhere — the third concurrent departure refuses; a
 *    raised lever admits more. Convenience parameter only.
 *  - LOCKS: committed instances go in_service + locked for the
 *    duration and are refused by re-dispatch; settlement releases
 *    them. The personal action slot is never touched.
 *  - COURIER (brief §2.3-§2.5, R10/R11): tiers gate on the VEHICLE's
 *    class unlock (2h>=1, 8h>=18, 24h>=42), never player level.
 *    Fuel = routeTicks x shipped burn, debited in full at departure.
 *    Wear = routeTicks x shipped decay; breakdown iff wear reaches
 *    departure condition — deterministic, priced, and shown in prep
 *    (Skimmer Deep Haul on High danger: 5,760 fuel, 115.2 wear,
 *    breaks at 100/115.2; Crawler Deep: 4,320 fuel, 23.04 wear,
 *    returns at ~77). Breakdown settles pro-rata at the breakdown
 *    fraction, refunds unflown fuel, returns the vehicle at 0.
 *    Credits = foot line x1.6 premium; cargo = floor(foot units x
 *    vehicle material bonus) — the Cargo Hauler's second job.
 *  - SETTLEMENT: server-side at term IN FULL (the AFK cap does not
 *    truncate dispatch), lazy on reads; recall pays the elapsed
 *    fraction capped at the breakdown point; pro-rata floors;
 *    nonce replays and double settles never double-pay.
 *  - LEVIATHAN (R11): unlock 75, yield 1.50, burn 1.6, decay 0.50,
 *    material bonus 0.15; TS/SQL twins agree; generator-gated below
 *    areaUnlockLevel 20; the brief's crossover holds — Skimmer and
 *    Leviathan both average ~1.45 over 2,000 fueled Medium ticks,
 *    Leviathan pulls ahead by 5,000 ticks on ~20% less fuel.
 *  - ECONOMY: settle payouts fold into the minted meters by family
 *    (credits_minted_dispatch / credits_minted_courier).
 *  - ADVERSARIAL: forged payout/duration/family/playerId fields in
 *    request bodies change nothing — terms resolve from server
 *    records under the JWT identity only.
 *
 * The SQL twin is exercised against real Postgres in the slice
 * harness (0032 chain: depart/settle/recall, lock refusals from the
 * shipped ops, metrics fold); its shapes are pinned textually below.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import {
  DISPATCH_LEVER_DEFAULTS,
  courierPayoutLines,
  courierProjection,
  courierTierGate,
  dispatchOffersForDate,
  dispatchSettlementFraction,
  dispatchStrengthFactor,
  findDispatchOffer,
  footPayoutLines,
  proratePayout,
  resolveDispatchLevers,
  roamingAreaById,
  roamingCreditsPerHour,
  type DispatchLeverValues,
} from '@/content/dispatch';
import {
  VEHICLE_CLASSES,
  conditionFraction,
  effectiveVehicleYield,
  getVehicleClass,
  vehicleBurnPerTick,
  vehicleDecayPerTick,
} from '@/lib/vehicles/vehicles';
import { generateVehicle, vehicleClassWeights } from '../server/lib/generators/vehicleGenerator';
import { ECONOMY_CONFIG_DEFAULTS, ECONOMY_CONFIG_KEYS, validateEconomyConfigValue } from '../server/economy/config';
import { InMemoryEconomyStore } from '../server/economy/memory';
import { mountDispatchRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type ProfileRowData, type WriteItemData } from '../server/writes/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
type Json = Record<string, unknown>;

const LEVERS: DispatchLeverValues = resolveDispatchLevers();
const HIGH_AREA = ROAMING_AREAS.find((a) => a.id === 'helixworks_labyrinth')!;
const MEDIUM_AREA = ROAMING_AREAS.find((a) => a.dangerRating === 'Medium')!;

const plainVehicle = (vehicleClassId: string) => ({ vehicleClassId: vehicleClassId as never, affixes: [] });

// ---------------------------------------------------------------------------
// 1. Content: board, strength, foot rates, roaming comparison
// ---------------------------------------------------------------------------

describe('dispatch content: board + foot math', () => {
  it('offers are date-seeded, stable within the day, and mix families by index', () => {
    const day = new Date('2026-11-03T05:00:00.000Z');
    const offers = dispatchOffersForDate(day);
    expect(offers).toHaveLength(6);
    expect(offers.map((o) => o.family)).toEqual(['foot', 'courier', 'foot', 'foot', 'courier', 'foot']);
    expect(offers.map((o) => o.id)).toEqual([
      'd20261103-0', 'd20261103-1', 'd20261103-2', 'd20261103-3', 'd20261103-4', 'd20261103-5',
    ]);
    // Same UTC day, different hour: identical board.
    expect(dispatchOffersForDate(new Date('2026-11-03T23:59:00.000Z'))).toEqual(offers);
    // Round-trip + forgery.
    expect(findDispatchOffer(day, offers[3].id)).toEqual(offers[3]);
    expect(findDispatchOffer(day, 'd20261103-9')).toBeNull();
    expect(findDispatchOffer(day, 'd20261104-0')).toBeNull();
  });

  it('strength: matched loadout is exactly 1.0; the factor clamps to [0.5, 1.5]', () => {
    const matched = Array.from({ length: 7 }, () => ({
      itemLevel: HIGH_AREA.unlockLevel, rarity: 'Uncommon',
    }));
    expect(dispatchStrengthFactor(matched, HIGH_AREA)).toBeCloseTo(1, 10);
    // No loadout, no strength (routes refuse an empty pick before
    // this matters); a token single item floors at 0.5.
    expect(dispatchStrengthFactor([], HIGH_AREA)).toBe(0);
    expect(dispatchStrengthFactor([{ itemLevel: 1, rarity: 'Common' }], HIGH_AREA)).toBe(0.5);
    const huge = Array.from({ length: 8 }, () => ({
      itemLevel: HIGH_AREA.unlockLevel * 4, rarity: 'Legendary',
    }));
    expect(dispatchStrengthFactor(huge, HIGH_AREA)).toBe(1.5);
  });

  it('foot payouts scale with duration x area x levers x strength', () => {
    const lines = footPayoutLines(HIGH_AREA, 8, 1, LEVERS, 'seed-1');
    // 8h x 21 cr/min x 60 x 0.4 = 4032 credits at strength 1.
    expect(lines.credits).toBe(Math.round(8 * HIGH_AREA.idleCreditsPerMinute * 60 * 0.4));
    expect(lines.scrap).toBe(Math.round(8 * HIGH_AREA.idleScrapPerMinute * 60 * 0.4));
    expect(lines.materialUnits).toBe(Math.floor(8 * (1 + HIGH_AREA.unlockLevel / 20) * 1));
    expect(HIGH_AREA.materialBias).toContain(lines.materialId);
    const stronger = footPayoutLines(HIGH_AREA, 8, 1.5, LEVERS, 'seed-1');
    expect(stronger.credits).toBe(Math.round(8 * HIGH_AREA.idleCreditsPerMinute * 60 * 0.4 * 1.5));
  });

  it('dispatch is never the best AFK income: 0.4x roaming credits/hour at matched strength', () => {
    for (const area of ROAMING_AREAS) {
      const perHour = footPayoutLines(area, 24, 1, LEVERS, 'seed-x').credits / 24;
      const roaming = roamingCreditsPerHour(area);
      expect(perHour).toBeLessThan(roaming);
      expect(perHour / roaming).toBeCloseTo(0.4, 1);
    }
  });

  it('settlement fractions: term pays 1, breakdown caps, recall pays elapsed capped at breakdown', () => {
    const H = 3600_000;
    expect(dispatchSettlementFraction({ elapsedMs: 24 * H, durationMs: 24 * H, breakdownFraction: null, recalled: false })).toBe(1);
    expect(dispatchSettlementFraction({ elapsedMs: 24 * H, durationMs: 24 * H, breakdownFraction: 0.5, recalled: false })).toBe(0.5);
    expect(dispatchSettlementFraction({ elapsedMs: 12 * H, durationMs: 24 * H, breakdownFraction: null, recalled: true })).toBe(0.5);
    expect(dispatchSettlementFraction({ elapsedMs: 20 * H, durationMs: 24 * H, breakdownFraction: 0.5, recalled: true })).toBe(0.5);
    const prorated = proratePayout({ credits: 101, scrap: 51, materialId: 'X', materialUnits: 7 }, 0.5);
    expect(prorated).toEqual({ credits: 50, scrap: 25, materialId: 'X', materialUnits: 3 });
  });
});

// ---------------------------------------------------------------------------
// 2. Courier arithmetic: the brief's worked table (§2.3) as fixtures
// ---------------------------------------------------------------------------

describe('courier arithmetic: brief §2.3 worked cases', () => {
  it('Relay Skimmer, 24h Deep Haul, High danger: 5,760 fuel, 115.2 wear, breaks at 100/115.2', () => {
    const p = courierProjection(plainVehicle('relay_skimmer'), 100, HIGH_AREA, 24, LEVERS);
    expect(p.routeTicks).toBe(2880);
    expect(p.fuelUnits).toBe(5760);
    expect(p.wearProjected).toBeCloseTo(115.2, 1);
    expect(p.breaksDown).toBe(true);
    expect(p.breakdownFraction).toBeCloseTo(100 / 115.2, 4);
    expect(p.returnCondition).toBe(0);
  });

  it('Armored Crawler, 24h Deep Haul: 4,320 fuel, 23.04 wear, returns at ~77', () => {
    const p = courierProjection(plainVehicle('armored_crawler'), 100, HIGH_AREA, 24, LEVERS);
    expect(p.fuelUnits).toBe(4320);
    expect(p.wearProjected).toBeCloseTo(23.04, 1);
    expect(p.breaksDown).toBe(false);
    expect(p.returnCondition).toBeCloseTo(76.96, 1);
  });

  it('Utility Rover, 8h Regional, Medium: 672 fuel, 13.44 wear', () => {
    const p = courierProjection(plainVehicle('utility_rover'), 100, MEDIUM_AREA, 8, LEVERS);
    expect(p.routeTicks).toBe(960);
    expect(p.fuelUnits).toBe(672);
    expect(p.wearProjected).toBeCloseTo(13.44, 1);
    expect(p.breaksDown).toBe(false);
  });

  it('Scrap Bike, 2h Local, Medium: 216 fuel, 5.28 wear', () => {
    const p = courierProjection(plainVehicle('scrap_bike'), 100, MEDIUM_AREA, 2, LEVERS);
    expect(p.routeTicks).toBe(240);
    expect(p.fuelUnits).toBe(216);
    expect(p.wearProjected).toBeCloseTo(5.28, 1);
  });

  it('a worn Skimmer breaks earlier: the fraction is condition/wear, deterministically', () => {
    const p = courierProjection(plainVehicle('relay_skimmer'), 50, HIGH_AREA, 24, LEVERS);
    expect(p.breaksDown).toBe(true);
    expect(p.breakdownFraction).toBeCloseTo(50 / 115.2, 4);
    // Same inputs, same answer — no RNG anywhere in the model.
    expect(courierProjection(plainVehicle('relay_skimmer'), 50, HIGH_AREA, 24, LEVERS)).toEqual(p);
  });

  it('courier payout: credits = foot x1.6 premium, scrap unpremiated, cargo bonus is the Hauler second job', () => {
    const foot = footPayoutLines(HIGH_AREA, 24, 1, LEVERS, 'seed-c');
    const hauler = courierPayoutLines(HIGH_AREA, 24, plainVehicle('cargo_hauler'), LEVERS, 'seed-c');
    expect(hauler.credits).toBe(Math.round(foot.credits * 1.6));
    expect(hauler.scrap).toBe(foot.scrap);
    expect(hauler.cargoBonusUnits).toBe(Math.floor(foot.materialUnits * 0.3));
    expect(hauler.cargoBonusUnits).toBeGreaterThan(0);
    expect(hauler.materialUnits).toBe(foot.materialUnits + hauler.cargoBonusUnits);
    const skimmer = courierPayoutLines(HIGH_AREA, 24, plainVehicle('relay_skimmer'), LEVERS, 'seed-c');
    expect(skimmer.cargoBonusUnits).toBe(0);
  });

  it('tier gates read the vehicle class unlock, by duration', () => {
    expect(courierTierGate(2)).toBe(1);
    expect(courierTierGate(8)).toBe(18);
    expect(courierTierGate(24)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 3. Leviathan Rig: row, invariants, crossover, generator gate
// ---------------------------------------------------------------------------

describe('leviathan rig', () => {
  it('the class row matches the brief exactly (R11)', () => {
    const def = getVehicleClass('leviathan_rig');
    expect(def).not.toBeNull();
    expect(def!.unlockLevel).toBe(75);
    expect(def!.baseYield).toBe(1.5);
    expect(def!.fuelBurnPerTick).toBe(1.6);
    expect(def!.conditionLossMultiplier).toBe(0.5);
    expect(def!.materialYieldBonus).toBe(0.15);
  });

  it('ladder invariants: unlocks strictly increase, no yield above the Skimmer, one cargo class >= 0.3', () => {
    const unlocks = VEHICLE_CLASSES.map((c) => c.unlockLevel);
    expect([...unlocks].sort((a, b) => a - b)).toEqual(unlocks);
    expect(new Set(unlocks).size).toBe(unlocks.length);
    expect(Math.max(...VEHICLE_CLASSES.map((c) => c.baseYield))).toBeLessThanOrEqual(1.6);
    expect(VEHICLE_CLASSES.filter((c) => c.materialYieldBonus >= 0.3)).toHaveLength(1);
  });

  it('crossover: Skimmer and Leviathan both average ~1.45 over 2,000 fueled Medium ticks; Leviathan ahead at 5,000 on ~20% less fuel', () => {
    const simulate = (classId: string, ticks: number) => {
      const vehicle = plainVehicle(classId);
      let condition = 100;
      let yieldSum = 0;
      let fuel = 0;
      for (let i = 0; i < ticks; i += 1) {
        yieldSum += effectiveVehicleYield(vehicle, conditionFraction(condition, 100), 1);
        fuel += vehicleBurnPerTick(vehicle);
        condition = Math.max(0, condition - vehicleDecayPerTick(vehicle, 'Medium'));
      }
      return { mean: yieldSum / ticks, fuel };
    };
    const skim2k = simulate('relay_skimmer', 2000);
    const levi2k = simulate('leviathan_rig', 2000);
    expect(skim2k.mean).toBeCloseTo(1.45, 1);
    expect(levi2k.mean).toBeCloseTo(1.45, 1);
    expect(Math.abs(skim2k.mean - levi2k.mean)).toBeLessThanOrEqual(0.02);
    expect(levi2k.fuel).toBeCloseTo(3200, 6);
    expect(skim2k.fuel).toBeCloseTo(4000, 6);
    const skim5k = simulate('relay_skimmer', 5000);
    const levi5k = simulate('leviathan_rig', 5000);
    expect(levi5k.mean).toBeGreaterThan(skim5k.mean);
  });

  it('generator gate: no Leviathan below areaUnlockLevel 20; it can drop above', () => {
    expect(vehicleClassWeights(19).some((w) => w.def.id === 'leviathan_rig')).toBe(false);
    expect(vehicleClassWeights(20).some((w) => w.def.id === 'leviathan_rig')).toBe(true);
    let seed = 1234567;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 200; i += 1) {
      const v = generateVehicle({ level: 30, areaUnlockLevel: 10 }, rng);
      expect(v.vehicleClassId).not.toBe('leviathan_rig');
    }
    const forced = generateVehicle({ level: 80, areaUnlockLevel: 30, forcedClassId: 'leviathan_rig' }, rng);
    expect(forced.vehicleClassId).toBe('leviathan_rig');
  });
});

// ---------------------------------------------------------------------------
// 4. Levers: economy-config registration + clamps
// ---------------------------------------------------------------------------

describe('dispatch levers', () => {
  it('all six levers are economy-config keys pinned to the content defaults', () => {
    for (const key of Object.keys(DISPATCH_LEVER_DEFAULTS)) {
      expect(ECONOMY_CONFIG_KEYS).toHaveProperty(key);
      expect((ECONOMY_CONFIG_DEFAULTS as unknown as Record<string, unknown>)[key])
        .toBe((DISPATCH_LEVER_DEFAULTS as unknown as Record<string, unknown>)[key]);
    }
  });

  it('validation rejects out-of-range writes; resolution clamps stored values', () => {
    expect(validateEconomyConfigValue('dispatchQueueSlots', 3)).toBe(3);
    expect(validateEconomyConfigValue('dispatchQueueSlots', 99)).toBeNull();
    expect(validateEconomyConfigValue('dispatchQueueSlots', 2.7)).toBeNull();
    expect(validateEconomyConfigValue('courierPremiumMultiplier', 9)).toBeNull();
    expect(resolveDispatchLevers({ dispatchQueueSlots: 99 }).dispatchQueueSlots).toBe(8);
    expect(resolveDispatchLevers({ dispatchQueueSlots: 0 }).dispatchQueueSlots).toBe(1);
    expect(resolveDispatchLevers({ dispatchQueueSlots: 2.7 }).dispatchQueueSlots).toBe(2);
    expect(resolveDispatchLevers({ courierPremiumMultiplier: 9 }).courierPremiumMultiplier).toBe(3);
    expect(resolveDispatchLevers({ courierPremiumMultiplier: 0.5 }).courierPremiumMultiplier).toBe(1);
    expect(resolveDispatchLevers({ dispatchCreditRate: 2 }).dispatchCreditRate).toBe(1);
    expect(resolveDispatchLevers({ courierRouteTicksPerHour: 10 }).courierRouteTicksPerHour).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 5. Routes + in-memory twin: slots, locks, settlement, courier, forgery
// ---------------------------------------------------------------------------

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface RouteHarness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
  tokenB: string;
  setNow: (d: Date) => void;
}

async function makeRouteServer(
  startNow: Date,
  leverProvider?: () => Partial<DispatchLeverValues>,
): Promise<RouteHarness> {
  let now = startNow;
  const nowFn = () => now;
  const store = new InMemoryChefGameplayStore(nowFn, undefined, leverProvider);
  const app = express();
  app.use(express.json());
  // The route reads levers through the economy-config accessor; the
  // twin reads them through its provider. A lever test injects the
  // same values through both, as production wiring does (one config
  // table behind both).
  const economyConfig = leverProvider
    ? { snapshot: async () => leverProvider() as Record<string, unknown> }
    : undefined;
  mountDispatchRoutes(app, store, {
    jwtSecret: SECRET, now: nowFn,
    ...(economyConfig ? { economyConfig: economyConfig as never } : {}),
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, false),
    setNow: (d: Date) => { now = d; },
  };
}

async function get(h: RouteHarness, path: string, token?: string) {
  const res = await fetch(`${h.base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function post(h: RouteHarness, path: string, body: unknown, token?: string) {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

type DispatchState = {
  slots: number;
  slotsUsed: number;
  vehicleFuel: number;
  offers: Array<{ id: string; family: string; areaId: string; durationHours: number; areaLocked: boolean }>;
  missions: Array<Json>;
  candidates: Array<Json>;
};

async function stateOf(h: RouteHarness): Promise<DispatchState> {
  const res = await get(h, '/api/dispatch/me', h.tokenA);
  expect(res.status).toBe(200);
  return res.json.dispatch as DispatchState;
}

function seedSpareWeapons(store: InMemoryChefGameplayStore, prefix: string, count: number, itemLevel = 25) {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `${prefix}-${i}`;
    store.seedItem({
      id, owner_user_id: A, kind: 'weapon', item_level: itemLevel, rarity: 'Uncommon',
      payload: { name: `Spare Gun ${i}` },
    });
    ids.push(id);
  }
  return ids;
}

function seedVehicle(
  store: InMemoryChefGameplayStore,
  id: string,
  vehicleClassId: string,
  condition = 100,
) {
  store.seedItem({
    id, owner_user_id: A, kind: 'vehicle', item_level: 50, rarity: 'Rare',
    condition_current: condition, condition_max: 100,
    payload: { name: id, vehicleClassId, affixes: [] },
  });
}

/** Find a UTC date whose board carries a 24h courier offer to the
 *  High-danger HelixWorks Labyrinth (the brief's worked route). */
function findDeepHaulDay(): { day: Date; offerId: string } {
  for (let offset = 0; offset < 400; offset += 1) {
    const day = new Date(Date.UTC(2026, 10, 1 + offset, 12, 0, 0));
    const offer = dispatchOffersForDate(day).find(
      (o) => o.family === 'courier' && o.durationHours === 24 && o.areaId === 'helixworks_labyrinth',
    );
    if (offer) return { day, offerId: offer.id };
  }
  throw new Error('no deep-haul day found in 400 days');
}

describe('dispatch routes', () => {
  it('requires auth; 404s without a profile; the board carries six offers and two slots', async () => {
    const h = await makeRouteServer(new Date('2026-11-03T12:00:00.000Z'));
    expect((await get(h, '/api/dispatch/me')).status).toBe(401);
    expect((await get(h, '/api/dispatch/me', h.tokenA)).status).toBe(404);
    h.store.seedProfile({ id: A, player_level: 50 });
    const state = await stateOf(h);
    expect(state.offers).toHaveLength(6);
    expect(state.slots).toBe(2);
    expect(state.slotsUsed).toBe(0);
  });

  it('foot flow: preview prices from server records, depart locks the loadout, term settles in full, replay never double-pays', async () => {
    const h = await makeRouteServer(new Date('2026-11-03T12:00:00.000Z'));
    h.store.seedProfile({ id: A, player_level: 50, credits: 0, scrap: 0 });
    const itemIds = seedSpareWeapons(h.store, 'gun', 7, HIGH_AREA.unlockLevel);
    const state = await stateOf(h);
    const offer = state.offers.find((o) => o.family === 'foot' && !o.areaLocked)!;
    const area = roamingAreaById(offer.areaId)!;

    const preview = await post(h, '/api/dispatch/preview', { offerId: offer.id, itemIds }, h.tokenA);
    expect(preview.status).toBe(200);
    expect(preview.json.eligible).toBe(true);
    const strength = dispatchStrengthFactor(
      itemIds.map(() => ({ itemLevel: HIGH_AREA.unlockLevel, rarity: 'Uncommon' })), area);
    const expected = footPayoutLines(area, offer.durationHours, strength, LEVERS, `${A}:${offer.id}`);
    const previewPayout = (preview.json.preview as Json).payout as Json;
    expect(previewPayout.credits).toBe(expected.credits);
    expect(previewPayout.scrap).toBe(expected.scrap);

    const body = { offerId: offer.id, itemIds, nonce: 'dispatch-start-0001' };
    const started = await post(h, '/api/dispatch/start', body, h.tokenA);
    expect(started.status).toBe(200);
    // The loadout is escrowed: in_service + locked in the store.
    for (const id of itemIds) {
      const item = h.store.items.get(id)!;
      expect(item.runtime_state).toBe('in_service');
      expect(item.is_locked).toBe(true);
    }
    // Re-dispatching an away item refuses.
    const again = await post(h, '/api/dispatch/start', {
      offerId: offer.id, itemIds: [itemIds[0]], nonce: 'dispatch-start-0002',
    }, h.tokenA);
    expect(again.status).toBe(400);
    // Nonce replay returns the same departure, no second mission.
    const replay = await post(h, '/api/dispatch/start', body, h.tokenA);
    expect(replay.status).toBe(200);
    expect(replay.json.idempotentReplay).toBe(true);
    expect(h.store.dispatchMissions.filter((m) => m.user_id === A)).toHaveLength(1);

    // Advance past term: the next read settles IN FULL (no AFK cap).
    h.setNow(new Date(new Date('2026-11-03T12:00:00.000Z').getTime() + (offer.durationHours + 1) * 3600_000));
    const settled = await stateOf(h);
    const mission = settled.missions[0];
    expect(mission.status).toBe('settled');
    expect(mission.payout_fraction).toBe(1);
    expect(h.store.profiles.get(A)!.credits).toBe(expected.credits);
    expect(h.store.profiles.get(A)!.scrap).toBe(expected.scrap);
    // Gear is home and usable again.
    for (const id of itemIds) {
      const item = h.store.items.get(id)!;
      expect(item.runtime_state).toBe('available');
      expect(item.is_locked).toBe(false);
    }
    // A second settle pays nothing more.
    await stateOf(h);
    expect(h.store.profiles.get(A)!.credits).toBe(expected.credits);
    expect(h.store.dispatchSettleLog).toHaveLength(1);
  });

  it('slot cap comes from the lever: the third concurrent departure refuses; a raised lever admits more', async () => {
    const h = await makeRouteServer(new Date('2026-11-03T12:00:00.000Z'));
    h.store.seedProfile({ id: A, player_level: 50 });
    const ids = seedSpareWeapons(h.store, 'slot-gun', 24);
    const state = await stateOf(h);
    const footOffers = state.offers.filter((o) => o.family === 'foot' && !o.areaLocked);
    let cursor = 0;
    const departOne = async (nonce: string) => {
      const offer = footOffers[cursor % footOffers.length];
      const items = ids.slice(cursor * 2, cursor * 2 + 2);
      cursor += 1;
      return post(h, '/api/dispatch/start', { offerId: offer.id, itemIds: items, nonce }, h.tokenA);
    };
    expect((await departOne('slot-nonce-0001')).status).toBe(200);
    expect((await departOne('slot-nonce-0002')).status).toBe(200);
    const third = await departOne('slot-nonce-0003');
    expect(third.status).toBe(400);
    expect(String(third.json.detail ?? third.json.error)).toContain('Dispatch queue full');

    // Same world, lever raised to 4: four concurrent missions fit.
    const h2 = await makeRouteServer(
      new Date('2026-11-03T12:00:00.000Z'),
      () => ({ dispatchQueueSlots: 4 }),
    );
    h2.store.seedProfile({ id: A, player_level: 50 });
    seedSpareWeapons(h2.store, 'slot-gun', 24);
    const state2 = await stateOf(h2);
    expect(state2.slots).toBe(4);
    const foot2 = state2.offers.filter((o) => o.family === 'foot' && !o.areaLocked);
    for (let i = 0; i < 4; i += 1) {
      const res = await post(h2, '/api/dispatch/start', {
        offerId: foot2[i % foot2.length].id,
        itemIds: [`slot-gun-${i * 2}`, `slot-gun-${i * 2 + 1}`],
        nonce: `slot2-nonce-000${i}`,
      }, h2.tokenA);
      expect(res.status).toBe(200);
    }
  });

  it('recall pays the elapsed fraction and frees the gear early', async () => {
    const t0 = new Date('2026-11-03T12:00:00.000Z');
    const h = await makeRouteServer(t0);
    h.store.seedProfile({ id: A, player_level: 50, credits: 0 });
    const itemIds = seedSpareWeapons(h.store, 'recall-gun', 7, HIGH_AREA.unlockLevel);
    const state = await stateOf(h);
    const offer = state.offers.find((o) => o.family === 'foot' && !o.areaLocked)!;
    const area = roamingAreaById(offer.areaId)!;
    const strength = dispatchStrengthFactor(
      itemIds.map(() => ({ itemLevel: HIGH_AREA.unlockLevel, rarity: 'Uncommon' })), area);
    const expected = footPayoutLines(area, offer.durationHours, strength, LEVERS, `${A}:${offer.id}`);
    const started = await post(h, '/api/dispatch/start', {
      offerId: offer.id, itemIds, nonce: 'recall-start-0001',
    }, h.tokenA);
    expect(started.status).toBe(200);
    const missionId = String((started.json.departed as Json).mission_id ?? (started.json.departed as Json).id ?? '');
    const missions = h.store.dispatchMissions.filter((m) => m.user_id === A);
    const mid = missionId || missions[0].id;

    h.setNow(new Date(t0.getTime() + (offer.durationHours / 2) * 3600_000));
    const recalled = await post(h, '/api/dispatch/recall', { missionId: mid, nonce: 'recall-nonce-0001' }, h.tokenA);
    expect(recalled.status).toBe(200);
    const settlement = recalled.json.settlement as Json;
    expect(Number(settlement.fraction)).toBeCloseTo(0.5, 6);
    expect(h.store.profiles.get(A)!.credits).toBe(Math.floor(expected.credits * 0.5));
    expect(h.store.items.get(itemIds[0])!.runtime_state).toBe('available');
    // Recall replay: same nonce, no second payout.
    const replay = await post(h, '/api/dispatch/recall', { missionId: mid, nonce: 'recall-nonce-0001' }, h.tokenA);
    expect(replay.status).toBe(200);
    expect(h.store.profiles.get(A)!.credits).toBe(Math.floor(expected.credits * 0.5));
  });

  it('dispatch never touches the personal action slot', async () => {
    const h = await makeRouteServer(new Date('2026-11-03T12:00:00.000Z'));
    h.store.seedProfile({ id: A, player_level: 50 });
    const action = h.store.seedActiveAction({
      user_id: A, kind: 'roaming', area_id: 'dustwaste_frontier', started_at: new Date().toISOString(),
    } as never);
    const itemIds = seedSpareWeapons(h.store, 'parallel-gun', 3);
    const state = await stateOf(h);
    const offer = state.offers.find((o) => o.family === 'foot' && !o.areaLocked)!;
    const started = await post(h, '/api/dispatch/start', {
      offerId: offer.id, itemIds, nonce: 'parallel-nonce-01',
    }, h.tokenA);
    expect(started.status).toBe(200);
    expect(h.store.activeActions.get(A)).toBe(action);
  });

  it('adversarial: forged payout/duration/family/playerId fields change nothing', async () => {
    const h = await makeRouteServer(new Date('2026-11-03T12:00:00.000Z'));
    h.store.seedProfile({ id: A, player_level: 50, credits: 0 });
    h.store.seedProfile({ id: B, player_level: 50, credits: 0 });
    const itemIds = seedSpareWeapons(h.store, 'forge-gun', 7, HIGH_AREA.unlockLevel);
    const state = await stateOf(h);
    const offer = state.offers.find((o) => o.family === 'foot' && !o.areaLocked)!;
    const area = roamingAreaById(offer.areaId)!;
    const strength = dispatchStrengthFactor(
      itemIds.map(() => ({ itemLevel: HIGH_AREA.unlockLevel, rarity: 'Uncommon' })), area);
    const expected = footPayoutLines(area, offer.durationHours, strength, LEVERS, `${A}:${offer.id}`);
    // A body playerId that disagrees with the JWT is a 403 (the
    // chefRouteAuth law) — identity never comes from the body.
    const mismatched = await post(h, '/api/dispatch/start', {
      offerId: offer.id, itemIds, nonce: 'forge-nonce-0000', playerId: B,
    }, h.tokenA);
    expect(mismatched.status).toBe(403);
    const forged = await post(h, '/api/dispatch/start', {
      offerId: offer.id,
      itemIds,
      nonce: 'forge-nonce-0001',
      payout_credits: 999999999,
      payoutCredits: 999999999,
      duration_hours: 999,
      durationHours: 999,
      family: 'courier',
      credits: 123456,
    }, h.tokenA);
    expect(forged.status).toBe(200);
    const mission = h.store.dispatchMissions.find((m) => m.user_id === A)!;
    expect(mission.contract_family).toBe('foot');
    expect(mission.duration_hours).toBe(offer.durationHours);
    expect(mission.payout_credits).toBe(expected.credits);
    expect(h.store.profiles.get(B)!.credits).toBe(0);
    expect(h.store.dispatchMissions.filter((m) => m.user_id === B)).toHaveLength(0);
    // A forged offer id never validates.
    const badOffer = await post(h, '/api/dispatch/start', {
      offerId: 'd20990101-0', itemIds, nonce: 'forge-nonce-0002',
    }, h.tokenA);
    expect(badOffer.status).toBe(400);
  });
});

describe('courier routes: gating, fuel, breakdown', () => {
  it('class band gates the tier — player level is irrelevant both ways', async () => {
    const { day, offerId } = findDeepHaulDay();
    const h = await makeRouteServer(day);
    // Player level 100 with a Rover (class unlock 18 < 42): refused.
    h.store.seedProfile({ id: A, player_level: 100, vehicle_fuel: 100000 });
    seedVehicle(h.store, 'rover-1', 'utility_rover');
    const roverPreview = await post(h, '/api/dispatch/preview', { offerId, vehicleItemId: 'rover-1' }, h.tokenA);
    expect(roverPreview.status).toBe(200);
    expect(roverPreview.json.eligible).toBe(false);
    expect((roverPreview.json.reasons as string[]).join(' ')).toContain('class');
    const roverStart = await post(h, '/api/dispatch/start', {
      offerId, vehicleItemId: 'rover-1', nonce: 'gate-nonce-0001',
    }, h.tokenA);
    expect(roverStart.status).toBe(400);
    // Player level 25 (the area's own unlock) with a Crawler (42):
    // eligible — the gate read the vehicle, not the player.
    h.store.seedProfile({ id: B, player_level: 25, vehicle_fuel: 100000 });
    h.store.seedItem({
      id: 'crawler-b', owner_user_id: B, kind: 'vehicle', item_level: 50, rarity: 'Rare',
      condition_current: 100, condition_max: 100,
      payload: { name: 'crawler-b', vehicleClassId: 'armored_crawler', affixes: [] },
    });
    const crawlerPreview = await post(h, '/api/dispatch/preview', { offerId, vehicleItemId: 'crawler-b' }, h.tokenB);
    expect(crawlerPreview.status).toBe(200);
    expect(crawlerPreview.json.eligible).toBe(true);
  });

  it('fuel shortfall refuses with the exact cell shortfall; fuel debits in full at departure', async () => {
    const { day, offerId } = findDeepHaulDay();
    const h = await makeRouteServer(day);
    h.store.seedProfile({ id: A, player_level: 50, vehicle_fuel: 5000 });
    seedVehicle(h.store, 'skimmer-1', 'relay_skimmer');
    const preview = await post(h, '/api/dispatch/preview', { offerId, vehicleItemId: 'skimmer-1' }, h.tokenA);
    expect(preview.json.eligible).toBe(false);
    // Skimmer Deep Haul burns 5,760 units = 58 cells; 5,000 units = 50
    // cells on hand: shortfall is exactly 8 cells.
    expect((preview.json.reasons as string[]).join(' ')).toContain('needs 8 more');
    h.store.seedProfile({ id: A, player_level: 50, vehicle_fuel: 5760 });
    const started = await post(h, '/api/dispatch/start', {
      offerId, vehicleItemId: 'skimmer-1', nonce: 'fuel-nonce-0001',
    }, h.tokenA);
    expect(started.status).toBe(200);
    expect(h.store.profiles.get(A)!.vehicle_fuel).toBe(0);
    expect(h.store.items.get('skimmer-1')!.runtime_state).toBe('in_service');
  });

  it('breakdown end-to-end: prep projection == settlement; pro-rata pay, fuel refund, vehicle home at 0', async () => {
    const { day, offerId } = findDeepHaulDay();
    const h = await makeRouteServer(day);
    h.store.seedProfile({ id: A, player_level: 50, credits: 0, vehicle_fuel: 10000 });
    seedVehicle(h.store, 'skimmer-2', 'relay_skimmer');
    seedVehicle(h.store, 'crawler-2', 'armored_crawler');

    const skimPreview = await post(h, '/api/dispatch/preview', { offerId, vehicleItemId: 'skimmer-2' }, h.tokenA);
    const skim = skimPreview.json.preview as Json;
    expect(skim.breaksDown).toBe(true);
    expect(Number(skim.wearProjected)).toBeCloseTo(115.2, 1);
    const crawlPreview = await post(h, '/api/dispatch/preview', { offerId, vehicleItemId: 'crawler-2' }, h.tokenA);
    const crawl = crawlPreview.json.preview as Json;
    expect(crawl.breaksDown).toBe(false);
    expect(Number(crawl.returnCondition)).toBeCloseTo(76.96, 0);

    const started = await post(h, '/api/dispatch/start', {
      offerId, vehicleItemId: 'skimmer-2', nonce: 'break-nonce-0001',
    }, h.tokenA);
    expect(started.status).toBe(200);
    expect(h.store.profiles.get(A)!.vehicle_fuel).toBe(10000 - 5760);

    h.setNow(new Date(day.getTime() + 25 * 3600_000));
    const settled = await stateOf(h);
    const mission = settled.missions.find((m) => m.vehicle_item_id === 'skimmer-2')!;
    expect(mission.status).toBe('settled');
    const fraction = 100 / 115.2;
    expect(Number(mission.payout_fraction)).toBeCloseTo(fraction, 4);
    expect(Number(mission.wear_applied)).toBeCloseTo(100, 6);
    const lines = courierPayoutLines(HIGH_AREA, 24, plainVehicle('relay_skimmer'), LEVERS, `${A}:${offerId}`);
    expect(h.store.profiles.get(A)!.credits).toBe(Math.floor(lines.credits * fraction));
    // Unflown fuel refunded: (1 - f) x 5,760 = 760 units.
    expect(h.store.profiles.get(A)!.vehicle_fuel).toBeCloseTo(10000 - 5760 + 760, 4);
    // The vehicle is home, released, at 0 condition (repair lane's job now).
    const vehicle = h.store.items.get('skimmer-2')!;
    expect(vehicle.runtime_state).toBe('available');
    expect(vehicle.is_locked).toBe(false);
    expect(vehicle.condition_current).toBe(0);
  });

  it('cargo hauler affix stacks on the class bonus in the cargo line', () => {
    const withAffix = courierPayoutLines(HIGH_AREA, 24, {
      vehicleClassId: 'cargo_hauler' as never,
      affixes: [{ stat: 'vehicleCargoPct', value: 0.1 } as never],
    }, LEVERS, 'seed-c');
    const foot = footPayoutLines(HIGH_AREA, 24, 1, LEVERS, 'seed-c');
    expect(withAffix.cargoBonusUnits).toBe(Math.floor(foot.materialUnits * 0.4));
  });
});

// ---------------------------------------------------------------------------
// 6. Economy fold + SQL twin pins
// ---------------------------------------------------------------------------

describe('dispatch economy fold', () => {
  it('memory metrics fold dispatch + courier settle credits into the minted total', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const store = new InMemoryEconomyStore({
      config: {},
      items: [],
      ledger: [
        {
          action_type: 'cc_dispatch_settle', created_at: `${today}T10:00:00.000Z`,
          result_payload: { family: 'foot', payout: { credits: 300 } },
        },
        {
          action_type: 'cc_dispatch_settle', created_at: `${today}T11:00:00.000Z`,
          result_payload: { family: 'courier', payout: { credits: 700 } },
        },
      ],
    });
    const row = await store.computeMetricsForDay(today);
    expect(row.creditsMintedDispatch).toBe(300);
    expect(row.creditsMintedCourier).toBe(700);
    expect(row.creditsMintedTotal).toBe(1000);
  });
});

describe('dispatch SQL twin pins (0032)', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0032_dispatch.sql'), 'utf8');

  it('carries the Leviathan SQL twin and the reserved courier fields (§2.7)', () => {
    expect(sql).toContain('leviathan_rig');
    expect(sql).toMatch(/leviathan_rig'?\s*(then|,)\s*75/);
    for (const column of [
      'contract_family', 'offer_id', 'seed', 'destination_area_id', 'duration_hours',
      'loadout_item_ids', 'loadout_strength', 'payout_credits', 'payout_scrap',
      'payout_material_id', 'payout_material_units', 'vehicle_item_id', 'vehicle_class_id',
      'route_ticks', 'fuel_charged_units', 'fuel_refunded_units', 'condition_at_departure',
      'wear_projected', 'wear_applied', 'breakdown_fraction', 'cargo_bonus_units',
      'premium_multiplier', 'payout_fraction', 'departed_at', 'ends_at', 'settled_at',
    ]) {
      expect(sql).toContain(column);
    }
    for (const fn of ['cc_dispatch_depart', 'cc_dispatch_settle_mission', 'cc_dispatch_settle_due', 'cc_dispatch_recall']) {
      expect(sql).toContain(fn);
    }
  });

  it('folds dispatch mints into the economy metrics restatement', () => {
    expect(sql).toContain('credits_minted_dispatch');
    expect(sql).toContain('credits_minted_courier');
    expect(sql).toContain('cc_dispatch_settle');
  });

  it('escrow hardening: equip / market / item-lock restated with in_service refusals', () => {
    // cc_recycle_item (0026), cc_reforge_item (0027) and
    // cc_post_repair_job (0025) already refused in_service; 0032
    // closes the three live gaps. The retired cc_use_patch_kit /
    // cc_item_service_request (dropped in 0025) stay dropped.
    expect(sql).toContain("runtime_state in ('listed','consumed','salvaged','in_service')");
    expect(sql).toContain("runtime_state in ('listed','equipped','salvaged','consumed','in_service')");
    expect(sql).not.toContain('cc_use_patch_kit: verbatim');
    expect(sql).not.toContain('cc_item_service_request: verbatim');
  });
});

// ---------------------------------------------------------------------------
// 7. Writes-twin lock matrix: the /ops store refuses the same moves
// ---------------------------------------------------------------------------

describe('dispatch lock matrix (writes twin)', () => {
  it('itemLock and marketCreate refuse an in_service instance; equip already does', async () => {
    const seed = emptyWriteSeed();
    seed.profiles = [{
      id: A, player_level: 50, player_xp: 0, credits: 1000, scrap: 0,
      cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {}, consumables: {},
      skill_spends: {}, boss_state: {}, last_idle_claim_at: null, last_claimed_tick: 0,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      account_type: 'verified', email: 'a@example.com', email_verified_at: '2026-10-01T00:00:00.000Z',
      verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
      last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: null,
      vehicle_fuel: 0, workshop_benches: 1, workshop_tools: {},
    } as ProfileRowData];
    const awayItem = {
      id: '99999999-9999-4999-8999-999999999999', owner_user_id: A, kind: 'weapon',
      static_item_id: null, item_level: 25, rarity: 'Uncommon', quality: null,
      material_tier: null, condition_state: null, condition_current: null, condition_max: null,
      supply_mode: 'verified_action', source_id: null, creator_user_id: null,
      tradeable: true, account_bound: false, locked_until: null,
      payload: { name: 'Away Gun', weaponType: 'AR' }, runtime_state: 'in_service', is_locked: true,
      equipped_slot: null, estimated_value: 100,
    } as unknown as WriteItemData;
    seed.items = [awayItem];
    const writes = new InMemoryWriteStore(seed);
    await expect(writes.itemLock(A, 'twin-lock-nonce-1', awayItem.id, false)).rejects.toThrow('Item state invalid');
    await expect(writes.marketCreate(A, 'twin-market-nonce-1', awayItem.id, 500)).rejects.toThrow();
    await expect(writes.equipItem(A, 'twin-equip-nonce-1', awayItem.id, 'primary')).rejects.toThrow('Item state invalid');
    // The instance is untouched by all three refusals.
    expect(seed.items[0].runtime_state).toBe('in_service');
    expect(seed.items[0].is_locked).toBe(true);
  });
});
