/**
 * Market listings (Route B, slice B4) — transport swap onto the Chef
 * read route, which returns the same listing rows with the embedded
 * item (object or null; the old PostgREST embed could also arrive as
 * an array — both are still handled).
 */
import { apiRequest } from './http';
import { serverItemRowToDisplayGear, type ServerItemRow } from './serverItemAdapter';
import type { Listing } from '@/types/market';

type MarketListingRow = {
  id: string;
  price_credits: number;
  listed_at: string;
  seller_user_id: string;
  item_instances: ServerItemRow[] | ServerItemRow | null;
};

export async function fetchActiveMarketListings(): Promise<Listing[]> {
  let rows: MarketListingRow[];
  try {
    rows = (await apiRequest<MarketListingRow[]>('/market/listings')) ?? [];
  } catch (error) {
    console.warn('[marketListings] fetch failed:', error instanceof Error ? error.message : error);
    return [];
  }

  return rows
    .map((row): Listing | null => {
      const embedded = row.item_instances;
      const itemRow = Array.isArray(embedded) ? embedded[0] : embedded;
      if (!itemRow) return null;
      const gear = serverItemRowToDisplayGear({
        id: itemRow.id ?? row.id,
        item_level: itemRow.item_level,
        rarity: itemRow.rarity,
        is_locked: itemRow.is_locked,
        runtime_state: itemRow.runtime_state,
        equipped_slot: itemRow.equipped_slot,
        payload: itemRow.payload,
      });
      if (!gear) return null;
      return {
        id: row.id,
        sellerId: row.seller_user_id,
        sellerName: row.seller_user_id,
        itemId: gear.id,
        itemSnapshot: gear,
        price: Number(row.price_credits),
        listedAt: new Date(row.listed_at).getTime(),
        feePaid: 0,
      };
    })
    .filter((l): l is Listing => l !== null);
}
