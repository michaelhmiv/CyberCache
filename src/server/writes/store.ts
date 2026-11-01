/**
 * WriteStore: the Route B write surface (slice B3).
 *
 * Two implementations behind one seam:
 *  - PgWriteStore calls the `cc_*` write functions landed in
 *    db/migrations/0004_write_apis.sql (faithful ports of the Supabase RPCs
 *    with `auth.uid()` replaced by an explicit `p_player_id` from the JWT)
 *    and the direct tables for runtime snapshots / activity reads.
 *  - InMemoryWriteStore mirrors the same observable semantics for tests.
 *
 * All economy outcomes are computed from stored state. Result payloads are
 * the functions' JSONB verbatim, matching today's RPC result shapes so the
 * B4 client cutover is a transport swap. Idempotency: every verified op
 * records (player, nonce) in the verified-action ledger and replays the
 * stored result for a repeated nonce, exactly like the SQL surface.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { mapProfile, type ProfileRowData } from '../reads/store.js';
import { xpToNextLevel } from '../../content/simulation.js';
import type { GearItem } from '../../types/items.js';
import { skillBonusesFromRecords } from '../gameplay/serverLoadout.js';
import { finalizePendingCraftedGear } from './craftFinalize.js';
import {
  buildWorkshopStateView,
  type CraftJobRecord,
  type CraftJobSnapshot,
} from './craftEngine.js';
import type { ExtractionStateRecord } from './extractionEngine.js';
import {
  buildRepairBoardView,
  resolveRepairLevers,
  type RepairVehicleInfo,
} from './repairBoard.js';
import { resolveEconomyConfigValues } from '../economy/config.js';
import type { DiscoveryRecord } from '../../content/collections.js';
import {
  applyReforgeToItem,
  isReforgeableAffix,
  reforgeKindOf,
} from '../../lib/gear/affixPools.js';
import { createRNG, hashString } from '../../lib/utils/rng.js';

export type Json = Record<string, unknown>;

export type WriteErrorCode =
  | 'unauthorized'
  | 'validation'
  | 'not_found'
  | 'insufficient_funds'
  | 'conflict'
  | 'forbidden';

export class WriteStoreError extends Error {
  readonly code: WriteErrorCode;
  constructor(code: WriteErrorCode, message: string) {
    super(message);
    this.name = 'WriteStoreError';
    this.code = code;
  }
}

/** Maps a SQL `raise exception` message to a stable error code. */
export function codeForWriteMessage(message: string): WriteErrorCode {
  if (message === 'Authentication required') return 'unauthorized';
  if (message === 'Verified account required' || message.startsWith('Cannot accept own')) return 'forbidden';
  if (message.startsWith('Insufficient')) return 'insufficient_funds';
  if (
    message === 'Listing not active' ||
    message === 'Job state invalid' ||
    message === 'Item state invalid' ||
    message === 'Service job not available'
  ) {
    return 'conflict';
  }
  if (message.includes('not found') || message.includes('Not found')) return 'not_found';
  return 'validation';
}

export function writeError(message: string): WriteStoreError {
  return new WriteStoreError(codeForWriteMessage(message), message);
}

// ---------------------------------------------------------------------------
// Row shapes (mirror the B3 tables)
// ---------------------------------------------------------------------------

export interface WriteItemData {
  id: string;
  owner_user_id: string;
  kind: string;
  static_item_id: string | null;
  item_level: number;
  rarity: string;
  quality: string | null;
  material_tier: string | null;
  condition_state: string | null;
  condition_current: number | null;
  condition_max: number | null;
  supply_mode: string;
  source_id: string | null;
  creator_user_id: string | null;
  tradeable: boolean;
  account_bound: boolean;
  locked_until: string | null;
  payload: Json;
  runtime_state: string;
  is_locked: boolean;
  equipped_slot: string | null;
  estimated_value: number;
  created_at: string;
  updated_at: string;
}

export interface ActiveActionData {
  user_id: string;
  active_action: string;
  started_at: string;
  completes_at: string | null;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  scene_key: string | null;
  notes: string | null;
  activity_payload: Json;
  public_payload: Json;
  last_heartbeat_at: string;
  public_visible: boolean;
  schema_version: number;
  updated_at: string;
}

export interface WriteListingData {
  id: string;
  seller_user_id: string;
  /** Null for consumable/material listings (0019) — they escrow profile stock, not an item row. */
  item_instance_id: string | null;
  price_credits: number;
  status: string;
  listed_at: string;
  sold_at: string | null;
  // Market depth (0019) — optional so pre-0019 seed rows stay valid;
  // stores normalize absent fields to the gear defaults at read time.
  listing_kind?: 'gear' | 'consumable' | 'material' | 'vehicle';
  quantity?: number;
  quality_percent?: number | null;
  consumable_type?: string | null;
  consumable_batch_id?: string | null;
  batch_origin?: string | null;
  batch_creator_user_id?: string | null;
  batch_source_recipe_id?: string | null;
  material_id?: string | null;
  identity_key?: string | null;
  category?: string | null;
  display_name?: string | null;
  weapon_type?: string | null;
  element?: string | null;
  rarity?: string | null;
  item_level?: number | null;
  seller_type?: 'player' | 'npc';
}

export interface ServiceJobData {
  id: string;
  owner_user_id: string;
  provider_user_id: string | null;
  profession_id: string;
  status: string;
  target_item_instance_id: string;
  requested_service_id: string | null;
  quoted_price_credits: number | null;
  quoted_duration_minutes: number | null;
  owner_supplied_material_ids: string[];
  provider_supplied_material_ids: string[];
  escrow_id: string | null;
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  // ── Mechanics & repair services (migration 0025) ────────────────
  // Present on repair jobs (profession_id 'repair'); absent on
  // legacy rows. The price is escrowed in full at posting; work
  // accrues only while the job is the provider's active action.
  target_points?: number | null;
  points_restored?: number;
  work_points_banked?: number;
  /** Remaining restoration capacity of the currently open kit. */
  open_kit_capacity?: number;
  /** Capacity of the currently open kit when it was opened. */
  open_kit_total?: number;
  open_kit_quality?: number | null;
  accrued_work_ms?: number;
  last_settled_at?: string | null;
  last_progress_at?: string | null;
  expires_at?: string | null;
  outcome?: string | null;
  paid_credits?: number | null;
  fee_credits?: number | null;
  xp_awarded?: number | null;
  kit_type?: string | null;
  kits_consumed?: Array<{ kitType: string; quality: number; pointsApplied: number }>;
  repair_snapshot?: {
    masteryLevel: number;
    workRatePointsPerHour: number;
    efficiency: number;
  } | null;
}

