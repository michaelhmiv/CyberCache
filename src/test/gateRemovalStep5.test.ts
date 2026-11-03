/**
 * Gate-removal step 5 (migration 0062) — Dispatch courier tiers:
 *
 *   - The courier bands were keyed on the vehicle class ladder's
 *     unlockLevel values (Local >= 1, Regional >= 18, Deep >= 42)
 *     on all three paths: src/content/dispatch.ts, the in-memory
 *     gameplay twin, and cc_dispatch_depart (migration 0032) via
 *     cc_vehicle_unlock_level. The gate never read the PLAYER's
 *     level — but its carrier was a level-shaped number, and the
 *     vehicles slice (0054) had already deleted the equip gate
 *     keyed on the same field family (audit item G7).
 *   - 0062 retargets the SQL gate to the class TIER INDEX — the
 *     class's position in the shipped ladder — via the new twin
 *     cc_vehicle_class_tier (Scrap Bike 0 -> Leviathan Rig 6),
 *     restating cc_dispatch_depart verbatim from 0032 with exactly
 *     the gate block changed (thresholds 0 / 2 / 4; the refusal
 *     'Vehicle class cannot run this courier tier' byte-identical).
 *   - The TS paths read the same carrier: vehicleClassTierIndex
 *     (src/lib/vehicles/vehicles.ts) under vehicleClassEligibleForTier
 *     (src/content/dispatch.ts); the in-memory twin calls the shared
 *     helper instead of re-deriving from the ladder.
 *   - The qualifying class sets are IDENTICAL to the old bands —
 *     pinned below against the pre-change sets computed from the
 *     ladder values themselves. Payouts, durations, and yields do
 *     not change: a gate-carrier swap, not a rebalance. (baseYield
 *     could not be the carrier: the Deep Haul anchor, Armored
 *     Crawler, carries the ladder's LOWEST baseYield, 1.05.)
 *   - The unlockLevel field SURVIVES, deliberately: the roaming
 *     drop flavor weighting (src/server/lib/generators/
 *     vehicleGenerator.ts) still reads it against AREA ladders, and
 *     cc_equip_item (0054) still calls cc_vehicle_unlock_level as a
 *     class-existence check. Neither reads a player's level.
 *   - Behavior pins (route harness over the in-memory twin): a
 *     level-1 player with an Armored Crawler CAN start a Deep Haul;
 *     a level-100 player with a Dune Buggy CANNOT start a Regional
 *     Haul, and the refusal names the capability remedy (Utility
 *     Rover class or stronger) — never a level.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COURIER_TIER_BY_DURATION,
  courierTierAnchorClass,
  courierTierGate,
  dispatchOffersForDate,
  vehicleClassEligibleForTier,
  type DispatchDurationHours,
} from '@/content/dispatch';
import {
  VEHICLE_CLASSES,
  getVehicleClass,
  vehicleClassTierIndex,
} from '@/lib/vehicles/vehicles';
import { mountDispatchRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { issueAccessToken } from '../server/auth/tokens';

const MIGRATION_0062 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0062_dispatch_courier_tier.sql'),
  'utf8',
);
const DISPATCH_CONTENT = readFileSync(
  join(process.cwd(), 'src', 'content', 'dispatch.ts'),
  'utf8',
);

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
type Json = Record<string, unknown>;

// ─── 0062 textual pins (gate-removal step 5) ────────────────────

describe('migration 0062 — courier tiers read the class tier index', () => {
  // In the executable SQL (comment lines stripped — the header
  // narrates the retarget), the old carrier is gone entirely.
  const executable = MIGRATION_0062.split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('defines cc_vehicle_class_tier as the twin of the TS ladder order', () => {
    expect(MIGRATION_0062).toContain('function public.cc_vehicle_class_tier');
    VEHICLE_CLASSES.forEach((def, index) => {
      expect(executable).toContain(`when '${def.id}' then ${index}`);
      expect(vehicleClassTierIndex(def.id)).toBe(index);
    });
    expect(vehicleClassTierIndex('not_a_class')).toBe(-1);
    expect(vehicleClassTierIndex(null)).toBe(-1);
  });

  it('restates cc_dispatch_depart with the tier gate — and no level survives in it', () => {
    expect(MIGRATION_0062).toContain('function public.cc_dispatch_depart');
    expect(executable).toContain('public.cc_vehicle_class_tier');
    expect(executable).toContain('when 2 then 0 when 8 then 2 when 24 then 4');
    expect(executable).not.toContain('cc_vehicle_unlock_level');
    expect(executable).not.toContain('player_level');
    // The refusal text is byte-identical to 0032's.
    expect(executable).toContain("raise exception 'Vehicle class cannot run this courier tier'");
    // The surviving machinery is byte-identical too.
    expect(executable).toContain("raise exception 'Dispatch queue full'");
    expect(executable).toContain("raise exception 'Insufficient vehicle fuel'");
    expect(executable).toContain("values (actor, 'cc_dispatch_depart', nonce, result)");
  });

  it('does NOT drop cc_vehicle_unlock_level — equip still reads it as a class check', () => {
    expect(executable.toLowerCase()).not.toContain('drop function');
    const sql0054 = readFileSync(
      join(process.cwd(), 'db', 'migrations', '0054_vehicle_equip_no_level_gate.sql'),
      'utf8',
    );
    expect(sql0054).toContain('cc_vehicle_unlock_level');
  });
});

// ─── TS carrier pins ────────────────────────────────────────────

describe('the TS courier gate after step 5', () => {
  it('tier gates are anchor-class tier indices; the anchors are classes', () => {
    expect(courierTierGate(2)).toBe(0);
    expect(courierTierGate(8)).toBe(2);
    expect(courierTierGate(24)).toBe(4);
    expect(courierTierAnchorClass(2)?.id).toBe('scrap_bike');
    expect(courierTierAnchorClass(8)?.id).toBe('utility_rover');
    expect(courierTierAnchorClass(24)?.id).toBe('armored_crawler');
    expect(COURIER_TIER_BY_DURATION[8].name).toBe('Regional Haul');
    expect(COURIER_TIER_BY_DURATION[24].name).toBe('Deep Haul');
    expect(DISPATCH_CONTENT).not.toContain('minClassUnlockLevel');
    expect(DISPATCH_CONTENT).toContain('vehicleClassTierIndex');
  });

  it('the qualifying sets are exactly the pre-change bands', () => {
    // Pre-change bands, from the ladder values the old gate read.
    const oldGate: Record<DispatchDurationHours, number> = { 2: 1, 8: 18, 24: 42 };
    for (const duration of [2, 8, 24] as DispatchDurationHours[]) {
      const before = VEHICLE_CLASSES
        .filter((c) => c.unlockLevel >= oldGate[duration])
        .map((c) => c.id);
      const after = VEHICLE_CLASSES
        .filter((c) => vehicleClassEligibleForTier(c.id, duration))
        .map((c) => c.id);
      expect(after, `duration ${duration}h`).toEqual(before);
    }
    // The sets, spelled out: Regional is Utility Rover and up,
    // Deep is Armored Crawler and up.
    expect(VEHICLE_CLASSES.filter((c) => vehicleClassEligibleForTier(c.id, 8)).map((c) => c.id))
      .toEqual(['utility_rover', 'cargo_hauler', 'armored_crawler', 'relay_skimmer', 'leviathan_rig']);
    expect(VEHICLE_CLASSES.filter((c) => vehicleClassEligibleForTier(c.id, 24)).map((c) => c.id))
      .toEqual(['armored_crawler', 'relay_skimmer', 'leviathan_rig']);
    // An unknown class runs nothing — not even a Local Run.
    for (const duration of [2, 8, 24] as DispatchDurationHours[]) {
      expect(vehicleClassEligibleForTier('not_a_class', duration)).toBe(false);
      expect(vehicleClassEligibleForTier(null, duration)).toBe(false);
    }
  });

  it('the ladder field survives for its remaining reader (drop flavor)', () => {
    // vehicles.test.ts pins the full table; here the point is only
    // that step 5 did NOT remove the field the generator reads.
    expect(getVehicleClass('armored_crawler')!.unlockLevel).toBe(42);
    const generator = readFileSync(
      join(process.cwd(), 'src', 'server', 'lib', 'generators', 'vehicleGenerator.ts'),
      'utf8',
    );
    expect(generator).toContain('def.unlockLevel');
  });
});

// ─── Behavior: the route harness over the in-memory twin ────────

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface RouteHarness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
}

async function makeRouteServer(startNow: Date): Promise<RouteHarness> {
  const nowFn = () => startNow;
  const store = new InMemoryChefGameplayStore(nowFn);
  const app = express();
  app.use(express.json());
  mountDispatchRoutes(app, store, { jwtSecret: SECRET, now: nowFn });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return { store, base: `http://127.0.0.1:${port}`, tokenA: issueAccessToken(SECRET, A, false) };
}

async function post(h: RouteHarness, path: string, body: unknown) {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${h.tokenA}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function seedVehicle(store: InMemoryChefGameplayStore, id: string, vehicleClassId: string) {
  store.seedItem({
    id, owner_user_id: A, kind: 'vehicle', item_level: 50, rarity: 'Rare',
    condition_current: 100, condition_max: 100,
    payload: { name: id, vehicleClassId, affixes: [] },
  });
}

/** Find a UTC date whose board carries a courier offer of the
 *  given duration (any destination). */
