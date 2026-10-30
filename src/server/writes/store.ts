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
  item_instance_id: string;
  price_credits: number;
  status: string;
  listed_at: string;
  sold_at: string | null;
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
  /** user_ids that already have a user_notification_settings row. */
  notificationSettingsUsers: string[];
  usernameReservations: string[];
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
    notificationSettingsUsers: [],
    usernameReservations: [],
  };
}

// ---------------------------------------------------------------------------
// Pure economy rules, ported from the SQL helpers in 0004
// (cc_salvage_scrap, cc_apply_xp, cc_vendor_price, cc_consumable_recipe_*,
// cc_hash_string / cc_mulberry32_next, cc_generate_weapon_payload,
// cc_compute_item_estimated_value, cc_draw_odds, cc_mastery_level).
// ---------------------------------------------------------------------------

/** cc_salvage_scrap: round((10 + level*5) * rarity multiplier), title-case rarities. */
export function salvageScrap(rarity: string, itemLevel: number): number {
  const mult =
    rarity === 'Uncommon' ? 1.5 : rarity === 'Rare' ? 2.5 : rarity === 'Epic' ? 4 : rarity === 'Legendary' ? 8 : 1;
  return Math.max(1, Math.round((10 + Math.max(1, itemLevel || 1) * 5) * mult));
}

