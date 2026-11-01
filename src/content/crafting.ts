/**
 * Crafting-as-occupation — the ONE content owner for the Workshop's
 * server job model (design brief: cybercache-prep/design-briefs/
 * crafting-as-occupation.md, Michael's occupations law 2026-10-30).
 *
 * What lives here (and nowhere else):
 *   - the unified craft catalog: the 29 legacy consumable recipes
 *     (imported unchanged from src/constants/craftingRecipes.ts) plus
 *     refining, gear frames, workshop tools, and the crafted vehicle
 *     consumables (§2.5). The SQL twin is cc_craft_recipe in migration
 *     0024; a parity test pins the two together.
 *   - benches as modifier objects (§2.2): identity, unlock gates,
 *     quality factor / min-bound bonus, station sprites.
 *   - the crafting XP formula (§2.3): pegged to roaming's XP/hour at
 *     the best area unlocked at the player's level, paid per completed
 *     unit at settlement. The rate is the `craftXpRate` economy lever,
 *     hard-clamped to [0.70, 0.85] in lever validation.
 *   - the quality bounds function (§2.4) — TS/SQL twin pair
 *     (cc_craft_quality_bounds), parity-tested across the
 *     mastery × bench × catalyst grid.
 *   - refining yield, gear temper, catalyst map, tool defs (§2.5).
 *
 * Jobs themselves are server state (craft_jobs, migration 0024): the
 * Chef settles them from server timestamps only while `crafting` is
 * the player's active action. Nothing in this module reads a clock.
 */
import { CRAFTING_RECIPES } from '../constants/craftingRecipes';
import { CONSUMABLES } from '../constants/consumables';
import { ROAMING_AREAS } from '../constants/roamingAreas';
import { MaterialType, Rarity } from '../types/game';

// ─── Levers (§2.10; registered in src/server/economy/config.ts) ─────

/** Crafting XP pays this fraction of roaming's XP/hour. */
export const CRAFT_XP_RATE_DEFAULT = 0.775;
/** The band is law (occupations brief §2.3): validation clamps to it. */
export const CRAFT_XP_RATE_MIN = 0.7;
export const CRAFT_XP_RATE_MAX = 0.85;

export const CRAFT_TIME_SCALAR_DEFAULT = 1.0;
export const CRAFT_QUALITY_SHIFT_DEFAULT = 0;
export const GEAR_TEMPER_BASE_CHANCE_DEFAULT = 0.05;
export const REFINE_BASE_YIELD_DEFAULT = 0.8;

// ─── Benches (§2.2) ──────────────────────────────────────────────────

export interface CraftBenchDef {
  /** 1..3 — also the value stored in profiles.workshop_benches. */
  bench: number;
  id: string;
  name: string;
  /** Grammar ACTION_SETS sprite for this bench's station. */
  spriteId: string;
  unlockLevel: number;
  costCredits: number;
  /** Charged atomically by cc_unlock_bench (the credit sink + VoidDust). */
  costInputs: Record<string, number>;
  /** Rolled quality multiplier (Forge 1.05, Lab 1.10). */
  qualityFactor: number;
  /** Flat bonus to the quality roll's minimum bound (Lab +5). */
  minQualityBonus: number;
  blurb: string;
}

export const CRAFT_BENCHES: readonly CraftBenchDef[] = [
  {
    bench: 1,
    id: 'basic',
    name: 'Basic Bench',
    spriteId: 'set-bench-basic',
    unlockLevel: 1,
    costCredits: 0,
    costInputs: {},
    qualityFactor: 1.0,
    minQualityBonus: 0,
    blurb: 'The starter bench. Runs every legacy recipe and the crusher.',
  },
  {
    bench: 2,
    id: 'forge',
    name: 'Forge',
    spriteId: 'set-bench-forge',
    unlockLevel: 15,
    costCredits: 5000,
    costInputs: {},
    qualityFactor: 1.05,
    minQualityBonus: 0,
    blurb: 'Quality rolls ×1.05. Unlocks Rare gear frames and catalysts.',
  },
  {
    bench: 3,
    id: 'lab',
    name: 'Lab',
    spriteId: 'set-bench-lab',
    unlockLevel: 30,
    costCredits: 25000,
    costInputs: { VoidDust: 10 },
    qualityFactor: 1.1,
    minQualityBonus: 5,
    blurb: 'Quality rolls ×1.10 with +5 to the minimum. Unlocks Epic frames and the furnace.',
  },
];

export const MAX_BENCH = 3;
/** One job RUNS per bench; up to this many more QUEUE behind it. */
export const QUEUED_JOBS_PER_BENCH = 5;
/** Sanity bound on a single job's unit count (escrow locks the inputs). */
export const MAX_UNITS_PER_JOB = 500;

export function benchDef(bench: number): CraftBenchDef {
  return CRAFT_BENCHES[Math.max(1, Math.min(MAX_BENCH, Math.floor(bench) || 1)) - 1];
}

