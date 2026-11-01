/**
 * Dispatch — timed missions for SPARE loadouts and SPARE vehicles
 * (Dispatch slice, migration 0032; courier contracts per
 * design-briefs/expansion-pack/courier-contracts.md, whose defaults
 * Michael approved 2026-10-31 — DECISIONS.md R10/R11).
 *
 * This module is the ONE content owner for the dispatch rules: the
 * daily offer board, the foot payout lines, the loadout strength
 * factor, the courier cost/premium/cargo arithmetic, the breakdown
 * rule, and the lever surface (defaults + hard clamps). Routes,
 * stores, screens, and the SQL appliers' snapshots all read from
 * here — nobody re-derives a magnitude.
 *
 * The laws this file encodes:
 *
 *  - DISPATCH IS PARALLEL. Missions never touch the personal action
 *    slot (active_actions / cc_set_active_action): roaming,
 *    crafting, boss attempts, and endless runs proceed untouched
 *    while contracts run, and contracts are never paused by them.
 *  - SPARE MEANS SPARE. A foot contract commits gear that is
 *    `available` and unequipped; a courier contract commits a
 *    vehicle that is `available` and unequipped. Committed instances
 *    move to runtime_state 'in_service' + is_locked for the duration
 *    — the same state the repair board uses — so every shipped op
 *    (equip, market, salvage, reforge, repair-post) refuses them.
 *  - QUEUE SLOTS ARE A PARAMETER. One shared pool for foot and
 *    courier contracts; the count is the `dispatchQueueSlots` lever
 *    (default 2). A future subscription may raise it — convenience
 *    only, never power (Michael's subscription principle). No
 *    subscription anything is built here.
 *  - TERMS ARE FIXED AT DEPARTURE. Payout lines, the courier premium
 *    multiplier, route ticks, fuel, and wear are computed from
 *    shipped formulas at departure and snapshotted onto the mission
 *    row; lever moves never reprice a running contract.
 *  - NO INVISIBLE MECHANICS (courier brief law 4). Courier outcomes
 *    are deterministic arithmetic: fuel and wear come from the
 *    shipped vehicle formulas (src/lib/vehicles/vehicles.ts), the
 *    breakdown point is exact, and prep shows the settlement numbers
 *    before the vehicle leaves. There is NO random failure roll.
 *  - PRO-RATA IS THE SETTLEMENT SHAPE. A contract that ends early —
 *    recall or breakdown — pays for the fraction covered, refunds
 *    the unflown fuel fraction, and applies the flown wear fraction.
 *  - DISPATCH IS A SIDE FAUCET. Foot lines pay
 *    `dispatchCreditRate` / `dispatchScrapRate` (default 0.40) of
 *    the destination area's roaming idle rates at strength 1.0 —
 *    clearly below active roaming per hour at matched level/gear
 *    (the comparison is pinned by tests). Contracts pay credits,
 *    scrap, and materials. NO XP (the hunter did not go; XP stays
 *    with the personal occupations), NO gear, NO legendaries, NO
 *    cores (DECISIONS.md R3).
 *  - SETTLE IN FULL AT TERM. Dispatch is a fixed-term contract, not
 *    roaming: the AFK/offline cap does not truncate it (courier
 *    brief §2.12 Q4 default, ruled once here for both families).
 *    Settlement happens server-side from server timestamps, lazily
 *    on the next dispatch read/departure — the offline-settlement
 *    pattern, never the client's clock.
 */
import { ROAMING_AREAS, type RoamingAreaDef } from '../constants/roamingAreas';
import {
  vehicleBurnPerTick,
  vehicleDecayPerTick,
  vehicleMaterialBonusChance,
  getVehicleClass,
} from '../lib/vehicles/vehicles';
import type { Vehicle } from '../types/items';

// ─── Levers ──────────────────────────────────────────────────────────

export interface DispatchLeverValues {
  /** Concurrent missions (foot + courier share one pool). */
  dispatchQueueSlots: number;
  /** Foot credit line as a fraction of the area's roaming idle credits. */
  dispatchCreditRate: number;
  /** Foot scrap line as a fraction of the area's roaming idle scrap. */
  dispatchScrapRate: number;
  /** Scalar on the foot material line's unit count. */
  dispatchMaterialRate: number;
  /** Courier credit premium over the same-duration foot line. */
  courierPremiumMultiplier: number;
  /** Route ticks per contract hour (courier cost accounting unit). */
  courierRouteTicksPerHour: number;
}

