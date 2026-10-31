/**
 * Read persistence (Route B, slice B2).
 *
 * ReadStore is the seam between the Chef's read routes and storage:
 * InMemoryReadStore for tests, PgReadStore (db/migrations/0003_read_apis.sql)
 * for Railway Postgres.
 *
 * Shape contract: every method returns exactly what the Supabase surface
 * returns today for the matching client service in src/lib/api/
 * (profileService, progressionService, masteryService, leaderboardService,
 * publicProfileService, statsService, usernameService reads, marketListings
 * reads, runtimeStateService item reads), so the B4 client cutover can swap
 * transports without changing call sites.
 *
 * Authorization contract (replaces RLS): methods that read a player's own
 * data take the player id resolved from the verified Chef JWT and scope
 * every query to it. Methods that read another player's data return only
 * the fields the current public surface exposes (player_public_stats /
 * cc_get_public_profile / leaderboard projections) — never the profile row.
 */
import type { PgQuery } from '../auth/store';
import { utcDayStartIso } from '../../lib/bossFees';
import {
  consumableDisplayName,
  consumableIdentityKey,
  gearCategoryFromPayload,
  gearIdentityFromPayload,
  materialIdentityKey,
  vehicleIdentityKey,
  type MarketCategory,
} from '../../lib/market/identityKey';
import {
  applyListingQuery,
  clampLimit,
  clampOffset,
  type MarketBrowseRow,
  type MarketListingQuery,
} from '../../lib/market/listingQuery';
import {
  computePriceStats,
  PRICE_STATS_SUPPLY_DAYS,
  type PriceStats,
  type SaleRecord,
} from '../../lib/market/priceStats';

// ---------------------------------------------------------------------------
// Row shapes — mirrors of the client service interfaces (kept server-local
// so the server bundle never imports the Supabase client).
// ---------------------------------------------------------------------------

export interface ProfileRowData {
  id: string;
  username: string | null;
  display_name: string | null;
  player_level: number;
  player_xp: number;
  credits: number;
  scrap: number;
  cache_tokens: number;
  cache_token_parts: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  consumables: Record<string, number>;
  skill_spends: Record<string, number>;
  boss_state: Record<string, unknown>;
  last_idle_claim_at: string;
  last_claimed_tick: number;
  created_at: string;
  updated_at: string;
  account_type: string;
  email: string | null;
  email_verified_at: string | null;
  verification_grace_expires_at: string | null;
  verification_reminder_last_seen_at: string | null;
  // Columns the Supabase `select *` also returns (not declared by the
  // client's ProfileRow type but present in the payload today).
  last_roaming_settled_at: string | null;
  last_settlement_nonce: string | null;
  offline_cap_hours: number;
  /** Vehicle tank fuel units (migration 0021). Optional: pre-0021 seed rows omit it. */
  vehicle_fuel?: number;
  /** Owned workshop benches (migration 0024). Optional: pre-0024 seed rows omit it (= 1). */
  workshop_benches?: number;
  /** Workshop tool assets (migration 0024): { owned, fitted, charges }. Optional: pre-0024 rows omit it. */
  workshop_tools?: Record<string, unknown>;
  /**
   * Computed by PgReadStore.getProfile (not a column): victories per
   * boss on the current UTC day from the verified action ledger — the
   * prep panel's rematch-escalation display state. Absent on seeded
   * in-memory rows unless a test provides it.
   */
  boss_victories_today?: Record<string, number>;
  username_updated_at: string | null;
  username_change_count: number;
}

export interface ProgressionSnapshotData {
  id: number;
  player_id: string;
  snapshot_at: string;
  source: string;
  snapshot_version: number;
  level: number | null;
  xp: number | null;
  credits: number | null;
  scrap: number | null;
  total_kills: number | null;
  total_deaths: number | null;
  net_worth: number | null;
  total_items: number | null;
  weapons_owned: number | null;
  legendary_items: number | null;
  highest_item_level: number | null;
  total_mastery_xp: number | null;
  highest_mastery_level: number | null;
  highest_boss_tier: number | null;
  active_action: string | null;
  metadata: Record<string, unknown>;
}

export interface SnapshotQuery {
  sources?: string[];
  since?: string;
  until?: string;
  limit?: number;
}

export interface MasterySummaryRowData {
  mastery_id: string;
  category: string;
  label: string;
  mastery_xp: number;
  mastery_level: number;
  rank: number;
}

export interface MasteryLeaderboardRowData {
  rank: number;
  user_id: string;
  display_name: string;
  mastery_id: string;
  mastery_xp: number;
  mastery_level: number;
}

export type LeaderboardMetric =
  | 'level' | 'xp' | 'net_worth' | 'total_kills' | 'kdr'
  | 'highest_boss_tier' | 'total_mastery_xp' | 'highest_mastery_level'
  | 'legendary_items' | 'total_items';

export type LeaderboardPeriod = 'all_time' | 'weekly' | 'daily';

export const LEADERBOARD_METRICS: readonly LeaderboardMetric[] = [
  'level', 'xp', 'net_worth', 'total_kills', 'kdr',
  'highest_boss_tier', 'total_mastery_xp', 'highest_mastery_level',
  'legendary_items', 'total_items',
];

export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = ['all_time', 'weekly', 'daily'];

export interface LeaderboardEntryData {
  rank: number;
  player_id: string;
  username: string | null;
  value: number;
  previous_value: number | null;
  trend: number;
}

export interface MyLeaderboardRankData {
  rank: number;
  value: number;
  previous_value: number | null;
  trend: number;
  total_players: number;
}

export interface PublicProfileData {
  player_id: string;
  username: string | null;
  display_name: string | null;
  level: number;
  xp: number;
  net_worth: number;
  total_kills: number;
  total_deaths: number;
  kill_death_ratio: number | null;
  highest_boss_tier: number;
  total_mastery_xp: number;
  highest_mastery_level: number;
  legendary_items: number;
  total_items: number;
  weapons_owned: number;
  highest_item_level: number;
  joined_at: string;
  last_active_at: string;
}