// ─── The unified craft catalog (§2.5) ────────────────────────────────

export type CraftJobKind = 'consumable' | 'refine' | 'gear' | 'tool' | 'repair' | 'shieldtech';
export type CraftStation = 'bench' | 'crusher' | 'furnace';

export interface CraftRecipe {
  id: string;
  kind: CraftJobKind;
  name: string;
  /** Display grouping in the Workshop. */
  category: 'survival' | 'offense' | 'utility' | 'refining' | 'gear' | 'tools';
  /** Per-unit inputs: material ids resolve against profiles.materials,
   *  essence ids against profiles.essences (legacy recipe convention). */
  inputs: Record<string, number>;
  /** Per-unit duration before snapshot modifiers (not used for gear —
   *  see durationByRarity). */
  unitDurationMs: number;
  requiresLevel: number;
  /** Minimum owned bench this recipe may run on. */
  requiresBench: number;
  requiresMastery?: { track: string; level: number };
  /** Research gate (0038): the course id whose completion unlocks
   *  this recipe — a fourth gate beside level / bench / mastery,
   *  enforced in both stores (cc_enqueue_craft_job reads
   *  research_completions). */
  requiresResearch?: string;
  /** Manufacturer Standing gate (0043): the manufacturer ladder and
   *  rank whose ownership unlocks this recipe — a fifth gate beside
   *  level / bench / mastery / research, enforced in both stores
   *  (cc_enqueue_craft_job reads manufacturer_standing). Standing is
   *  access only: the gate never changes the recipe's numbers. */
  requiresStanding?: { manufacturer: string; rank: number };
  station: CraftStation;
  /** consumable kind: the output consumable type. */
  consumableType?: string;
  /** consumable kind: units produced per completed job unit
   *  (default 1; the Research batch recipes produce 3). A fitted
   *  tool's bonus unit adds +1 on top, as it does at quantity 1. */
  outputQuantity?: number;
  /** refine kind: the output material and its base-rate yield count. */
  outputMaterial?: string;
  outputBase?: number;
  /** gear kind: the loadout slot the frame produces. */
  gearSlot?: 'weapon' | 'shield' | 'classMod' | 'relic' | 'ordnance';
  /** gear kind: per-unit duration by chosen rarity. */
  durationByRarityMs?: Partial<Record<Rarity, number>>;
  /** tool kind: the workshop tool asset this job produces. */
  toolId?: string;
}

const MIN = 60 * 1000;

const LEGACY_RECIPES: CraftRecipe[] = CRAFTING_RECIPES.map((r) => ({
  id: r.id,
  kind: 'consumable' as const,
  name: r.name,
  category: r.category,
  inputs: { ...r.materials },
  unitDurationMs: r.craftTimeMs,
  requiresLevel: r.requiresLevel ?? 1,
  requiresBench: 1,
  station: 'bench' as const,
  consumableType: r.consumableType,
}));

/** The crafted vehicle consumables (§2.5d). Patch Kit's recipe is new;
 *  its type, base restore (30), and vendor staple are shipped (#214). */
const VEHICLE_CONSUMABLE_RECIPES: CraftRecipe[] = [
  {
    id: 'recipe_patch_kit', kind: 'consumable', name: 'Patch Kit', category: 'utility',
    inputs: { ScrapAlloy: 4, ReactiveComponents: 1 }, unitDurationMs: 12 * MIN,
    requiresLevel: 1, requiresBench: 1, station: 'bench', consumableType: 'PatchKit',
  },
  {
    id: 'recipe_field_patch_kit', kind: 'consumable', name: 'Field Patch Kit', category: 'utility',
    inputs: { ScrapAlloy: 6, ReactiveComponents: 3, TechFragments: 1, HeartwoodResin: 1 },
    unitDurationMs: 25 * MIN, requiresLevel: 12, requiresBench: 1, station: 'bench',
    consumableType: 'FieldPatchKit',
  },
  {
    id: 'recipe_master_patch_kit', kind: 'consumable', name: 'Master Patch Kit', category: 'utility',
    inputs: { ScrapAlloy: 8, ReactiveComponents: 5, TechFragments: 3, VoidDust: 1 },
    unitDurationMs: 45 * MIN, requiresLevel: 1, requiresBench: 1, station: 'bench',
    consumableType: 'MasterPatchKit',
    requiresMastery: { track: 'crafting_consumables', level: 15 },
  },
  {
    id: 'recipe_fuel_cell', kind: 'consumable', name: 'Fuel Cell', category: 'utility',
    inputs: { ScrapAlloy: 6, NitrocellGel: 1 }, unitDurationMs: 15 * MIN,
    requiresLevel: 8, requiresBench: 1, station: 'bench', consumableType: 'FuelCell',
  },
  {
    // Shield-Tech services (0044, brief §2.4): the Calibration Core —
    // the shield-tech lane's crafter-only consumable. PrismShards
    // (the Prismatek signature material) ties cores to the shield
    // economy's home territory. 40 min, Forge bench.
    id: 'recipe_calibration_core', kind: 'consumable', name: 'Calibration Core', category: 'utility',
    inputs: { ReactiveComponents: 20, TechFragments: 15, PrismShards: 2, VoidDust: 2 },
    unitDurationMs: 40 * MIN,
    requiresLevel: 15, requiresBench: 2, station: 'bench', consumableType: 'CalibrationCore',
  },
];