export interface ConsumableBatchData {
  id: string;
  owner_user_id: string;
  consumable_type: string;
  quality_percent: number;
  quantity: number;
  origin: string;
  creator_user_id: string | null;
  source_recipe_id: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface PushDeviceData {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  app_version: string | null;
  enabled: boolean;
  last_registered_at: string;
  last_seen_at: string;
  disabled_at: string | null;
  metadata: Json;
}

export interface ProfessionData {
  user_id: string;
  profession_id: string;
  level: number;
  xp: number;
  total_crafts: number;
  total_services_completed: number;
  reputation_score: number;
  updated_at: string;
}

export interface StatCounterData {
  user_id: string;
  stat_key: string;
  stat_value: number;
}

export interface MasteryData {
  user_id: string;
  mastery_id: string;
  mastery_xp: number;
  mastery_level: number;
}

export interface SkillNodeData {
  id: string;
  tree: string;
  tier: number;
  slot_index: number;
  name: string;
  description: string;
  node_type: string;
  max_points: number;
  per_point_cost: number;
  effects: Json;
  requires: string[];
}

export interface OddsOutcomeData {
  table_id: string;
  outcome: string;
  weight: number;
  payload: Json;
}

export interface RoamingAreaData {
  id: string;
  display_name: string;
  unlock_level: number;
  payload: Json;
}

export interface LedgerEntryData {
  user_id: string;
  action_type: string;
  idempotency_key: string;
  result_payload: Json;
}

export interface RuntimeSnapshotData {
  user_id: string;
  schema_version: number;
  snapshot: Json;
  created_at: string;
  updated_at: string;
}

/**
 * The combat_stats row in client (PostgREST) shape: bigint columns as
 * numbers, timestamptz as ISO strings. B4 addition — the client's
 * combatStats sync used to read/write this table directly through
 * PostgREST; the Chef route pair (GET/PUT /api/stats/combat) is its
 * transport swap, same pattern as the runtime snapshot routes.
 */
export interface CombatStatsData {
  user_id: string;
  total_kills: number;
  total_deaths: number;
  longest_kill_streak: number;
  last_kill_at: string | null;
  run_started_at: string | null;
  kills_by_area: Record<string, number>;
  kills_by_weapon_type: Record<string, number>;
  kills_by_boss: Record<string, number>;
  kills_by_element: Record<string, number>;
  highest_boss_tier: number;
  active_play_seconds: number;
  idle_play_seconds: number;
  updated_at: string;
}

export interface WriteSeed {
  profiles: ProfileRowData[];
  items: WriteItemData[];
  listings: WriteListingData[];
  activeActions: ActiveActionData[];
  serviceJobs: ServiceJobData[];
  consumableBatches: ConsumableBatchData[];
  pushDevices: PushDeviceData[];
  professions: ProfessionData[];
  statCounters: StatCounterData[];
  masteries: MasteryData[];
  skillNodes: SkillNodeData[];
  oddsOutcomes: OddsOutcomeData[];
  roamingAreas: RoamingAreaData[];
  adGrants: { user_id: string; reward_type: string; status: string; granted_at: string }[];
  ledger: LedgerEntryData[];
  runtimeSnapshots: RuntimeSnapshotData[];
  combatStats: CombatStatsData[];
  /** user_ids that already have a user_notification_settings row. */
  notificationSettingsUsers: string[];
  usernameReservations: string[];
  /** Craft jobs (migration 0024), the in-memory settler's state. */
  craftJobs: CraftJobRecord[];
  /** Extraction state rows (migration 0033), the accrual twin's state. */
  extractionStates: ExtractionStateRecord[];
}

export function emptyWriteSeed(): WriteSeed {
  return {
    profiles: [],
    items: [],
    listings: [],
    activeActions: [],
    serviceJobs: [],
    consumableBatches: [],
    pushDevices: [],
    professions: [],
    statCounters: [],
    masteries: [],
    skillNodes: [],
    oddsOutcomes: [],
    roamingAreas: [],
    adGrants: [],
    ledger: [],
    runtimeSnapshots: [],
    combatStats: [],
    notificationSettingsUsers: [],
    usernameReservations: [],
    craftJobs: [],
    extractionStates: [],
  };
}

// ---------------------------------------------------------------------------
// Pure economy rules, ported from the SQL helpers in 0004
// (cc_salvage_scrap, cc_apply_xp, cc_consumable_recipe_*,
// cc_hash_string / cc_mulberry32_next, cc_generate_weapon_payload,
// cc_draw_odds, cc_mastery_level). Vendor pricing and the item
// estimated value live in src/lib/vendor/catalog.ts (0020).
// ---------------------------------------------------------------------------

/** cc_salvage_scrap: round((10 + level*5) * rarity multiplier), title-case rarities. */
export function salvageScrap(rarity: string, itemLevel: number): number {
  const mult =
    rarity === 'Uncommon' ? 1.5 : rarity === 'Rare' ? 2.5 : rarity === 'Epic' ? 4 : rarity === 'Legendary' ? 8 : 1;
  return Math.max(1, Math.round((10 + Math.max(1, itemLevel || 1) * 5) * mult));
}

/** cc_apply_xp: per-level thresholds come from the one shared curve. */
export function applyXp(level: number, xp: number, award: number): { player_level: number; player_xp: number } {
  let nextLevel = Math.max(1, Math.floor(level));
  let nextXp = Math.max(0, Math.floor(xp)) + Math.max(0, Math.floor(award));
  for (;;) {
    const needed = xpToNextLevel(nextLevel);
    if (nextXp < needed) break;
    nextXp -= needed;
    nextLevel += 1;
  }
  return { player_level: nextLevel, player_xp: nextXp };
}

export function skillSpendTotal(spends: Json): number {
  let total = 0;
  for (const value of Object.values(spends)) {
    if (typeof value === 'number' && Number.isFinite(value)) total += Math.max(0, Math.floor(value));
  }
  return total;
}

/**
 * Vendor pricing used to live here as a hardcoded VENDOR_CATALOG
 * record — the second of three copies. It now derives from the ONE
 * vendor catalog (src/lib/vendor/catalog.ts): staples + date-seeded
 * rotation + Item of the Day, with the SQL twin in migration 0020.
 */

/**
 * cc_consumable_recipe_materials: requirements keyed by recipe_id ONLY.
 * Charged once per craft (not per unit) by cc_claim_crafted_consumable.
 * Keys outside the five materials are essences (see the SQL loop).
 */
const RECIPE_MATERIALS: Record<string, Record<string, number>> = {
  recipe_medkit: { ScrapAlloy: 15, ReactiveComponents: 8 },
  recipe_medkit_refined: { ScrapAlloy: 25, ReactiveComponents: 15, VoidDust: 1 },
  recipe_shieldcell: { ScrapAlloy: 20, ReactiveComponents: 12 },
  recipe_nanoswarm: { ScrapAlloy: 30, ReactiveComponents: 20, VoidDust: 2 },
  recipe_adrenaline: { ScrapAlloy: 40, ReactiveComponents: 25, VoidDust: 3 },
  recipe_ammo_pack: { ScrapAlloy: 10, BallisticParts: 6 },
  recipe_high_capacity_ammo_pack: { ScrapAlloy: 18, BallisticParts: 12, TechFragments: 2 },
  recipe_ap_ammo: { ScrapAlloy: 15, BallisticParts: 10 },
  recipe_fire_ammo: { ScrapAlloy: 15, BallisticParts: 8, IgnitionFluid: 3 },
  recipe_shock_ammo: { ScrapAlloy: 15, BallisticParts: 8, ConduitWire: 3 },
  recipe_corrosive_ammo: { ScrapAlloy: 15, BallisticParts: 8, AcidCompound: 3 },
  recipe_cryo_ammo: { ScrapAlloy: 15, BallisticParts: 8, CryoGel: 3 },
  recipe_void_ammo: { ScrapAlloy: 20, BallisticParts: 10, VoidEssence: 5 },
  recipe_ordnance: { ScrapAlloy: 12, BallisticParts: 10 },
  recipe_emp_charge: { ScrapAlloy: 18, BallisticParts: 8, ConduitWire: 4, TechFragments: 2 },
  recipe_corrosive_charge: { ScrapAlloy: 18, BallisticParts: 8, AcidCompound: 4, TechFragments: 2 },
  recipe_overcharge: { ScrapAlloy: 25, BallisticParts: 15, VoidDust: 2 },
  recipe_targetpainter: { ScrapAlloy: 20, BallisticParts: 10, TechFragments: 2 },
  recipe_phaseshift: { ScrapAlloy: 30, BallisticParts: 15, VoidDust: 5 },
  recipe_luck: { ScrapAlloy: 15, TechFragments: 8 },
  recipe_scanner: { ScrapAlloy: 20, TechFragments: 12 },
  recipe_insurance: { ScrapAlloy: 30, TechFragments: 15, VoidDust: 2 },
  recipe_dataskimmer: { ScrapAlloy: 25, TechFragments: 15, VoidDust: 3 },
  recipe_jammer: { ScrapAlloy: 20, TechFragments: 10, ConduitWire: 2 },
  recipe_magnetized: { ScrapAlloy: 15, BallisticParts: 10, TechFragments: 5 },
  recipe_signal_scrambler: { ScrapAlloy: 15, TechFragments: 10, ConduitWire: 2 },
  recipe_loot_beacon: { ScrapAlloy: 20, TechFragments: 14, VoidDust: 2 },
  recipe_salvage_contract: { ScrapAlloy: 12, TechFragments: 8 },
  recipe_workshop_rush_ticket: { ScrapAlloy: 18, TechFragments: 12, VoidDust: 1 },
};

export function recipeMaterials(recipeId: string): Record<string, number> | null {
  return RECIPE_MATERIALS[recipeId] ?? null;
}

/** cc_consumable_quality_bounds: craft quality range per item key. */
const QUALITY_BOUNDS: Record<string, { min: number; max: number }> = {
  MedKit: { min: 75, max: 125 },
  MedKitRefined: { min: 80, max: 140 },
  ShieldCell: { min: 75, max: 130 },
  NanoSwarm: { min: 80, max: 145 },
  AdrenalineShot: { min: 75, max: 150 },
  AmmoPack: { min: 70, max: 125 },
  HighCapacityAmmoPack: { min: 75, max: 140 },
  ArmorPiercingAmmo: { min: 75, max: 135 },
  IncendiaryAmmo: { min: 75, max: 140 },
  ShockAmmo: { min: 75, max: 140 },
  CorrosiveAmmo: { min: 75, max: 140 },
  CryoAmmo: { min: 75, max: 140 },
  VoidAmmo: { min: 70, max: 155 },
  OrdnanceCharge: { min: 75, max: 145 },
  EMPCharge: { min: 75, max: 145 },
  CorrosiveCharge: { min: 75, max: 145 },
  OverchargeStim: { min: 70, max: 150 },
  TargetPainter: { min: 75, max: 145 },
  PhaseShiftGrenade: { min: 75, max: 155 },
  LuckBooster: { min: 75, max: 135 },
  BossScanner: { min: 80, max: 160 },
  InsuranceToken: { min: 80, max: 145 },
  DataSkimmer: { min: 75, max: 150 },
  Jammer: { min: 75, max: 150 },
  MagnetizedPayload: { min: 75, max: 150 },
  SignalScrambler: { min: 75, max: 145 },
  LootBeacon: { min: 70, max: 150 },
  SalvageContract: { min: 75, max: 150 },
  WorkshopRushTicket: { min: 75, max: 150 },
};

export function recipeQualityBounds(itemKey: string): { min: number; max: number } | null {
  return QUALITY_BOUNDS[itemKey] ?? null;
}

/** cc_mastery_level: thresholds are level^2 * 100 cumulative. */
export function masteryLevelForXp(totalXp: number): number {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  for (;;) {
    const threshold = level * level * 100;
    if (remaining < threshold) break;
    remaining -= threshold;
    level += 1;
  }
  return level;
}

/** cc_hash_string: FNV-style hash used to seed roaming RNG. */
export function hashString(input: string): number {
  let h = 1779033703;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  return h;
}

/** cc_mulberry32_next: deterministic PRNG step (seed increment is 18205). */
export class Mulberry32 {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 18205) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    t = (t ^ (t >>> 14)) >>> 0;
    return t / 4294967296;
  }
}