export interface PublicStatsData {
  user_id: string;
  username: string | null;
  display_name: string | null;
  player_level: number;
  player_xp: number;
  credits: number;
  scrap: number;
  cache_tokens: number;
  cache_token_parts: number;
  total_kills: number;
  total_deaths: number;
  kill_death_ratio: number | null;
  highest_boss_tier: number;
  longest_kill_streak: number;
  active_play_seconds: number;
  idle_play_seconds: number;
  kills_by_area: Record<string, number>;
  kills_by_weapon_type: Record<string, number>;
  kills_by_element: Record<string, number>;
  net_worth: number;
  total_items: number;
  weapons_owned: number;
  legendary_items: number;
  highest_item_level: number;
  total_mastery_xp: number;
  highest_mastery_level: number;
  last_active_at: string;
  joined_at: string;
}

export interface ProfileSummaryData {
  user_id: string;
  username: string | null;
  display_name: string | null;
  account_type: string;
  has_username: boolean;
  username_updated_at: string | null;
  can_rename_at: string | null;
}

export interface MarketItemData {
  id: string;
  item_level: number | null;
  rarity: string | null;
  is_locked: boolean;
  runtime_state: string;
  equipped_slot: string | null;
  payload: Record<string, unknown>;
  /** Item kind (0021: runtime items carry it so vehicles route to the garage). */
  kind?: string | null;
  /** Vehicle wear (0021); null for non-vehicle kinds. */
  condition_current?: number | null;
  condition_max?: number | null;
}

export interface MarketListingData {
  id: string;
  price_credits: number;
  listed_at: string;
  seller_user_id: string;
  /** Market depth (0019): browse facts ride on the listing itself. */
  seller_type: 'player' | 'npc';
  listing_kind: 'gear' | 'consumable' | 'material' | 'vehicle';
  quantity: number;
  quality_percent: number | null;
  consumable_type: string | null;
  material_id: string | null;
  identity_key: string | null;
  category: MarketCategory | null;
  display_name: string | null;
  weapon_type: string | null;
  element: string | null;
  rarity: string | null;
  item_level: number | null;
  /** The gear payload row; null for consumable/material listings. */
  item_instances: MarketItemData | null;
}

export interface RuntimeItemData extends MarketItemData {
  created_at: string;
}

// ---------------------------------------------------------------------------
// Market depth (0019) — listing normalization shared by both read
// stores. Migration 0019 stamps browse facts (category, identity_key,
// …) onto market_listings at creation and backfills old rows, but the
// fold below still derives any missing fact from the item payload, so
// a row written by an older path browses identically. The derivation
// rules are src/lib/market/identityKey.ts — the one scheme.
// ---------------------------------------------------------------------------

/** Listing fields as either store holds them (0019 columns optional on legacy rows). */
export interface RawListingFields {
  id: string;
  seller_user_id: string;
  price_credits: number;
  listed_at: string;
  sold_at?: string | null;
  listing_kind?: string | null;
  quantity?: number | null;
  quality_percent?: number | null;
  consumable_type?: string | null;
  material_id?: string | null;
  identity_key?: string | null;
  category?: string | null;
  display_name?: string | null;
  weapon_type?: string | null;
  element?: string | null;
  rarity?: string | null;
  item_level?: number | null;
  seller_type?: string | null;
}

export interface RawItemFields {
  kind?: string | null;
  item_level?: number | null;
  rarity?: string | null;
  supply_mode?: string | null;
  payload?: Record<string, unknown> | null;
}

export function browseRowFor(listing: RawListingFields, item: RawItemFields | null): MarketBrowseRow {
  const kind = listing.listing_kind === 'consumable' || listing.listing_kind === 'material' || listing.listing_kind === 'vehicle'
    ? listing.listing_kind
    : 'gear';
  const payload = item?.payload ?? {};
  const quantity = Math.max(1, Math.floor(listing.quantity ?? 1));
  let category: MarketCategory;
  let displayName: string;
  let weaponType: string | null = null;
  let element: string | null = null;
  let rarity: string | null = null;
  let itemLevel: number | null = null;
  let identityKey: string | null;
  if (kind === 'consumable') {
    category = 'consumable';
    displayName = listing.consumable_type ? consumableDisplayName(listing.consumable_type) : (listing.display_name ?? 'Consumable');
    identityKey = listing.identity_key
      ?? (listing.consumable_type ? consumableIdentityKey(listing.consumable_type, listing.quality_percent) : null);
  } else if (kind === 'material') {
    category = 'material';
    displayName = listing.display_name ?? listing.material_id ?? 'Material';
    identityKey = listing.identity_key
      ?? (listing.material_id ? materialIdentityKey(listing.material_id) : null);
  } else if (kind === 'vehicle') {
    // Vehicles (0021): browse like gear, bucketed by class + rarity.
    category = 'vehicle';
    rarity = listing.rarity ?? item?.rarity ?? (typeof payload.rarity === 'string' ? payload.rarity : null);
    itemLevel = listing.item_level ?? item?.item_level ?? (typeof payload.level === 'number' ? payload.level : null);
    displayName = listing.display_name ?? (typeof payload.name === 'string' ? payload.name : 'Vehicle');
    identityKey = listing.identity_key
      ?? vehicleIdentityKey(typeof payload.vehicleClassId === 'string' ? payload.vehicleClassId : '', rarity);
  } else {
    category = (listing.category as MarketCategory | null) ?? gearCategoryFromPayload(payload, item?.kind);
    weaponType = listing.weapon_type ?? (typeof payload.weaponType === 'string' ? payload.weaponType : null);
    element = listing.element ?? (typeof payload.element === 'string' ? payload.element : null);
    rarity = listing.rarity ?? item?.rarity ?? (typeof payload.rarity === 'string' ? payload.rarity : null);
    itemLevel = listing.item_level ?? item?.item_level ?? (typeof payload.level === 'number' ? payload.level : null);
    displayName = listing.display_name ?? (typeof payload.name === 'string' ? payload.name : 'Unknown Item');
    identityKey = listing.identity_key
      ?? gearIdentityFromPayload(payload, { kind: item?.kind, rarity, level: itemLevel });
  }
  return {
    id: listing.id,
    sellerId: listing.seller_user_id,
    sellerType: listing.seller_type === 'npc' || item?.supply_mode === 'npc_market' ? 'npc' : 'player',
    kind,
    category,
    displayName,
    weaponType,
    element,
    rarity,
    itemLevel,
    price: Number(listing.price_credits),
    quantity,
    unitPrice: Number(listing.price_credits) / quantity,
    qualityPercent: listing.quality_percent ?? null,
    consumableType: listing.consumable_type ?? null,
    materialId: listing.material_id ?? null,
    identityKey,
    listedAt: Date.parse(listing.listed_at),
  };
}