/** Refining (§2.5a): deterministic yield, never random loss. Tier-1
 *  recipes run on the Basic Bench's crusher; composites need the Lab
 *  furnace. Essences are not refined in v1. */
const REFINING_RECIPES: CraftRecipe[] = [
  { id: 'refine_refined_alloy', kind: 'refine', name: 'Refined Alloy', category: 'refining', inputs: { ScrapAlloy: 10 }, unitDurationMs: 20 * MIN, requiresLevel: 1, requiresBench: 1, station: 'crusher', outputMaterial: 'RefinedAlloy', outputBase: 8 },
  { id: 'refine_tempered_parts', kind: 'refine', name: 'Tempered Parts', category: 'refining', inputs: { BallisticParts: 10 }, unitDurationMs: 20 * MIN, requiresLevel: 1, requiresBench: 1, station: 'crusher', outputMaterial: 'TemperedParts', outputBase: 8 },
  { id: 'refine_stabilized_cells', kind: 'refine', name: 'Stabilized Cells', category: 'refining', inputs: { ReactiveComponents: 10 }, unitDurationMs: 20 * MIN, requiresLevel: 1, requiresBench: 1, station: 'crusher', outputMaterial: 'StabilizedCells', outputBase: 8 },
  { id: 'refine_woven_circuits', kind: 'refine', name: 'Woven Circuits', category: 'refining', inputs: { TechFragments: 10 }, unitDurationMs: 20 * MIN, requiresLevel: 1, requiresBench: 1, station: 'crusher', outputMaterial: 'WovenCircuits', outputBase: 8 },
  { id: 'refine_condensed_void', kind: 'refine', name: 'Condensed Void', category: 'refining', inputs: { VoidDust: 10 }, unitDurationMs: 25 * MIN, requiresLevel: 1, requiresBench: 1, station: 'crusher', outputMaterial: 'CondensedVoid', outputBase: 8 },
  { id: 'refine_composite_plating', kind: 'refine', name: 'Composite Plating', category: 'refining', inputs: { RefinedAlloy: 4, StabilizedCells: 2 }, unitDurationMs: 45 * MIN, requiresLevel: 1, requiresBench: 3, station: 'furnace', outputMaterial: 'CompositePlating', outputBase: 2 },
  { id: 'refine_circuit_lattice', kind: 'refine', name: 'Circuit Lattice', category: 'refining', inputs: { WovenCircuits: 4, TemperedParts: 2 }, unitDurationMs: 45 * MIN, requiresLevel: 1, requiresBench: 3, station: 'furnace', outputMaterial: 'CircuitLattice', outputBase: 2 },
  { id: 'refine_voidweave', kind: 'refine', name: 'Voidweave', category: 'refining', inputs: { CondensedVoid: 2, WovenCircuits: 2 }, unitDurationMs: 45 * MIN, requiresLevel: 1, requiresBench: 3, station: 'furnace', outputMaterial: 'Voidweave', outputBase: 2 },
];

/** Gear-frame durations by rarity (§2.5c): C/U 90min, Rare 150, Epic 240. */
export const GEAR_FRAME_DURATION_MS: Partial<Record<Rarity, number>> = {
  [Rarity.Common]: 90 * MIN,
  [Rarity.Uncommon]: 90 * MIN,
  [Rarity.Rare]: 150 * MIN,
  [Rarity.Epic]: 240 * MIN,
};

/** Crafted rarity is capped at Epic — Legendary cannot be selected,
 *  rolled, or tempered into existence (§2.5c, cache-forged precedent). */
export const CRAFTABLE_GEAR_RARITIES: readonly Rarity[] = [
  Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic,
];

/** Bench a gear rarity needs: Rare frames need the Forge, Epic the Lab. */
export function gearRarityRequiresBench(rarity: Rarity): number {
  if (rarity === Rarity.Epic) return 3;
  if (rarity === Rarity.Rare) return 2;
  return 1;
}

/** Epic frames additionally require gear mastery (§2.5c). */
export const EPIC_FRAME_GEAR_MASTERY = 10;

