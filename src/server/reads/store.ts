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
  /** Legendary core balance (migration 0026). Optional: pre-0026 seed rows omit it. */
  legendary_cores?: number;
  /** Action skill charge pool 0..100 (migration 0030). Optional: pre-0030 seed rows omit it (= 0). */
  action_skill_charge?: number;
  /** Recorded action skill selection (migration 0030). Optional: pre-0030 rows omit it (= null). */
  action_skill_selection?: string | null;
  /** Cache Rank token balance (migration 0031). Optional: pre-0031 seed rows omit it (= 0). */
  cache_rank_tokens?: number;
  /** Cache Rank grant watermark (migration 0031). Optional: pre-0031 rows omit it (= 0). */
  cache_rank_grant_level?: number;
  /** Cache Rank per-track spend ranks (migration 0031). Optional: pre-0031 rows omit it (= {}). */
  cache_rank_spends?: Record<string, number>;
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

/** One collection_discoveries row (migration 0026). */
export interface CollectionDiscoveryData {
  family: string;
  entry_key: string;
  source: string;
  discovered_at: string;
}

/**
 * The caller's collection log state (migration 0026): the legendary
 * core balance plus every discovery row. The catalog itself is
 * content (src/content/collections.ts); this read carries only the
 * player's proven facts, so a public projection (the later profile
 * showcase) can read the same shape.
 */
export interface CollectionsData {
  legendary_cores: number;
  discoveries: CollectionDiscoveryData[];
}

// ---------------------------------------------------------------------------
// Profile lifetime stats + trophy showcase (0034 read).
//
// Every figure folds from server records only — the verified action
// ledger, collection_discoveries, endless_runs, dispatch_missions,
// craft_jobs, service_jobs, consumable_events, extraction_state,
// market_listings, player_kill_stats (0034), and the player's own
// item_instances. Nothing is computed from client state and nothing
// is estimated: a stat the records cannot prove is simply absent
// from this payload (the gaps are listed in the slice PR — lifetime
// deaths, lifetime credits earned/spent, kills by element, and
// legendary items found by source beyond the discovery-proven
// subset have no complete server record).
// ---------------------------------------------------------------------------

/** One verified_action_ledger row (own rows; the fold reads result_payload only). */
export interface LedgerEntryData {
  user_id: string;
  action_type: string;
  result_payload: Record<string, unknown>;
}

export interface EndlessRunRecordData {
  status: string;
  depth_reached: number;
}

export interface DispatchMissionRecordData {
  contract_family: string;
  status: string;
  payout_credits: number;
  payout_fraction: number | null;
}

export interface CraftJobRecordData {
  kind: string;
  units_completed: number;
  /** Unit outputs; repair-kind jobs carry pointsRestored per unit (0025). */
  outputs: Array<Record<string, unknown>>;
}

export interface ServiceJobRecordData {
  status: string;
  points_restored: number;
  paid_credits: number;
}

export interface ConsumableEventRecordData {
  consumable_type: string;
  quantity_delta: number;
  event_type: string;
}

/** Raw record set for the lifetime fold — one shape for both stores. */
export interface ProfileLifetimeInput {
  profile: {
    legendary_cores: number;
    cache_rank_tokens: number;
    cache_rank_spends: Record<string, number>;
  };
  discoveries: CollectionDiscoveryData[];
  /** The player's OWN ledger rows (folds never read another player's rows for counts). */
  ledger: LedgerEntryData[];
  /**
   * Market fees the player paid AS SELLER, summed from the buyers'
   * cc_accept_listing ledger results naming them as seller — the fee
   * is fixed in the sale's result payload (0017/0019) and exists
   * nowhere else. Each store computes this from its own records.
   */
  sellerFeesPaid: number;
  /** The player's own sold listings (status = 'sold'). */
  soldListings: Array<{ price_credits: number }>;
  endlessRuns: EndlessRunRecordData[];
  dispatchMissions: DispatchMissionRecordData[];
  craftJobs: CraftJobRecordData[];
  /** Repair-board jobs where the player is the PROVIDER (0025). */
  serviceJobs: ServiceJobRecordData[];
  consumableEvents: ConsumableEventRecordData[];
  extraction: { finalized_passes: number; total_xp_awarded: number } | null;
  /** player_kill_stats (0034): weapon type → lifetime roaming kills. */
  killStats: Record<string, number>;
  /** The player's own runtime items (showcase ranking input). */
  items: RuntimeItemData[];
}

