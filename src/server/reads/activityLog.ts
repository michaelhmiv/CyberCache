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
  | 'earnings' | 'settlement' | 'salvage' | 'dispatch' | 'endless' | 'system';

/** Kind filter values: every emitted kind, plus 'away' (the away-era pseudo-kind). */
export type ActivityLogKindFilter = ActivityRecordKind | 'away';

export const ACTIVITY_KIND_FILTERS: readonly ActivityLogKindFilter[] = [
  'drop', 'kills', 'boss', 'cache', 'craft', 'market', 'earnings', 'away',
  'settlement', 'salvage', 'dispatch', 'endless', 'system',
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
  fragments?: number;
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
    direction: 'bought' | 'sold';
    priceCredits: number;
    feeCredits: number | null;
    counterpartyId: string | null;
    counterpartyName: string | null;
    listingId: string | null;
    /** Vendor trades name their goods by catalog key (no item instance exists). */
    goodsKey?: string | null;
    quantity?: number | null;
  };
  settlement?: {
    elapsedMs: number | null;
    capHours: number | null;
    capReached: boolean | null;
    ticks: number | null;
  };
  salvage?: { scrapAward: number; coresAward: number; auto?: boolean };
  dispatch?: { family: string; payoutCredits: number; payoutFraction: number | null };
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
  /** Per sold listing, the facts that live only in the buyer's accept row: the fee and the buyer. */
  saleFacts: ReadonlyMap<string, { feeCredits: number | null; buyerId: string | null }>;
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
  if (credits !== 0) out.credits = credits;
  if (scrap !== 0) out.scrap = scrap;
  if (xp !== 0) out.xp = xp;
  if (fragments !== 0) out.fragments = fragments;
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
          },
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