const WEAPON_TYPES = ['Pistol', 'SMG', 'Shotgun', 'Sniper', 'Launcher', 'Beam'] as const;
const MANUFACTURERS = ['Redline', 'Ironwood', 'BlastForge', 'Prismatek', 'ThrowTech', 'HelixWorks'] as const;
const ELEMENTS = ['Kinetic', 'Fire', 'Shock', 'Corrosive', 'Cryo', 'Void'] as const;

function pick<T>(values: readonly T[], roll: number): T {
  return values[Math.min(values.length - 1, Math.floor(roll * values.length))];
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * cc_compute_item_estimated_value — the canonical implementation
 * lives in the vendor catalog module (its value is what buyback
 * pays on, and the vendor screen previews with it); re-exported
 * here so the server stores keep their existing import surface.
 */
export { computeItemEstimatedValue } from '../../lib/vendor/catalog.js';

interface WeaponBase {
  baseDamage: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  statusChance: number;
  statusDamage: number;
  bossDamageMod: number;
  waveDamageMod: number;
  shieldDamageMod: number;
  armorDamageMod: number;
}

const WEAPON_BASES: Record<string, WeaponBase> = {
  Pistol: { baseDamage: 80, attackSpeed: 1.2, critChance: 0.1, critDamage: 1.5, statusChance: 0.08, statusDamage: 1.2, bossDamageMod: 1.0, waveDamageMod: 1.0, shieldDamageMod: 1.0, armorDamageMod: 1.0 },
  SMG: { baseDamage: 45, attackSpeed: 2.0, critChance: 0.08, critDamage: 1.4, statusChance: 0.12, statusDamage: 1.1, bossDamageMod: 0.95, waveDamageMod: 1.15, shieldDamageMod: 1.05, armorDamageMod: 0.9 },
  Shotgun: { baseDamage: 140, attackSpeed: 0.7, critChance: 0.06, critDamage: 1.6, statusChance: 0.1, statusDamage: 1.3, bossDamageMod: 0.9, waveDamageMod: 1.3, shieldDamageMod: 0.95, armorDamageMod: 1.05 },
  Sniper: { baseDamage: 200, attackSpeed: 0.5, critChance: 0.25, critDamage: 2.0, statusChance: 0.05, statusDamage: 1.0, bossDamageMod: 1.2, waveDamageMod: 0.7, shieldDamageMod: 1.0, armorDamageMod: 1.1 },
  Launcher: { baseDamage: 300, attackSpeed: 0.35, critChance: 0.03, critDamage: 1.8, statusChance: 0.15, statusDamage: 1.5, bossDamageMod: 1.15, waveDamageMod: 1.1, shieldDamageMod: 0.85, armorDamageMod: 1.3 },
  Beam: { baseDamage: 60, attackSpeed: 1.5, critChance: 0.07, critDamage: 1.35, statusChance: 0.2, statusDamage: 1.4, bossDamageMod: 1.0, waveDamageMod: 0.95, shieldDamageMod: 1.15, armorDamageMod: 1.15 },
};

/** cc_generate_weapon_payload. `rng` replaces SQL random() for the 3 picks. */
export function generateWeaponPayload(itemLevel: number, rarity: string, rng: () => number): Json {
  const type = pick(WEAPON_TYPES, rng());
  const manufacturer = pick(MANUFACTURERS, rng());
  const element = pick(ELEMENTS, rng());
  const levelScalar = 1 + (itemLevel - 1) * 0.08;
  const rarityScalar =
    rarity === 'Uncommon' ? 1.1 : rarity === 'Rare' ? 1.25 : rarity === 'Epic' ? 1.45 : rarity === 'Legendary' ? 1.7 : 1.0;
  const base = WEAPON_BASES[type];
  const baseDamage = Math.round(base.baseDamage * levelScalar * rarityScalar);
  const attackSpeed = roundTo(base.attackSpeed * levelScalar * 0.98, 2);
  const critChance = roundTo(Math.min(0.9, base.critChance * levelScalar * 0.95), 3);
  const critDamage = roundTo(base.critDamage * levelScalar * 0.97, 2);
  const statusChance = roundTo(Math.min(0.9, base.statusChance * levelScalar), 3);
  const statusDamage = roundTo(base.statusDamage * levelScalar * 0.96, 2);
  const combatPower = Math.round(
    baseDamage * attackSpeed * (1 + critChance * critDamage) * (1 + statusChance * statusDamage * 0.3),
  );
  return {
    id: null,
    weaponType: type,
    manufacturer,
    element,
    name: `${rarity} Cache ${type}`,
    level: itemLevel,
    rarity,
    baseDamage,
    attackSpeed,
    critChance,
    critDamage,
    statusChance,
    statusDamage,
    bossDamageMod: base.bossDamageMod,
    waveDamageMod: base.waveDamageMod,
    shieldDamageMod: base.shieldDamageMod,
    armorDamageMod: base.armorDamageMod,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    rollQuality: 50,
    parts: [],
    affixes: [],
    sourceTag: 'Cache-Forged',
    isLocked: false,
    combatPower,
    bossPower: combatPower,
    farmPower: combatPower,
    economyScore: 0,
  };
}

export interface OddsDraw {
  table_id: string;
  outcome: string;
  roll: number;
  total_weight: number;
  payload: Json;
}

/** cc_draw_odds over a provided outcome list (ordered by outcome, like SQL). */
export function drawOdds(tableId: string, outcomes: OddsOutcomeData[], roll0to1: number): OddsDraw {
  const sorted = [...outcomes].filter((o) => o.table_id === tableId).sort((a, b) => a.outcome.localeCompare(b.outcome));
  const total = sorted.reduce((sum, o) => sum + o.weight, 0);
  const roll = Math.floor(roll0to1 * total) + 1;
  let cursor = 0;
  for (const outcome of sorted) {
    cursor += outcome.weight;
    if (roll <= cursor) {
      return { table_id: tableId, outcome: outcome.outcome, roll, total_weight: total, payload: outcome.payload };
    }
  }
  const last = sorted[sorted.length - 1];
  return { table_id: tableId, outcome: last.outcome, roll, total_weight: total, payload: last.payload };
}

/** cc_item_accepts_slot: payload key-presence rules per loadout slot. */
export function itemAcceptsSlot(payload: Json, slot: string): boolean {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);
  switch (slot) {
    case 'primary':
    case 'secondary':
    case 'heavy':
      return has('weaponType');
    case 'shield':
      return has('hp') && !has('weaponType');
    case 'classMod':
      return has('treeBonus');
    case 'ordnance':
      return has('damage') && has('effect') && !has('weaponType');
    case 'relic':
      return has('affixes') && !has('weaponType') && !has('hp') && !has('treeBonus') && !has('damage') && !has('vehicleClassId');
    case 'vehicle':
      return has('vehicleClassId');
    default:
      return false;
  }
}