/** The wire row for one listing: normalized browse facts + the gear item embed. */
export function marketListingData(
  listing: RawListingFields,
  item: MarketItemData | null,
  rawItem: RawItemFields | null,
): MarketListingData {
  const browse = browseRowFor(listing, rawItem);
  return {
    id: listing.id,
    price_credits: Number(listing.price_credits),
    listed_at: listing.listed_at,
    seller_user_id: listing.seller_user_id,
    seller_type: browse.sellerType,
    listing_kind: browse.kind,
    quantity: browse.quantity,
    quality_percent: browse.qualityPercent,
    consumable_type: browse.consumableType,
    material_id: browse.materialId,
    identity_key: browse.identityKey,
    category: browse.category,
    display_name: browse.displayName,
    weapon_type: browse.weaponType,
    element: browse.element,
    rarity: browse.rarity,
    item_level: browse.itemLevel,
    item_instances: item,
  };
}

export type ReadErrorCode = 'validation';

export class ReadStoreError extends Error {
  constructor(public readonly code: ReadErrorCode, message: string) {
    super(message);
  }
}

export interface ReadStore {
  /** Caller's own full profile row (profiles_select_own). */
  getProfile(playerId: string): Promise<ProfileRowData | null>;
  /** Caller's own progression snapshots (RLS: player_id = caller). */
  getMyProgressionSnapshots(playerId: string, query: SnapshotQuery): Promise<ProgressionSnapshotData[]>;
  /** Caller's own mastery summary (cc_my_mastery_summary). */
  getMyMasterySummary(playerId: string): Promise<MasterySummaryRowData[]>;
  /** Public per-mastery leaderboard (cc_mastery_leaderboard). */
  getMasteryLeaderboard(masteryId: string, limit: number): Promise<MasteryLeaderboardRowData[]>;
  /** Public global leaderboard (cc_get_leaderboard). */
  getLeaderboard(metric: LeaderboardMetric, period: LeaderboardPeriod, limit: number): Promise<LeaderboardEntryData[]>;
  /** Caller's own rank on a leaderboard (cc_get_my_leaderboard_rank). */
  getMyLeaderboardRank(playerId: string, metric: LeaderboardMetric, period: LeaderboardPeriod): Promise<MyLeaderboardRankData | null>;
  /** Public profile subset for any player (cc_get_public_profile). */
  getPublicProfile(playerId: string): Promise<PublicProfileData | null>;
  /** Caller's own public-stats row (cc_my_stats_summary). */
  getMyStats(playerId: string): Promise<PublicStatsData | null>;
  /** Any player's public-stats row (cc_public_stats). */
  getPublicStats(playerId: string): Promise<PublicStatsData | null>;
  /** Username availability (cc_is_username_available). */
  isUsernameAvailable(username: string): Promise<boolean>;
  /** Caller's own profile summary (cc_my_profile_summary). */
  getMyProfileSummary(playerId: string): Promise<ProfileSummaryData | null>;
  /** Active market listings, server-filtered/sorted/paginated (0019 browse query). */
  getActiveMarketListings(query?: MarketListingQuery): Promise<{ listings: MarketListingData[]; total: number }>;
  /** Completed-sales stats per identity key (0019 price intelligence). */
  getMarketPriceStats(keys: string[]): Promise<Record<string, PriceStats>>;
  /** Caller's own runtime items (runtimeStateService item read). */
  getMyRuntimeItems(playerId: string): Promise<RuntimeItemData[]>;
}

// ---------------------------------------------------------------------------
// Shared pure logic — used by the in-memory store. The Pg store runs the
// ported SQL twins in db/migrations/0003_read_apis.sql; the two are kept
// honest by exercising both against the same scenarios in tests.
// ---------------------------------------------------------------------------

export const RESERVED_USERNAMES: readonly string[] = [
  'admin', 'administrator', 'mod', 'moderator', 'system', 'support',
  'help', 'null', 'guest', 'anonymous', 'cybercache', 'nousresearch',
];

/** Mirrors cc_validate_username + the taken check in cc_is_username_available. */
export function usernameAvailable(username: string, takenLowerTrimmed: ReadonlySet<string>): boolean {
  if (typeof username !== 'string') return false;
  const cleaned = username.trim().toLowerCase();
  if (cleaned.length < 3 || cleaned.length > 24) return false;
  if (/[^a-z0-9_-]/.test(cleaned)) return false;
  if (RESERVED_USERNAMES.includes(cleaned)) return false;
  return !takenLowerTrimmed.has(cleaned);
}

const METRIC_FIELD: Record<LeaderboardMetric, keyof ProgressionSnapshotData> = {
  level: 'level',
  xp: 'xp',
  net_worth: 'net_worth',
  total_kills: 'total_kills',
  kdr: 'total_kills', // special-cased below (needs total_deaths too)
  highest_boss_tier: 'highest_boss_tier',
  total_mastery_xp: 'total_mastery_xp',
  highest_mastery_level: 'highest_mastery_level',
  legendary_items: 'legendary_items',
  total_items: 'total_items',
};

function metricValue(snap: ProgressionSnapshotData, metric: LeaderboardMetric): number | null {
  if (metric === 'kdr') {
    if (snap.total_kills === null || snap.total_deaths === null || snap.total_deaths === 0) return null;
    return snap.total_kills / snap.total_deaths;
  }
  const raw = snap[METRIC_FIELD[metric]];
  return typeof raw === 'number' ? raw : null;
}

function periodStart(period: LeaderboardPeriod, now: Date): number {
  if (period === 'weekly') return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (period === 'daily') return now.getTime() - 24 * 60 * 60 * 1000;
  return Number.NEGATIVE_INFINITY; // all_time: the SQL uses 1970-01-01
}

/** Mirrors cc_get_leaderboard: latest snapshot inside the period window per
 * player, previous value from the latest snapshot before the window. */
