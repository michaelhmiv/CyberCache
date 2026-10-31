/**
 * listingQuery — the ONE market browse query contract (market depth
 * slice, migration 0019).
 *
 * The Buy tab used to fetch every active listing and filter in the
 * client; at ~1,000 players that stops being a market and becomes a
 * denial-of-service on the buyer's phone. Browsing is now a server
 * query: this module defines the query shape, the normalized browse
 * row both read stores produce, and the pure filter/sort/paginate
 * fold the in-memory store runs. PgReadStore runs the SQL twin over
 * the denormalized columns migration 0019 stamps onto market_listings
 * at creation (category / weapon_type / element / rarity / item_level
 * / identity_key / seller_type), so a filter never has to open an
 * item payload. The two paths are exercised against the same seeded
 * market in tests.
 */
import type { MarketCategory } from './identityKey';

export type MarketSort = 'price_asc' | 'price_desc' | 'rarity' | 'level' | 'newest' | 'name';

export const MARKET_SORTS: readonly MarketSort[] = [
  'price_asc', 'price_desc', 'rarity', 'level', 'newest', 'name',
];

export interface MarketListingQuery {
  /** Case-insensitive substring on the display name. */
  search?: string;
  category?: MarketCategory;
  weaponType?: string;
  element?: string;
  rarity?: string;
  levelMin?: number;
  levelMax?: number;
  /** Total listing price (what the buyer pays), not unit price. */
  priceMin?: number;
  priceMax?: number;
  sellerType?: 'player' | 'npc';
  /** Exact seller — the My Listings tab. */
  sellerId?: string;
  /** Exclude one seller — the Buy tab never shows the buyer's own listings. */
  excludeSellerId?: string;
  sort?: MarketSort;
  limit?: number;
  offset?: number;
}

export const DEFAULT_LISTING_LIMIT = 25;
export const MAX_LISTING_LIMIT = 100;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LISTING_LIMIT;
  return Math.min(MAX_LISTING_LIMIT, Math.max(1, Math.floor(limit)));
}

export function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

/**
 * A listing reduced to its browse facts — everything filtering,
 * sorting, and row display need, without opening the item payload.
 * Both read stores produce this shape; `item` (the gear payload row)
 * rides along for gear listings only.
 */
export interface MarketBrowseRow {
  id: string;
  sellerId: string;
  sellerType: 'player' | 'npc';
  kind: 'gear' | 'consumable' | 'material' | 'vehicle';
  category: MarketCategory;
  displayName: string;
  weaponType: string | null;
  element: string | null;
  rarity: string | null;
  itemLevel: number | null;
  /** Total price the buyer pays for the whole listing. */
  price: number;
  quantity: number;
  /** price ÷ quantity — the number price stats compare. */
  unitPrice: number;
  qualityPercent: number | null;
  consumableType: string | null;
  materialId: string | null;
  identityKey: string | null;
  /** ms epoch. */
  listedAt: number;
}

export const RARITY_RANK: Record<string, number> = {
  Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5,
};

function matches(row: MarketBrowseRow, q: MarketListingQuery): boolean {
  if (q.search && !row.displayName.toLowerCase().includes(q.search.toLowerCase())) return false;
  if (q.category && row.category !== q.category) return false;
  if (q.weaponType && row.weaponType !== q.weaponType) return false;
  if (q.element && row.element !== q.element) return false;
  if (q.rarity && row.rarity !== q.rarity) return false;
  if (q.levelMin !== undefined && (row.itemLevel === null || row.itemLevel < q.levelMin)) return false;
  if (q.levelMax !== undefined && (row.itemLevel === null || row.itemLevel > q.levelMax)) return false;
  if (q.priceMin !== undefined && row.price < q.priceMin) return false;
  if (q.priceMax !== undefined && row.price > q.priceMax) return false;
  if (q.sellerType && row.sellerType !== q.sellerType) return false;
  if (q.sellerId && row.sellerId !== q.sellerId) return false;
  if (q.excludeSellerId && row.sellerId === q.excludeSellerId) return false;
  return true;
}

function comparator(sort: MarketSort): (a: MarketBrowseRow, b: MarketBrowseRow) => number {
  const byNewest = (a: MarketBrowseRow, b: MarketBrowseRow) => b.listedAt - a.listedAt;
  switch (sort) {
    case 'price_asc':
      return (a, b) => a.price - b.price || byNewest(a, b);
    case 'price_desc':
      return (a, b) => b.price - a.price || byNewest(a, b);
    case 'rarity':
      return (a, b) =>
        (RARITY_RANK[b.rarity ?? ''] ?? 0) - (RARITY_RANK[a.rarity ?? ''] ?? 0)
        || a.price - b.price || byNewest(a, b);
    case 'level':
      return (a, b) =>
        (b.itemLevel ?? -1) - (a.itemLevel ?? -1) || a.price - b.price || byNewest(a, b);
    case 'name':
      return (a, b) => a.displayName.localeCompare(b.displayName) || byNewest(a, b);
    case 'newest':
    default:
      return byNewest;
  }
}

/** Filter + sort + paginate. Returns the page plus the FULL match count. */
export function applyListingQuery(
  rows: readonly MarketBrowseRow[],
  query: MarketListingQuery,
): { rows: MarketBrowseRow[]; total: number } {
  const filtered = rows.filter((row) => matches(row, query));
  const sorted = [...filtered].sort(comparator(query.sort ?? 'newest'));
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  return { rows: sorted.slice(offset, offset + limit), total: filtered.length };
}
