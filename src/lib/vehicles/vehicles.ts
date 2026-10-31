/**
 * Vehicles — the ONE source of truth for the vehicle system
 * (Phase 2b slice, migration 0021).
 *
 * Vehicles are real gear: item_instances rows with kind 'vehicle',
 * equipped into the loadout's 'vehicle' slot. The design tables in
 * src/content/mechanicFramework.ts (VEHICLE_CLASSES_FIRST_ERA) were
 * the design source; this module is the shipped table — class stats
 * live here and ONLY here (the SQL twin of the unlock levels lives in
 * migration 0021, `cc_vehicle_unlock_level`, and parity is pinned by
 * tests the way the vendor catalog's twin is).
 *
 * YIELD MODEL, never cadence: ticks stay 3s and the claim RNG stream
 * is untouched. The equipped vehicle multiplies what each tick
 * yields — credits, scrap, XP, material quantity, and the loot-roll
 * chances — by its effective yield factor:
 *
 *   factor = 1 + (baseYield − 1) × (1 + yieldAffixPct)
 *              × conditionFraction × vehicleYieldScalar
 *
 * derived SERVER-SIDE by the Chef from the equipped instance (the
 * claim routes read the instance from item_instances; the request
 * body never carries it). Boss attempts never read the vehicle.
 *
 * FUEL: the tank is profiles.vehicle_fuel, measured in fuel units;
 * one Generic Fuel Cell loads FUEL_UNITS_PER_CELL units (cc_refuel_
 * vehicle). A fueled tick burns the class rate; an unfueled tick
 * pays ×1.0 and roaming continues on foot — never a hard block.
 *
 * CONDITION: item_instances.condition_current / condition_max. Wear
 * accrues per fueled tick, scaled by area danger and class
 * durability. The factor degrades smoothly with the condition
 * fraction; at zero condition the factor is exactly ×1.0. Condition
 * never destroys the vehicle and never blocks roaming. Patch Kits
 * restore it (cc_use_patch_kit) at PATCH_KIT_RESTORE_POINTS × the
 * kit batch's quality % — the untrained base rate; the repair slice
 * layers mastery/quality on top of the same data, not new logic.
 */
import type { Affix, Vehicle } from '../../types/items';
import type { DangerRating } from '../../constants/roamingAreas';

export interface VehicleClassDef {
  id: string;
  displayName: string;
  /** Equip gate: the player's level must be >= this (enforced server-side at equip). */
  unlockLevel: number;
  /** Base yield multiplier at full condition with no affixes (the design table's travel speed). */
  baseYield: number;
  /** Fuel units burned per fueled tick (1 cell = FUEL_UNITS_PER_CELL units). */
  fuelBurnPerTick: number;
  /** Condition decay multiplier (lower = more durable). */
  conditionLossMultiplier: number;
  /** Extra material-find quantity chance, the Cargo Hauler's identity (0 for other classes). */
  materialYieldBonus: number;
  role: string;
}

export const VEHICLE_CLASSES: VehicleClassDef[] = [
  { id: 'scrap_bike', displayName: 'Scrap Bike', unlockLevel: 1, baseYield: 1.15, fuelBurnPerTick: 0.9, conditionLossMultiplier: 1.1, materialYieldBonus: 0, role: 'Starter mobility.' },
  { id: 'dune_buggy', displayName: 'Dune Buggy', unlockLevel: 8, baseYield: 1.35, fuelBurnPerTick: 1.1, conditionLossMultiplier: 1.0, materialYieldBonus: 0, role: 'General roaming travel.' },
  { id: 'utility_rover', displayName: 'Utility Rover', unlockLevel: 18, baseYield: 1.25, fuelBurnPerTick: 0.7, conditionLossMultiplier: 0.7, materialYieldBonus: 0, role: 'Best fuel efficiency, slow wear — the long-haul farmer.' },
  { id: 'cargo_hauler', displayName: 'Cargo Hauler', unlockLevel: 28, baseYield: 1.1, fuelBurnPerTick: 1.3, conditionLossMultiplier: 0.95, materialYieldBonus: 0.3, role: 'Material farming support: lower raw yield, bonus material quantity.' },
  { id: 'armored_crawler', displayName: 'Armored Crawler', unlockLevel: 42, baseYield: 1.05, fuelBurnPerTick: 1.5, conditionLossMultiplier: 0.25, materialYieldBonus: 0, role: 'Dangerous-zone reliability: near-negligible wear.' },
  { id: 'relay_skimmer', displayName: 'Relay Skimmer', unlockLevel: 60, baseYield: 1.6, fuelBurnPerTick: 2.0, conditionLossMultiplier: 1.25, materialYieldBonus: 0, role: 'Fastest yield, highest fuel burn, fragile.' },
];

