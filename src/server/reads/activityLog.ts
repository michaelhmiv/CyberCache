/**
 * Activity Log read (AL-2) — the player's unified, durable record.
 *
 * The compact feed (ActionFeed) is session state, capped at 10
 * entries; this is the other record: a projection over the server's
 * durable facts — verified_action_ledger rows, the player's own
 * item_instances (carrying AL-1's drop receipts on their payloads),
 * sold market_listings, completed craft_jobs, settled
 * dispatch_missions, and ended endless_runs. One pure projection
 * (buildActivityRecords) serves both read stores, exactly like the
 * lifetime fold: the Pg store feeds it bounded, cursor-windowed row
 * sets (see PgReadStore.getActivityLog), the in-memory store feeds
 * it its seed. Nothing here writes, and nothing is estimated:
 *
 *  - A drop's receipt (foundVia / foundContext / foundEnemy /
 *    dropOdds) is read straight off the item payload AL-1 stamped.
 *    Pre-AL-1 items carry no stamp, so their records carry
 *    receipt: null — provenance is never back-computed.
 *  - Ambient roam drops are per-tick rolls, not kill drops; their
 *    stamped relation is 'engaged' ("while fighting") and the
 *    projection never upgrades it to a kill attribution.
 *  - Roaming kills are LUMPED (owner ruling): one kills record per
 *    claim/settle stretch, with the stretch's count and area —
 *    never one record per kill.
 *  - While-away facts are marked, not merged away: everything the
 *    offline settler produced (the settlement summary, its kills
 *    lump, its earnings, and drops stamped foundVia 'offline')
 *    carries away: true.
 *  - Auto-salvage (0080) rides the same ledger rows as a manual
 *    recycle — cc_auto_salvage_claim_items recycles through
 *    cc_recycle_item itself — told apart by the derived nonce
 *    marker on the row ('autosalvage:<source>:<claim nonce>:<item
 *    id>', carried here as the row's nonce): the record is labeled
 *    as an auto-salvage, flagged salvage.auto, and marked away
 *    when the source is the offline settlement.
 *  - The trace law (owner, 2026-11-09; AL-4): every player action
 *    that creates, destroys, moves, or spends value leaves a
 *    record here. AL-4 extends the projection to the ledger rows
 *    AL-2 never read — bulk salvage, extraction settlements,
 *    reforge, standing turn-ins and rank-ups, the repair and
 *    shield-tech service boards, streak claims, cache-rank grants
 *    and spends, consumable use, vehicle refuel and the retired
 *    instant patch kit, dispatch departures / recalls / rerolls,
 *    listing creation and cancellation, craft enqueue and cancel,
 *    and loadout equip / unequip / lock changes. Each new case
 *    projects ONLY the fields its own result_payload provably
 *    carries (read from the migration chain head and the in-memory
 *    twin before the case was written); a payload that does not
 *    carry a fact produces no claim about it.
 *  - Bulk salvage (0055): the batch recycles each item through
 *    cc_recycle_item under the derived nonce '<batch nonce>:<item
 *    id>', so the per-item rows already project as salvage records;
 *    AL-4 adds the aggregate cc_recycle_batch row's own summary
 *    record and marks each per-item record salvage.batch — but
 *    ONLY when the row's nonce prefix exactly equals a
 *    cc_recycle_batch row's idempotency key in the same input.
 *    Membership is proven by the nonce, never guessed from timing.
 *  - Service-board rows (repair / shield-tech): every op records
 *    its ledger row on the ACTOR's own account — the poster on a
 *    post, the worker on an accept — so each side reads their own
 *    row; the projection never synthesizes the other side's record.
 *  - Retention is the account's whole life (owner ruling): no time
 *    cutoff exists anywhere in this module. Pagination is a cursor
 *    over (at, id), newest first, so a veteran's history is walked
 *    a page at a time and never loaded whole.
 */
import { ROAMING_AREAS } from '../../constants/roamingAreas';
import { REGION_1_BOSSES } from '../../constants/bosses';
import { CRAFTING_RECIPES } from '../../constants/craftingRecipes';
import { ALL_CRAFT_RECIPES } from '../../content/crafting';
import { sourceIdFromPayload, type DropOddsStamp } from '../dropReceipts';

// ---------------------------------------------------------------------------
// Record DTO — the wire contract AL-3 renders. One envelope, with the
// kind-specific facts under the field named for the kind.
// ---------------------------------------------------------------------------

export type ActivityRecordKind =
  | 'drop' | 'kills' | 'boss' | 'cache' | 'craft' | 'market'
  | 'earnings' | 'settlement' | 'salvage' | 'dispatch' | 'endless' | 'system'
  | 'extraction' | 'service';

/** Kind filter values: every emitted kind, plus 'away' (the away-era pseudo-kind). */
export type ActivityLogKindFilter = ActivityRecordKind | 'away';

export const ACTIVITY_KIND_FILTERS: readonly ActivityLogKindFilter[] = [
  'drop', 'kills', 'boss', 'cache', 'craft', 'market', 'earnings', 'away',
  'settlement', 'salvage', 'dispatch', 'endless', 'system',
  'extraction', 'service',
];

export interface ActivityItemSummary {
  id: string;
  name: string | null;
  kind: string | null;
  rarity: string | null;
  level: number | null;
}

/** AL-1's stamp, surfaced verbatim. Emitted only on drop records. */
export interface ActivityDropReceipt {
  foundVia: string;
  foundContext: string | number | null;
  foundEnemy: { id: string; name: string; relation: string } | null;
  dropOdds: DropOddsStamp | null;
  sourceId: string | null;
}

export interface ActivityEarnings {
  credits?: number;
  scrap?: number;
  xp?: number;
  /** Historical only: pre-0082 claims paid cache fragments. */
  fragments?: number;
  /** Whole cache keys paid (0082+ claim payloads). */
  cacheKeys?: number;
  materials?: Record<string, number>;
  essences?: Record<string, number>;
}