/** cc_apply_xp: xp needed for a level is floor(50*level + 20*level^1.4). */
export function applyXp(level: number, xp: number, award: number): { player_level: number; player_xp: number } {
  let nextLevel = Math.max(1, Math.floor(level));
  let nextXp = Math.max(0, Math.floor(xp)) + Math.max(0, Math.floor(award));
  for (;;) {
    const needed = Math.floor(50 * nextLevel + 20 * Math.pow(nextLevel, 1.4));
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

/** cc_vendor_price: the vendor catalog (null = not sold). */
const VENDOR_CATALOG: Record<string, number> = {
  MedKit: 250,
  ShieldCell: 300,
  AmmoPack: 150,
  Grenade: 400,
  BossScanner: 600,
  InsuranceToken: 800,
  LuckBooster: 350,
};

export function vendorPrice(itemKey: string): number | null {
  return VENDOR_CATALOG[itemKey] ?? null;
}

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

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** cc_compute_item_estimated_value: floor(level*100*rarityMult + kind bonus). */
export function computeItemEstimatedValue(payload: Json, kind: string, rarity: string, itemLevel: number): number {
  const mult =
    rarity === 'Uncommon' ? 2 : rarity === 'Rare' ? 5 : rarity === 'Epic' ? 10 : rarity === 'Legendary' ? 25 : 1;
  const level = Math.max(1, itemLevel || 1);
  const base = level * 100 * mult;
  let bonus = 0;
  if (kind === 'weapon') {
    bonus = num(payload.combatPower) * 2;
  } else if (kind === 'shield') {
    bonus = num(payload.hp) * 0.5 * (1 + num(payload.mitigation));
  } else if (kind === 'classMod') {
    const affixCount = Array.isArray(payload.affixes) ? payload.affixes.length : 0;
    const nodeBoosts = payload.nodeBoosts && typeof payload.nodeBoosts === 'object' ? Object.keys(payload.nodeBoosts).length : 0;
    bonus = (nodeBoosts * 50 + affixCount * 30) * level;
  } else if (kind === 'relic') {
    const affixCount = Array.isArray(payload.affixes) ? payload.affixes.length : 0;
    bonus = affixCount * 40 * mult;
  } else if (kind === 'ordnance') {
    bonus = (num(payload.damage) + num(payload.shieldDamage) + num(payload.armorDamage)) * 1.5;
  }
  return Math.floor(base + bonus);
}

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
      return has('affixes') && !has('weaponType') && !has('hp') && !has('treeBonus') && !has('damage');
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

export interface WriteStore {
  initialBundle(playerId: string, nonce: string): Promise<Json>;
  makeItem(playerId: string, nonce: string): Promise<Json>;
  claimRewardedCacheKey(playerId: string, nonce: string, adUnitId: string, rewardSource: string): Promise<Json>;
  registerPushDevice(playerId: string, token: string, platform: string, appVersion: string | null): Promise<Json>;
  disablePushDevice(playerId: string, token: string): Promise<Json>;
  vendorBuy(playerId: string, nonce: string, itemKey: string, quantity: number): Promise<Json>;
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
  itemLock(playerId: string, nonce: string, itemId: string, locked: boolean): Promise<Json>;
  equipItem(playerId: string, nonce: string, itemId: string, slotName: string): Promise<Json>;
  unequipSlot(playerId: string, nonce: string, slotName: string): Promise<Json>;
  idleClaim(playerId: string, nonce: string): Promise<Json>;
  claimRoamingRewards(playerId: string, ticks: number, areaId: string, tickCount: number): Promise<Json>;
  retrain(playerId: string, nonce: string): Promise<Json>;
  trainSkill(playerId: string, nonce: string, nodeId: string): Promise<Json>;
  battleResult(playerId: string, nonce: string, targetId: string, stance: string): Promise<Json>;
  marketCreate(playerId: string, nonce: string, itemId: string, priceCredits: number): Promise<Json>;
  marketCancel(playerId: string, nonce: string, listingId: string): Promise<Json>;
  acceptListing(playerId: string, nonce: string, listingId: string): Promise<Json>;
  requestItemService(playerId: string, nonce: string, itemId: string, serviceId: string): Promise<Json>;
  acceptItemService(playerId: string, nonce: string, jobId: string, priceCredits: number, durationMinutes: number): Promise<Json>;
  finishItemService(playerId: string, nonce: string, jobId: string): Promise<Json>;
  resetProgress(playerId: string, nonce: string): Promise<Json>;
  getActiveActivity(playerId: string): Promise<ActiveActionData | null>;
  setActiveAction(playerId: string, nonce: string, input: SetActiveActionInput): Promise<Json>;
  clearActiveAction(playerId: string, nonce: string): Promise<Json>;
  heartbeatActiveAction(playerId: string): Promise<Json>;
  setUsername(playerId: string, username: string): Promise<{ ok: boolean; error?: string }>;
  markReminderSeen(playerId: string): Promise<ProfileRowData>;
  getRuntimeSnapshot(playerId: string): Promise<Json | null>;
  saveRuntimeSnapshot(playerId: string, snapshot: Json): Promise<void>;
  clearRuntimeSnapshot(playerId: string): Promise<void>;
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
  itemLock(playerId: string, nonce: string, itemId: string, locked: boolean): Promise<Json> {
    return this.callJson('select public.cc_item_lock($1, $2, $3, $4) as result', [playerId, nonce, itemId, locked]);
  }
  equipItem(playerId: string, nonce: string, itemId: string, slotName: string): Promise<Json> {
    return this.callJson('select public.cc_equip_item($1, $2, $3, $4) as result', [playerId, nonce, itemId, slotName]);
  }
  unequipSlot(playerId: string, nonce: string, slotName: string): Promise<Json> {
    return this.callJson('select public.cc_unequip_slot($1, $2, $3) as result', [playerId, nonce, slotName]);
  }
  idleClaim(playerId: string, nonce: string): Promise<Json> {
    return this.callJson('select public.cc_idle_claim($1, $2) as result', [playerId, nonce]);
  }
  claimRoamingRewards(playerId: string, ticks: number, areaId: string, tickCount: number): Promise<Json> {
    return this.callJson('select public.cc_claim_roaming_rewards($1, $2, $3, $4) as result', [
      playerId,
      ticks,
      areaId,
      tickCount,
    ]);
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
  marketCancel(playerId: string, nonce: string, listingId: string): Promise<Json> {
    return this.callJson('select public.cc_market_cancel($1, $2, $3) as result', [playerId, nonce, listingId]);
  }
  acceptListing(playerId: string, nonce: string, listingId: string): Promise<Json> {
    return this.callJson('select public.cc_accept_listing($1, $2, $3) as result', [playerId, nonce, listingId]);
  }
  requestItemService(playerId: string, nonce: string, itemId: string, serviceId: string): Promise<Json> {
    return this.callJson('select public.cc_item_service_request($1, $2, $3, $4) as result', [
      playerId,
      nonce,
      itemId,
      serviceId,
    ]);
  }
  acceptItemService(playerId: string, nonce: string, jobId: string, priceCredits: number, durationMinutes: number): Promise<Json> {
    return this.callJson('select public.cc_item_service_accept($1, $2, $3, $4, $5) as result', [
      playerId,
      nonce,
      jobId,
      priceCredits,
      durationMinutes,
    ]);
  }
  finishItemService(playerId: string, nonce: string, jobId: string): Promise<Json> {
    return this.callJson('select public.cc_item_job_finish($1, $2, $3) as result', [playerId, nonce, jobId]);
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
}
