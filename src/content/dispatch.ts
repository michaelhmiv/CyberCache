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
 *  - THE BOARD IS SET; RE-DEALS COST CREDITS (economy brief §7.3,
 *    migration 0068). Six offers a day is the slate; a player may
 *    re-deal it for credits at an escalating price (base × 2^(k−1),
 *    capped per UTC day, both live levers). A reroll deals board
 *    n+1 under fresh seeds with the same six-slot composition;
 *    departed offer ids stay departed (the id is the consumption
 *    unit — identical terms under a NEW id are a new offer), and
 *    running contracts are never repriced: a reroll touches only
 *    un-departed offers on boards not yet dealt.
 */
import { ROAMING_AREAS, type RoamingAreaDef } from '../constants/roamingAreas';
import {
  VEHICLE_CLASSES,
  vehicleBurnPerTick,
  vehicleDecayPerTick,
  vehicleMaterialBonusChance,
  vehicleClassTierIndex,
  type VehicleRateInput,
} from '../lib/vehicles/vehicles';

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
  /** Base price (credits) of the day's first dispatch board reroll;
   *  reroll k costs base × 2^(k−1) (economy brief §7.3). */
  dispatchRerollBaseCredits: number;
  /** Max paid board rerolls per UTC day (economy brief §7.3). */
  dispatchRerollDailyCap: number;
}

export const DISPATCH_LEVER_DEFAULTS: DispatchLeverValues = {
  dispatchQueueSlots: 2,
  dispatchCreditRate: 0.4,
  dispatchScrapRate: 0.4,
  dispatchMaterialRate: 1,
  courierPremiumMultiplier: 1.6,
  courierRouteTicksPerHour: 120,
  dispatchRerollBaseCredits: 250,
  dispatchRerollDailyCap: 5,
};