const GEAR_FRAME_RECIPES: CraftRecipe[] = [
  { id: 'frame_weapon', kind: 'gear', name: 'Weapon Frame', category: 'gear', inputs: { RefinedAlloy: 6, TemperedParts: 4, ForgeheartIngots: 2 }, unitDurationMs: 0, durationByRarityMs: GEAR_FRAME_DURATION_MS, requiresLevel: 1, requiresBench: 1, station: 'bench', gearSlot: 'weapon' },
  { id: 'frame_shield', kind: 'gear', name: 'Shield Frame', category: 'gear', inputs: { StabilizedCells: 6, RefinedAlloy: 4, HeartwoodResin: 2 }, unitDurationMs: 0, durationByRarityMs: GEAR_FRAME_DURATION_MS, requiresLevel: 1, requiresBench: 1, station: 'bench', gearSlot: 'shield' },
  { id: 'frame_class_mod', kind: 'gear', name: 'Class Mod Frame', category: 'gear', inputs: { WovenCircuits: 5, CircuitLattice: 2, PrismShards: 2 }, unitDurationMs: 0, durationByRarityMs: GEAR_FRAME_DURATION_MS, requiresLevel: 1, requiresBench: 1, station: 'bench', gearSlot: 'classMod' },
  { id: 'frame_relic', kind: 'gear', name: 'Relic Frame', category: 'gear', inputs: { CondensedVoid: 4, Voidweave: 2, MycoSteelFiber: 2 }, unitDurationMs: 0, durationByRarityMs: GEAR_FRAME_DURATION_MS, requiresLevel: 1, requiresBench: 1, station: 'bench', gearSlot: 'relic' },
  { id: 'frame_ordnance', kind: 'gear', name: 'Ordnance Frame', category: 'gear', inputs: { TemperedParts: 6, StabilizedCells: 3, ForgeheartIngots: 2 }, unitDurationMs: 0, durationByRarityMs: GEAR_FRAME_DURATION_MS, requiresLevel: 1, requiresBench: 1, station: 'bench', gearSlot: 'ordnance' },
];

// ─── Workshop tools (§2.5e) ──────────────────────────────────────────

export interface CraftToolDef {
  id: string;
  name: string;
  /** Jobs a fitted tool survives before it is spent. */
  durabilityJobs: number;
  /** Rolled-quality multiplier while fitted (Precision Calipers). */
  qualityMultiplier?: number;
  /** Unit-duration multiplier while fitted (Servo Bench Rig). */
  durationMultiplier?: number;
  /** Refining yield bonus while fitted (Reclaimer Head). */
  refineYieldBonus?: number;
  /** Consumable jobs: chance per completed unit of one bonus unit at
   *  the same rolled quality (Reclaimer Head). */
  bonusUnitChance?: number;
  blurb: string;
}

export const CRAFT_TOOLS: readonly CraftToolDef[] = [
  {
    id: 'tool_precision_calipers', name: 'Precision Calipers', durabilityJobs: 25,
    qualityMultiplier: 1.08,
    blurb: 'Fitted tool: rolled quality ×1.08 for 25 jobs.',
  },
  {
    id: 'tool_servo_bench_rig', name: 'Servo Bench Rig', durabilityJobs: 25,
    durationMultiplier: 0.85,
    blurb: 'Fitted tool: unit durations ×0.85 for 25 jobs.',
  },
  {
    id: 'tool_reclaimer_head', name: 'Reclaimer Head', durabilityJobs: 25,
    refineYieldBonus: 0.05, bonusUnitChance: 0.1,
    blurb: 'Fitted tool: refining yield +5pts; consumable jobs may reclaim a bonus unit.',
  },
];

const TOOL_RECIPES: CraftRecipe[] = [
  { id: 'tool_precision_calipers', kind: 'tool', name: 'Precision Calipers', category: 'tools', inputs: { CircuitLattice: 2, PrismShards: 2 }, unitDurationMs: 60 * MIN, requiresLevel: 1, requiresBench: 1, station: 'bench', toolId: 'tool_precision_calipers' },
  { id: 'tool_servo_bench_rig', kind: 'tool', name: 'Servo Bench Rig', category: 'tools', inputs: { CompositePlating: 2, MagnetiteCores: 2 }, unitDurationMs: 60 * MIN, requiresLevel: 1, requiresBench: 1, station: 'bench', toolId: 'tool_servo_bench_rig' },
  { id: 'tool_reclaimer_head', kind: 'tool', name: 'Reclaimer Head', category: 'tools', inputs: { CompositePlating: 1, CircuitLattice: 1, Voidweave: 1 }, unitDurationMs: 60 * MIN, requiresLevel: 1, requiresBench: 1, station: 'bench', toolId: 'tool_reclaimer_head' },
];

export function toolDef(toolId: string): CraftToolDef | undefined {
  return CRAFT_TOOLS.find((t) => t.id === toolId);
}

// ─── Catalysts (§2.5b) ───────────────────────────────────────────────

/** Optional per-unit catalyst input on mapped recipes (Forge required):
 *  quality bounds +10 min / +15 max. Signature materials finally have
 *  their sink. `gear: true` = the catalyst also applies to gear frames. */
export interface CatalystDef {
  materialId: string;
  consumableTypes: readonly string[];
  gear?: boolean;
}