export function computeLeaderboard(
  snapshots: readonly ProgressionSnapshotData[],
  usernames: ReadonlyMap<string, string | null>,
  metric: LeaderboardMetric,
  period: LeaderboardPeriod,
  limit: number,
  now: Date,
): LeaderboardEntryData[] {
  const minTime = periodStart(period, now);
  const latest = new Map<string, ProgressionSnapshotData>();
  const prior = new Map<string, ProgressionSnapshotData>();
  for (const snap of snapshots) {
    const at = new Date(snap.snapshot_at).getTime();
    const target = at >= minTime ? latest : prior;
    const existing = target.get(snap.player_id);
    if (!existing || new Date(existing.snapshot_at).getTime() <= at) target.set(snap.player_id, snap);
  }
  const rows: LeaderboardEntryData[] = [];
  for (const [playerId, snap] of latest) {
    if (!usernames.has(playerId)) continue; // SQL inner-joins profiles
    const current = metricValue(snap, metric);
    if (current === null) continue;
    const prevSnap = prior.get(playerId);
    const previous = prevSnap ? metricValue(prevSnap, metric) : null;
    rows.push({
      rank: 0,
      player_id: playerId,
      username: usernames.get(playerId) ?? null,
      value: current,
      previous_value: previous,
      trend: previous === null || previous === 0 ? 0 : (current - previous) / previous,
    });
  }
  rows.sort((a, b) => b.value - a.value);
  rows.forEach((row, i) => { row.rank = i + 1; });
  return rows.slice(0, limit);
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests; single-process dev)
// ---------------------------------------------------------------------------

export interface MemMasteryDefinition {
  id: string;
  category: string;
  label: string;
  is_ranked: boolean;
  is_active: boolean;
}

export interface MemPlayerMastery {
  user_id: string;
  mastery_id: string;
  mastery_xp: number;
  mastery_level: number;
}

export interface MemCombatStats {
  user_id: string;
  total_kills: number;
  total_deaths: number;
  longest_kill_streak: number;
  highest_boss_tier: number;
  active_play_seconds: number;
  idle_play_seconds: number;
  kills_by_area: Record<string, number>;
  kills_by_weapon_type: Record<string, number>;
  kills_by_element: Record<string, number>;
}

export interface MemItem {
  id: string;
  owner_user_id: string;
  kind: string;
  item_level: number | null;
  rarity: string | null;
  is_locked: boolean;
  runtime_state: string;
  equipped_slot: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  /** Vehicle wear (0021); absent for non-vehicle seeds. */
  condition_current?: number | null;
  condition_max?: number | null;
}

export interface MemListing {
  id: string;
  seller_user_id: string;
  /** Null for consumable/material listings (0019). */
  item_instance_id: string | null;
  price_credits: number;
  status: string;
  listed_at: string;
  sold_at?: string | null;
  // Market depth (0019) — optional; browseRowFor derives the rest.
  listing_kind?: 'gear' | 'consumable' | 'material' | 'vehicle';
  quantity?: number;
  quality_percent?: number | null;
  consumable_type?: string | null;
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

/** Seedable in-memory dataset for the read surface. */
export interface ReadSeed {
  profiles: ProfileRowData[];
  snapshots: ProgressionSnapshotData[];
  masteryDefinitions: MemMasteryDefinition[];
  playerMasteries: MemPlayerMastery[];
  combatStats: MemCombatStats[];
  netWorth: Record<string, number>;
  items: MemItem[];
  listings: MemListing[];
}

export function emptyReadSeed(): ReadSeed {
  return {
    profiles: [], snapshots: [], masteryDefinitions: [], playerMasteries: [],
    combatStats: [], netWorth: {}, items: [], listings: [],
  };
}

export class InMemoryReadStore implements ReadStore {
  constructor(private readonly seed: ReadSeed = emptyReadSeed(), private readonly now: () => Date = () => new Date()) {}

  async getProfile(playerId: string): Promise<ProfileRowData | null> {
    return this.seed.profiles.find((p) => p.id === playerId) ?? null;
  }

  async getMyProgressionSnapshots(playerId: string, query: SnapshotQuery): Promise<ProgressionSnapshotData[]> {
    let rows = this.seed.snapshots.filter((s) => s.player_id === playerId);
    if (query.sources && query.sources.length > 0) rows = rows.filter((s) => query.sources!.includes(s.source));
    if (query.since) rows = rows.filter((s) => s.snapshot_at >= query.since!);
    if (query.until) rows = rows.filter((s) => s.snapshot_at <= query.until!);
    rows = [...rows].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
    if (query.limit) rows = rows.slice(0, query.limit);
    return rows;
  }

  async getMyMasterySummary(playerId: string): Promise<MasterySummaryRowData[]> {
    const defs = new Map(this.seed.masteryDefinitions.map((d) => [d.id, d]));
    const rows = this.seed.playerMasteries
      .filter((m) => m.user_id === playerId && defs.has(m.mastery_id))
      .map((m) => ({
        mastery_id: m.mastery_id,
        category: defs.get(m.mastery_id)!.category,
        label: defs.get(m.mastery_id)!.label,
        mastery_xp: m.mastery_xp,
        mastery_level: m.mastery_level,
        rank: 1 + this.seed.playerMasteries.filter(
          (o) => o.mastery_id === m.mastery_id && o.mastery_xp > m.mastery_xp,
        ).length,
      }));
    rows.sort((a, b) => a.category.localeCompare(b.category) || b.mastery_xp - a.mastery_xp);
    return rows;
  }

  async getMasteryLeaderboard(masteryId: string, limit: number): Promise<MasteryLeaderboardRowData[]> {
    const def = this.seed.masteryDefinitions.find((d) => d.id === masteryId);
    if (!def || !def.is_ranked || !def.is_active) return [];
    const clamped = Math.max(1, Math.min(100, limit || 25));
    const profiles = new Map(this.seed.profiles.map((p) => [p.id, p]));
    const rows = this.seed.playerMasteries
      .filter((m) => m.mastery_id === masteryId && profiles.has(m.user_id))
      .sort((a, b) => b.mastery_xp - a.mastery_xp);
    return rows.slice(0, clamped).map((m) => ({
      // SQL rank(): 1 + number of rows with strictly greater xp (ties share).
      rank: 1 + rows.filter((o) => o.mastery_xp > m.mastery_xp).length,
      user_id: m.user_id,
      display_name: profiles.get(m.user_id)!.display_name ?? profiles.get(m.user_id)!.username ?? 'Vault Runner',
      mastery_id: m.mastery_id,
      mastery_xp: m.mastery_xp,
      mastery_level: m.mastery_level,
    }));
  }