const CLASS_BY_ID = new Map(VEHICLE_CLASSES.map((c) => [c.id, c]));

export function getVehicleClass(classId: string | null | undefined): VehicleClassDef | null {
  if (!classId) return null;
  return CLASS_BY_ID.get(classId) ?? null;
}

/** Fuel units one Generic Fuel Cell loads into the tank. */
export const FUEL_UNITS_PER_CELL = 100;

/** Consumable type id of the baseline fuel cell (src/constants/consumables.ts). */
export const FUEL_CELL_TYPE = 'GenericFuelCell';

/** Consumable type id of the baseline patch kit. */
export const PATCH_KIT_TYPE = 'PatchKit';

/**
 * Condition points one Patch Kit restores at 100% quality — the
 * untrained base rate. The SQL twin lives in cc_use_patch_kit
 * (migration 0021); parity is pinned by tests.
 */
export const PATCH_KIT_RESTORE_POINTS = 30;

/**
 * Base condition restore per patch-kit type at 100% quality
 * (crafting-as-occupation §2.5d; F1: the shipped tier-1 base of 30
 * stands, the crafted tiers are 45 / 80). cc_use_patch_kit (restated
 * in migration 0024) carries the same table; the consumable defs'
 * runtime.baseEffects.conditionRestore mirrors it too.
 */
export const PATCH_KIT_BASES: Readonly<Record<string, number>> = {
  PatchKit: 30,
  FieldPatchKit: 45,
  MasterPatchKit: 80,
};

/** Consumable types the refuel path can load (crafting §2.5d): the
 *  vendor's flat Generic cell and the crafted quality-scaled cell. */
export const FUEL_CELL_TYPES: readonly string[] = ['GenericFuelCell', 'FuelCell'];

/** Every vehicle instance carries condition on a 0..100 scale. */
export const VEHICLE_CONDITION_MAX = 100;

/** Condition points lost per fueled tick at danger ×1.0 before class/affix scaling. */
export const VEHICLE_BASE_DECAY_PER_TICK = 0.02;

/** Share of gear drops replaced by a vehicle drop (rolled on a separate RNG stream). */
export const VEHICLE_DROP_SHARE = 0.04;

/** Area danger rating → condition-decay scaling. */
export const AREA_DANGER_DECAY: Record<DangerRating, number> = {
  Low: 0.6,
  Medium: 1.0,
  'Medium/High': 1.3,
  Variable: 1.1,
  High: 1.6,
};

export interface VehicleAffixDef {
  stat: string;
  text: string;
  /** Roll range, as a fraction (0.04 = +4%). */
  min: number;
  max: number;
}

/**
 * The vehicle affix pool. Values are fractions read by the Chef's
 * per-tick math (vehicleAffixTotals) — never display-only.
 */
export const VEHICLE_AFFIX_POOL: VehicleAffixDef[] = [
  { stat: 'vehicleYieldPct', text: '+{v}% Vehicle Yield', min: 0.04, max: 0.1 },
  { stat: 'vehicleFuelEfficiencyPct', text: '+{v}% Fuel Efficiency', min: 0.05, max: 0.15 },
  { stat: 'vehicleFramePct', text: '+{v}% Reinforced Frame', min: 0.1, max: 0.3 },
  { stat: 'vehicleCargoPct', text: '+{v}% Cargo Racks', min: 0.08, max: 0.2 },
  { stat: 'vehicleScannerPct', text: '+{v}% Scanner (find)', min: 0.05, max: 0.15 },
];