export const DISPATCH_LEVER_DEFAULTS: DispatchLeverValues = {
  dispatchQueueSlots: 2,
  dispatchCreditRate: 0.4,
  dispatchScrapRate: 0.4,
  dispatchMaterialRate: 1,
  courierPremiumMultiplier: 1.6,
  courierRouteTicksPerHour: 120,
};

export const DISPATCH_LEVER_CLAMPS: Record<keyof DispatchLeverValues, { min: number; max: number; integer: boolean }> = {
  dispatchQueueSlots: { min: 1, max: 8, integer: true },
  dispatchCreditRate: { min: 0, max: 1, integer: false },
  dispatchScrapRate: { min: 0, max: 1, integer: false },
  dispatchMaterialRate: { min: 0, max: 3, integer: false },
  courierPremiumMultiplier: { min: 1, max: 3, integer: false },
  courierRouteTicksPerHour: { min: 60, max: 240, integer: true },
};

/** Resolve lever values from a raw economy-config snapshot: stored
 *  values win when finite, everything clamps to the hard ranges. */
export function resolveDispatchLevers(values?: Partial<Record<string, unknown>> | null): DispatchLeverValues {
  const out = { ...DISPATCH_LEVER_DEFAULTS };
  if (values) {
    (Object.keys(DISPATCH_LEVER_DEFAULTS) as Array<keyof DispatchLeverValues>).forEach((key) => {
      const raw = values[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        const clamp = DISPATCH_LEVER_CLAMPS[key];
        const clamped = Math.min(clamp.max, Math.max(clamp.min, raw));
        out[key] = clamp.integer ? Math.trunc(clamped) : clamped;
      }
    });
  }
  return out;
}

// ─── Contract shape ──────────────────────────────────────────────────

export type DispatchFamily = 'foot' | 'courier';

/** The three contract durations (hours) — the settled tiering. */
export const DISPATCH_DURATIONS_HOURS = [2, 8, 24] as const;
export type DispatchDurationHours = (typeof DISPATCH_DURATIONS_HOURS)[number];

export function isDispatchDurationHours(value: unknown): value is DispatchDurationHours {
  return value === 2 || value === 8 || value === 24;
}

/** Courier tier names by duration (courier brief §2.1). */
export const COURIER_TIER_BY_DURATION: Record<DispatchDurationHours, { name: string; minClassUnlockLevel: number }> = {
  2: { name: 'Local Run', minClassUnlockLevel: 1 },
  8: { name: 'Regional Haul', minClassUnlockLevel: 18 },
  24: { name: 'Deep Haul', minClassUnlockLevel: 42 },
};

/** Minimum vehicle class unlock level for a courier tier — the gate
 *  reads the VEHICLE's class, never the player's level (§2.1). */
export function courierTierGate(durationHours: DispatchDurationHours): number {
  return COURIER_TIER_BY_DURATION[durationHours].minClassUnlockLevel;
}

/** Whether a vehicle class may run a courier tier. */
export function vehicleClassEligibleForTier(vehicleClassId: string | null | undefined, durationHours: DispatchDurationHours): boolean {
  const def = getVehicleClass(vehicleClassId);
  if (!def) return false;
  return def.unlockLevel >= courierTierGate(durationHours);
}

// ─── The daily offer board ───────────────────────────────────────────

/** FNV-1a — the same hash family the hot-area rotation uses. */
export function dispatchHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface DispatchOffer {
  /** Stable within the UTC day: `d<YYYYMMDD>-<index>`. */
  id: string;
  family: DispatchFamily;
  areaId: string;
  durationHours: DispatchDurationHours;
}

/** Board composition: six offers, courier at indices 1 and 4 — a
 *  guaranteed mix every day (courier brief §2.1: each refresh offers
 *  a mix of foot and courier contracts). */
const OFFER_FAMILIES: DispatchFamily[] = ['foot', 'courier', 'foot', 'foot', 'courier', 'foot'];

/**
 * The day's contract board — system-issued, date-seeded, computed on
 * read (the vendor-rotation / hot-area pattern; no cron, no table).
 * Deterministic for a UTC day: the server recomputes the same board
 * at departure and matches the claimed offer id, so a forged offer
 * (invented area/duration/family) never validates.
 */
export function dispatchOffersForDate(date: Date): DispatchOffer[] {
  const day = utcDayKey(date);
  return OFFER_FAMILIES.map((family, index) => {
    const areaHash = dispatchHash(`dispatch:${day}:${index}:area`);
    const durationHash = dispatchHash(`dispatch:${day}:${index}:duration`);
    const area = ROAMING_AREAS[areaHash % ROAMING_AREAS.length];
    const durationHours = DISPATCH_DURATIONS_HOURS[durationHash % DISPATCH_DURATIONS_HOURS.length];
    return { id: `d${day.replace(/-/g, '')}-${index}`, family, areaId: area.id, durationHours };
  });
}

