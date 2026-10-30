/**
 * Market listings (Route B, slice B4; browse query, market depth
 * 0019) — the Buy tab no longer downloads the whole market and
 * filters on the phone. GET /api/market/listings takes the browse
 * query (src/lib/market/listingQuery.ts) and returns one page plus
 * the full match count; the server filters over the columns
 * migration 0019 stamps onto each listing at creation.
 *
 * Rows arrive with the listing's browse facts on the row itself and
 * the embedded item (gear listings only; the old PostgREST embed
 * could also arrive as an array — both are still handled).
 */
import { apiRequest } from './http';
import { serverItemRowToDisplayGear, type ServerItemRow } from './serverItemAdapter';
import type { MarketListingQuery } from '@/lib/market/listingQuery';
import type { MarketCategory } from '@/lib/market/identityKey';
import type { Listing, ListingKind } from '@/types/market';

type MarketListingRow = {
  id: string;
  price_credits: number;
  listed_at: string;
  seller_user_id: string;
  seller_type?: string | null;
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
  item_instances: ServerItemRow[] | ServerItemRow | null;
};

export interface MarketListingsPage {
  listings: Listing[];
  total: number;
}

function rowToListing(row: MarketListingRow): Listing | null {
  const embedded = row.item_instances;
  const itemRow = Array.isArray(embedded) ? embedded[0] : embedded;
  const kind: ListingKind = row.listing_kind === 'consumable' || row.listing_kind === 'material'
    ? row.listing_kind
    : 'gear';
  const gear = itemRow
    ? serverItemRowToDisplayGear({
      id: itemRow.id ?? row.id,
      item_level: itemRow.item_level,
      rarity: itemRow.rarity,
      is_locked: itemRow.is_locked,
      runtime_state: itemRow.runtime_state,
      equipped_slot: itemRow.equipped_slot,
      payload: itemRow.payload,
    })
    : null;
  // A gear listing whose item failed to adapt is unrenderable — drop
  // it (the pre-0019 behavior). Stack listings never carry an item.
  if (kind === 'gear' && !gear) return null;
  const quantity = Math.max(1, Math.floor(Number(row.quantity) || 1));
  const price = Number(row.price_credits);
  return {
    id: row.id,
    sellerId: row.seller_user_id,
    sellerName: row.seller_user_id,
    sellerType: row.seller_type === 'npc' ? 'npc' : 'player',
    kind,
    itemId: gear ? gear.id : null,
    itemSnapshot: gear,
    category: (row.category as MarketCategory | null) ?? null,
    displayName: row.display_name ?? gear?.name ?? row.consumable_type ?? row.material_id ?? 'Unknown',
    quantity,
    qualityPercent: row.quality_percent === null || row.quality_percent === undefined ? null : Number(row.quality_percent),
    consumableType: row.consumable_type ?? null,
    materialId: row.material_id ?? null,
    identityKey: row.identity_key ?? null,
    weaponType: row.weapon_type ?? null,
    element: row.element ?? null,
    rarity: row.rarity ?? gear?.rarity ?? null,
    itemLevel: row.item_level === null || row.item_level === undefined ? (gear?.level ?? null) : Number(row.item_level),
    price,
    unitPrice: price / quantity,
    listedAt: new Date(row.listed_at).getTime(),
    feePaid: 0,
  };
}

function queryString(query: MarketListingQuery): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  };
  set('search', query.search);
  set('category', query.category);
  set('weaponType', query.weaponType);
  set('element', query.element);
  set('rarity', query.rarity);
  set('levelMin', query.levelMin);
  set('levelMax', query.levelMax);
  set('priceMin', query.priceMin);
  set('priceMax', query.priceMax);
  set('sellerType', query.sellerType);
  set('sellerId', query.sellerId);
  set('excludeSellerId', query.excludeSellerId);
  set('sort', query.sort);
  set('limit', query.limit);
  set('offset', query.offset);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** One page of the server-browsed market plus the full match count. */
export async function fetchMarketListings(query: MarketListingQuery = {}): Promise<MarketListingsPage> {
  let page: { listings: MarketListingRow[]; total: number };
  try {
    page = (await apiRequest<{ listings: MarketListingRow[]; total: number }>(`/market/listings${queryString(query)}`))
      ?? { listings: [], total: 0 };
  } catch (error) {
    console.warn('[marketListings] fetch failed:', error instanceof Error ? error.message : error);
    return { listings: [], total: 0 };
  }
  return {
    total: page.total ?? 0,
    listings: (page.listings ?? [])
      .map(rowToListing)
      .filter((l): l is Listing => l !== null),
  };
}

/** The caller's own active listings (My Listings tab), unpaginated up to the server cap. */
export async function fetchMyMarketListings(sellerId: string): Promise<Listing[]> {
  const page = await fetchMarketListings({ sellerId, sort: 'newest', limit: 100 });
  return page.listings;
}