export interface VehicleAffixTotals {
  yieldPct: number;
  fuelEfficiencyPct: number;
  framePct: number;
  cargoPct: number;
  scannerPct: number;
}

/** Sum a vehicle payload's affixes into the totals the engine reads. */
export function vehicleAffixTotals(vehicle: Pick<Vehicle, 'affixes'> | null | undefined): VehicleAffixTotals {
  const totals: VehicleAffixTotals = { yieldPct: 0, fuelEfficiencyPct: 0, framePct: 0, cargoPct: 0, scannerPct: 0 };
  for (const affix of (vehicle?.affixes ?? []) as Affix[]) {
    const value = typeof affix.value === 'number' && Number.isFinite(affix.value) ? affix.value : 0;
    switch (affix.stat) {
      case 'vehicleYieldPct': totals.yieldPct += value; break;
      case 'vehicleFuelEfficiencyPct': totals.fuelEfficiencyPct += value; break;
      case 'vehicleFramePct': totals.framePct += value; break;
      case 'vehicleCargoPct': totals.cargoPct += value; break;
      case 'vehicleScannerPct': totals.scannerPct += value; break;
      default: break;
    }
  }
  return totals;
}

/** Condition as a 0..1 fraction (1 = pristine). Unknown max reads as full. */
export function conditionFraction(conditionCurrent: number, conditionMax: number): number {
  const max = conditionMax > 0 ? conditionMax : VEHICLE_CONDITION_MAX;
  const current = Number.isFinite(conditionCurrent) ? conditionCurrent : max;
  return Math.max(0, Math.min(1, current / max));
}

/**
 * The effective yield factor for one tick:
 *   1 + (baseYield − 1) × (1 + yieldAffixPct) × conditionFraction × scalar
 * At zero condition (or scalar 0) the factor is exactly 1.
 */
export function effectiveVehicleYield(
  vehicle: Pick<Vehicle, 'vehicleClassId' | 'affixes'>,
  fraction: number,
  yieldScalar: number,
): number {
  const def = getVehicleClass(vehicle.vehicleClassId);
  if (!def) return 1;
  const totals = vehicleAffixTotals(vehicle);
  const bonus = (def.baseYield - 1) * (1 + totals.yieldPct);
  return 1 + bonus * Math.max(0, Math.min(1, fraction)) * Math.max(0, yieldScalar);
}

/** Fuel units burned per fueled tick, after the efficiency affix (floored at 10% of base). */
export function vehicleBurnPerTick(vehicle: Pick<Vehicle, 'vehicleClassId' | 'affixes'>): number {
  const def = getVehicleClass(vehicle.vehicleClassId);
  if (!def) return 0;
  const totals = vehicleAffixTotals(vehicle);
  return def.fuelBurnPerTick * Math.max(0.1, 1 - totals.fuelEfficiencyPct);
}

/** Condition points lost per fueled tick in an area of the given danger rating. */
export function vehicleDecayPerTick(
  vehicle: Pick<Vehicle, 'vehicleClassId' | 'affixes'>,
  dangerRating: DangerRating,
): number {
  const def = getVehicleClass(vehicle.vehicleClassId);
  if (!def) return 0;
  const totals = vehicleAffixTotals(vehicle);
  const danger = AREA_DANGER_DECAY[dangerRating] ?? 1;
  return VEHICLE_BASE_DECAY_PER_TICK * danger * def.conditionLossMultiplier * Math.max(0, 1 - totals.framePct);
}

/** Extra material-quantity chance: class cargo identity + cargo rack affixes. */
export function vehicleMaterialBonusChance(vehicle: Pick<Vehicle, 'vehicleClassId' | 'affixes'>): number {
  const def = getVehicleClass(vehicle.vehicleClassId);
  if (!def) return 0;
  return def.materialYieldBonus + vehicleAffixTotals(vehicle).cargoPct;
}