  async getLeaderboard(metric: LeaderboardMetric, period: LeaderboardPeriod, limit: number): Promise<LeaderboardEntryData[]> {
    const usernames = new Map(this.seed.profiles.map((p) => [p.id, p.username]));
    return computeLeaderboard(this.seed.snapshots, usernames, metric, period, limit, this.now());
  }

  async getMyLeaderboardRank(playerId: string, metric: LeaderboardMetric, period: LeaderboardPeriod): Promise<MyLeaderboardRankData | null> {
    const board = await this.getLeaderboard(metric, period, 100000);
    const mine = board.find((e) => e.player_id === playerId);
    if (!mine) return null;
    return {
      rank: mine.rank, value: mine.value, previous_value: mine.previous_value,
      trend: mine.trend, total_players: board.length,
    };
  }

  private statsFor(playerId: string): PublicStatsData | null {
    const profile = this.seed.profiles.find((p) => p.id === playerId);
    if (!profile) return null;
    const combat = this.seed.combatStats.find((c) => c.user_id === playerId);
    const items = this.seed.items.filter((i) => i.owner_user_id === playerId);
    const masteries = this.seed.playerMasteries.filter((m) => m.user_id === playerId);
    const kills = combat?.total_kills ?? 0;
    const deaths = combat?.total_deaths ?? 0;
    const levels = items.map((i) => i.item_level).filter((v): v is number => v !== null);
    return {
      user_id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      player_level: profile.player_level,
      player_xp: profile.player_xp,
      credits: profile.credits,
      scrap: profile.scrap,
      cache_tokens: profile.cache_tokens,
      cache_token_parts: profile.cache_token_parts,
      total_kills: kills,
      total_deaths: deaths,
      kill_death_ratio: deaths === 0 ? null : kills / deaths,
      highest_boss_tier: combat?.highest_boss_tier ?? 0,
      longest_kill_streak: combat?.longest_kill_streak ?? 0,
      active_play_seconds: combat?.active_play_seconds ?? 0,
      idle_play_seconds: combat?.idle_play_seconds ?? 0,
      kills_by_area: combat?.kills_by_area ?? {},
      kills_by_weapon_type: combat?.kills_by_weapon_type ?? {},
      kills_by_element: combat?.kills_by_element ?? {},
      net_worth: this.seed.netWorth[playerId] ?? 0,
      total_items: items.length,
      weapons_owned: items.filter((i) => i.kind === 'weapon').length,
      legendary_items: items.filter((i) => i.rarity === 'Legendary').length,
      highest_item_level: levels.length ? Math.max(...levels) : 0,
      total_mastery_xp: masteries.reduce((sum, m) => sum + m.mastery_xp, 0),
      highest_mastery_level: masteries.length ? Math.max(...masteries.map((m) => m.mastery_level)) : 0,
      last_active_at: profile.updated_at,
      joined_at: profile.created_at,
    };
  }

  async getPublicProfile(playerId: string): Promise<PublicProfileData | null> {
    const s = this.statsFor(playerId);
    if (!s) return null;
    return {
      player_id: s.user_id,
      username: s.username,
      display_name: s.display_name,
      level: s.player_level,
      xp: s.player_xp,
      net_worth: s.net_worth,
      total_kills: s.total_kills,
      total_deaths: s.total_deaths,
      kill_death_ratio: s.kill_death_ratio,
      highest_boss_tier: s.highest_boss_tier,
      total_mastery_xp: s.total_mastery_xp,
      highest_mastery_level: s.highest_mastery_level,
      legendary_items: s.legendary_items,
      total_items: s.total_items,
      weapons_owned: s.weapons_owned,
      highest_item_level: s.highest_item_level,
      joined_at: s.joined_at,
      last_active_at: s.last_active_at,
    };
  }

  async getMyStats(playerId: string): Promise<PublicStatsData | null> {
    return this.statsFor(playerId);
  }

  async getPublicStats(playerId: string): Promise<PublicStatsData | null> {
    return this.statsFor(playerId);
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const taken = new Set(
      this.seed.profiles.map((p) => p.username?.trim().toLowerCase()).filter(Boolean) as string[],
    );
    return usernameAvailable(username, taken);
  }