export interface ProfileLifetimeData {
  kills: {
    /** Roaming kills: kills_recorded summed over claim + offline-settle ledger results. */
    roaming: number;
    by_area: Record<string, number>;
    /** From player_kill_stats (0034) — accrues only from claims settled after 0034. */
    by_weapon_type: Record<string, number>;
    /** Elite kills (roaming.elite_kill telemetry sums, 0023). */
    elites: number;
    named_elites_downed: number;
  };
  bosses: {
    attempts: number;
    victories: number;
    by_boss: Record<string, number>;
    /** Distinct bosses downed (collection_discoveries, boss family). */
    downed: number;
  };
  endless: {
    runs: number;
    best_depth: number;
    deaths: number;
    banked: number;
    abandoned: number;
  };
  legendaries: {
    salvaged: number;
    cores_minted: number;
    /** Minted − current balance: recycling is the only core mint (0026), so the difference is exactly what was spent. */
    cores_spent: number;
    cores_balance: number;
    /** Legendary-effect + legendary-frame discoveries grouped by their recorded source. */
    discoveries_by_source: Record<string, number>;
  };
  caches: {
    opened: number;
    rewarded_keys: number;
  };
  crafting: {
    total_units: number;
    units_by_kind: Record<string, number>;
  };
  consumables: {
    used_total: number;
    top_used: Array<{ type: string; count: number }>;
  };
  repair: {
    board_points_restored: number;
    board_jobs_completed: number;
    board_credits_earned: number;
    self_points_restored: number;
    self_jobs: number;
  };
  dispatch: {
    completed: number;
    foot: number;
    courier: number;
    credits_earned: number;
  };
  extraction: {
    passes: number;
    xp_awarded: number;
  };
  market: {
    sales: number;
    sales_volume: number;
    fees_paid: number;
    purchases: number;
    purchases_volume: number;
  };
  salvage: {
    items: number;
    scrap_earned: number;
  };
  reforges: number;
  resurrections: number;
  collections: {
    discovered: number;
    by_family: Record<string, number>;
  };
  showcase: {
    /** Server-ranked top weapons (rarity → level → newest), full runtime-item rows for the compositor. */
    top_weapons: RuntimeItemData[];
    best_endless_depth: number;
    cache_rank_tokens: number;
    cache_rank_total_ranks: number;
    collections_discovered: number;
  };
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
  /** Caller's collection log + legendary core balance (0026); null when no profile. */
  getCollections(playerId: string): Promise<CollectionsData | null>;
  /** Caller's lifetime stats + trophy showcase, folded from server records (0034); null when no profile. */
  getProfileStats(playerId: string): Promise<ProfileLifetimeData | null>;
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
// Lifetime fold (0034) — the one computation both read stores run.
// Pg fetches the raw rows; the in-memory store reads its seed; both
// fold here so the two can never disagree about what a record means.
// ---------------------------------------------------------------------------

function foldRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function foldNum(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function addTo(map: Record<string, number>, key: string, amount: number): void {
  if (!key || amount === 0) return;
  map[key] = (map[key] ?? 0) + amount;
}

const SHOWCASE_RARITY_RANK: Record<string, number> = {
  Legendary: 5, Epic: 4, Rare: 3, Uncommon: 2, Common: 1,
};

/** Server ranking for the trophy shelf: rarity tier, then item level, then newest first. */
export function rankShowcaseWeapons(items: readonly RuntimeItemData[], limit = 3): RuntimeItemData[] {
  const levelOf = (item: RuntimeItemData): number =>
    item.item_level ?? foldNum(foldRecord(item.payload).level) ?? 0;
  return items
    .filter((item) => item.kind === 'weapon')
    .sort((a, b) => {
      const rarityDelta = (SHOWCASE_RARITY_RANK[b.rarity ?? ''] ?? 0) - (SHOWCASE_RARITY_RANK[a.rarity ?? ''] ?? 0);
      if (rarityDelta !== 0) return rarityDelta;
      const levelDelta = levelOf(b) - levelOf(a);
      if (levelDelta !== 0) return levelDelta;
      return b.created_at.localeCompare(a.created_at);
    })
    .slice(0, limit);
}

export function computeProfileLifetime(input: ProfileLifetimeInput): ProfileLifetimeData {
  const killsByArea: Record<string, number> = {};
  let roamingKills = 0;
  let eliteKills = 0;
  let bossAttempts = 0;
  let bossVictories = 0;
  const bossByBoss: Record<string, number> = {};
  let cachesOpened = 0;
  let rewardedKeys = 0;
  let salvageItems = 0;
  let salvageScrap = 0;
  let legendariesSalvaged = 0;
  let coresMinted = 0;
  let purchases = 0;
  let purchasesVolume = 0;
  let reforges = 0;
  let resurrections = 0;

  for (const entry of input.ledger) {
    const payload = foldRecord(entry.result_payload);
    switch (entry.action_type) {
      case 'cc_apply_chef_rewards':
      case 'cc_settle_offline_roaming': {
        const kills = foldNum(foldRecord(payload.rewards).kills_recorded);
        roamingKills += kills;
        addTo(killsByArea, typeof payload.area_id === 'string' ? payload.area_id : '', kills);
        break;
      }
      case 'roaming.elite_kill':
        eliteKills += foldNum(payload.elite_kills);
        break;
      case 'cc_apply_boss_attempt': {
        bossAttempts += 1;
        if (foldRecord(payload.attempt).victory === true) {
          bossVictories += 1;
          addTo(bossByBoss, typeof payload.boss_id === 'string' ? payload.boss_id : '', 1);
        }
        break;
      }
      case 'cc_make_item':
        cachesOpened += 1;
        break;
      case 'cc_claim_rewarded_cache_key':
        rewardedKeys += 1;
        break;
      case 'cc_recycle_item': {
        salvageItems += 1;
        salvageScrap += foldNum(payload.scrap_award);
        coresMinted += foldNum(payload.cores_award);
        if (foldRecord(payload.item).rarity === 'Legendary') legendariesSalvaged += 1;
        break;
      }
      case 'cc_accept_listing': {
        purchases += 1;
        purchasesVolume += foldNum(foldRecord(payload.listing).price_credits);
        break;
      }
      case 'cc_reforge_item':
        reforges += 1;
        break;
      case 'cc_resurrect':
        resurrections += 1;
        break;
      default:
        break;
    }
  }

  const collectionsByFamily: Record<string, number> = {};
  const legendaryBySource: Record<string, number> = {};
  let namedElitesDowned = 0;
  let bossesDowned = 0;
  for (const discovery of input.discoveries) {
    addTo(collectionsByFamily, discovery.family, 1);
    if (discovery.family === 'named_elite') namedElitesDowned += 1;
    if (discovery.family === 'boss') bossesDowned += 1;
    if (discovery.family === 'legendary_effect' || discovery.family === 'weapon_frame') {
      addTo(legendaryBySource, discovery.source, 1);
    }
  }

  // Endless: best depth derives from ENDED run rows only (0028 law —
  // an active run has proven nothing yet).
  let endlessRuns = 0;
  let bestDepth = 0;
  let endlessDeaths = 0;
  let endlessBanked = 0;
  let endlessAbandoned = 0;
  for (const run of input.endlessRuns) {
    if (run.status === 'active') continue;
    endlessRuns += 1;
    bestDepth = Math.max(bestDepth, run.depth_reached);
    if (run.status === 'died') endlessDeaths += 1;
    if (run.status === 'banked') endlessBanked += 1;
    if (run.status === 'abandoned') endlessAbandoned += 1;
  }

  let dispatchCompleted = 0;
  let dispatchFoot = 0;
  let dispatchCourier = 0;
  let dispatchCredits = 0;
  for (const mission of input.dispatchMissions) {
    if (mission.status !== 'settled') continue;
    dispatchCompleted += 1;
    if (mission.contract_family === 'foot') dispatchFoot += 1;
    if (mission.contract_family === 'courier') dispatchCourier += 1;
    // The settler credits floor(payout × fraction) (0032) — recompute
    // the paid amount from the row's own snapshotted terms.
    dispatchCredits += Math.floor(mission.payout_credits * (mission.payout_fraction ?? 1));
  }

  let craftTotalUnits = 0;
  const craftByKind: Record<string, number> = {};
  let selfRepairJobs = 0;
  let selfRepairPoints = 0;
  for (const job of input.craftJobs) {
    craftTotalUnits += job.units_completed;
    addTo(craftByKind, job.kind, job.units_completed);
    if (job.kind === 'repair') {
      selfRepairJobs += 1;
      for (const output of job.outputs) {
        selfRepairPoints += foldNum(foldRecord(output).pointsRestored);
      }
    }
  }

  let boardPoints = 0;
  let boardJobsCompleted = 0;
  let boardCredits = 0;
  for (const job of input.serviceJobs) {
    if (job.status !== 'completed') continue;
    boardJobsCompleted += 1;
    boardPoints += job.points_restored;
    boardCredits += job.paid_credits;
  }

  const usedByType: Record<string, number> = {};
  let usedTotal = 0;
  for (const event of input.consumableEvents) {
    if (event.event_type !== 'used' || event.quantity_delta >= 0) continue;
    const used = -event.quantity_delta;
    usedTotal += used;
    addTo(usedByType, event.consumable_type, used);
  }
  const topUsed = Object.entries(usedByType)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .slice(0, 5);

  const coresBalance = input.profile.legendary_cores;
  const cacheRankTotalRanks = Object.values(input.profile.cache_rank_spends)
    .reduce((sum, ranks) => sum + foldNum(ranks), 0);

  return {
    kills: {
      roaming: roamingKills,
      by_area: killsByArea,
      by_weapon_type: { ...input.killStats },
      elites: eliteKills,
      named_elites_downed: namedElitesDowned,
    },
    bosses: {
      attempts: bossAttempts,
      victories: bossVictories,
      by_boss: bossByBoss,
      downed: bossesDowned,
    },
    endless: {
      runs: endlessRuns,
      best_depth: bestDepth,
      deaths: endlessDeaths,
      banked: endlessBanked,
      abandoned: endlessAbandoned,
    },
    legendaries: {
      salvaged: legendariesSalvaged,
      cores_minted: coresMinted,
      cores_spent: Math.max(0, coresMinted - coresBalance),
      cores_balance: coresBalance,
      discoveries_by_source: legendaryBySource,
    },
    caches: { opened: cachesOpened, rewarded_keys: rewardedKeys },
    crafting: { total_units: craftTotalUnits, units_by_kind: craftByKind },
    consumables: { used_total: usedTotal, top_used: topUsed },
    repair: {
      board_points_restored: boardPoints,
      board_jobs_completed: boardJobsCompleted,
      board_credits_earned: boardCredits,
      self_points_restored: selfRepairPoints,
      self_jobs: selfRepairJobs,
    },
    dispatch: {
      completed: dispatchCompleted,
      foot: dispatchFoot,
      courier: dispatchCourier,
      credits_earned: dispatchCredits,
    },
    extraction: {
      passes: input.extraction?.finalized_passes ?? 0,
      xp_awarded: input.extraction?.total_xp_awarded ?? 0,
    },
    market: {
      sales: input.soldListings.length,
      sales_volume: input.soldListings.reduce((sum, l) => sum + l.price_credits, 0),
      fees_paid: input.sellerFeesPaid,
      purchases,
      purchases_volume: purchasesVolume,
    },
    salvage: { items: salvageItems, scrap_earned: salvageScrap },
    reforges,
    resurrections,
    collections: {
      discovered: input.discoveries.length,
      by_family: collectionsByFamily,
    },
    showcase: {
      top_weapons: rankShowcaseWeapons(input.items),
      best_endless_depth: bestDepth,
      cache_rank_tokens: input.profile.cache_rank_tokens,
      cache_rank_total_ranks: cacheRankTotalRanks,
      collections_discovered: input.discoveries.length,
    },
  };
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
  /** Collection discovery rows (0026). Optional: older seeds omit it. */
  discoveries?: (CollectionDiscoveryData & { user_id: string })[];
  /** Verified-action ledger rows, ALL users (the seller-fee fold scans buyers' rows). Optional (0034). */
  ledger?: LedgerEntryData[];
  /** Endless run rows (0028). Optional (0034). */
  endlessRuns?: (EndlessRunRecordData & { user_id: string })[];
  /** Dispatch mission rows (0032). Optional (0034). */
  dispatchMissions?: (DispatchMissionRecordData & { user_id: string })[];
  /** Craft job rows (0024/0025). Optional (0034). */
  craftJobs?: (CraftJobRecordData & { user_id: string })[];
  /** Repair-board service jobs (0025). Optional (0034). */
  serviceJobs?: (ServiceJobRecordData & { provider_user_id: string })[];
  /** Consumable event rows (0004). Optional (0034). */
  consumableEvents?: (ConsumableEventRecordData & { user_id: string })[];
  /** Extraction state rows (0033). Optional (0034). */
  extractionStates?: Array<{ user_id: string; finalized_passes: number; total_xp_awarded: number }>;
  /** player_kill_stats rows (0034). Optional. */
  killStats?: Array<{ user_id: string; weapon_type: string; kills: number }>;
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

  async getCollections(playerId: string): Promise<CollectionsData | null> {
    const profile = this.seed.profiles.find((p) => p.id === playerId);
    if (!profile) return null;
    const discoveries = (this.seed.discoveries ?? [])
      .filter((d) => d.user_id === playerId)
      .map(({ family, entry_key, source, discovered_at }) => ({ family, entry_key, source, discovered_at }))
      .sort((a, b) => a.discovered_at.localeCompare(b.discovered_at));
    return { legendary_cores: profile.legendary_cores ?? 0, discoveries };
  }

  async getProfileStats(playerId: string): Promise<ProfileLifetimeData | null> {
    const profile = this.seed.profiles.find((p) => p.id === playerId);
    if (!profile) return null;
    const ledger = this.seed.ledger ?? [];
    // Seller fees: scan every user's accept rows for sales naming this
    // player as seller — the same cross-row fact the Pg store reads.
    let sellerFeesPaid = 0;
    for (const entry of ledger) {
      if (entry.action_type !== 'cc_accept_listing') continue;
      const payload = foldRecord(entry.result_payload);
      if (foldRecord(payload.listing).seller_user_id === playerId) {
        sellerFeesPaid += foldNum(foldRecord(payload.market_fee).fee_credits);
      }
    }
    const killStats: Record<string, number> = {};
    for (const row of this.seed.killStats ?? []) {
      if (row.user_id === playerId) killStats[row.weapon_type] = row.kills;
    }
    const extraction = (this.seed.extractionStates ?? []).find((s) => s.user_id === playerId);
    return computeProfileLifetime({
      profile: {
        legendary_cores: profile.legendary_cores ?? 0,
        cache_rank_tokens: profile.cache_rank_tokens ?? 0,
        cache_rank_spends: profile.cache_rank_spends ?? {},
      },
      discoveries: (this.seed.discoveries ?? [])
        .filter((d) => d.user_id === playerId)
        .map(({ family, entry_key, source, discovered_at }) => ({ family, entry_key, source, discovered_at })),
      ledger: ledger.filter((e) => e.user_id === playerId),
      sellerFeesPaid,
      soldListings: this.seed.listings
        .filter((l) => l.seller_user_id === playerId && l.status === 'sold')
        .map((l) => ({ price_credits: l.price_credits })),
      endlessRuns: (this.seed.endlessRuns ?? []).filter((r) => r.user_id === playerId),
      dispatchMissions: (this.seed.dispatchMissions ?? []).filter((m) => m.user_id === playerId),
      craftJobs: (this.seed.craftJobs ?? []).filter((j) => j.user_id === playerId),
      serviceJobs: (this.seed.serviceJobs ?? []).filter((j) => j.provider_user_id === playerId),
      consumableEvents: (this.seed.consumableEvents ?? []).filter((e) => e.user_id === playerId),
      extraction: extraction
        ? { finalized_passes: extraction.finalized_passes, total_xp_awarded: extraction.total_xp_awarded }
        : null,
      killStats,
      items: await this.getMyRuntimeItems(playerId),
    });
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

  async getCollections(playerId: string): Promise<CollectionsData | null> {
    const { rows } = await this.db.query(
      'select legendary_cores from public.profiles where id = $1',
      [playerId],
    );
    if (!rows.length) return null;
    const { rows: discoveryRows } = await this.db.query(
      `select family, entry_key, source, discovered_at
         from public.collection_discoveries
        where user_id = $1
        order by discovered_at asc, family asc, entry_key asc`,
      [playerId],
    );
    return {
      legendary_cores: num((rows[0] as Row).legendary_cores),
      discoveries: (discoveryRows as Row[]).map((row) => ({
        family: String(row.family),
        entry_key: String(row.entry_key),
        source: String(row.source),
        discovered_at: iso(row.discovered_at),
      })),
    };
  }

  async getProfileStats(playerId: string): Promise<ProfileLifetimeData | null> {
    const { rows: profileRows } = await this.db.query(
      'select legendary_cores, cache_rank_tokens, cache_rank_spends from public.profiles where id = $1',
      [playerId],
    );
    if (!profileRows.length) return null;
    const profileRow = profileRows[0] as Row;

    const collections = await this.getCollections(playerId);
    const discoveries = collections?.discoveries ?? [];

    // The player's own ledger rows for exactly the action types the
    // fold reads — result payloads only; request payloads never fold.
    const { rows: ledgerRows } = await this.db.query(
      `select action_type, result_payload
         from public.verified_action_ledger
        where user_id = $1
          and action_type = any($2::text[])`,
      [playerId, [
        'cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'roaming.elite_kill',
        'cc_apply_boss_attempt', 'cc_make_item', 'cc_claim_rewarded_cache_key',
        'cc_recycle_item', 'cc_accept_listing', 'cc_reforge_item', 'cc_resurrect',
      ]],
    );
    // Fees this player paid AS SELLER live in the buyers' sale results
    // (0017/0019 stamp market_fee + the listing's seller into every
    // cc_accept_listing result) — sum exactly those.
    const { rows: feeRows } = await this.db.query(
      `select coalesce(sum((result_payload->'market_fee'->>'fee_credits')::bigint), 0) as fees
         from public.verified_action_ledger
        where action_type = 'cc_accept_listing'
          and result_payload->'listing'->>'seller_user_id' = $1`,
      [playerId],
    );
    const { rows: soldRows } = await this.db.query(
      `select price_credits from public.market_listings
        where seller_user_id = $1 and status = 'sold'`,
      [playerId],
    );
    const { rows: endlessRows } = await this.db.query(
      'select status, depth_reached from public.endless_runs where user_id = $1',
      [playerId],
    );
    const { rows: dispatchRows } = await this.db.query(
      `select contract_family, status, payout_credits, payout_fraction
         from public.dispatch_missions where user_id = $1`,
      [playerId],
    );
    const { rows: craftRows } = await this.db.query(
      `select kind, units_completed, outputs from public.craft_jobs where owner_user_id = $1`,
      [playerId],
    );
    const { rows: serviceRows } = await this.db.query(
      `select status, points_restored, paid_credits from public.service_jobs
        where provider_user_id = $1 and profession_id = 'repair'`,
      [playerId],
    );
    const { rows: consumableRows } = await this.db.query(
      `select consumable_type, quantity_delta from public.consumable_events
        where user_id = $1 and event_type = 'used'`,
      [playerId],
    );
    const { rows: extractionRows } = await this.db.query(
      'select finalized_passes, total_xp_awarded from public.extraction_state where user_id = $1',
      [playerId],
    );
    const { rows: killRows } = await this.db.query(
      'select weapon_type, kills from public.player_kill_stats where user_id = $1',
      [playerId],
    );
    const killStats: Record<string, number> = {};
    for (const row of killRows as Row[]) killStats[String(row.weapon_type)] = num(row.kills);

    return computeProfileLifetime({
      profile: {
        legendary_cores: num(profileRow.legendary_cores),
        cache_rank_tokens: num(profileRow.cache_rank_tokens),
        cache_rank_spends: (profileRow.cache_rank_spends as Record<string, number>) ?? {},
      },
      discoveries,
      ledger: (ledgerRows as Row[]).map((row) => ({
        user_id: playerId,
        action_type: String(row.action_type),
        result_payload: foldRecord(row.result_payload),
      })),
      sellerFeesPaid: num((feeRows[0] as Row | undefined)?.fees),
      soldListings: (soldRows as Row[]).map((row) => ({ price_credits: num(row.price_credits) })),
      endlessRuns: (endlessRows as Row[]).map((row) => ({
        status: String(row.status),
        depth_reached: num(row.depth_reached),
      })),
      dispatchMissions: (dispatchRows as Row[]).map((row) => ({
        contract_family: String(row.contract_family),
        status: String(row.status),
        payout_credits: num(row.payout_credits),
        payout_fraction: row.payout_fraction === null || row.payout_fraction === undefined
          ? null
          : Number(row.payout_fraction),
      })),
      craftJobs: (craftRows as Row[]).map((row) => ({
        kind: String(row.kind),
        units_completed: num(row.units_completed),
        outputs: Array.isArray(row.outputs) ? (row.outputs as Array<Record<string, unknown>>) : [],
      })),
      serviceJobs: (serviceRows as Row[]).map((row) => ({
        status: String(row.status),
        points_restored: Number(row.points_restored ?? 0),
        paid_credits: num(row.paid_credits),
      })),
      consumableEvents: (consumableRows as Row[]).map((row) => ({
        consumable_type: String(row.consumable_type),
        quantity_delta: num(row.quantity_delta),
        event_type: 'used',
      })),
      extraction: extractionRows.length
        ? {
            finalized_passes: num((extractionRows[0] as Row).finalized_passes),
            total_xp_awarded: num((extractionRows[0] as Row).total_xp_awarded),
          }
        : null,
      killStats,
      items: await this.getMyRuntimeItems(playerId),
    });
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