export function findDispatchOffer(date: Date, offerId: string): DispatchOffer | null {
  return dispatchOffersForDate(date).find((o) => o.id === offerId) ?? null;
}

export function roamingAreaById(areaId: string): RoamingAreaDef | null {
  return ROAMING_AREAS.find((a) => a.id === areaId) ?? null;
}

// ─── Loadout strength (foot contracts) ───────────────────────────────

/** Rarity weights for the dispatched-loadout power sum. */
export const DISPATCH_RARITY_POWER: Record<string, number> = {
  Common: 1,
  Uncommon: 1.15,
  Rare: 1.3,
  Epic: 1.5,
  Legendary: 1.8,
};

export interface DispatchLoadoutItem {
  itemLevel: number;
  rarity: string | null;
}

/** Σ itemLevel × rarity weight over the dispatched set. */
export function dispatchLoadoutPower(items: DispatchLoadoutItem[]): number {
  return items.reduce((acc, item) => {
    const level = Math.max(1, Math.trunc(item.itemLevel) || 1);
    const mult = DISPATCH_RARITY_POWER[item.rarity ?? 'Common'] ?? 1;
    return acc + level * mult;
  }, 0);
}

/**
 * Strength factor for a foot contract: the dispatched loadout's
 * power against the baseline of a full seven-slot loadout at the
 * destination's unlock level (7 × unlock × 1.15 — an all-Uncommon
 * level-appropriate set), clamped to [0.5, 1.5]. A token single item
 * floors at 0.5; an over-geared spare set caps at 1.5.
 */
export function dispatchStrengthFactor(items: DispatchLoadoutItem[], area: RoamingAreaDef): number {
  if (items.length === 0) return 0;
  const baseline = 7 * Math.max(1, area.unlockLevel) * 1.15;
  const raw = dispatchLoadoutPower(items) / baseline;
  return Math.min(1.5, Math.max(0.5, raw));
}

// ─── Foot payout lines ───────────────────────────────────────────────

export interface DispatchPayoutLines {
  credits: number;
  scrap: number;
  materialId: string | null;
  materialUnits: number;
}

/** Material units per hour before rates: richer areas stock more. */
export function dispatchMaterialUnitsPerHour(area: RoamingAreaDef): number {
  return 1 + area.unlockLevel / 20;
}

/** The material a contract to this area hauls: seeded from the
 *  mission seed over the area's material bias (deterministic). */
export function dispatchMaterialId(area: RoamingAreaDef, seed: string): string | null {
  if (area.materialBias.length === 0) return null;
  return area.materialBias[dispatchHash(`dispatch-material:${seed}`) % area.materialBias.length];
}

/**
 * The foot payout lines for a contract — the base every courier
 * premium derives from. Pure function of (area, duration, strength,
 * levers, seed); the departure snapshot stores exactly these numbers.
 */
export function footPayoutLines(
  area: RoamingAreaDef,
  durationHours: number,
  strengthFactor: number,
  levers: DispatchLeverValues,
  seed: string,
): DispatchPayoutLines {
  const credits = Math.round(durationHours * area.idleCreditsPerMinute * 60 * levers.dispatchCreditRate * strengthFactor);
  const scrap = Math.round(durationHours * area.idleScrapPerMinute * 60 * levers.dispatchScrapRate * strengthFactor);
  const materialUnits = Math.max(
    0,
    Math.floor(durationHours * dispatchMaterialUnitsPerHour(area) * levers.dispatchMaterialRate * strengthFactor),
  );
  return {
    credits,
    scrap,
    materialId: materialUnits > 0 ? dispatchMaterialId(area, seed) : null,
    materialUnits,
  };
}

/** Roaming's own per-hour idle credits in an area — the comparison
 *  baseline for the side-faucet law (tests pin dispatch below it). */
export function roamingCreditsPerHour(area: RoamingAreaDef): number {
  return area.idleCreditsPerMinute * 60;
}

// ─── Courier arithmetic (brief §2.3 / §2.4 / §2.5) ──────────────────

export interface CourierProjection {
  routeTicks: number;
  /** Fuel units charged at departure (shipped burn formula). */
  fuelUnits: number;
  /** Fuel in whole Generic cells, for the prep display. */
  fuelCells: number;
  /** Total condition wear over the full route (shipped decay formula). */
  wearProjected: number;
  /** Condition the vehicle returns at if it arrives (floored at 0). */
  returnCondition: number;
  /** True when projected wear reaches departure condition mid-route. */
  breaksDown: boolean;
  /** Route fraction covered before breakdown (1 = arrives). */
  breakdownFraction: number | null;
}