  async getMyProfileSummary(playerId: string): Promise<ProfileSummaryData | null> {
    const profile = this.seed.profiles.find((p) => p.id === playerId);
    if (!profile) return null;
    return {
      user_id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      account_type: profile.account_type,
      has_username: profile.username !== null,
      username_updated_at: profile.username_updated_at,
      can_rename_at: profile.username_updated_at
        ? new Date(new Date(profile.username_updated_at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null,
    };
  }

  async getActiveMarketListings(query: MarketListingQuery = {}): Promise<{ listings: MarketListingData[]; total: number }> {
    const items = new Map(this.seed.items.map((i) => [i.id, i]));
    const active = this.seed.listings.filter((l) => l.status === 'active');
    const itemFor = (l: MemListing) => (l.item_instance_id ? items.get(l.item_instance_id) ?? null : null);
    const browsed = applyListingQuery(active.map((l) => browseRowFor(l, itemFor(l))), query);
    const byId = new Map(active.map((l) => [l.id, l]));
    return {
      total: browsed.total,
      listings: browsed.rows.map((row) => {
        const listing = byId.get(row.id) as MemListing;
        const item = itemFor(listing);
        return marketListingData(listing, item ? {
          id: item.id, item_level: item.item_level, rarity: item.rarity,
          is_locked: item.is_locked, runtime_state: item.runtime_state,
          equipped_slot: item.equipped_slot, payload: item.payload,
        } : null, item);
      }),
    };
  }

  async getMarketPriceStats(keys: string[]): Promise<Record<string, PriceStats>> {
    const items = new Map(this.seed.items.map((i) => [i.id, i]));
    const now = this.now().getTime();
    const since = now - PRICE_STATS_SUPPLY_DAYS * 24 * 60 * 60 * 1000;
    const records: SaleRecord[] = [];
    for (const l of this.seed.listings) {
      if (l.status !== 'sold' || !l.sold_at) continue;
      const soldAt = Date.parse(l.sold_at);
      if (!Number.isFinite(soldAt) || soldAt < since) continue;
      const item = l.item_instance_id ? items.get(l.item_instance_id) ?? null : null;
      const row = browseRowFor(l, item);
      if (row.identityKey) records.push({ identityKey: row.identityKey, unitPrice: row.unitPrice, soldAt });
    }
    return computePriceStats(records, keys, now);
  }

  async getMyRuntimeItems(playerId: string): Promise<RuntimeItemData[]> {
    const excluded = new Set(['salvaged', 'consumed', 'listed']);
    return this.seed.items
      .filter((i) => i.owner_user_id === playerId && !excluded.has(i.runtime_state))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((i) => ({
        id: i.id, item_level: i.item_level, rarity: i.rarity, is_locked: i.is_locked,
        runtime_state: i.runtime_state, equipped_slot: i.equipped_slot,
        payload: i.payload, created_at: i.created_at,
        kind: i.kind, condition_current: i.condition_current ?? null, condition_max: i.condition_max ?? null,
      }));
  }
}

// ---------------------------------------------------------------------------
// Postgres implementation (Railway) — see db/migrations/0003_read_apis.sql
//
// pg returns int8/numeric as strings and timestamptz as Dates; PostgREST
// emits all of those as JSON numbers / ISO strings. The mappers below
// coerce to the PostgREST shapes the client already consumes.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

/** Exported for the B3 write store (cc_mark_reminder_seen returns a row). */
export function mapProfile(row: Row): ProfileRowData {
  return {
    ...(row as unknown as ProfileRowData),
    player_xp: num(row.player_xp),
    credits: num(row.credits),
    scrap: num(row.scrap),
    last_claimed_tick: num(row.last_claimed_tick),
    offline_cap_hours: num(row.offline_cap_hours),
    last_idle_claim_at: iso(row.last_idle_claim_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    email_verified_at: isoOrNull(row.email_verified_at),
    verification_grace_expires_at: isoOrNull(row.verification_grace_expires_at),
    verification_reminder_last_seen_at: isoOrNull(row.verification_reminder_last_seen_at),
    last_roaming_settled_at: isoOrNull(row.last_roaming_settled_at),
    username_updated_at: isoOrNull(row.username_updated_at),
  };
}

function mapSnapshot(row: Row): ProgressionSnapshotData {
  return {
    id: num(row.id),
    player_id: row.player_id as string,
    snapshot_at: iso(row.snapshot_at),
    source: row.source as string,
    snapshot_version: num(row.snapshot_version),
    level: numOrNull(row.level),
    xp: numOrNull(row.xp),
    credits: numOrNull(row.credits),
    scrap: numOrNull(row.scrap),
    total_kills: numOrNull(row.total_kills),
    total_deaths: numOrNull(row.total_deaths),
    net_worth: numOrNull(row.net_worth),
    total_items: numOrNull(row.total_items),
    weapons_owned: numOrNull(row.weapons_owned),
    legendary_items: numOrNull(row.legendary_items),
    highest_item_level: numOrNull(row.highest_item_level),
    total_mastery_xp: numOrNull(row.total_mastery_xp),
    highest_mastery_level: numOrNull(row.highest_mastery_level),
    highest_boss_tier: numOrNull(row.highest_boss_tier),
    active_action: (row.active_action as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

function mapStats(row: Row): PublicStatsData {
  return {
    user_id: row.user_id as string,
    username: (row.username as string | null) ?? null,
    display_name: (row.display_name as string | null) ?? null,
    player_level: num(row.player_level),
    player_xp: num(row.player_xp),
    credits: num(row.credits),
    scrap: num(row.scrap),
    cache_tokens: num(row.cache_tokens),
    cache_token_parts: num(row.cache_token_parts),
    total_kills: num(row.total_kills),
    total_deaths: num(row.total_deaths),
    kill_death_ratio: numOrNull(row.kill_death_ratio),
    highest_boss_tier: num(row.highest_boss_tier),
    longest_kill_streak: num(row.longest_kill_streak),
    active_play_seconds: num(row.active_play_seconds),
    idle_play_seconds: num(row.idle_play_seconds),
    kills_by_area: (row.kills_by_area as Record<string, number>) ?? {},
    kills_by_weapon_type: (row.kills_by_weapon_type as Record<string, number>) ?? {},
    kills_by_element: (row.kills_by_element as Record<string, number>) ?? {},
    net_worth: num(row.net_worth),
    total_items: num(row.total_items),
    weapons_owned: num(row.weapons_owned),
    legendary_items: num(row.legendary_items),
    highest_item_level: num(row.highest_item_level),
    total_mastery_xp: num(row.total_mastery_xp),
    highest_mastery_level: num(row.highest_mastery_level),
    last_active_at: iso(row.last_active_at),
    joined_at: iso(row.joined_at),
  };
}

function mapPublicProfile(row: Row): PublicProfileData {
  return {
    player_id: row.player_id as string,
    username: (row.username as string | null) ?? null,
    display_name: (row.display_name as string | null) ?? null,
    level: num(row.level),
    xp: num(row.xp),
    net_worth: num(row.net_worth),
    total_kills: num(row.total_kills),
    total_deaths: num(row.total_deaths),
    kill_death_ratio: numOrNull(row.kill_death_ratio),
    highest_boss_tier: num(row.highest_boss_tier),
    total_mastery_xp: num(row.total_mastery_xp),
    highest_mastery_level: num(row.highest_mastery_level),
    legendary_items: num(row.legendary_items),
    total_items: num(row.total_items),
    weapons_owned: num(row.weapons_owned),
    highest_item_level: num(row.highest_item_level),
    joined_at: iso(row.joined_at),
    last_active_at: iso(row.last_active_at),
  };
}

function mapItem(row: Row): MarketItemData {
  return {
    id: row.id as string,
    item_level: numOrNull(row.item_level),
    rarity: (row.rarity as string | null) ?? null,
    is_locked: Boolean(row.is_locked),
    runtime_state: row.runtime_state as string,
    equipped_slot: (row.equipped_slot as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    kind: (row.kind as string | null) ?? null,
    condition_current: numOrNull(row.condition_current),
    condition_max: numOrNull(row.condition_max),
  };
}

export class PgReadStore implements ReadStore {
  constructor(private readonly db: PgQuery) {}

  async getProfile(playerId: string): Promise<ProfileRowData | null> {
    const { rows } = await this.db.query('select * from public.profiles where id = $1', [playerId]);
    if (!rows.length) return null;
    const profile = mapProfile(rows[0]);
    // Rematch-escalation display state (pacing-baseline tuning): today's
    // victories per boss, counted from the verified action ledger so the
    // prep panel shows the escalated fee before an attempt. Display
    // only — the verify-boss route re-derives the charge itself.
    const { rows: victoryRows } = await this.db.query(
      `select result_payload->>'boss_id' as boss_id, count(*)::int as victories
         from public.verified_action_ledger
        where user_id = $1 and action_type = 'cc_apply_boss_attempt'
          and coalesce((result_payload->'attempt'->>'victory')::boolean, false)
          and created_at >= $2::timestamptz
        group by 1`,
      [playerId, utcDayStartIso()],
    );
    const bossVictoriesToday: Record<string, number> = {};
    for (const row of victoryRows as Row[]) {
      if (typeof row.boss_id === 'string') bossVictoriesToday[row.boss_id] = num(row.victories);
    }
    return { ...profile, boss_victories_today: bossVictoriesToday };
  }

  async getMyProgressionSnapshots(playerId: string, query: SnapshotQuery): Promise<ProgressionSnapshotData[]> {
    const params: unknown[] = [playerId];
    let sql = 'select * from public.player_progression_snapshots where player_id = $1';
    if (query.sources && query.sources.length > 0) {
      params.push(query.sources);
      sql += ` and source = any($${params.length}::text[])`;
    }
    if (query.since) {
      params.push(query.since);
      sql += ` and snapshot_at >= $${params.length}`;
    }
    if (query.until) {
      params.push(query.until);
      sql += ` and snapshot_at <= $${params.length}`;
    }
    sql += ' order by snapshot_at asc';
    if (query.limit) {
      params.push(query.limit);
      sql += ` limit $${params.length}`;
    }
    const { rows } = await this.db.query(sql, params);
    return rows.map(mapSnapshot);
  }

  async getMyMasterySummary(playerId: string): Promise<MasterySummaryRowData[]> {
    const { rows } = await this.db.query('select public.cc_my_mastery_summary($1) as data', [playerId]);
    const data = (rows[0]?.data ?? []) as MasterySummaryRowData[];
    return data.map((r) => ({ ...r, mastery_xp: num(r.mastery_xp), rank: num(r.rank) }));
  }

  async getMasteryLeaderboard(masteryId: string, limit: number): Promise<MasteryLeaderboardRowData[]> {
    const { rows } = await this.db.query('select public.cc_mastery_leaderboard($1, $2) as data', [masteryId, limit]);
    const data = (rows[0]?.data ?? []) as MasteryLeaderboardRowData[];
    return data.map((r) => ({ ...r, mastery_xp: num(r.mastery_xp), rank: num(r.rank) }));
  }

  async getLeaderboard(metric: LeaderboardMetric, period: LeaderboardPeriod, limit: number): Promise<LeaderboardEntryData[]> {
    const { rows } = await this.db.query(
      'select rank, player_id, username, value, previous_value, trend from public.cc_get_leaderboard($1, $2, $3)',
      [metric, period, limit],
    );
    return rows.map((r) => ({
      rank: num(r.rank),
      player_id: r.player_id as string,
      username: (r.username as string | null) ?? null,
      value: num(r.value),
      previous_value: numOrNull(r.previous_value),
      trend: num(r.trend),
    }));
  }

  async getMyLeaderboardRank(playerId: string, metric: LeaderboardMetric, period: LeaderboardPeriod): Promise<MyLeaderboardRankData | null> {
    const { rows } = await this.db.query(
      'select rank, value, previous_value, trend, total_players from public.cc_get_my_leaderboard_rank($1, $2, $3)',
      [playerId, metric, period],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      rank: num(r.rank), value: num(r.value), previous_value: numOrNull(r.previous_value),
      trend: num(r.trend), total_players: num(r.total_players),
    };
  }

  async getPublicProfile(playerId: string): Promise<PublicProfileData | null> {
    const { rows } = await this.db.query('select * from public.cc_get_public_profile($1)', [playerId]);
    return rows.length ? mapPublicProfile(rows[0]) : null;
  }

  async getMyStats(playerId: string): Promise<PublicStatsData | null> {
    const { rows } = await this.db.query('select * from public.cc_my_stats_summary($1)', [playerId]);
    // Composite-returning function: a missing player yields one all-NULL
    // row (PostgREST collapses that to a null payload for the client).
    return rows.length && rows[0].user_id != null ? mapStats(rows[0]) : null;
  }

  async getPublicStats(playerId: string): Promise<PublicStatsData | null> {
    const { rows } = await this.db.query('select * from public.cc_public_stats($1)', [playerId]);
    return rows.length && rows[0].user_id != null ? mapStats(rows[0]) : null;
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const { rows } = await this.db.query('select public.cc_is_username_available($1) as available', [username]);
    return Boolean(rows[0]?.available);
  }

  async getMyProfileSummary(playerId: string): Promise<ProfileSummaryData | null> {
    const { rows } = await this.db.query('select public.cc_my_profile_summary($1) as data', [playerId]);
    const data = rows[0]?.data as ProfileSummaryData | null | undefined;
    return data ?? null;
  }

  async getActiveMarketListings(query: MarketListingQuery = {}): Promise<{ listings: MarketListingData[]; total: number }> {
    // SQL twin of applyListingQuery (src/lib/market/listingQuery.ts)
    // over the columns migration 0019 stamps at creation — a browse
    // never opens an item payload to filter.
    const where: string[] = [`ml.status = 'active'`];
    const params: unknown[] = [];
    const push = (clause: (i: number) => string, value: unknown) => {
      params.push(value);
      where.push(clause(params.length));
    };
    if (query.search) push((i) => `position(lower($${i}) in lower(coalesce(ml.display_name, ''))) > 0`, query.search);
    if (query.category) push((i) => `ml.category = $${i}`, query.category);
    if (query.weaponType) push((i) => `ml.weapon_type = $${i}`, query.weaponType);
    if (query.element) push((i) => `ml.element = $${i}`, query.element);
    if (query.rarity) push((i) => `ml.rarity = $${i}`, query.rarity);
    if (query.levelMin !== undefined) push((i) => `ml.item_level >= $${i}`, query.levelMin);
    if (query.levelMax !== undefined) push((i) => `ml.item_level <= $${i}`, query.levelMax);
    if (query.priceMin !== undefined) push((i) => `ml.price_credits >= $${i}`, query.priceMin);
    if (query.priceMax !== undefined) push((i) => `ml.price_credits <= $${i}`, query.priceMax);
    if (query.sellerType) push((i) => `ml.seller_type = $${i}`, query.sellerType);
    if (query.sellerId) push((i) => `ml.seller_user_id = $${i}`, query.sellerId);
    if (query.excludeSellerId) push((i) => `ml.seller_user_id <> $${i}`, query.excludeSellerId);
    const whereSql = where.join(' and ');
    const orderBy = {
      price_asc: 'ml.price_credits asc, ml.listed_at desc',
      price_desc: 'ml.price_credits desc, ml.listed_at desc',
      rarity: `case ml.rarity when 'Legendary' then 5 when 'Epic' then 4 when 'Rare' then 3 when 'Uncommon' then 2 when 'Common' then 1 else 0 end desc, ml.price_credits asc, ml.listed_at desc`,
      level: 'ml.item_level desc nulls last, ml.price_credits asc, ml.listed_at desc',
      name: 'ml.display_name asc, ml.listed_at desc',
      newest: 'ml.listed_at desc',
    }[query.sort ?? 'newest'];
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const { rows: countRows } = await this.db.query(
      `select count(*)::int as total from public.market_listings ml where ${whereSql}`,
      params,
    );
    const { rows } = await this.db.query(
      `select ml.id, ml.price_credits, ml.listed_at, ml.seller_user_id, ml.listing_kind,
              ml.quantity, ml.quality_percent, ml.consumable_type, ml.material_id,
              ml.identity_key, ml.category, ml.display_name, ml.weapon_type, ml.element,
              ml.rarity, ml.item_level, ml.seller_type,
              ii.id as item_id, ii.item_level as item_item_level, ii.rarity as item_rarity,
              ii.is_locked as item_is_locked, ii.runtime_state as item_runtime_state,
              ii.equipped_slot as item_equipped_slot, ii.payload as item_payload,
              ii.kind as item_kind, ii.supply_mode as item_supply_mode
       from public.market_listings ml
       left join public.item_instances ii on ii.id = ml.item_instance_id
       where ${whereSql}
       order by ${orderBy}
       limit ${limit} offset ${offset}`,
      params,
    );
    return {
      total: num(countRows[0]?.total),
      listings: rows.map((r) => {
        const rawItem: RawItemFields | null = r.item_id ? {
          kind: (r.item_kind as string | null) ?? null,
          item_level: numOrNull(r.item_item_level),
          rarity: (r.item_rarity as string | null) ?? null,
          supply_mode: (r.item_supply_mode as string | null) ?? null,
          payload: (r.item_payload as Record<string, unknown>) ?? {},
        } : null;
        return marketListingData({
          id: r.id as string,
          seller_user_id: r.seller_user_id as string,
          price_credits: num(r.price_credits),
          listed_at: iso(r.listed_at),
          listing_kind: (r.listing_kind as string | null) ?? null,
          quantity: num(r.quantity),
          quality_percent: numOrNull(r.quality_percent),
          consumable_type: (r.consumable_type as string | null) ?? null,
          material_id: (r.material_id as string | null) ?? null,
          identity_key: (r.identity_key as string | null) ?? null,
          category: (r.category as string | null) ?? null,
          display_name: (r.display_name as string | null) ?? null,
          weapon_type: (r.weapon_type as string | null) ?? null,
          element: (r.element as string | null) ?? null,
          rarity: (r.rarity as string | null) ?? null,
          item_level: numOrNull(r.item_level),
          seller_type: (r.seller_type as string | null) ?? null,
        }, r.item_id ? mapItem({
          id: r.item_id, item_level: r.item_item_level, rarity: r.item_rarity,
          is_locked: r.item_is_locked, runtime_state: r.item_runtime_state,
          equipped_slot: r.item_equipped_slot, payload: r.item_payload,
        }) : null, rawItem);
      }),
    };
  }

  async getMarketPriceStats(keys: string[]): Promise<Record<string, PriceStats>> {
    if (!keys.length) return {};
    // Completed sales for the requested keys; the identity key is the
    // stamped column, with the 0019 SQL helpers as the fallback for
    // any row that predates stamping. Stats math is the shared
    // src/lib/market/priceStats.ts fold over unit prices.
    const { rows } = await this.db.query(
      `select identity_key, unit_price, sold_at from (
         select case
                  when ml.listing_kind = 'consumable' then coalesce(ml.identity_key, public.cc_market_consumable_identity(ml.consumable_type, ml.quality_percent))
                  when ml.listing_kind = 'material' then coalesce(ml.identity_key, 'mat:' || ml.material_id)
                  else coalesce(ml.identity_key, public.cc_market_gear_identity(ii.payload, ii.kind, coalesce(ii.rarity, ii.payload ->> 'rarity'), coalesce(ii.item_level, (ii.payload ->> 'level')::integer, 1)))
                end as identity_key,
                (ml.price_credits::numeric / greatest(ml.quantity, 1)) as unit_price,
                ml.sold_at
           from public.market_listings ml
           left join public.item_instances ii on ii.id = ml.item_instance_id
          where ml.status = 'sold'
            and ml.sold_at >= now() - ($2::int || ' days')::interval
       ) s
       where identity_key = any($1::text[])`,
      [keys, PRICE_STATS_SUPPLY_DAYS],
    );
    const records: SaleRecord[] = rows.map((r) => ({
      identityKey: r.identity_key as string,
      unitPrice: num(r.unit_price),
      soldAt: new Date(iso(r.sold_at)).getTime(),
    }));
    return computePriceStats(records, keys, Date.now());
  }

  async getMyRuntimeItems(playerId: string): Promise<RuntimeItemData[]> {
    const { rows } = await this.db.query(
      `select id, item_level, rarity, is_locked, runtime_state, equipped_slot, payload, created_at, kind, condition_current, condition_max
       from public.item_instances
       where owner_user_id = $1
         and runtime_state <> 'salvaged'
         and runtime_state <> 'consumed'
         and runtime_state <> 'listed'
       order by created_at desc`,
      [playerId],
    );
    return rows.map((r) => ({ ...mapItem(r), created_at: iso(r.created_at) }));
  }
}