export const DISPATCH_LEVER_CLAMPS: Record<keyof DispatchLeverValues, { min: number; max: number; integer: boolean }> = {
  dispatchQueueSlots: { min: 1, max: 8, integer: true },
  dispatchCreditRate: { min: 0, max: 1, integer: false },
  dispatchScrapRate: { min: 0, max: 1, integer: false },
  dispatchMaterialRate: { min: 0, max: 3, integer: false },
  courierPremiumMultiplier: { min: 1, max: 3, integer: false },
  courierRouteTicksPerHour: { min: 60, max: 240, integer: true },
  dispatchRerollBaseCredits: { min: 0, max: 10000, integer: true },
  dispatchRerollDailyCap: { min: 0, max: 20, integer: true },
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

/** Courier tiers by duration (courier brief §2.1). The gate is a
 *  CAPABILITY band, not a level: `minClassTier` is the tier index
 *  (position in VEHICLE_CLASSES) of the tier's anchor class — a
 *  vehicle qualifies when its own class sits at that tier or
 *  higher. Gate-removal step 5 retargeted the bands from the class
 *  ladder's unlockLevel values (1 / 18 / 42) to tier indices
 *  (0 / 2 / 4): the qualifying class sets are identical — Regional
 *  takes Utility Rover (tier 2) and up, Deep takes Armored Crawler
 *  (tier 4) and up — and no level-shaped number is read anywhere in
 *  the eligibility path. The gate reads the VEHICLE's class, never
 *  the player's level (§2.1). */
export const COURIER_TIER_BY_DURATION: Record<DispatchDurationHours, { name: string; minClassTier: number }> = {
  2: { name: 'Local Run', minClassTier: 0 },
  8: { name: 'Regional Haul', minClassTier: 2 },
  24: { name: 'Deep Haul', minClassTier: 4 },
};

/** Minimum vehicle class tier index for a courier tier — the gate
 *  reads the VEHICLE's class, never the player's level (§2.1). */
export function courierTierGate(durationHours: DispatchDurationHours): number {
  return COURIER_TIER_BY_DURATION[durationHours].minClassTier;
}

/** The anchor class of a courier tier: the weakest class that may
 *  run it. Refusal copy names it as the remedy ("assign an Armored
 *  Crawler-class vehicle or stronger"). */
export function courierTierAnchorClass(durationHours: DispatchDurationHours) {
  return VEHICLE_CLASSES[courierTierGate(durationHours)] ?? null;
}

/** Whether a vehicle class may run a courier tier. */
export function vehicleClassEligibleForTier(vehicleClassId: string | null | undefined, durationHours: DispatchDurationHours): boolean {
  return vehicleClassTierIndex(vehicleClassId) >= courierTierGate(durationHours);
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
  /** Stable within the UTC day and board: board 0 is
   *  `d<YYYYMMDD>-<index>`; board n ≥ 1 (a paid reroll, §7.3) is
   *  `d<YYYYMMDD>-r<n>-<index>`. The consumption unit is this id:
   *  an offer id, once departed, stays departed for the day. */
  id: string;
  family: DispatchFamily;
  areaId: string;
  durationHours: DispatchDurationHours;
}

/** Board composition: six offers, courier at indices 1 and 4 — a
 *  guaranteed mix every day (courier brief §2.1: each refresh offers
 *  a mix of foot and courier contracts). Every rerolled board keeps
 *  this exact composition (economy brief §7.3). */
const OFFER_FAMILIES: DispatchFamily[] = ['foot', 'courier', 'foot', 'foot', 'courier', 'foot'];

/**
 * One of the day's contract boards — system-issued, date-seeded,
 * computed on read (the vendor-rotation / hot-area pattern; no cron,
 * no table). Deterministic for a UTC day + board index: the server
 * recomputes the player's CURRENT board at departure and matches the
 * claimed offer id, so a forged offer (invented area/duration/
 * family) — or an offer from any other board, purchased or not —
 * never validates (economy brief §7.3).
 *
 * Board 0 is the free daily board and is BYTE-IDENTICAL to the
 * shipped formula: hash inputs `dispatch:<day>:<i>:area|duration`,
 * ids `d<day>-<i>`. Board n ≥ 1 hashes
 * `dispatch:<day>:r<n>:<i>:area|duration` and ids `d<day>-r<n>-<i>`,
 * so a reroll re-deals areas/durations under fresh seeds while the
 * running players' board 0 never moves under them.
 */
export function dispatchOffersForBoard(date: Date, boardIndex: number): DispatchOffer[] {
  const day = utcDayKey(date);
  const board = Math.max(0, Math.trunc(boardIndex) || 0);
  return OFFER_FAMILIES.map((family, index) => {
    const seedBase = board === 0
      ? `dispatch:${day}:${index}`
      : `dispatch:${day}:r${board}:${index}`;
    const areaHash = dispatchHash(`${seedBase}:area`);
    const durationHash = dispatchHash(`${seedBase}:duration`);
    const area = ROAMING_AREAS[areaHash % ROAMING_AREAS.length];
    const durationHours = DISPATCH_DURATIONS_HOURS[durationHash % DISPATCH_DURATIONS_HOURS.length];
    return {
      id: board === 0 ? `d${day.replace(/-/g, '')}-${index}` : `d${day.replace(/-/g, '')}-r${board}-${index}`,
      family,
      areaId: area.id,
      durationHours,
    };
  });
}

/** The day's free board (board 0) — the shipped daily board. */
export function dispatchOffersForDate(date: Date): DispatchOffer[] {
  return dispatchOffersForBoard(date, 0);
}

export function findDispatchOfferForBoard(date: Date, boardIndex: number, offerId: string): DispatchOffer | null {
  return dispatchOffersForBoard(date, boardIndex).find((o) => o.id === offerId) ?? null;
}

export function findDispatchOffer(date: Date, offerId: string): DispatchOffer | null {
  return findDispatchOfferForBoard(date, 0, offerId);
}

// ─── Board reroll (economy brief §7.3) ───────────────────────────────

/** The stored per-player board state (profile columns, migration
 *  0068): which board the player is on, how many paid rerolls they
 *  have used, and the UTC day key those numbers belong to. */
export interface DispatchBoardState {
  boardIndex: number;
  rerollsUsed: number;
  /** UTC day key (`YYYY-MM-DD`) the state belongs to. */
  day: string;
}

/**
 * Resolve the EFFECTIVE board state for `date` from the stored row:
 * state stored under any other day key is stale and reads as the
 * fresh day (board 0, no rerolls used) — the lazy reset on read; no
 * cron ever rewrites it, the next reroll persists the new day.
 */
export function resolveDispatchBoardState(
  stored: { boardIndex?: number | null; rerollsUsed?: number | null; day?: string | null } | null | undefined,
  date: Date,
): DispatchBoardState {
  const day = utcDayKey(date);
  if (!stored || stored.day !== day) return { boardIndex: 0, rerollsUsed: 0, day };
  return {
    boardIndex: Math.max(0, Math.trunc(Number(stored.boardIndex) || 0)),
    rerollsUsed: Math.max(0, Math.trunc(Number(stored.rerollsUsed) || 0)),
    day,
  };
}

/**
 * The price of the NEXT reroll after `rerollsUsed` rerolls today:
 * reroll k (1-based) costs `dispatchRerollBaseCredits × 2^(k−1)` —
 * 250 / 500 / 1,000 / 2,000 / 4,000 at the shipped defaults.
 * Escalation is the design (brief §7.3): a flat price low enough to
 * feel fair would make cherry-picking boards a pure arbitrage.
 */
export function dispatchRerollPrice(rerollsUsed: number, levers: DispatchLeverValues): number {
  const used = Math.max(0, Math.trunc(rerollsUsed) || 0);
  return Math.trunc(levers.dispatchRerollBaseCredits) * 2 ** used;
}

/** Paid rerolls left today (0 at the `dispatchRerollDailyCap`). */
export function dispatchRerollsRemaining(rerollsUsed: number, levers: DispatchLeverValues): number {
  const used = Math.max(0, Math.trunc(rerollsUsed) || 0);
  return Math.max(0, Math.trunc(levers.dispatchRerollDailyCap) - used);
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
  vehicle: VehicleRateInput,
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
 * Whole Generic Fuel Cells a courier departure is short, priced
 * against the tank (QB-3): the departure burns TANK units
 * (cc_dispatch_depart decrements profiles.vehicle_fuel), and one
 * Generic cell loads 100 units (cc_refuel_vehicle), so the
 * shortfall in cells is the unit gap rounded up to whole cells.
 * This restates — verbatim — the refusal the Chef's dispatch route
 * computes in priceContract (src/server/routes/dispatch.ts), so the
 * prep surface's quick-buy + opens at exactly the count the server
 * names. 0 when the tank covers the route.
 */
export function dispatchFuelShortfallCells(fuelUnits: number, fuelAvailable: number): number {
  if (!Number.isFinite(fuelUnits) || !Number.isFinite(fuelAvailable)) return 0;
  if (fuelUnits <= fuelAvailable) return 0;
  return Math.ceil((fuelUnits - fuelAvailable) / 100);
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
  vehicle: VehicleRateInput,
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