export const CATALYSTS: readonly CatalystDef[] = [
  { materialId: 'Siltglass', consumableTypes: ['BossScanner', 'DataSkimmer'] },
  { materialId: 'NitrocellGel', consumableTypes: ['OverchargeStim', 'IncendiaryAmmo', 'ShockAmmo', 'CorrosiveAmmo', 'CryoAmmo', 'VoidAmmo'] },
  { materialId: 'HeartwoodResin', consumableTypes: ['ShieldCell', 'PatchKit', 'FieldPatchKit', 'MasterPatchKit'] },
  { materialId: 'ForgeheartIngots', consumableTypes: ['OrdnanceCharge', 'EMPCharge', 'CorrosiveCharge'], gear: true },
  { materialId: 'PrismShards', consumableTypes: ['BossScanner', 'DataSkimmer', 'LuckBooster'] },
  { materialId: 'MagnetiteCores', consumableTypes: ['SalvageContract', 'MagnetizedPayload'] },
  { materialId: 'MycoSteelFiber', consumableTypes: ['NanoSwarm', 'AdrenalineShot'] },
];

/** The catalyst material that applies to a recipe, if any. */
export function catalystForRecipe(recipe: CraftRecipe): string | null {
  for (const cat of CATALYSTS) {
    if (recipe.kind === 'consumable' && recipe.consumableType && cat.consumableTypes.includes(recipe.consumableType)) {
      return cat.materialId;
    }
    if (recipe.kind === 'gear' && cat.gear) return cat.materialId;
  }
  return null;
}

export const CATALYST_MIN_BONUS = 10;
export const CATALYST_MAX_BONUS = 15;
export const CATALYST_REQUIRES_BENCH = 2;

/**
 * Legendary Core Catalyst (0026, collections slice): gear-frame jobs
 * may escrow ONE legendary core per unit instead of a material
 * catalyst. Gear quality is priced in generation DRAWS (best-of-N
 * rollQuality — the same lever tempering uses), so the core buys
 * +2 draws per completed unit. Mutually exclusive with the material
 * catalyst; Forge-gated (CATALYST_REQUIRES_BENCH) like it. SQL twin:
 * cc_enqueue_craft_job / cc_settle_craft_jobs in migration 0026.
 */
export const CORE_CATALYST_DRAWS_BONUS = 2;
export const CORE_CATALYST_CORES_PER_UNIT = 1;

// ─── The catalog ─────────────────────────────────────────────────────

/**
 * Research batch recipes (0038, Production Systems): three shipped
 * consumables produced in batches of 3 — 2.5× the base recipe's
 * inputs and 2.2× its unit duration per 3 units (cheaper in time
 * than three singles, dearer in materials: the production-line
 * trade). Inputs are per-input ceil(base × 2.5) so every input is a
 * whole unit (Patch Kit's 1 Reactive Component prices as 3).
 * Data-only recipes behind the requiresResearch gate — the SQL
 * twin lives in cc_craft_recipe_catalog (migration 0038).
 */
export const BATCH_RECIPES: CraftRecipe[] = [
  {
    id: 'recipe_shield_cell_batch', kind: 'consumable', name: 'Shield Cell ×3 (Batch)', category: 'survival',
    inputs: { ScrapAlloy: 50, ReactiveComponents: 30 }, unitDurationMs: 1980000,
    requiresLevel: 3, requiresBench: 1, station: 'bench', consumableType: 'ShieldCell',
    requiresResearch: 'production_systems', outputQuantity: 3,
  },
  {
    id: 'recipe_patch_kit_batch', kind: 'consumable', name: 'Patch Kit ×3 (Batch)', category: 'utility',
    inputs: { ScrapAlloy: 10, ReactiveComponents: 3 }, unitDurationMs: 1584000,
    requiresLevel: 1, requiresBench: 1, station: 'bench', consumableType: 'PatchKit',
    requiresResearch: 'production_systems', outputQuantity: 3,
  },
  {
    id: 'recipe_ordnance_batch', kind: 'consumable', name: 'Ordnance Charge ×3 (Batch)', category: 'offense',
    inputs: { ScrapAlloy: 30, BallisticParts: 25 }, unitDurationMs: 1584000,
    requiresLevel: 1, requiresBench: 1, station: 'bench', consumableType: 'OrdnanceCharge',
    requiresResearch: 'production_systems', outputQuantity: 3,
  },
];

/** Manufacturer Standing exclusives (0043, brief §2.5): one recipe per
 *  manufacturer, gated at rank 2 on that manufacturer's own ladder.
 *  Ids and output types are pinned against
 *  src/content/manufacturerStanding.ts (STANDING_RECIPE_TYPES) by the
 *  slice suite; the SQL catalog carries the same six objects. */