const USERNAME_MIN = 3;
const USERNAME_MAX = 24;

/** cc_validate_username: returns the SQL error message or null when valid. */
export function validateUsername(username: string | null | undefined): string | null {
  const cleaned = (username ?? '').trim();
  if (!cleaned) return 'Username is required.';
  if (cleaned.length < USERNAME_MIN || cleaned.length > USERNAME_MAX) {
    return `Username must be between ${USERNAME_MIN} and ${USERNAME_MAX} characters.`;
  }
  if (!/^[A-Za-z0-9_ ]+$/.test(cleaned)) {
    return 'Username may only contain letters, numbers, spaces, and underscores.';
  }
  if (!/^[A-Za-z0-9]/.test(cleaned) || !/[A-Za-z0-9]$/.test(cleaned)) {
    return 'Username must start and end with a letter or number.';
  }
  if (cleaned.includes('  ') || cleaned.includes('__')) {
    return 'Username cannot contain repeated spaces or underscores.';
  }
  return null;
}

export function newUuid(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Store seam
// ---------------------------------------------------------------------------

/** cc_vendor_sell input: exactly one sale target per call. */
export interface VendorSellInput {
  kind: 'gear' | 'consumable' | 'material';
  itemId?: string | null;
  batchId?: string | null;
  materialId?: string | null;
  quantity?: number;
}

export interface SetActiveActionInput {
  activity_kind: string;
  target_type?: string | null;
  target_id?: string | null;
  target_label?: string | null;
  scene_key?: string | null;
  notes?: string | null;
  expected_finish_at?: string | null;
  activity_payload?: Json;
  public_payload?: Json;
  public_visible?: boolean;
}

/**
 * cc_enqueue_craft_job input, as accepted from the route. Everything
 * economy-bearing beyond this shape (the consumableEfficiency skill
 * bonus, bench/tool state, mastery levels, lever values) is derived
 * by the store from server records — the request body never carries
 * durations, qualities, XP, or bench counts (forgery suite, §2.12).
 */
export interface EnqueueCraftJobInput {
  bench: number;
  recipeId: string;
  units: number;
  rarity?: string | null;
  useCatalyst?: boolean;
  /** Legendary Core Catalyst (0026): gear frames only, 1 core/unit. */
  useCoreCatalyst?: boolean;
  useRushTicket?: boolean;
}

/**
 * cc_enqueue_repair_job input (0025). The unit duration, per-kit
 * restoration, and mastery snapshot are derived by the store from
 * server records — the request body carries only the vehicle, the
 * kit type, and how many kits to escrow.
 */
export interface EnqueueRepairJobInput {
  itemId: string;
  kitType: string;
  units: number;
}

export interface WriteStore {
  initialBundle(playerId: string, nonce: string): Promise<Json>;
  makeItem(playerId: string, nonce: string): Promise<Json>;
  claimRewardedCacheKey(playerId: string, nonce: string, adUnitId: string, rewardSource: string): Promise<Json>;
  registerPushDevice(playerId: string, token: string, platform: string, appVersion: string | null): Promise<Json>;
  disablePushDevice(playerId: string, token: string): Promise<Json>;
  vendorBuy(playerId: string, nonce: string, itemKey: string, quantity: number): Promise<Json>;
  vendorSell(playerId: string, nonce: string, input: VendorSellInput): Promise<Json>;
  claimCraftedConsumable(playerId: string, nonce: string, recipeId: string, itemKey: string, quantity: number): Promise<Json>;
  consumeConsumable(
    playerId: string,
    nonce: string,
    itemKey: string,
    quantity: number,
    activityType: string | null,
    reason: string | null,
  ): Promise<Json>;
  recycleItem(playerId: string, nonce: string, itemId: string): Promise<Json>;
  /**
   * Reforge one rolled affix on a gear item (cc_reforge_item, 0027):
   * the roll is computed in TypeScript from the shared affix pools
   * (src/lib/gear/affixPools.ts) on a dedicated stream seeded from
   * the op nonce; the SQL applier revalidates ownership, state,
   * identity invariants, and the lever-priced cost under the row
   * lock, charges scrap (+ legendary cores on Legendaries), and
   * persists atomically. Result carries old_affix / new_affix for
   * the reveal.
   */
  reforgeItem(playerId: string, nonce: string, itemId: string, affixId: string): Promise<Json>;
  /**
   * Record collection discoveries proven by a settled server-side
   * fact (cc_record_discoveries, 0026). Entries are derived by the
   * route from the operation's own result — never from the request
   * body. Insert-on-conflict-do-nothing; records, never pays.
   */
  recordDiscoveries(playerId: string, entries: DiscoveryRecord[]): Promise<Json>;
  itemLock(playerId: string, nonce: string, itemId: string, locked: boolean): Promise<Json>;
  equipItem(playerId: string, nonce: string, itemId: string, slotName: string): Promise<Json>;
  unequipSlot(playerId: string, nonce: string, slotName: string): Promise<Json>;
  /**
   * Load fuel cells into the vehicle tank (cc_refuel_vehicle, 0021;
   * restated in 0024 to accept the crafted FuelCell type — fuel loads
   * at 100 × the consumed batches' weighted quality). itemKey defaults
   * to the vendor's GenericFuelCell.
   */
  refuelVehicle(playerId: string, nonce: string, cells: number, itemKey?: string): Promise<Json>;
  // ── Crafting-as-occupation (migration 0024) ──────────────────────
  /** Enqueue a server craft job with full escrow (cc_enqueue_craft_job). */
  enqueueCraftJob(playerId: string, nonce: string, input: EnqueueCraftJobInput): Promise<Json>;
  /** Cancel an active craft job with the §2.1 refund table (cc_cancel_craft_job). */
  cancelCraftJob(playerId: string, nonce: string, jobId: string): Promise<Json>;
  /** Unlock the next bench atomically (cc_unlock_bench). */
  unlockCraftBench(playerId: string, nonce: string): Promise<Json>;
  /** Fit (or clear, with null) a workshop tool on a bench. */
  fitWorkshopTool(playerId: string, nonce: string, bench: number, toolId: string | null): Promise<Json>;
  /**
   * Run the craft settler for a player (cc_settle_craft_jobs).
   * Idempotent by server timestamps — not a nonce op. maxAdvanceMs,
   * when given, caps the total advance (offline settlement, F5).
   */
  settleCraftJobs(playerId: string, maxAdvanceMs?: number): Promise<Json>;
  /**
   * Fire Overclock at the Workshop (cc_fire_overclock_workshop,
   * 0030): spends the full action-skill charge pool and instantly
   * completes the in-progress unit on every active bench through
   * cc_complete_craft_unit. Validation (Fixer selection + keystone
   * qualification + full charge + a unit actually in progress) is the
   * applier's, under the profile row lock; nonce-idempotent.
   */
  fireOverclockWorkshop(playerId: string, nonce: string): Promise<Json>;
  /**
   * The Workshop state read: settles lazily, finalizes any pending
   * crafted gear through the shared generators, and returns benches,
   * tools, jobs (with derived display state), and mastery levels.
   */
  getWorkshopState(playerId: string): Promise<Json>;
  // ── Mechanics & repair services (migration 0025) ────────────────
  /**
   * Enqueue a TIMED self-repair job on the craft job machinery
   * (cc_enqueue_repair_job): the owner's patch kits escrow at
   * enqueue and apply while `workshop_service` is the active action.
   * Replaces the retired instant cc_use_patch_kit (dropped in 0025).
   */
  enqueueRepairJob(playerId: string, nonce: string, input: EnqueueRepairJobInput): Promise<Json>;
  /**
   * Post a repair job to the open board (cc_post_repair_job): the
   * full price escrows from the owner's verified balance at posting
   * and the vehicle locks in service. Verified accounts only.
   */
  postRepairJob(playerId: string, nonce: string, itemId: string, targetPoints: number | null, priceCredits: number): Promise<Json>;
  /** Accept an open board job (cc_accept_repair_job), snapshotting
   *  the mechanic's rate/efficiency and chosen kit type. */
  acceptRepairJob(playerId: string, nonce: string, jobId: string, kitType: string): Promise<Json>;
  /** Provider delivers the job as-is (cc_repair_job_finish):
   *  settles, then pays pro-rata for points actually restored. */
  finishRepairJob(playerId: string, nonce: string, jobId: string): Promise<Json>;
  /** Owner or provider cancels (cc_repair_job_cancel): full refund
   *  before acceptance; pro-rata pay + remainder refund after. */
  cancelRepairJob(playerId: string, nonce: string, jobId: string): Promise<Json>;
  /** Owner reclaims a job abandoned past the no-progress window
   *  (cc_repair_job_reclaim). */
  reclaimRepairJob(playerId: string, nonce: string, jobId: string): Promise<Json>;
  /**
   * The repair board read: settles every job the caller owns or
   * provides (expiring stale listings), then returns open postings,
   * my postings, my workbench, and board/mechanic stats.
   */
  getRepairBoard(playerId: string): Promise<Json>;
  idleClaim(playerId: string, nonce: string): Promise<Json>;
  retrain(playerId: string, nonce: string): Promise<Json>;
  trainSkill(playerId: string, nonce: string, nodeId: string): Promise<Json>;
  battleResult(playerId: string, nonce: string, targetId: string, stance: string): Promise<Json>;
  marketCreate(playerId: string, nonce: string, itemId: string, priceCredits: number): Promise<Json>;
  marketCreateConsumable(playerId: string, nonce: string, batchId: string, quantity: number, priceCredits: number): Promise<Json>;
  marketCreateMaterial(playerId: string, nonce: string, materialId: string, quantity: number, priceCredits: number): Promise<Json>;
  marketCancel(playerId: string, nonce: string, listingId: string): Promise<Json>;
  acceptListing(playerId: string, nonce: string, listingId: string): Promise<Json>;
  resetProgress(playerId: string, nonce: string): Promise<Json>;
  getActiveActivity(playerId: string): Promise<ActiveActionData | null>;
  setActiveAction(playerId: string, nonce: string, input: SetActiveActionInput): Promise<Json>;
  clearActiveAction(playerId: string, nonce: string): Promise<Json>;
  heartbeatActiveAction(playerId: string): Promise<Json>;
  setUsername(playerId: string, username: string): Promise<{ ok: boolean; error?: string }>;
  /**
   * Set (or clear, with null) the player's AFK limiter —
   * profiles.offline_cap_hours (migration 0023, cc_set_offline_cap_limiter).
   * The limiter only ever shortens settlements: the settlement route
   * takes min(earned, limiter, 24h).
   */
  setOfflineCapLimiter(playerId: string, capHours: number | null): Promise<{ ok: boolean; error?: string; offlineCapHours?: number | null }>;
  markReminderSeen(playerId: string): Promise<ProfileRowData>;
  getRuntimeSnapshot(playerId: string): Promise<Json | null>;
  saveRuntimeSnapshot(playerId: string, snapshot: Json): Promise<void>;
  clearRuntimeSnapshot(playerId: string): Promise<void>;
  getCombatStats(playerId: string): Promise<CombatStatsData | null>;
  saveCombatStats(playerId: string, row: CombatStatsData): Promise<void>;
}

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function mapActiveAction(row: Row): ActiveActionData {
  return {
    user_id: String(row.user_id),
    active_action: String(row.active_action),
    started_at: iso(row.started_at),
    completes_at: isoOrNull(row.completes_at),
    target_type: (row.target_type as string | null) ?? null,
    target_id: (row.target_id as string | null) ?? null,
    target_label: (row.target_label as string | null) ?? null,
    scene_key: (row.scene_key as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    activity_payload: (row.activity_payload as Json) ?? {},
    public_payload: (row.public_payload as Json) ?? {},
    last_heartbeat_at: iso(row.last_heartbeat_at),
    public_visible: Boolean(row.public_visible),
    schema_version: Number(row.schema_version ?? 1),
    updated_at: iso(row.updated_at),
  };
}

/** Map a craft_jobs row (migration 0024) to the shared job record. */
function mapCraftJobRow(row: Row): CraftJobRecord {
  const ms = (value: unknown): number =>
    value === null || value === undefined ? 0 : new Date(iso(value)).getTime();
  const snapshot = (row.snapshot ?? {}) as unknown as CraftJobSnapshot;
  return {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    bench: Number(row.bench ?? 1),
    kind: String(row.kind) as CraftJobRecord['kind'],
    recipe_id: String(row.recipe_id),
    units_total: Number(row.units_total ?? 0),
    units_completed: Number(row.units_completed ?? 0),
    unit_duration_ms: Number(row.unit_duration_ms ?? 0),
    accrued_ms: Number(row.accrued_ms ?? 0),
    status: String(row.status) as CraftJobRecord['status'],
    escrow_inputs: (row.escrow_inputs ?? {}) as Record<string, number>,
    escrow_catalyst: (row.escrow_catalyst ?? {}) as Record<string, number>,
    escrow_cores: Number(row.escrow_cores ?? 0),
    rush_ticket_quality:
      row.rush_ticket_quality === null || row.rush_ticket_quality === undefined
        ? null
        : Number(row.rush_ticket_quality),
    rush_ticket_origin:
      row.rush_ticket_origin === null || row.rush_ticket_origin === undefined
        ? null
        : String(row.rush_ticket_origin),
    snapshot,
    xp_awarded: Number(row.xp_awarded ?? 0),
    outputs: (row.outputs ?? []) as CraftJobRecord['outputs'],
    tool_charged: Boolean(row.tool_charged),
    created_at_ms: ms(row.created_at),
    last_settled_ms: ms(row.last_settled_at),
    completed_at_ms:
      row.completed_at === null || row.completed_at === undefined ? null : ms(row.completed_at),
  };
}

/** Map a service_jobs row (0025 repair columns included) to the
 *  seed-shaped record the board view builder consumes. */
function mapServiceJobRow(row: Row): ServiceJobData {
  const isoOrNull = (value: unknown): string | null =>
    value === null || value === undefined ? null : iso(value);
  const numOrNull = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value);
  return {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    provider_user_id: row.provider_user_id ? String(row.provider_user_id) : null,
    profession_id: String(row.profession_id),
    status: String(row.status),
    target_item_instance_id: String(row.target_item_instance_id),
    requested_service_id: row.requested_service_id ? String(row.requested_service_id) : null,
    quoted_price_credits: numOrNull(row.quoted_price_credits),
    quoted_duration_minutes: numOrNull(row.quoted_duration_minutes),
    owner_supplied_material_ids: (row.owner_supplied_material_ids ?? []) as string[],
    provider_supplied_material_ids: (row.provider_supplied_material_ids ?? []) as string[],
    escrow_id: row.escrow_id ? String(row.escrow_id) : null,
    created_at: iso(row.created_at),
    accepted_at: isoOrNull(row.accepted_at),
    completed_at: isoOrNull(row.completed_at),
    target_points: numOrNull(row.target_points),
    points_restored: Number(row.points_restored ?? 0),
    work_points_banked: Number(row.work_points_banked ?? 0),
    open_kit_capacity: Number(row.open_kit_capacity ?? 0),
    open_kit_total: Number(row.open_kit_total ?? 0),
    open_kit_quality: numOrNull(row.open_kit_quality),
    accrued_work_ms: Number(row.accrued_work_ms ?? 0),
    last_settled_at: isoOrNull(row.last_settled_at),
    last_progress_at: isoOrNull(row.last_progress_at),
    expires_at: isoOrNull(row.expires_at),
    outcome: row.outcome ? String(row.outcome) : null,
    paid_credits: numOrNull(row.paid_credits),
    fee_credits: numOrNull(row.fee_credits),
    xp_awarded: numOrNull(row.xp_awarded),
    kit_type: row.kit_type ? String(row.kit_type) : null,
    kits_consumed: (row.kits_consumed ?? []) as ServiceJobData['kits_consumed'],
    repair_snapshot: (row.repair_snapshot ?? null) as ServiceJobData['repair_snapshot'],
  };
}

/** Translate a pg failure into the stable WriteStoreError surface. */
function translatePgError(err: unknown): never {
  if (err instanceof WriteStoreError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  throw writeError(message);
}

export class PgWriteStore implements WriteStore {
  constructor(private readonly pool: Pool) {}

  private async callJson(sql: string, params: unknown[]): Promise<Json> {
    try {
      const { rows } = await this.pool.query(sql, params);
      return (rows[0]?.result ?? {}) as Json;
    } catch (err) {
      return translatePgError(err);
    }
  }

  initialBundle(playerId: string, nonce: string): Promise<Json> {
    return this.callJson('select public.cc_initial_bundle($1, $2) as result', [playerId, nonce]);
  }
  makeItem(playerId: string, nonce: string): Promise<Json> {
    return this.callJson('select public.cc_make_item($1, $2) as result', [playerId, nonce]);
  }
  claimRewardedCacheKey(playerId: string, nonce: string, adUnitId: string, rewardSource: string): Promise<Json> {
    return this.callJson('select public.cc_claim_rewarded_cache_key($1, $2, $3, $4) as result', [
      playerId,
      nonce,
      adUnitId,
      rewardSource,
    ]);
  }
  registerPushDevice(playerId: string, token: string, platform: string, appVersion: string | null): Promise<Json> {
    return this.callJson('select public.cc_register_push_device($1, $2, $3, $4) as result', [
      playerId,
      token,
      platform,
      appVersion,
    ]);
  }
  disablePushDevice(playerId: string, token: string): Promise<Json> {
    return this.callJson('select public.cc_disable_push_device($1, $2) as result', [playerId, token]);
  }
  vendorBuy(playerId: string, nonce: string, itemKey: string, quantity: number): Promise<Json> {
    return this.callJson('select public.cc_vendor_buy($1, $2, $3, $4) as result', [playerId, nonce, itemKey, quantity]);
  }
  vendorSell(playerId: string, nonce: string, input: VendorSellInput): Promise<Json> {
    return this.callJson('select public.cc_vendor_sell($1, $2, $3, $4, $5, $6, $7) as result', [
      playerId,
      nonce,
      input.kind,
      input.itemId ?? null,
      input.batchId ?? null,
      input.materialId ?? null,
      input.quantity ?? 1,
    ]);
  }
  claimCraftedConsumable(playerId: string, nonce: string, recipeId: string, itemKey: string, quantity: number): Promise<Json> {
    return this.callJson('select public.cc_claim_crafted_consumable($1, $2, $3, $4, $5) as result', [
      playerId,
      nonce,
      recipeId,
      itemKey,
      quantity,
    ]);
  }
  consumeConsumable(
    playerId: string,
    nonce: string,
    itemKey: string,
    quantity: number,
    activityType: string | null,
    reason: string | null,
  ): Promise<Json> {
    return this.callJson('select public.cc_consume_consumable($1, $2, $3, $4, $5, $6) as result', [
      playerId,
      nonce,
      itemKey,
      quantity,
      activityType,
      reason,
    ]);
  }
  recycleItem(playerId: string, nonce: string, itemId: string): Promise<Json> {
    return this.callJson('select public.cc_recycle_item($1, $2, $3) as result', [playerId, nonce, itemId]);
  }
  /**
   * Reforge (0027): replay → read the server item row → roll on the
   * dedicated nonce-seeded stream through the shared affix pools →
   * cc_reforge_item validates + charges + persists atomically. The
   * pre-checks here exist so the roll can be computed at all; every
   * one of them is re-checked by the SQL applier under the row lock
   * (state, lock, funds, cost, and payload invariants included), so
   * a stale read can never produce a bad write — at worst the apply
   * refuses and nothing is charged.
   */
  async reforgeItem(playerId: string, nonce: string, itemId: string, affixId: string): Promise<Json> {
    const cleanNonce = (nonce ?? '').trim();
    if (!cleanNonce || cleanNonce.length < 8) throw writeError('nonce is required');
    try {
      const { rows: priorRows } = await this.pool.query(
        'select result_payload from public.verified_action_ledger where user_id = $1 and idempotency_key = $2',
        [playerId, cleanNonce],
      );
      const prior = priorRows[0]?.result_payload as Json | undefined;
      if (prior) return prior;

      const { rows } = await this.pool.query(
        'select kind, payload from public.item_instances where id = $1 and owner_user_id = $2',
        [itemId, playerId],
      );
      const row = rows[0];
      if (!row) throw writeError('Item not found');
      const payload = row.payload as GearItem;
      const kind = reforgeKindOf(row.kind as string, payload);
      if (!kind) throw writeError('Item cannot be reforged');
      const affixes = payload.affixes ?? [];
      const affixIndex = affixes.findIndex((a) => a.id === affixId);
      if (affixIndex < 0) throw writeError('Affix not found');
      if (!isReforgeableAffix(affixes[affixIndex])) throw writeError('Affix cannot be reforged');
      // Dedicated RNG stream: the roll is a pure function of
      // (player, item, nonce), so a retried apply recomputes the
      // identical replacement.
      const rng = createRNG(hashString(`reforge:${playerId}:${itemId}:${cleanNonce}`));
      const { item: nextPayload, oldAffix } = applyReforgeToItem(kind, payload, affixIndex, rng);
      return await this.callJson(
        'select public.cc_reforge_item($1, $2, $3, $4, $5::jsonb, $6::jsonb) as result',
        [playerId, cleanNonce, itemId, affixId, JSON.stringify(oldAffix), JSON.stringify(nextPayload)],
      );
    } catch (err) {
      return translatePgError(err);
    }
  }
  recordDiscoveries(playerId: string, entries: DiscoveryRecord[]): Promise<Json> {
    return this.callJson('select public.cc_record_discoveries($1, $2::jsonb) as result', [
      playerId,
      JSON.stringify(entries),
    ]);
  }
  itemLock(playerId: string, nonce: string, itemId: string, locked: boolean): Promise<Json> {
    return this.callJson('select public.cc_item_lock($1, $2, $3, $4) as result', [playerId, nonce, itemId, locked]);
  }
  equipItem(playerId: string, nonce: string, itemId: string, slotName: string): Promise<Json> {
    return this.callJson('select public.cc_equip_item($1, $2, $3, $4) as result', [playerId, nonce, itemId, slotName]);
  }
  unequipSlot(playerId: string, nonce: string, slotName: string): Promise<Json> {
    return this.callJson('select public.cc_unequip_slot($1, $2, $3) as result', [playerId, nonce, slotName]);
  }
  refuelVehicle(playerId: string, nonce: string, cells: number, itemKey = 'GenericFuelCell'): Promise<Json> {
    return this.callJson('select public.cc_refuel_vehicle($1, $2, $3, $4) as result', [playerId, nonce, cells, itemKey]);
  }
  // ── Crafting-as-occupation (migration 0024) ──────────────────────
  /**
   * The §2.7 skill consumer's input, derived from server records:
   * profiles.skill_spends + the equipped class mod's boosts through
   * skillBonusesFromRecords — the same derivation the Chef routes
   * use. Passed into cc_enqueue_craft_job as a trusted server
   * parameter; the request body never carries it.
   */
  private async consumableEfficiencyBonus(playerId: string): Promise<number> {
    try {
      const { rows } = await this.pool.query(
        'select skill_spends from public.profiles where id = $1',
        [playerId],
      );
      const spends = (rows[0]?.skill_spends ?? {}) as Record<string, number>;
      const { rows: itemRows } = await this.pool.query(
        "select payload from public.item_instances where owner_user_id = $1 and runtime_state = 'equipped'",
        [playerId],
      );
      const gear = itemRows.map((r) => r.payload as unknown as GearItem);
      return skillBonusesFromRecords(gear, spends).consumableEfficiency ?? 0;
    } catch (err) {
      return translatePgError(err);
    }
  }
  async enqueueCraftJob(playerId: string, nonce: string, input: EnqueueCraftJobInput): Promise<Json> {
    const bonus = await this.consumableEfficiencyBonus(playerId);
    const result = await this.callJson(
      'select public.cc_enqueue_craft_job($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as result',
      [
        playerId, nonce, input.bench, input.recipeId, input.units,
        input.rarity ?? null, input.useCatalyst ?? false, input.useRushTicket ?? false, bonus,
        input.useCoreCatalyst ?? false,
      ],
    );
    // The enqueue settles first inside SQL; a settled gear unit waits
    // as a pending output until generated through the shared
    // generators — finalize before returning so no surface can
    // observe a completed unit without its item.
    await finalizePendingCraftedGear(this.pool, playerId);
    return result;
  }
  async cancelCraftJob(playerId: string, nonce: string, jobId: string): Promise<Json> {
    const result = await this.callJson('select public.cc_cancel_craft_job($1, $2, $3) as result', [
      playerId, nonce, jobId,
    ]);
    await finalizePendingCraftedGear(this.pool, playerId);
    return result;
  }
  unlockCraftBench(playerId: string, nonce: string): Promise<Json> {
    return this.callJson('select public.cc_unlock_bench($1, $2) as result', [playerId, nonce]);
  }
  fitWorkshopTool(playerId: string, nonce: string, bench: number, toolId: string | null): Promise<Json> {
    return this.callJson('select public.cc_fit_workshop_tool($1, $2, $3, $4) as result', [
      playerId, nonce, bench, toolId,
    ]);
  }
  async settleCraftJobs(playerId: string, maxAdvanceMs?: number): Promise<Json> {
    const result = await this.callJson('select public.cc_settle_craft_jobs($1, $2) as result', [
      playerId, maxAdvanceMs ?? null,
    ]);
    await finalizePendingCraftedGear(this.pool, playerId);
    return result;
  }
  async fireOverclockWorkshop(playerId: string, nonce: string): Promise<Json> {
    const result = await this.callJson('select public.cc_fire_overclock_workshop($1, $2) as result', [
      playerId, nonce,
    ]);
    // A fired unit can complete a gear job — finalize its pending
    // crafted gear exactly like a settle does.
    await finalizePendingCraftedGear(this.pool, playerId);
    return result;
  }
  async getWorkshopState(playerId: string): Promise<Json> {
    await this.callJson('select public.cc_settle_craft_jobs($1, $2) as result', [playerId, null]);
    await finalizePendingCraftedGear(this.pool, playerId);
    try {
      const { rows: profileRows } = await this.pool.query(
        'select workshop_benches, workshop_tools from public.profiles where id = $1',
        [playerId],
      );
      if (!profileRows[0]) throw writeError('Profile not found');
      const { rows: jobRows } = await this.pool.query(
        'select * from public.craft_jobs where owner_user_id = $1 order by created_at asc, id asc',
        [playerId],
      );
      const { rows: masteryRows } = await this.pool.query(
        "select mastery_id, mastery_level, mastery_xp from public.player_masteries where user_id = $1 and mastery_id in ('crafting_consumables', 'crafting.refining', 'crafting.gear', 'services.repair')",
        [playerId],
      );
      const { rows: actionRows } = await this.pool.query(
        'select active_action from public.active_actions where user_id = $1',
        [playerId],
      );
      const masteries: Record<string, { level: number; xp: number }> = {
        crafting_consumables: { level: 1, xp: 0 },
        'crafting.refining': { level: 1, xp: 0 },
        'crafting.gear': { level: 1, xp: 0 },
        'services.repair': { level: 1, xp: 0 },
      };
      for (const row of masteryRows) {
        masteries[String(row.mastery_id)] = {
          level: Number(row.mastery_level ?? 1),
          xp: Number(row.mastery_xp ?? 0),
        };
      }
      const toolsRaw = (profileRows[0].workshop_tools ?? {}) as {
        owned?: Record<string, boolean>;
        fitted?: Record<string, string | null>;
        charges?: Record<string, number>;
      };
      return buildWorkshopStateView({
        benches: Number(profileRows[0].workshop_benches ?? 1),
        tools: {
          owned: toolsRaw.owned ?? {},
          fitted: toolsRaw.fitted ?? {},
          charges: toolsRaw.charges ?? {},
        },
        jobs: jobRows.map(mapCraftJobRow),
        masteries,
        activeActionKind: actionRows[0] ? String(actionRows[0].active_action) : null,
      }) as Json;
    } catch (err) {
      return translatePgError(err);
    }
  }
  // ── Mechanics & repair services (migration 0025) ────────────────
  enqueueRepairJob(playerId: string, nonce: string, input: EnqueueRepairJobInput): Promise<Json> {
    return this.callJson('select public.cc_enqueue_repair_job($1, $2, $3, $4, $5) as result', [
      playerId, nonce, input.itemId, input.kitType, input.units,
    ]);
  }
  postRepairJob(playerId: string, nonce: string, itemId: string, targetPoints: number | null, priceCredits: number): Promise<Json> {
    return this.callJson('select public.cc_post_repair_job($1, $2, $3, $4, $5) as result', [
      playerId, nonce, itemId, targetPoints, priceCredits,
    ]);
  }
  acceptRepairJob(playerId: string, nonce: string, jobId: string, kitType: string): Promise<Json> {
    return this.callJson('select public.cc_accept_repair_job($1, $2, $3, $4) as result', [
      playerId, nonce, jobId, kitType,
    ]);
  }
  finishRepairJob(playerId: string, nonce: string, jobId: string): Promise<Json> {
    return this.callJson('select public.cc_repair_job_finish($1, $2, $3) as result', [playerId, nonce, jobId]);
  }
  cancelRepairJob(playerId: string, nonce: string, jobId: string): Promise<Json> {
    return this.callJson('select public.cc_repair_job_cancel($1, $2, $3) as result', [playerId, nonce, jobId]);
  }
  reclaimRepairJob(playerId: string, nonce: string, jobId: string): Promise<Json> {
    return this.callJson('select public.cc_repair_job_reclaim($1, $2, $3) as result', [playerId, nonce, jobId]);
  }
  async getRepairBoard(playerId: string): Promise<Json> {
    await this.callJson('select public.cc_settle_repair_jobs_for($1) as result', [playerId]);
    try {
      const { rows: jobRows } = await this.pool.query(
        `select * from public.service_jobs
          where profession_id = 'repair'
            and (status = 'listed'
                 or owner_user_id = $1
                 or provider_user_id = $1
                 or (status = 'completed' and completed_at > now() - interval '90 days'))
          order by created_at desc
          limit 500`,
        [playerId],
      );
      const jobs = jobRows.map(mapServiceJobRow);
      const itemIds = [...new Set(jobs.map((j) => j.target_item_instance_id))];
      const vehicles = new Map<string, RepairVehicleInfo | null>();
      if (itemIds.length > 0) {
        const { rows: itemRows } = await this.pool.query(
          'select id, kind, payload, rarity, condition_current, condition_max from public.item_instances where id = any($1::uuid[])',
          [itemIds],
        );
        for (const row of itemRows) {
          vehicles.set(String(row.id), {
            kind: String(row.kind),
            payload: (row.payload ?? {}) as Record<string, unknown>,
            rarity: row.rarity ? String(row.rarity) : null,
            conditionCurrent: Number(row.condition_current ?? 100),
            conditionMax: Number(row.condition_max ?? 100),
          });
        }
      }
      const userIds = [
        ...new Set(jobs.flatMap((j) => [j.owner_user_id, j.provider_user_id]).filter(Boolean)),
      ] as string[];
      const names = new Map<string, string | null>();
      if (userIds.length > 0) {
        const { rows: profileRows } = await this.pool.query(
          'select id, username from public.profiles where id = any($1::uuid[])',
          [userIds],
        );
        for (const row of profileRows) {
          names.set(String(row.id), row.username ? String(row.username) : null);
        }
      }
      const { rows: masteryRows } = await this.pool.query(
        "select mastery_level, mastery_xp from public.player_masteries where user_id = $1 and mastery_id = 'services.repair'",
        [playerId],
      );
      const { rows: configRows } = await this.pool.query('select key, value from public.economy_config');
      const stored: Record<string, unknown> = {};
      for (const row of configRows) stored[String(row.key)] = row.value;
      const config = resolveEconomyConfigValues(stored);
      const levers = resolveRepairLevers({
        serviceXpPerPoint: config.serviceXpPerPoint,
        repairAbandonWindowHours: config.repairAbandonWindowHours,
        repairListingExpiryDays: config.repairListingExpiryDays,
      });
      return buildRepairBoardView({
        callerId: playerId,
        jobs,
        vehicles,
        names,
        nowMs: Date.now(),
        abandonWindowHours: levers.repairAbandonWindowHours,
        myMastery: {
          level: Number(masteryRows[0]?.mastery_level ?? 1),
          xp: Number(masteryRows[0]?.mastery_xp ?? 0),
        },
        levers: { ...levers, marketFeeRate: config.marketFeeRate },
      }) as unknown as Json;
    } catch (err) {
      return translatePgError(err);
    }
  }
  idleClaim(playerId: string, nonce: string): Promise<Json> {
    return this.callJson('select public.cc_idle_claim($1, $2) as result', [playerId, nonce]);
  }
  retrain(playerId: string, nonce: string): Promise<Json> {
    return this.callJson('select public.cc_retrain($1, $2) as result', [playerId, nonce]);
  }
  trainSkill(playerId: string, nonce: string, nodeId: string): Promise<Json> {
    return this.callJson('select public.cc_train_skill($1, $2, $3) as result', [playerId, nonce, nodeId]);
  }
  battleResult(playerId: string, nonce: string, targetId: string, stance: string): Promise<Json> {
    return this.callJson('select public.cc_battle_result($1, $2, $3, $4) as result', [playerId, nonce, targetId, stance]);
  }
  marketCreate(playerId: string, nonce: string, itemId: string, priceCredits: number): Promise<Json> {
    return this.callJson('select public.cc_market_create($1, $2, $3, $4) as result', [playerId, nonce, itemId, priceCredits]);
  }
  marketCreateConsumable(playerId: string, nonce: string, batchId: string, quantity: number, priceCredits: number): Promise<Json> {
    return this.callJson('select public.cc_market_create_consumable($1, $2, $3, $4, $5) as result', [playerId, nonce, batchId, quantity, priceCredits]);
  }
  marketCreateMaterial(playerId: string, nonce: string, materialId: string, quantity: number, priceCredits: number): Promise<Json> {
    return this.callJson('select public.cc_market_create_material($1, $2, $3, $4, $5) as result', [playerId, nonce, materialId, quantity, priceCredits]);
  }
  marketCancel(playerId: string, nonce: string, listingId: string): Promise<Json> {
    return this.callJson('select public.cc_market_cancel($1, $2, $3) as result', [playerId, nonce, listingId]);
  }
  acceptListing(playerId: string, nonce: string, listingId: string): Promise<Json> {
    return this.callJson('select public.cc_accept_listing($1, $2, $3) as result', [playerId, nonce, listingId]);
  }
  resetProgress(playerId: string, nonce: string): Promise<Json> {
    return this.callJson('select public.cc_reset_progress($1, $2) as result', [playerId, nonce]);
  }
  setActiveAction(playerId: string, nonce: string, input: SetActiveActionInput): Promise<Json> {
    return this.callJson(
      'select public.cc_set_active_action($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12) as result',
      [
        playerId,
        nonce,
        input.activity_kind,
        input.target_type ?? null,
        input.target_id ?? null,
        input.target_label ?? null,
        input.scene_key ?? null,
        input.expected_finish_at ?? null,
        input.notes ?? null,
        JSON.stringify(input.activity_payload ?? {}),
        JSON.stringify(input.public_payload ?? {}),
        input.public_visible ?? true,
      ],
    );
  }
  clearActiveAction(playerId: string, nonce: string): Promise<Json> {
    return this.callJson('select public.cc_clear_active_action($1, $2) as result', [playerId, nonce]);
  }
  heartbeatActiveAction(playerId: string): Promise<Json> {
    return this.callJson('select public.cc_active_action_heartbeat($1) as result', [playerId]);
  }

  async getActiveActivity(playerId: string): Promise<ActiveActionData | null> {
    try {
      const { rows } = await this.pool.query('select * from public.active_actions where user_id = $1', [playerId]);
      return rows.length ? mapActiveAction(rows[0] as Row) : null;
    } catch (err) {
      return translatePgError(err);
    }
  }

  async setUsername(playerId: string, username: string): Promise<{ ok: boolean; error?: string }> {
    const result = await this.callJson('select public.cc_set_username($1, $2) as result', [playerId, username]);
    const out: { ok: boolean; error?: string } = { ok: result.ok === true };
    if (typeof result.error === 'string') out.error = result.error;
    return out;
  }

  async setOfflineCapLimiter(playerId: string, capHours: number | null): Promise<{ ok: boolean; error?: string; offlineCapHours?: number | null }> {
    const result = await this.callJson('select public.cc_set_offline_cap_limiter($1, $2) as result', [
      playerId,
      capHours === null ? null : Math.trunc(capHours),
    ]);
    const out: { ok: boolean; error?: string; offlineCapHours?: number | null } = { ok: result.ok === true };
    if (typeof result.error === 'string') out.error = result.error;
    if (out.ok) out.offlineCapHours = typeof result.offline_cap_hours === 'number' ? result.offline_cap_hours : null;
    return out;
  }

  async markReminderSeen(playerId: string): Promise<ProfileRowData> {
    try {
      const { rows } = await this.pool.query('select * from public.cc_mark_reminder_seen($1)', [playerId]);
      return mapProfile(rows[0] as Row);
    } catch (err) {
      return translatePgError(err);
    }
  }

  async getRuntimeSnapshot(playerId: string): Promise<Json | null> {
    try {
      const { rows } = await this.pool.query(
        'select snapshot from public.player_runtime_snapshots where user_id = $1',
        [playerId],
      );
      return rows.length ? ((rows[0].snapshot as Json) ?? null) : null;
    } catch (err) {
      return translatePgError(err);
    }
  }

  async saveRuntimeSnapshot(playerId: string, snapshot: Json): Promise<void> {
    try {
      await this.pool.query(
        `insert into public.player_runtime_snapshots (user_id, schema_version, snapshot)
         values ($1, 1, $2::jsonb)
         on conflict (user_id) do update set schema_version = 1, snapshot = excluded.snapshot, updated_at = now()`,
        [playerId, JSON.stringify(snapshot)],
      );
    } catch (err) {
      translatePgError(err);
    }
  }

  async clearRuntimeSnapshot(playerId: string): Promise<void> {
    try {
      await this.pool.query('delete from public.player_runtime_snapshots where user_id = $1', [playerId]);
    } catch (err) {
      translatePgError(err);
    }
  }

  async getCombatStats(playerId: string): Promise<CombatStatsData | null> {
    try {
      const { rows } = await this.pool.query('select * from public.combat_stats where user_id = $1', [playerId]);
      return rows.length ? mapCombatStats(rows[0] as Row) : null;
    } catch (err) {
      return translatePgError(err);
    }
  }

  async saveCombatStats(playerId: string, row: CombatStatsData): Promise<void> {
    try {
      await this.pool.query(
        `insert into public.combat_stats (
           user_id, total_kills, total_deaths, longest_kill_streak,
           last_kill_at, run_started_at, kills_by_area, kills_by_weapon_type,
           kills_by_boss, kills_by_element, highest_boss_tier,
           active_play_seconds, idle_play_seconds, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
         on conflict (user_id) do update set
           total_kills = excluded.total_kills,
           total_deaths = excluded.total_deaths,
           longest_kill_streak = excluded.longest_kill_streak,
           last_kill_at = excluded.last_kill_at,
           run_started_at = excluded.run_started_at,
           kills_by_area = excluded.kills_by_area,
           kills_by_weapon_type = excluded.kills_by_weapon_type,
           kills_by_boss = excluded.kills_by_boss,
           kills_by_element = excluded.kills_by_element,
           highest_boss_tier = excluded.highest_boss_tier,
           active_play_seconds = excluded.active_play_seconds,
           idle_play_seconds = excluded.idle_play_seconds,
           updated_at = excluded.updated_at`,
        [
          playerId,
          row.total_kills,
          row.total_deaths,
          row.longest_kill_streak,
          row.last_kill_at,
          row.run_started_at,
          JSON.stringify(row.kills_by_area ?? {}),
          JSON.stringify(row.kills_by_weapon_type ?? {}),
          JSON.stringify(row.kills_by_boss ?? {}),
          JSON.stringify(row.kills_by_element ?? {}),
          row.highest_boss_tier,
          row.active_play_seconds,
          row.idle_play_seconds,
          row.updated_at,
        ],
      );
    } catch (err) {
      translatePgError(err);
    }
  }
}

function mapCombatStats(row: Row): CombatStatsData {
  return {
    user_id: String(row.user_id),
    total_kills: Number(row.total_kills ?? 0),
    total_deaths: Number(row.total_deaths ?? 0),
    longest_kill_streak: Number(row.longest_kill_streak ?? 0),
    last_kill_at: isoOrNull(row.last_kill_at),
    run_started_at: isoOrNull(row.run_started_at),
    kills_by_area: (row.kills_by_area as Record<string, number>) ?? {},
    kills_by_weapon_type: (row.kills_by_weapon_type as Record<string, number>) ?? {},
    kills_by_boss: (row.kills_by_boss as Record<string, number>) ?? {},
    kills_by_element: (row.kills_by_element as Record<string, number>) ?? {},
    highest_boss_tier: Number(row.highest_boss_tier ?? 0),
    active_play_seconds: Number(row.active_play_seconds ?? 0),
    idle_play_seconds: Number(row.idle_play_seconds ?? 0),
    updated_at: iso(row.updated_at),
  };
}