function findCourierDay(durationHours: DispatchDurationHours): { day: Date; offerId: string } {
  for (let offset = 0; offset < 400; offset += 1) {
    const day = new Date(Date.UTC(2026, 10, 1 + offset, 12, 0, 0));
    const offer = dispatchOffersForDate(day).find(
      (o) => o.family === 'courier' && o.durationHours === durationHours,
    );
    if (offer) return { day, offerId: offer.id };
  }
  throw new Error(`no ${durationHours}h courier day found in 400 days`);
}

describe('courier eligibility after step 5 — the player level never speaks', () => {
  it('a level-1 player with an Armored Crawler CAN start a Deep Haul', async () => {
    const { day, offerId } = findCourierDay(24);
    const h = await makeRouteServer(day);
    h.store.seedProfile({ id: A, player_level: 1, vehicle_fuel: 100000 });
    seedVehicle(h.store, 'crawler-l1', 'armored_crawler');

    const preview = await post(h, '/api/dispatch/preview', { offerId, vehicleItemId: 'crawler-l1' });
    expect(preview.status).toBe(200);
    expect(preview.json.eligible).toBe(true);

    const started = await post(h, '/api/dispatch/start', {
      offerId, vehicleItemId: 'crawler-l1', nonce: 'step5-nonce-0001',
    });
    expect(started.status).toBe(200);
    expect(h.store.items.get('crawler-l1')!.runtime_state).toBe('in_service');
    expect(h.store.profiles.get(A)!.player_level).toBe(1); // never leveled — the vehicle was the gate
  });

  it('a level-100 player with a Dune Buggy CANNOT start a Regional Haul — and the refusal names the remedy', async () => {
    const { day, offerId } = findCourierDay(8);
    const h = await makeRouteServer(day);
    h.store.seedProfile({ id: A, player_level: 100, vehicle_fuel: 100000 });
    seedVehicle(h.store, 'buggy-l100', 'dune_buggy');

    const preview = await post(h, '/api/dispatch/preview', { offerId, vehicleItemId: 'buggy-l100' });
    expect(preview.status).toBe(200);
    expect(preview.json.eligible).toBe(false);
    const reasons = (preview.json.reasons as string[]).join(' ');
    // Capability shortfall + remedy, in capability terms.
    expect(reasons).toContain('Dune Buggy cannot run the Regional Haul');
    expect(reasons).toContain('Utility Rover class or stronger');
    expect(reasons).toContain('assign a stronger spare vehicle');
    // Never a level.
    expect(reasons.toLowerCase()).not.toContain('level');

    const started = await post(h, '/api/dispatch/start', {
      offerId, vehicleItemId: 'buggy-l100', nonce: 'step5-nonce-0002',
    });
    expect(started.status).toBe(400);
    expect(h.store.items.get('buggy-l100')!.runtime_state).toBe('available');
  });

  it('the anchor class itself qualifies: a level-1 player with a Utility Rover runs a Regional Haul', async () => {
    const { day, offerId } = findCourierDay(8);
    const h = await makeRouteServer(day);
    h.store.seedProfile({ id: A, player_level: 1, vehicle_fuel: 100000 });
    seedVehicle(h.store, 'rover-l1', 'utility_rover');

    const preview = await post(h, '/api/dispatch/preview', { offerId, vehicleItemId: 'rover-l1' });
    expect(preview.status).toBe(200);
    expect(preview.json.eligible).toBe(true);
    const started = await post(h, '/api/dispatch/start', {
      offerId, vehicleItemId: 'rover-l1', nonce: 'step5-nonce-0003',
    });
    expect(started.status).toBe(200);
  });
});