const STANDING_RECIPES: CraftRecipe[] = [
  {
    id: 'recipe_redline_standing', kind: 'consumable', name: 'Redline Tonic', category: 'offense',
    inputs: { BallisticParts: 12, NitrocellGel: 2, ReactiveComponents: 6 },
    unitDurationMs: 25 * MIN, requiresLevel: 12, requiresBench: 1, station: 'bench',
    consumableType: 'RedlineTonic', requiresStanding: { manufacturer: 'Redline', rank: 2 },
  },
  {
    id: 'recipe_ironwood_standing', kind: 'consumable', name: 'Heartwood Sight Oil', category: 'offense',
    inputs: { HeartwoodResin: 2, TechFragments: 10, ReactiveComponents: 6 },
    unitDurationMs: 25 * MIN, requiresLevel: 12, requiresBench: 1, station: 'bench',
    consumableType: 'HeartwoodSightOil', requiresStanding: { manufacturer: 'Ironwood', rank: 2 },
  },
  {
    id: 'recipe_blastforge_standing', kind: 'consumable', name: 'Forgeheart Charge', category: 'offense',
    inputs: { ForgeheartIngots: 2, BallisticParts: 12, ReactiveComponents: 8 },
    unitDurationMs: 25 * MIN, requiresLevel: 12, requiresBench: 1, station: 'bench',
    consumableType: 'ForgeheartCharge', requiresStanding: { manufacturer: 'BlastForge', rank: 2 },
  },
  {
    id: 'recipe_prismatek_standing', kind: 'consumable', name: 'Prism Coating', category: 'offense',
    inputs: { PrismShards: 2, VoidEssence: 3, TechFragments: 8 },
    unitDurationMs: 25 * MIN, requiresLevel: 12, requiresBench: 1, station: 'bench',
    consumableType: 'PrismCoating', requiresStanding: { manufacturer: 'Prismatek', rank: 2 },
  },
  {
    id: 'recipe_throwtech_standing', kind: 'consumable', name: 'ThrowTech Decoy Kit', category: 'utility',
    inputs: { MagnetiteCores: 2, TechFragments: 12, ScrapAlloy: 20 },
    unitDurationMs: 25 * MIN, requiresLevel: 12, requiresBench: 1, station: 'bench',
    consumableType: 'ThrowTechDecoyKit', requiresStanding: { manufacturer: 'ThrowTech', rank: 2 },
  },
  {
    id: 'recipe_helixworks_standing', kind: 'consumable', name: 'Helix Calibration Kit', category: 'utility',
    inputs: { Siltglass: 2, TechFragments: 12, VoidDust: 2 },
    unitDurationMs: 25 * MIN, requiresLevel: 12, requiresBench: 1, station: 'bench',
    consumableType: 'HelixCalibrationKit', requiresStanding: { manufacturer: 'HelixWorks', rank: 2 },
  },
];

export const ALL_CRAFT_RECIPES: readonly CraftRecipe[] = [
  ...LEGACY_RECIPES,
  ...VEHICLE_CONSUMABLE_RECIPES,
  ...REFINING_RECIPES,
  ...GEAR_FRAME_RECIPES,
  ...TOOL_RECIPES,
  ...BATCH_RECIPES,
  ...STANDING_RECIPES,
];

const RECIPE_BY_ID = new Map(ALL_CRAFT_RECIPES.map((r) => [r.id, r]));

export function getCraftRecipe(id: string): CraftRecipe | undefined {
  return RECIPE_BY_ID.get(id);
}

/** Every craft recipe (any kind) that consumes the given material or
 *  essence id — the unified "Used in" lookup (§2.9 / market depth). */
export function getAllCraftRecipesUsingMaterial(materialId: string): CraftRecipe[] {
  return ALL_CRAFT_RECIPES.filter((r) => (r.inputs[materialId] ?? 0) > 0);
}

const MATERIAL_ID_SET = new Set<string>(Object.values(MaterialType));

/** Recipe input keys split the legacy way: materials vs essences. */
export function isMaterialInput(key: string): boolean {
  return MATERIAL_ID_SET.has(key);
}

// ─── Mastery tracks (§2.7) ───────────────────────────────────────────

export const CRAFT_MASTERY_TRACKS = {
  consumable: 'crafting_consumables',
  refining: 'crafting.refining',
  gear: 'crafting.gear',
} as const;

/** Mastery XP per completed unit, by job kind. */
export function craftMasteryForKind(kind: CraftJobKind): { track: string; xpPerUnit: number } {
  switch (kind) {
    case 'refine':
      return { track: CRAFT_MASTERY_TRACKS.refining, xpPerUnit: 10 };
    case 'gear':
    case 'tool':
      return { track: CRAFT_MASTERY_TRACKS.gear, xpPerUnit: 25 };
    default:
      return { track: CRAFT_MASTERY_TRACKS.consumable, xpPerUnit: 10 };
  }
}

/** The mastery track whose level widens a job's quality bounds: the
 *  consumable track for consumables, the gear track for frames/tools. */
export function qualityMasteryTrackForKind(kind: CraftJobKind): string {
  return kind === 'gear' || kind === 'tool' ? CRAFT_MASTERY_TRACKS.gear : CRAFT_MASTERY_TRACKS.consumable;
}