/**
 * Project a courier contract for a vehicle + destination — the prep
 * screen's numbers AND settlement's snapshot, from the shipped
 * formulas only: routeTicks × vehicleBurnPerTick for fuel,
 * routeTicks × vehicleDecayPerTick for wear. No RNG anywhere.
 * `vehicle` needs only the class id + affixes the formulas read.
 */
export function courierProjection(
  vehicle: Pick<Vehicle, 'vehicleClassId' | 'affixes'>,
  conditionAtDeparture: number,
  area: RoamingAreaDef,
  durationHours: number,
  levers: DispatchLeverValues,
): CourierProjection {
  const routeTicks = Math.round(durationHours * levers.courierRouteTicksPerHour);
  const fuelUnits = routeTicks * vehicleBurnPerTick(vehicle);
  const wearProjected = routeTicks * vehicleDecayPerTick(vehicle, area.dangerRating);
  const condition = Math.max(0, conditionAtDeparture);
  // Breakdown iff cumulative wear reaches the departure condition
  // before route end — i.e. wear >= condition. A vehicle departing
  // at 0 condition is already worn out: any positive wear breaks it
  // immediately, at fraction 0.
  const willBreak = wearProjected > 0 && wearProjected >= condition;
  return {
    routeTicks,
    fuelUnits,
    fuelCells: Math.ceil(fuelUnits / 100),
    wearProjected,
    returnCondition: willBreak ? 0 : Math.max(0, condition - wearProjected),
    breaksDown: willBreak,
    breakdownFraction: willBreak ? (wearProjected > 0 ? Math.min(1, Math.max(0, condition / wearProjected)) : 1) : null,
  };
}

/**
 * Courier payout lines (brief §2.5): credits = foot line (strength
 * 1.0 — no loadout rides) × the premium snapshot; scrap = the foot
 * scrap line unpremiated (the premium prices the credit line; the
 * brief's delta names credits + cargo); materials = foot units plus
 * the deterministic cargo bonus floor(footUnits × vehicle material
 * bonus) — the Cargo Hauler's second job.
 */
export function courierPayoutLines(
  area: RoamingAreaDef,
  durationHours: number,
  vehicle: Pick<Vehicle, 'vehicleClassId' | 'affixes'>,
  levers: DispatchLeverValues,
  seed: string,
): DispatchPayoutLines & { cargoBonusUnits: number } {
  const foot = footPayoutLines(area, durationHours, 1, levers, seed);
  const cargoBonusUnits = Math.floor(foot.materialUnits * vehicleMaterialBonusChance(vehicle));
  return {
    credits: Math.round(foot.credits * levers.courierPremiumMultiplier),
    scrap: foot.scrap,
    materialId: foot.materialId,
    materialUnits: foot.materialUnits + cargoBonusUnits,
    cargoBonusUnits,
  };
}

// ─── Settlement fractions ────────────────────────────────────────────

/**
 * The fraction of a contract's terms a settlement pays: 1 at term;
 * the breakdown fraction when the vehicle broke down before term;
 * the elapsed fraction on recall (capped at the breakdown point —
 * a vehicle that would have broken down before the recall broke
 * down). Mirrors the SQL settler's arithmetic exactly.
 */
export function dispatchSettlementFraction(input: {
  elapsedMs: number;
  durationMs: number;
  breakdownFraction: number | null;
  recalled: boolean;
}): number {
  const elapsedFraction = input.durationMs > 0 ? input.elapsedMs / input.durationMs : 1;
  let fraction = input.recalled ? Math.min(1, Math.max(0, elapsedFraction)) : 1;
  if (input.breakdownFraction !== null && input.breakdownFraction !== undefined) {
    fraction = Math.min(fraction, Math.min(1, Math.max(0, input.breakdownFraction)));
  }
  return fraction;
}

/** Pro-rata payout application: credits/scrap/materials floor at
 *  the fraction (the house shape — partial work pays the fraction
 *  done, never a rounded-up whole). */
export function proratePayout(lines: DispatchPayoutLines, fraction: number): DispatchPayoutLines {
  const f = Math.min(1, Math.max(0, fraction));
  return {
    credits: Math.floor(lines.credits * f),
    scrap: Math.floor(lines.scrap * f),
    materialId: lines.materialId,
    materialUnits: Math.floor(lines.materialUnits * f),
  };
}