export interface ActivityRecord {
  /** Stable, source-prefixed: 'ledger:<uuid>', 'item:<uuid>', 'listing:<uuid>', … */
  id: string;
  kind: ActivityRecordKind;
  /** ISO timestamp of the fact. */
  at: string;
  /** True for facts the offline settler produced (the while-away chapter). */
  away: boolean;
  /** Short server-composed story line, from the record's own facts only. */
  label: string;
  item?: ActivityItemSummary;
  /** Drop records only: the AL-1 receipt, or null for pre-stamp items. */
  receipt?: ActivityDropReceipt | null;
  areaId?: string | null;
  areaName?: string | null;
  kills?: { count: number };
  earnings?: ActivityEarnings;
  /** AL-4 trace facts: kind-specific, payload-proven only. */
  extraction?: {
    passesCompleted: number;
    xpAwarded: number;
    /** Per-pass facts the settle payload carries (area, method, degradation, XP, signature units). */
    passes: Array<{
      areaId: string | null;
      areaName: string | null;
      method: string | null;
      deepDegraded: boolean | null;
      xp: number | null;
      signatureUnits: number | null;
    }>;
    materials: Record<string, number>;
    essences: Record<string, number>;
  };
  service?: {
    /** 'repair' | 'shieldtech' — the board the job belongs to. */
    board: string;
    /** The lifecycle step this row records: 'posted' | 'accepted' | 'finished' | 'cancelled' | 'reclaimed'. */
    step: string;
    /** 'poster' when the row's actor owns the job, 'worker' when they provide it. */
    role: 'poster' | 'worker';
    jobId: string | null;
    jobStatus: string | null;
    outcome: string | null;
    priceCredits: number | null;
    paidCredits: number | null;
    feeCredits: number | null;
    xpAwarded: number | null;
    pointsRestored: number | null;
    targetPoints: number | null;
    kitType: string | null;
  };
  trace?: {
    /** The ledger action_type this record projects (e.g. 'cc_reforge_item'). */
    action: string;
    /** System-family subtype for kind 'system' records; the generic sheet renders these rows. */
    facts: Array<{ label: string; value: string }>;
  };
  boss?: {
    bossId: string;
    bossName: string | null;
    victory: boolean;
    winChance: number | null;
    dedicatedChance: number | null;
    dedicatedDropAwarded: boolean | null;
    dropLuckBonus: number | null;
    creditsGained: number;
    creditsLost: number;
    loot: ActivityItemSummary[];
  };
  cache?: {
    tableId: string | null;
    outcome: string | null;
    roll: number | null;
    totalWeight: number | null;
    oddsTableVersion: number | null;
    cacheQuality: number | null;
    payment: string | null;
  };
  craft?: {
    recipeId: string;
    recipeName: string | null;
    jobKind: string;
    bench: number | null;
    unitsCompleted: number;
    unitsTotal: number | null;
    xpAwarded: number;
    outputs: Array<{ name: string | null; count: number }>;
  };
  market?: {
    direction: 'bought' | 'sold' | 'listed' | 'cancelled';
    priceCredits: number;
    feeCredits: number | null;
    /** Sold records only: the credits the seller was actually credited (price − fee + any Silver Tongue uplift), from the accept rows' own market_fee block. Null when no accept row proves it. */
    proceedsCredits?: number | null;
    counterpartyId: string | null;
    counterpartyName: string | null;
    listingId: string | null;
    /** Vendor trades name their goods by catalog key (no item instance exists). */
    goodsKey?: string | null;
    quantity?: number | null;
    /** AL-4 lifecycle facts: the listing's kind on create/cancel rows. */
    listingKind?: string | null;
  };
  settlement?: {
    elapsedMs: number | null;
    capHours: number | null;
    capReached: boolean | null;
    ticks: number | null;
  };
  salvage?: {
    scrapAward: number;
    coresAward: number;
    auto?: boolean;
    /** True when this record belongs to a bulk-salvage batch (summary row, or a per-item row whose nonce prefix exactly matches a batch row's key). */
    batch?: boolean;
    /** Summary records only: the batch's own totals, from cc_recycle_batch's payload. */
    scrappedCount?: number;
    maxRarity?: string | null;
    countsByRarity?: Record<string, number>;
    bonusMaterials?: Record<string, number>;
  };
  dispatch?: {
    family: string;
    payoutCredits: number;
    payoutFraction: number | null;
    /** AL-4 lifecycle facts: 'settled' for the domain-row record; 'departed' | 'recalled' | 'rerolled' for ledger lifecycle rows. */
    step?: string;
    areaId?: string | null;
    areaName?: string | null;
    durationHours?: number | null;
    scrapAward?: number | null;
    materialUnits?: number | null;
    rerollCredits?: number | null;
  };
  endless?: { status: string; depthReached: number };
  system?: { subtype: string };
}

export interface ActivityLogQuery {
  kinds?: ActivityLogKindFilter[];
  /** One search box: matches item names, enemy names, area names (and boss / recipe / counterparty names) together. */
  q?: string;
  /** Opaque cursor from a previous page's nextCursor. */
  cursor?: string;
  limit?: number;
}

export interface ActivityLogPage {
  records: ActivityRecord[];
  /** Cursor for the next page, or null at the end of the record. */
  nextCursor: string | null;
  limit: number;
}