// ─── XP formula (§2.3) ───────────────────────────────────────────────

/** Roaming ticks per hour: the shipped 3-second tick. */
export const ROAMING_TICKS_PER_HOUR = 1200;

/** idleXpPerTick of the best area unlocked at `level`. */
export function bestAreaXpPerTickAtLevel(level: number): number {
  const lv = Math.max(1, Math.floor(level) || 1);
  let best = 0;
  for (const area of ROAMING_AREAS) {
    if (area.unlockLevel <= lv) best = Math.max(best, area.idleXpPerTick);
  }
  return best;
}

/** What an hour of roaming pays in XP at `level` — the peg. */
export function benchmarkXpPerHour(level: number): number {
  return ROAMING_TICKS_PER_HOUR * bestAreaXpPerTickAtLevel(level);
}

/**
 * XP for ONE completed unit: its (snapshotted, rush-adjusted) duration
 * priced against the roaming benchmark at the level held AT COMPLETION,
 * times the craftXpRate lever. Paid at settlement, never at enqueue;
 * a rushed unit pays proportionally less because its duration shrank.
 */
export function craftUnitXp(durationMs: number, levelAtCompletion: number, rate: number): number {
  const hours = Math.max(0, durationMs) / 3_600_000;
  return Math.round(hours * benchmarkXpPerHour(levelAtCompletion) * rate);
}

// ─── Quality bounds + roll (§2.4) ────────────────────────────────────

/**
 * Per-type crafting bound overrides where the brief's recipe spec is
 * tighter than the def's display bounds: the crafted Patch Kit rolls
 * 75–130 (§2.5d) even though the Patch Kit def carries 75/150 (its
 * vendor/market display range). The SQL twin (cc_craft_quality_bounds)
 * carries the same values; the parity test pins them.
 */
export const CRAFT_QUALITY_BOUND_OVERRIDES: Record<string, { min: number; max: number }> = {
  PatchKit: { min: 75, max: 130 },
};

export interface CraftQualityBounds {
  min: number;
  max: number;
  /** Hard ceiling the final quality clamps to (def cap, default 175). */
  cap: number;
}

/**
 * THE bounds function (TS twin of cc_craft_quality_bounds):
 *   min = def.craftMin + min(20, 1.5 × (masteryLevel − 1)) [+5 Lab]
 *         [+10 catalyst] [+ craftQualityShift lever]
 *   max = def.craftMax + min(25, 2.0 × (masteryLevel − 1))
 *         [+15 catalyst] [+ shift], capped at 175 before the bench
 *         factor is applied at roll time.
 * Gear frames have no consumable def: they roll on the gear track with
 * frame bounds 75–150 (the WorkshopRushTicket-class band).
 */
export function craftQualityBounds(input: {
  consumableType?: string | null;
  masteryLevel: number;
  bench: number;
  catalyst: boolean;
  qualityShift?: number;
}): CraftQualityBounds {
  const def = input.consumableType ? CONSUMABLES[input.consumableType] : undefined;
  const override = input.consumableType ? CRAFT_QUALITY_BOUND_OVERRIDES[input.consumableType] : undefined;
  const baseMin = override?.min ?? def?.quality.craftMin ?? 75;
  const baseMax = override?.max ?? def?.quality.craftMax ?? 150;
  const cap = def?.quality.cap ?? 175;
  const mastery = Math.max(1, Math.floor(input.masteryLevel) || 1);
  const bench = benchDef(input.bench);
  const shift = input.qualityShift ?? 0;
  let min = baseMin + Math.min(20, 1.5 * (mastery - 1)) + bench.minQualityBonus + shift;
  let max = baseMax + Math.min(25, 2.0 * (mastery - 1)) + shift;
  if (input.catalyst) {
    min += CATALYST_MIN_BONUS;
    max += CATALYST_MAX_BONUS;
  }
  max = Math.min(max, 175);
  if (min > max) min = max;
  return { min, max, cap };
}

/**
 * Roll one unit's quality at completion: uniform(min, max) × bench
 * factor [× fitted-tool multiplier], rounded to 2dp, clamped to
 * [1, cap]. `rng` is injected (server RNG in production; seeded in
 * tests) — this function never calls Math.random itself.
 */
export function rollCraftQuality(
  bounds: CraftQualityBounds,
  bench: number,
  rng: () => number,
  toolQualityMultiplier = 1,
): number {
  const roll = (bounds.min + rng() * Math.max(0, bounds.max - bounds.min)) * benchDef(bench).qualityFactor * toolQualityMultiplier;
  const rounded = Math.round(roll * 100) / 100;
  return Math.max(1, Math.min(bounds.cap, rounded));
}

// ─── Refining yield (§2.5a) ──────────────────────────────────────────

/** yieldRate = refineBaseYield + 0.004 × refining mastery level,
 *  capped at 1.00 (a level-50 refiner converts at 100%). */