export const ACTIVITY_LOG_DEFAULT_LIMIT = 30;
export const ACTIVITY_LOG_MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Raw rows — one shape for both stores (the lifetime fold's pattern).
// ---------------------------------------------------------------------------

export interface ActivityLedgerRow {
  id: string;
  action_type: string;
  result_payload: Record<string, unknown>;
  created_at: string;
  /** The row's idempotency key (verified_action_ledger.idempotency_key), when the store carries it. */
  nonce?: string | null;
}

export interface ActivityItemRow {
  id: string;
  kind: string | null;
  rarity: string | null;
  item_level: number | null;
  runtime_state: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ActivityListingRow {
  id: string;
  item_instance_id: string | null;
  price_credits: number;
  sold_at: string;
  listing_kind: string | null;
  display_name: string | null;
  rarity: string | null;
  item_level: number | null;
}

export interface ActivityCraftJobRow {
  id: string;
  kind: string;
  recipe_id: string;
  bench: number | null;
  units_total: number;
  units_completed: number;
  outputs: Array<Record<string, unknown>>;
  xp_awarded: number;
  completed_at: string;
}

export interface ActivityDispatchRow {
  id: string;
  contract_family: string;
  payout_credits: number;
  payout_fraction: number | null;
  departed_at: string | null;
  settled_at: string;
}

export interface ActivityEndlessRow {
  id: string;
  status: string;
  depth_reached: number;
  started_at: string | null;
  ended_at: string;
}

export interface ActivityRawInput {
  ledger: ActivityLedgerRow[];
  items: ActivityItemRow[];
  soldListings: ActivityListingRow[];
  craftJobs: ActivityCraftJobRow[];
  dispatchMissions: ActivityDispatchRow[];
  endlessRuns: ActivityEndlessRow[];
  /** Item ids this player gained by buying (their own accept/quickbuy rows) — purchases are market records, never drops. */
  purchasedItemIds: ReadonlySet<string>;
  /** Item ids created by this player's cache draws (cache_box_openings) — the cache record tells their story. */
  cacheItemIds: ReadonlySet<string>;
  /** Hunter display names by user id, for market counterparties. */
  names: ReadonlyMap<string, string>;
  /** Per sold listing, the facts that live only in the buyer's accept row: the fee, the buyer, and the proceeds the seller was actually credited (summed across partial-fill legs). */
  saleFacts: ReadonlyMap<string, { feeCredits: number | null; buyerId: string | null; proceedsCredits: number | null }>;
}

export function emptyActivityInput(): ActivityRawInput {
  return {
    ledger: [], items: [], soldListings: [], craftJobs: [], dispatchMissions: [], endlessRuns: [],
    purchasedItemIds: new Set(), cacheItemIds: new Set(), names: new Map(), saleFacts: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Small json helpers (record-local, the reads layer's idiom).
// ---------------------------------------------------------------------------

function rec(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

// ---------------------------------------------------------------------------
// Name resolution — content facts, resolved from the same catalogs the
// Chef and the client read. Unknown ids resolve to null, never a guess.
// ---------------------------------------------------------------------------

const AREA_NAMES = new Map(ROAMING_AREAS.map((a) => [a.id, a.name]));
const BOSS_NAMES = new Map(REGION_1_BOSSES.map((b) => [b.id, b.name]));

/** Extraction pass methods in player words (0033: the method enum is 'surface' | 'deep'). */
function extractionMethodLabel(method: string | null): string | null {
  if (method === 'surface') return 'Surface';
  if (method === 'deep') return 'Deep Delve';
  return method;
}

/** A count map off a payload object — only finite non-zero numbers survive. */
function countMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(raw))) {
    const n = num(v);
    if (n !== 0) out[k] = n;
  }
  return out;
}
const RECIPE_NAMES = new Map<string, string>();
for (const recipe of ALL_CRAFT_RECIPES) RECIPE_NAMES.set(recipe.id, recipe.name);
for (const recipe of CRAFTING_RECIPES) if (!RECIPE_NAMES.has(recipe.id)) RECIPE_NAMES.set(recipe.id, recipe.name);

export function activityAreaName(areaId: string | null): string | null {
  return areaId ? (AREA_NAMES.get(areaId) ?? null) : null;
}

export function activityBossName(bossId: string | null): string | null {
  return bossId ? (BOSS_NAMES.get(bossId) ?? null) : null;
}

export function activityRecipeName(recipeId: string | null): string | null {
  return recipeId ? (RECIPE_NAMES.get(recipeId) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Projection helpers.
// ---------------------------------------------------------------------------

/** Item summary from either an item_instances row shape or a bare item payload. */
function itemSummary(raw: unknown, fallbackId?: string | null): ActivityItemSummary | null {
  const row = rec(raw);
  const payload = rec(row.payload);
  const id = str(row.id) ?? str(payload.id) ?? fallbackId ?? null;
  if (!id) return null;
  return {
    id,
    name: str(payload.name) ?? str(row.name) ?? str(row.display_name),
    kind: str(row.kind) ?? str(payload.kind) ?? (typeof payload.weaponType === 'string' ? 'weapon' : null),
    rarity: str(row.rarity) ?? str(payload.rarity),
    level: numOrNull(row.item_level) ?? numOrNull(payload.level) ?? numOrNull(payload.item_level),
  };
}

/** The AL-1 receipt off an item payload, or null when the payload is unstamped. */
function receiptFromPayload(payload: Record<string, unknown>): ActivityDropReceipt | null {
  const foundVia = str(payload.foundVia);
  if (!foundVia) return null;
  const enemy = rec(payload.foundEnemy);
  const context = payload.foundContext;
  return {
    foundVia,
    foundContext: typeof context === 'string' || typeof context === 'number' ? context : null,
    foundEnemy: str(enemy.id) && str(enemy.name)
      ? { id: String(enemy.id), name: String(enemy.name), relation: str(enemy.relation) ?? 'engaged' }
      : null,
    dropOdds: payload.dropOdds !== null && typeof payload.dropOdds === 'object'
      ? (payload.dropOdds as DropOddsStamp)
      : null,
    sourceId: sourceIdFromPayload(payload),
  };
}

/** Currency deltas from a claim/settle rewards object (both key spellings). */
function earningsFromRewards(rewards: Record<string, unknown>): ActivityEarnings | null {
  const out: ActivityEarnings = {};
  const credits = num(rewards.credits ?? rewards.credits_awarded);
  const scrap = num(rewards.scrap ?? rewards.scrap_awarded);
  const xp = num(rewards.xp ?? rewards.xp_awarded);
  const fragments = num(rewards.fragments ?? rewards.cache_fragments_awarded);
  const cacheKeys = num(rewards.keys ?? rewards.cache_keys_awarded);
  if (credits !== 0) out.credits = credits;
  if (scrap !== 0) out.scrap = scrap;
  if (xp !== 0) out.xp = xp;
  // Pre-0082 claim payloads paid fragments; the fold keeps reading
  // them so historical records stay truthful. New payloads pay
  // whole cache keys instead.
  if (fragments !== 0) out.fragments = fragments;
  if (cacheKeys !== 0) out.cacheKeys = cacheKeys;
  const materials = rec(rewards.materials);
  const essences = rec(rewards.essences);
  const matOut: Record<string, number> = {};
  for (const [k, v] of Object.entries(materials)) if (num(v) !== 0) matOut[k] = num(v);
  const essOut: Record<string, number> = {};
  for (const [k, v] of Object.entries(essences)) if (num(v) !== 0) essOut[k] = num(v);
  if (Object.keys(matOut).length) out.materials = matOut;
  if (Object.keys(essOut).length) out.essences = essOut;
  return Object.keys(out).length ? out : null;
}

function earningsLabel(earnings: ActivityEarnings): string {
  const parts: string[] = [];
  if (earnings.credits) parts.push(`${earnings.credits > 0 ? '+' : ''}${earnings.credits} cr`);
  if (earnings.scrap) parts.push(`${earnings.scrap > 0 ? '+' : ''}${earnings.scrap} scrap`);
  if (earnings.xp) parts.push(`+${earnings.xp} XP`);
  if (earnings.fragments) parts.push(`+${earnings.fragments} fragments`);
  if (earnings.cacheKeys) parts.push(`+${earnings.cacheKeys} cache key${earnings.cacheKeys === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// The projection. Input rows are the caller's OWN rows only (both
// stores scope by user before projecting); output is unsorted —
// queryActivityRecords owns ordering, filtering, and pagination.
// ---------------------------------------------------------------------------

export function buildActivityRecords(input: ActivityRawInput): ActivityRecord[] {
  const records: ActivityRecord[] = [];
  const itemsById = new Map(input.items.map((item) => [item.id, item]));

  // Boss loot explained by an attempt in this row set: the boss
  // record carries it, so the item row must not also pose as a drop.
  const bossLootIds = new Set<string>();
  for (const row of input.ledger) {
    if (row.action_type !== 'cc_apply_boss_attempt') continue;
    const loot = rec(row.result_payload).attempt;
    const ids = rec(loot).loot;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') bossLootIds.add(id);
  }

  // Bulk-salvage batch keys (AL-4): the idempotency keys of this
  // input's cc_recycle_batch rows. A per-item recycle row belongs
  // to a batch ONLY when its nonce, split at the last ':', leaves
  // exactly one of these keys — the 0055 derived-nonce proof.
  const batchKeys = new Set<string>();
  for (const row of input.ledger) {
    if (row.action_type === 'cc_recycle_batch' && typeof row.nonce === 'string' && row.nonce) {
      batchKeys.add(row.nonce);
    }
  }
  const isBatchDerived = (nonce: string | null | undefined): boolean => {
    if (typeof nonce !== 'string' || !nonce || nonce.startsWith('autosalvage:')) return false;
    const cut = nonce.lastIndexOf(':');
    return cut > 0 && batchKeys.has(nonce.slice(0, cut));
  };

  for (const row of input.ledger) {
    const payload = rec(row.result_payload);
    const at = row.created_at;
    switch (row.action_type) {
      case 'cc_apply_chef_rewards':
      case 'cc_settle_offline_roaming': {
        const away = row.action_type === 'cc_settle_offline_roaming';
        const areaId = str(payload.area_id);
        const areaName = activityAreaName(areaId);
        const rewards = rec(payload.rewards);
        if (away) {
          records.push({
            id: `ledger:${row.id}`,
            kind: 'settlement',
            at,
            away: true,
            label: `While you were away — ${areaName ?? 'Roaming'}`,
            areaId,
            areaName,
            settlement: {
              elapsedMs: numOrNull(payload.elapsed_ms),
              capHours: numOrNull(payload.cap_hours),
              capReached: boolOrNull(payload.cap_reached),
              ticks: numOrNull(rewards.ticks) ?? numOrNull(payload.ticks),
            },
          });
        }
        const kills = num(rewards.kills_recorded);
        if (kills > 0) {
          records.push({
            id: `ledger:${row.id}#kills`,
            kind: 'kills',
            at,
            away,
            label: `${kills} kills — ${areaName ?? 'Roaming'}`,
            areaId,
            areaName,
            kills: { count: kills },
          });
        }
        const earnings = earningsFromRewards(rewards);
        if (earnings) {
          records.push({
            id: `ledger:${row.id}#earnings`,
            kind: 'earnings',
            at,
            away,
            label: `${away ? 'While you were away' : 'Roaming claim'} — ${earningsLabel(earnings)}`,
            areaId,
            areaName,
            earnings,
          });
        }
        break;
      }
      case 'cc_apply_boss_attempt': {
        const attempt = rec(payload.attempt);
        const bossId = str(payload.boss_id) ?? str(attempt.boss_id) ?? '';
        const bossName = activityBossName(bossId);
        const victory = attempt.victory === true;
        const lootIds = Array.isArray(attempt.loot) ? attempt.loot : [];
        const loot: ActivityItemSummary[] = [];
        for (const lootId of lootIds) {
          if (typeof lootId !== 'string') continue;
          const itemRow = itemsById.get(lootId);
          const summary = itemRow
            ? itemSummary({ id: itemRow.id, kind: itemRow.kind, rarity: itemRow.rarity, item_level: itemRow.item_level, payload: itemRow.payload })
            : null;
          loot.push(summary ?? { id: lootId, name: null, kind: null, rarity: null, level: null });
        }
        records.push({
          id: `ledger:${row.id}`,
          kind: 'boss',
          at,
          away: false,
          label: `${bossName ?? 'Boss'} — ${victory ? 'victory' : 'defeat'}`,
          boss: {
            bossId,
            bossName,
            victory,
            winChance: numOrNull(attempt.winChance),
            dedicatedChance: numOrNull(attempt.dedicatedChance),
            dedicatedDropAwarded: boolOrNull(attempt.dedicatedDropAwarded),
            dropLuckBonus: numOrNull(attempt.dropLuckBonus),
            creditsGained: num(attempt.creditsGained),
            creditsLost: num(attempt.creditsLost),
            loot,
          },
        });
        break;
      }
      case 'cc_make_item': {
        const odds = rec(payload.odds);
        const item = itemSummary(payload.item);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'cache',
          at,
          away: false,
          label: `Cache — ${item?.name ?? str(odds.outcome) ?? 'opened'}`,
          ...(item ? { item } : {}),
          cache: {
            tableId: str(odds.table_id),
            outcome: str(odds.outcome),
            roll: numOrNull(odds.roll),
            totalWeight: numOrNull(odds.total_weight),
            oddsTableVersion: numOrNull(odds.odds_table_version),
            cacheQuality: numOrNull(payload.cache_quality) ?? numOrNull(odds.cache_quality),
            payment: str(payload.payment),
          },
        });
        break;
      }
      case 'cc_recycle_item': {
        const item = itemSummary(payload.item);
        // Auto-salvage (0080): the settlement pass recycles through
        // this same function under the derived nonce marker
        // 'autosalvage:<source>:<claim nonce>:<item id>' — the
        // marker is the only thing that tells a rule-driven salvage
        // from a deliberate one, so the record names it and the
        // offline source marks the record away-era.
        const autoSource = typeof row.nonce === 'string' && row.nonce.startsWith('autosalvage:')
          ? row.nonce.split(':')[1]
          : null;
        const inBatch = !autoSource && isBatchDerived(row.nonce);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'salvage',
          at,
          away: autoSource === 'offline',
          label: autoSource
            ? `Auto-salvaged ${item?.name ?? 'item'}`
            : `Salvaged ${item?.name ?? 'item'}`,
          ...(item ? { item } : {}),
          salvage: {
            scrapAward: num(payload.scrap_award),
            coresAward: num(payload.cores_award),
            ...(autoSource ? { auto: true } : {}),
            ...(inBatch ? { batch: true } : {}),
          },
        });
        break;
      }
      case 'cc_recycle_batch': {
        // Bulk salvage (0055; AL-4 spec item 1): ONE summary record
        // from the batch row's own payload. The per-item rows it
        // drove project separately (marked salvage.batch above);
        // this record states the aggregate and nothing more.
        const count = num(payload.scrapped_count);
        const maxRarity = str(payload.max_rarity);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'salvage',
          at,
          away: false,
          label: `Bulk salvage — ${count} item${count === 1 ? '' : 's'}${maxRarity ? ` (${maxRarity} and under)` : ''}`,
          salvage: {
            scrapAward: num(payload.scrap_award),
            coresAward: num(payload.cores_award),
            batch: true,
            scrappedCount: count,
            maxRarity,
            countsByRarity: countMap(payload.counts_by_rarity),
            bonusMaterials: countMap(payload.bonus_materials),
          },
        });
        break;
      }
      case 'cc_apply_extraction': {
        // Extraction settlement (0033; AL-4 spec item 2). The
        // payload carries batch totals + a per-pass list; mastery
        // XP is a flat per-pass award the payload does NOT carry,
        // so no mastery figure is claimed. Degraded deep passes
        // read as the Surface passes they paid as.
        const passesRaw = Array.isArray(payload.passes) ? payload.passes : [];
        const passes = passesRaw.map((raw) => {
          const p = rec(raw);
          const areaId = str(p.area_id);
          const degraded = boolOrNull(p.deep_degraded);
          return {
            areaId,
            areaName: activityAreaName(areaId),
            method: degraded === true ? 'surface' : str(p.method),
            deepDegraded: degraded,
            xp: numOrNull(p.xp),
            signatureUnits: numOrNull(p.signature_units),
          };
        });
        const count = num(payload.passes_completed) || passes.length;
        const distinctAreas = [...new Set(passes.map((p) => p.areaName).filter(Boolean))];
        const areaPart = distinctAreas.length === 1
          ? ` — ${distinctAreas[0]}`
          : distinctAreas.length > 1 ? ` — ${distinctAreas.length} areas` : '';
        const methods = [...new Set(passes.map((p) => extractionMethodLabel(p.method)).filter(Boolean))];
        records.push({
          id: `ledger:${row.id}`,
          kind: 'extraction',
          at,
          away: false,
          label: `Extraction — ${count} pass${count === 1 ? '' : 'es'}${methods.length === 1 ? ` (${methods[0]})` : ''}${areaPart}`,
          ...(passes.length === 1 && passes[0].areaId ? { areaId: passes[0].areaId, areaName: passes[0].areaName } : {}),
          extraction: {
            passesCompleted: count,
            xpAwarded: num(payload.xp_awarded),
            passes,
            materials: countMap(payload.finds_materials),
            essences: countMap(payload.finds_essences),
          },
        });
        break;
      }
      case 'cc_reforge_item': {
        const item = itemSummary(payload.item);
        const oldAffix = rec(payload.old_affix);
        const newAffix = rec(payload.new_affix);
        const facts: Array<{ label: string; value: string }> = [];
        if (str(oldAffix.id) || str(newAffix.id)) {
          facts.push({ label: 'Affix', value: `${str(oldAffix.id) ?? '—'} → ${str(newAffix.id) ?? '—'}` });
        }
        facts.push({ label: 'Scrap charged', value: `${num(payload.scrap_charged)}` });
        if (num(payload.cores_charged) > 0) facts.push({ label: 'Cores charged', value: `${num(payload.cores_charged)}` });
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Reforged ${item?.name ?? 'item'}`,
          ...(item ? { item } : {}),
          system: { subtype: 'reforge' },
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_turn_in_item': {
        const item = itemSummary(payload.item);
        const manufacturer = str(payload.manufacturer);
        const facts: Array<{ label: string; value: string }> = [];
        if (manufacturer) facts.push({ label: 'Manufacturer', value: manufacturer });
        facts.push({ label: 'Standing awarded', value: `+${num(payload.standing_awarded)}` });
        if (numOrNull(payload.new_balance) !== null) facts.push({ label: 'Standing balance', value: `${num(payload.new_balance)}` });
        if (numOrNull(payload.rank) !== null) facts.push({ label: 'Rank', value: `${num(payload.rank)}` });
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Turned in ${item?.name ?? 'item'}${manufacturer ? ` — ${manufacturer}` : ''}`,
          ...(item ? { item } : {}),
          system: { subtype: 'turn_in' },
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_rank_up_manufacturer': {
        const manufacturer = str(payload.manufacturer);
        const tributeItem = itemSummary(payload.item);
        const facts: Array<{ label: string; value: string }> = [];
        if (manufacturer) facts.push({ label: 'Manufacturer', value: manufacturer });
        facts.push({ label: 'New rank', value: `${num(payload.new_rank)}` });
        if (num(payload.tribute_credits) > 0) facts.push({ label: 'Tribute', value: `${num(payload.tribute_credits)} cr` });
        if (tributeItem?.name) facts.push({ label: 'Tribute item', value: tributeItem.name });
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Ranked up — ${manufacturer ?? 'manufacturer'} rank ${num(payload.new_rank)}`,
          ...(tributeItem ? { item: tributeItem } : {}),
          system: { subtype: 'rank_up' },
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_post_repair_job':
      case 'cc_accept_repair_job':
      case 'cc_repair_job_finish':
      case 'cc_repair_job_cancel':
      case 'cc_repair_job_reclaim':
      case 'cc_post_shieldtech_job':
      case 'cc_accept_shieldtech_job':
      case 'cc_shieldtech_job_finish':
      case 'cc_shieldtech_job_cancel':
      case 'cc_shieldtech_job_reclaim': {
        // Service boards (0025 repair / 0044 shield-tech; AL-4 spec
        // item 5). Facts ride the row's `job` snapshot (the full
        // service_jobs row as settled at op time) + the post ops'
        // top-level `item`. The actor is the row's owner by
        // construction: poster on post, worker on accept/finish,
        // either on cancel, owner on reclaim.
        const shield = row.action_type.includes('shieldtech');
        const board = shield ? 'shieldtech' : 'repair';
        const step = row.action_type.includes('_post_') ? 'posted'
          : row.action_type.includes('_accept_') ? 'accepted'
            : row.action_type.includes('_finish') ? 'finished'
              : row.action_type.includes('_cancel') ? 'cancelled' : 'reclaimed';
        const job = rec(payload.job);
        const ownerId = str(job.owner_user_id);
        const providerId = str(job.provider_user_id);
        // The counterparty of a post op targeting one's OWN gear is
        // oneself; post rows carry the item inline, accept+ rows
        // resolve it from the item rows when present.
        const targetId = str(job.target_item_instance_id);
        const itemRow = targetId ? itemsById.get(targetId) : undefined;
        const item = itemSummary(payload.item)
          ?? (itemRow ? itemSummary({
            id: itemRow.id, kind: itemRow.kind, rarity: itemRow.rarity,
            item_level: itemRow.item_level, payload: itemRow.payload,
          }) : null);
        const role: 'poster' | 'worker' = step === 'posted' || step === 'reclaimed'
          ? 'poster'
          : step === 'accepted' || step === 'finished'
            ? 'worker'
            : (providerId && providerId !== ownerId ? 'worker' : 'poster');
        const boardLabel = shield ? 'Shield tech' : 'Repair';
        const stepLabel = step === 'posted' ? (shield ? 'Recalibration posted' : 'Repair posted')
          : step === 'accepted' ? (shield ? 'Recalibration accepted' : 'Repair accepted')
            : step === 'finished' ? (shield ? 'Recalibration finished' : 'Repair finished')
              : step === 'cancelled' ? (shield ? 'Recalibration cancelled' : 'Repair cancelled')
                : (shield ? 'Recalibration reclaimed' : 'Repair reclaimed');
        records.push({
          id: `ledger:${row.id}`,
          kind: 'service',
          at,
          away: false,
          label: `${stepLabel} — ${item?.name ?? (shield ? 'shield' : 'vehicle')}`,
          ...(item ? { item } : {}),
          service: {
            board,
            step,
            role,
            jobId: str(job.id),
            jobStatus: str(job.status),
            outcome: str(job.outcome),
            priceCredits: numOrNull(job.quoted_price_credits),
            paidCredits: numOrNull(job.paid_credits),
            feeCredits: numOrNull(job.fee_credits),
            xpAwarded: numOrNull(job.xp_awarded),
            pointsRestored: numOrNull(job.points_restored),
            targetPoints: numOrNull(job.target_points),
            kitType: str(job.kit_type),
          },
          trace: { action: row.action_type, facts: [{ label: 'Board', value: boardLabel }] },
        });
        break;
      }
      case 'cc_login_streak_claim': {
        // 0079: the ledger row lands at CLAIM time and pays; rows
        // with already_claimed true are replays that paid nothing
        // and mint no record.
        if (payload.already_claimed === true) break;
        const cycleDay = num(payload.cycle_day);
        const facts: Array<{ label: string; value: string }> = [];
        facts.push({ label: 'Streak day', value: `${cycleDay}` });
        if (num(payload.streak_length) > 0) facts.push({ label: 'Streak length', value: `${num(payload.streak_length)} days` });
        if (str(payload.tier)) facts.push({ label: 'Tier', value: String(payload.tier) });
        if (num(payload.credits_awarded) > 0) facts.push({ label: 'Credits', value: `+${num(payload.credits_awarded)} cr` });
        if (num(payload.cache_keys_awarded) > 0) facts.push({ label: 'Cache keys', value: `+${num(payload.cache_keys_awarded)}` });
        if (num(payload.fragments_awarded) > 0) facts.push({ label: 'Cache fragments', value: `+${num(payload.fragments_awarded)}` });
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Streak claimed — day ${cycleDay}`,
          system: { subtype: 'streak_claim' },
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_cache_rank_grant': {
        const facts: Array<{ label: string; value: string }> = [
          { label: 'Tokens granted', value: `+${num(payload.tokens_granted)}` },
        ];
        if (numOrNull(payload.from_level) !== null && numOrNull(payload.to_level) !== null) {
          facts.push({ label: 'Levels', value: `${num(payload.from_level)} → ${num(payload.to_level)}` });
        }
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Cache Rank — +${num(payload.tokens_granted)} tokens`,
          system: { subtype: 'cache_rank_grant' },
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_cache_rank_spend': {
        const facts: Array<{ label: string; value: string }> = [];
        if (str(payload.bonus_id)) facts.push({ label: 'Bonus', value: String(payload.bonus_id) });
        if (numOrNull(payload.rank_after) !== null) facts.push({ label: 'Rank', value: `${num(payload.rank_after)}` });
        facts.push({ label: 'Tokens spent', value: `${num(payload.cost)}` });
        if (numOrNull(payload.tokens) !== null) facts.push({ label: 'Tokens left', value: `${num(payload.tokens)}` });
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Cache Rank — ${str(payload.bonus_id) ?? 'bonus'} rank ${num(payload.rank_after)}`,
          system: { subtype: 'cache_rank_spend' },
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_consume_consumable': {
        const itemKey = str(payload.item_key);
        const qty = num(payload.quantity) || 1;
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Used ${itemKey ?? 'consumable'}${qty > 1 ? ` ×${qty}` : ''}`,
          system: { subtype: 'consume' },
          trace: {
            action: row.action_type,
            facts: [
              { label: 'Consumable', value: itemKey ?? '—' },
              { label: 'Quantity', value: `${qty}` },
            ],
          },
        });
        break;
      }
      case 'cc_refuel_vehicle': {
        // 0021/0024: the payload names no vehicle (fuel is a profile
        // pool) — the record claims cells and units only.
        const facts: Array<{ label: string; value: string }> = [
          { label: 'Cells loaded', value: `${num(payload.cells_loaded)}` },
          { label: 'Fuel added', value: `+${num(payload.fuel_units_added)} units` },
        ];
        if (numOrNull(payload.vehicle_fuel) !== null) facts.push({ label: 'Tank after', value: `${num(payload.vehicle_fuel)} units` });
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Refueled — +${num(payload.fuel_units_added)} fuel`,
          system: { subtype: 'refuel' },
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_use_patch_kit': {
        // Retired in 0025 (replaced by timed self-repair jobs) —
        // historical rows only. The payload carries the vehicle and
        // the condition it restored to.
        const item = itemSummary(payload.item);
        const facts: Array<{ label: string; value: string }> = [];
        if (num(payload.restored) > 0) facts.push({ label: 'Condition restored', value: `+${num(payload.restored)}` });
        if (numOrNull(payload.condition_current) !== null) {
          facts.push({ label: 'Condition', value: `${num(payload.condition_current)}${numOrNull(payload.condition_max) !== null ? ` / ${num(payload.condition_max)}` : ''}` });
        }
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Patch kit — ${item?.name ?? 'vehicle'}`,
          ...(item ? { item } : {}),
          system: { subtype: 'patch_kit' },
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_dispatch_depart': {
        const mission = rec(payload.mission);
        const family = str(mission.contract_family) ?? 'dispatch';
        const areaId = str(mission.destination_area_id);
        const areaName = activityAreaName(areaId);
        const duration = numOrNull(mission.duration_hours);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'dispatch',
          at,
          away: false,
          label: `Dispatch departed — ${family}${areaName ? ` to ${areaName}` : ''}`,
          dispatch: {
            family,
            payoutCredits: num(mission.payout_credits),
            payoutFraction: null,
            step: 'departed',
            areaId,
            areaName,
            durationHours: duration,
          },
        });
        break;
      }
      case 'cc_dispatch_settle': {
        // The settle row behind a term settlement or a recall (the
        // dispatch_missions domain record keeps its own settled
        // record). A recall is named as one — it paid pro-rata.
        const recalled = payload.recalled === true;
        const family = str(payload.family) ?? 'dispatch';
        const payout = rec(payload.payout);
        const areaId = str(payload.area_id);
        const areaName = activityAreaName(areaId);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'dispatch',
          at,
          away: false,
          label: recalled ? `Dispatch recalled — ${family}` : `Dispatch settled — ${family}`,
          dispatch: {
            family,
            payoutCredits: num(payout.credits),
            payoutFraction: numOrNull(payload.fraction),
            step: recalled ? 'recalled' : 'settled',
            areaId,
            areaName,
            durationHours: numOrNull(payload.duration_hours),
            scrapAward: numOrNull(payout.scrap),
            materialUnits: numOrNull(payout.material_units),
          },
        });
        break;
      }
      case 'cc_reroll_dispatch_board': {
        const facts: Array<{ label: string; value: string }> = [
          { label: 'Credits charged', value: `${num(payload.credits_charged)} cr` },
        ];
        if (numOrNull(payload.board_index) !== null) facts.push({ label: 'Board', value: `#${num(payload.board_index)}` });
        if (numOrNull(payload.rerolls_remaining) !== null) facts.push({ label: 'Rerolls left', value: `${num(payload.rerolls_remaining)}` });
        records.push({
          id: `ledger:${row.id}`,
          kind: 'dispatch',
          at,
          away: false,
          label: `Dispatch board rerolled — ${num(payload.credits_charged)} cr`,
          dispatch: {
            family: 'board',
            payoutCredits: 0,
            payoutFraction: null,
            step: 'rerolled',
            rerollCredits: num(payload.credits_charged),
          },
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_market_create': {
        const listing = rec(payload.listing);
        const item = itemSummary(payload.item)
          ?? itemSummary({ id: str(listing.item_instance_id), display_name: str(listing.display_name), rarity: str(listing.rarity), item_level: numOrNull(listing.item_level), kind: str(listing.listing_kind) });
        const goodsKey = str(listing.consumable_type) ?? str(listing.material_id) ?? str(listing.essence_id);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'market',
          at,
          away: false,
          label: `Listed ${item?.name ?? (goodsKey ?? 'goods')} — ${num(listing.price_credits)} cr`,
          ...(item ? { item } : {}),
          market: {
            direction: 'listed',
            priceCredits: num(listing.price_credits),
            feeCredits: null,
            counterpartyId: null,
            counterpartyName: null,
            listingId: str(listing.id),
            goodsKey,
            quantity: numOrNull(listing.quantity),
            listingKind: str(listing.listing_kind),
          },
        });
        break;
      }
      case 'cc_market_cancel': {
        const listing = rec(payload.listing);
        const item = itemSummary(payload.item)
          ?? itemSummary({ id: str(listing.item_instance_id), display_name: str(listing.display_name), rarity: str(listing.rarity), item_level: numOrNull(listing.item_level), kind: str(listing.listing_kind) });
        const goodsKey = str(listing.consumable_type) ?? str(listing.material_id) ?? str(listing.essence_id);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'market',
          at,
          away: false,
          label: `Listing cancelled — ${item?.name ?? (goodsKey ?? 'goods')}`,
          ...(item ? { item } : {}),
          market: {
            direction: 'cancelled',
            priceCredits: num(listing.price_credits),
            feeCredits: null,
            counterpartyId: null,
            counterpartyName: null,
            listingId: str(listing.id),
            goodsKey,
            quantity: numOrNull(listing.quantity),
            listingKind: str(listing.listing_kind),
          },
        });
        break;
      }
      case 'cc_enqueue_craft_job':
      case 'cc_enqueue_tint_job': {
        const job = rec(payload.job);
        const recipeId = str(job.recipe_id) ?? str(job.recipeId) ?? '';
        const recipeName = activityRecipeName(recipeId || null);
        const units = numOrNull(job.units) ?? numOrNull(job.units_total);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'craft',
          at,
          away: false,
          label: `${recipeName ?? recipeId ?? 'Craft'} — queued`,
          craft: {
            recipeId,
            recipeName,
            jobKind: str(job.kind) ?? 'craft',
            bench: numOrNull(job.bench),
            unitsCompleted: 0,
            unitsTotal: units,
            xpAwarded: 0,
            outputs: [],
          },
          trace: {
            action: row.action_type,
            facts: [
              { label: 'Step', value: 'Queued' },
              ...(units !== null ? [{ label: 'Units', value: `${units}` }] : []),
            ],
          },
        });
        break;
      }
      case 'cc_cancel_craft_job': {
        const facts: Array<{ label: string; value: string }> = [{ label: 'Step', value: 'Cancelled' }];
        const refunded = rec(payload.refunded_inputs);
        for (const [name, count] of Object.entries(countMap(refunded))) {
          facts.push({ label: `Refunded ${name}`, value: `${count}` });
        }
        if (num(payload.cores_refunded) > 0) facts.push({ label: 'Cores refunded', value: `${num(payload.cores_refunded)}` });
        if (payload.rush_ticket_refunded === true) facts.push({ label: 'Rush ticket', value: 'Refunded' });
        records.push({
          id: `ledger:${row.id}`,
          kind: 'craft',
          at,
          away: false,
          label: 'Craft cancelled — inputs refunded',
          trace: { action: row.action_type, facts },
        });
        break;
      }
      case 'cc_equip_item': {
        const item = itemSummary(payload.item);
        const itemRow = rec(payload.item);
        // The slot lives on the item row's own column, not inside
        // its JSON payload (0050 column layout).
        const equippedSlot = str(itemRow.equipped_slot);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `Equipped ${item?.name ?? 'item'}`,
          ...(item ? { item } : {}),
          system: { subtype: 'equip' },
          trace: {
            action: row.action_type,
            facts: equippedSlot ? [{ label: 'Slot', value: equippedSlot }] : [],
          },
        });
        break;
      }
      case 'cc_unequip_slot': {
        const item = itemSummary(payload.item);
        const slotName = str(payload.slot_name);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: item ? `Unequipped ${item.name}` : `Unequipped ${slotName ?? 'slot'}`,
          ...(item ? { item } : {}),
          system: { subtype: 'unequip' },
          trace: {
            action: row.action_type,
            facts: slotName ? [{ label: 'Slot', value: slotName }] : [],
          },
        });
        break;
      }
      case 'cc_item_lock': {
        const item = itemSummary(payload.item);
        const locked = rec(payload.item).is_locked === true;
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: `${locked ? 'Locked' : 'Unlocked'} ${item?.name ?? 'item'}`,
          ...(item ? { item } : {}),
          system: { subtype: locked ? 'lock' : 'unlock' },
          trace: { action: row.action_type, facts: [] },
        });
        break;
      }
      case 'cc_accept_listing':
      case 'cc_quickbuy_fill': {
        const listing = rec(payload.listing);
        const fee = rec(payload.market_fee);
        const sellerId = str(listing.seller_user_id);
        const sellerName = sellerId ? (input.names.get(sellerId) ?? null) : null;
        const item = itemSummary(payload.item)
          ?? itemSummary({ id: str(listing.item_instance_id), display_name: str(listing.display_name), rarity: str(listing.rarity), item_level: numOrNull(listing.item_level), kind: str(listing.listing_kind) });
        records.push({
          id: `ledger:${row.id}`,
          kind: 'market',
          at,
          away: false,
          label: `Bought ${item?.name ?? 'goods'} from ${sellerName ?? 'the market'}`,
          ...(item ? { item } : {}),
          market: {
            direction: 'bought',
            priceCredits: num(listing.price_credits),
            feeCredits: numOrNull(fee.fee_credits),
            counterpartyId: sellerId,
            counterpartyName: sellerName,
            listingId: str(listing.id),
          },
        });
        break;
      }
      case 'cc_vendor_buy':
      case 'cc_vendor_sell': {
        const bought = row.action_type === 'cc_vendor_buy';
        const item = itemSummary(payload.item);
        records.push({
          id: `ledger:${row.id}`,
          kind: 'market',
          at,
          away: false,
          label: bought ? 'Bought from the Vendor' : 'Sold to the Vendor',
          ...(item ? { item } : {}),
          market: {
            direction: bought ? 'bought' : 'sold',
            priceCredits: num(payload.total_price ?? payload.total_payout),
            feeCredits: null,
            counterpartyId: null,
            counterpartyName: 'Vendor',
            listingId: null,
            goodsKey: str(payload.item_key),
            quantity: numOrNull(payload.quantity),
          },
        });
        break;
      }
      case 'cc_claim_contract_reward': {
        const reward = rec(payload.reward ?? payload.rewards);
        const earnings = earningsFromRewards({
          credits: reward.credits ?? payload.credits_awarded ?? payload.credits,
          fragments: reward.fragments ?? payload.fragments_awarded ?? payload.fragments,
        });
        if (earnings) {
          records.push({
            id: `ledger:${row.id}`,
            kind: 'earnings',
            at,
            away: false,
            label: `Contract reward — ${earningsLabel(earnings)}`,
            earnings,
          });
        }
        break;
      }
      case 'cc_resurrect': {
        records.push({
          id: `ledger:${row.id}`,
          kind: 'system',
          at,
          away: false,
          label: 'Resurrected',
          system: { subtype: 'resurrect' },
        });
        break;
      }
      default:
        break;
    }
  }

  // Item gains — drop records off the item rows themselves. A row
  // explained by another record (a purchase, a cache draw, an
  // in-window boss attempt, a craft) never poses as a drop.
  for (const itemRow of input.items) {
    if (input.purchasedItemIds.has(itemRow.id)) continue;
    if (input.cacheItemIds.has(itemRow.id)) continue;
    const payload = itemRow.payload;
    const receipt = receiptFromPayload(payload);
    const summary = itemSummary({
      id: itemRow.id, kind: itemRow.kind, rarity: itemRow.rarity, item_level: itemRow.item_level, payload,
    });
    if (!summary) continue;
    if (receipt) {
      if (receipt.foundVia === 'cache') continue; // the cache record tells it
      if (receipt.foundVia === 'boss' && bossLootIds.has(itemRow.id)) continue; // the boss record carries it
      const areaId = (receipt.foundVia === 'roam' || receipt.foundVia === 'offline')
        && typeof receipt.foundContext === 'string' ? receipt.foundContext : null;
      const areaName = activityAreaName(areaId);
      const enemy = receipt.foundEnemy;
      let label: string;
      if (receipt.foundVia === 'boss') label = `${receipt.foundContext ? (activityBossName(String(receipt.foundContext)) ?? 'Boss') : 'Boss'} — victory loot`;
      else if (receipt.foundVia === 'cache') label = 'Cache';
      else if (receipt.foundVia === 'endless') label = `Endless — depth ${receipt.foundContext ?? '?'}`;
      else if (enemy && enemy.relation === 'killed') label = `${areaName ?? 'Roaming'} — dropped by ${enemy.name}`;
      else if (enemy) label = `${areaName ?? 'Roaming'} — while fighting ${enemy.name}`;
      else label = `${areaName ?? 'Roaming'} — drop`;
      records.push({
        id: `item:${itemRow.id}`,
        kind: 'drop',
        at: itemRow.created_at,
        away: receipt.foundVia === 'offline',
        label,
        item: summary,
        receipt,
        areaId,
        areaName,
      });
      continue;
    }
    // Unstamped (pre-AL-1) rows: the item and its time are facts;
    // provenance is not, so the record carries receipt: null and
    // claims nothing more. Crafted goods and in-window boss loot are
    // explained by their own records and stay out.
    if (str(payload.origin) === 'crafted' || str(payload.craftedBy)) continue;
    if (bossLootIds.has(itemRow.id)) continue;
    records.push({
      id: `item:${itemRow.id}`,
      kind: 'drop',
      at: itemRow.created_at,
      away: false,
      label: 'Drop — predates item records',
      item: summary,
      receipt: null,
    });
  }

  // Sold listings — the seller's side of the market. The listing row
  // is the durable record; the fee and buyer (when provable) ride
  // from the buyer's accept row via saleFacts.
  for (const listing of input.soldListings) {
    const itemRow = listing.item_instance_id ? itemsById.get(listing.item_instance_id) : undefined;
    const item = itemRow
      ? itemSummary({ id: itemRow.id, kind: itemRow.kind, rarity: itemRow.rarity, item_level: itemRow.item_level, payload: itemRow.payload })
      : itemSummary({ id: listing.item_instance_id, display_name: listing.display_name, rarity: listing.rarity, item_level: listing.item_level, kind: listing.listing_kind });
    const facts = input.saleFacts.get(listing.id);
    const buyerName = facts?.buyerId ? (input.names.get(facts.buyerId) ?? null) : null;
    records.push({
      id: `listing:${listing.id}`,
      kind: 'market',
      at: listing.sold_at,
      away: false,
      label: `Sold ${item?.name ?? 'goods'}${buyerName ? ` to ${buyerName}` : ''}`,
      ...(item ? { item } : {}),
      market: {
        direction: 'sold',
        priceCredits: listing.price_credits,
        feeCredits: facts?.feeCredits ?? null,
        proceedsCredits: facts?.proceedsCredits ?? null,
        counterpartyId: facts?.buyerId ?? null,
        counterpartyName: buyerName,
        listingId: listing.id,
      },
    });
  }

  for (const job of input.craftJobs) {
    const recipeName = activityRecipeName(job.recipe_id);
    const outputs: Array<{ name: string | null; count: number }> = [];
    for (const output of job.outputs) {
      const out = rec(output);
      outputs.push({
        name: str(out.name) ?? str(out.consumableType) ?? str(out.itemName) ?? str(out.recipe_id),
        count: numOrNull(out.count) ?? numOrNull(out.quantity) ?? 1,
      });
    }
    records.push({
      id: `craft:${job.id}`,
      kind: 'craft',
      at: job.completed_at,
      away: false,
      label: `${recipeName ?? job.recipe_id} — crafted`,
      craft: {
        recipeId: job.recipe_id,
        recipeName,
        jobKind: job.kind,
        bench: job.bench,
        unitsCompleted: job.units_completed,
        unitsTotal: job.units_total,
        xpAwarded: job.xp_awarded,
        outputs,
      },
    });
  }

  for (const mission of input.dispatchMissions) {
    records.push({
      id: `dispatch:${mission.id}`,
      kind: 'dispatch',
      at: mission.settled_at,
      away: false,
      label: `Dispatch returned — ${mission.contract_family}`,
      dispatch: {
        family: mission.contract_family,
        payoutCredits: Math.floor(mission.payout_credits * (mission.payout_fraction ?? 1)),
        payoutFraction: mission.payout_fraction,
        step: 'settled',
      },
    });
  }

  for (const run of input.endlessRuns) {
    // An active run proves nothing yet (the lifetime fold's law) —
    // it lands in the record when it ends.
    if (run.status === 'active') continue;
    records.push({
      id: `endless:${run.id}`,
      kind: 'endless',
      at: run.ended_at,
      away: false,
      label: `Endless — depth ${run.depth_reached} (${run.status})`,
      endless: { status: run.status, depthReached: run.depth_reached },
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Filtering, search, ordering, cursor pagination — over any projected
// record set. The Pg store deepens its fetch window until this query
// can be answered exactly (see PgReadStore.getActivityLog).
// ---------------------------------------------------------------------------

/** Searchable text for one record: item, enemy, area, boss, recipe, counterparty names + the label. */
export function activitySearchText(record: ActivityRecord): string {
  const parts: Array<string | null | undefined> = [
    record.label,
    record.kind,
    record.item?.name,
    record.areaName,
    record.receipt?.foundEnemy?.name,
    record.boss?.bossName,
    record.craft?.recipeName,
    record.craft?.recipeId,
    record.market?.counterpartyName,
    record.market?.goodsKey,
    record.dispatch?.areaName,
    record.service?.board,
    record.service?.step,
    ...(record.trace?.facts ?? []).map((f) => f.value),
    ...(record.extraction?.passes ?? []).map((p) => p.areaName),
    ...(record.extraction ? Object.keys(record.extraction.materials) : []),
    ...(record.extraction ? Object.keys(record.extraction.essences) : []),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function recordMatchesKind(record: ActivityRecord, kinds: ActivityLogKindFilter[]): boolean {
  return kinds.some((kind) => (kind === 'away' ? record.away : record.kind === kind));
}

/** (at, id) descending — the stream's total order. */
function compareRecords(a: ActivityRecord, b: ActivityRecord): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

export interface ActivityCursor { at: string; id: string }

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decode a cursor; null when the value is not a cursor this module issued. */
export function decodeActivityCursor(raw: string): ActivityCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    const cursor = rec(parsed);
    const at = str(cursor.at);
    const id = str(cursor.id);
    if (!at || !id || Number.isNaN(Date.parse(at))) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export function normalizeActivityLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return ACTIVITY_LOG_DEFAULT_LIMIT;
  return Math.max(1, Math.min(ACTIVITY_LOG_MAX_LIMIT, Math.floor(raw)));
}

/**
 * Apply filters + search + cursor and take one page. Returns the
 * page plus whether more matching records exist beyond it IN THE
 * GIVEN SET (the Pg store uses that signal to decide whether its
 * fetch window must deepen before answering).
 */
export function queryActivityRecords(
  records: ActivityRecord[],
  query: ActivityLogQuery,
): ActivityLogPage & { hasMoreInSet: boolean } {
  const limit = normalizeActivityLimit(query.limit);
  const kinds = (query.kinds ?? []).filter((k) => ACTIVITY_KIND_FILTERS.includes(k));
  const q = (query.q ?? '').trim().toLowerCase();
  const cursor = query.cursor ? decodeActivityCursor(query.cursor) : null;

  let filtered = records;
  if (kinds.length) filtered = filtered.filter((r) => recordMatchesKind(r, kinds));
  if (q) filtered = filtered.filter((r) => activitySearchText(r).includes(q));
  const sorted = [...filtered].sort(compareRecords);
  const afterCursor = cursor
    ? sorted.filter((r) => r.at < cursor.at || (r.at === cursor.at && r.id < cursor.id))
    : sorted;
  const page = afterCursor.slice(0, limit);
  const hasMoreInSet = afterCursor.length > limit;
  const last = page[page.length - 1];
  return {
    records: page,
    nextCursor: hasMoreInSet && last ? encodeActivityCursor({ at: last.at, id: last.id }) : null,
    limit,
    hasMoreInSet,
  };
}