export function refineYieldRate(masteryLevel: number, baseYield: number, toolBonus = 0): number {
  const lv = Math.max(1, Math.floor(masteryLevel) || 1);
  return Math.min(1, baseYield + 0.004 * lv + toolBonus);
}

/** Units out for one refine unit: the recipe's base-rate output scaled
 *  by the yield rate relative to the base rate (floor). At mastery 1
 *  and the shipped 0.80 base this is exactly the printed output
 *  (10 → 8, composites → 2); at 100% yield tier-1 pays 10 per 10. */
export function refineOutputCount(recipe: CraftRecipe, masteryLevel: number, baseYield: number, toolBonus = 0): number {
  const base = recipe.outputBase ?? 0;
  if (base <= 0 || baseYield <= 0) return base;
  return Math.floor((base * refineYieldRate(masteryLevel, baseYield, toolBonus)) / baseYield);
}

// ─── Gear temper (§2.5c) ─────────────────────────────────────────────

/** temperChance = base (lever) + 0.01 × gear mastery level
 *  + Master Artificer (Fixer major, migration 0029), cap 0.30. */
export function gearTemperChance(gearMasteryLevel: number, baseChance: number, skillBonus = 0): number {
  const lv = Math.max(1, Math.floor(gearMasteryLevel) || 1);
  return Math.min(0.3, Math.max(0, baseChance) + 0.01 * lv + Math.max(0, skillBonus));
}

/**
 * The composed craft quality shift (migration 0029): the economy
 * lever, the Fixer Calibrated Eye / Tolerance Stacking total, and a
 * future Research shift compose ADDITIVELY under ONE clamp,
 * [−10, +20] — whichever of Fixer/Research lands first owns the
 * clamp (Fixer landed first). The result feeds craftQualityBounds'
 * qualityShift input in the TS settler; cc_complete_craft_unit
 * composes identically in SQL.
 */
export function composedCraftQualityShift(
  leverShift: number,
  skillBonus: number,
  researchShift = 0,
): number {
  const sum = (leverShift || 0) + Math.max(0, skillBonus || 0) + (researchShift || 0);
  return Math.min(20, Math.max(-10, sum));
}

// ─── Duration snapshot modifiers ─────────────────────────────────────

/**
 * The consumableEfficiency skill consumer (§2.7, F7): the Scavenger
 * small nodes scav_cons_1/scav_cons_2 carry +0.10 consumableEfficiency
 * per point; the server-side craft consumer converts TOTAL POINTS
 * across both nodes (effect total × 10) into a unit-duration
 * multiplier 1 − min(0.20, 0.02 × points), snapshotted at enqueue.
 * `efficiencyBonus` is the computeSkillBonuses total for the key.
 */
export function consumableEfficiencyDurationMultiplier(efficiencyBonus: number): number {
  const points = Math.max(0, Math.round((efficiencyBonus || 0) * 10));
  return 1 - Math.min(0.2, 0.02 * points);
}

/**
 * The Fixer craft-speed consumer (migration 0029): Assembly Rhythm /
 * Parallel Hands carry +0.025 craftSpeedBonus per point; the server
 * craft consumer converts the TOTAL bonus into a second unit-duration
 * multiplier 1 − min(0.25, bonus), applied AFTER the Scavenger
 * consumableEfficiency term. The two skill multipliers compose
 * multiplicatively under a combined 0.60× floor (0.80 × 0.75 = 0.60
 * at both caps — the floor binds exactly there and nowhere else).
 * Snapshotted at enqueue in BOTH store implementations.
 */
export function fixerCraftSpeedDurationMultiplier(craftSpeedBonus: number): number {
  return 1 - Math.min(0.25, Math.max(0, craftSpeedBonus || 0));
}

/** Workshop Rush Ticket time reduction at a given ticket quality:
 *  the def's own scaling (0.2 base, chance-mode cap 0.45) — resolved
 *  through getConsumableRuntimeEffects by the caller; this constant
 *  pair documents the fallback when no def read is available. */
export const RUSH_TICKET_BASE_REDUCTION = 0.2;
export const RUSH_TICKET_MAX_REDUCTION = 0.45;

/**
 * The rush-ticket reduction the craft enqueue snapshots (migration
 * 0029): min(cap, 0.2 × quality/100) — the SQL twin's clamp in
 * cc_enqueue_craft_job, restated here so both implementations share
 * one formula. The Fixer keystone's rushReductionCapBonus raises the
 * cap (0.45 → 0.55 maxed); at capBonus 0 this equals the consumable
 * def's FULL_CHANCE read for every reachable ticket quality.
 */
export function rushTicketTimeReduction(qualityPercent: number, capBonus = 0): number {
  const cap = RUSH_TICKET_MAX_REDUCTION + Math.max(0, capBonus || 0);
  return Math.min(cap, RUSH_TICKET_BASE_REDUCTION * (qualityPercent || 0) / 100);
}
