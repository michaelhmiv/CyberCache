/**
 * Vehicles as pure market goods (owner ruling 2026-11-02) — the
 * read + client halves of the trade path:
 *
 *   1. The in-memory read store browses a vehicle listing under the
 *      Vehicles category with the item embed intact — kind, class
 *      payload, and LIVE condition (a worn vehicle must browse as
 *      worn; condition is the price signal).
 *   2. The client's listing adapter (marketListings.rowToListing via
 *      fetchMarketListings) maps a vehicle row to a Listing with a
 *      vehicleSnapshot — before this slice the gear adapter refused
 *      vehicle rows and every vehicle listing silently dropped out
 *      of the Buy lane. An unadaptable vehicle row still drops.
 *
 * The write halves (create stamps kind 'vehicle'; accept delivers
 * the instance intact) are pinned in vehicles.test.ts ("vehicle
 * market sale (writes mirror)").
 */
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryReadStore,
  emptyReadSeed,
  type MemItem,
  type MemListing,
} from '../server/reads/store';

const S = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-02T12:00:00.000Z');

const LEVIATHAN_ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';

function vehiclePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LEVIATHAN_ITEM,
    name: 'Leviathan Rig',
    vehicleClassId: 'leviathan_rig',
    level: 12,
    rarity: 'Legendary',
    affixes: [{ id: 'aff-1', category: 'activity', stat: 'vehicleYieldPct', value: 0.08, displayText: 'vehicleYieldPct +8%' }],
    sourceTag: 'World Drop',
    isLocked: false,
    pixelSeed: 7,
    ...overrides,
  };
}

function readSeedWithVehicleListing() {
  const seed = emptyReadSeed();
  const item: MemItem = {
    id: LEVIATHAN_ITEM,
    owner_user_id: S,
    kind: 'vehicle',
    item_level: 12,
    rarity: 'Legendary',
    is_locked: false,
    runtime_state: 'listed',
    equipped_slot: null,
    payload: vehiclePayload(),
    created_at: '2026-11-01T00:00:00.000Z',
    condition_current: 55,
    condition_max: 100,
  };
  const listing: MemListing = {
    id: 'listing-veh-1',
    seller_user_id: S,
    item_instance_id: LEVIATHAN_ITEM,
    price_credits: 45000,
    status: 'active',
    listed_at: '2026-11-02T10:00:00.000Z',
    listing_kind: 'vehicle',
    quantity: 1,
    identity_key: 'vehicle:leviathan_rig:Legendary',
    category: 'vehicle',
    display_name: 'Leviathan Rig',
    rarity: 'Legendary',
    item_level: 12,
    seller_type: 'player',
  };
  seed.items = [item];
  seed.listings = [listing];
  return seed;
}

describe('vehicle listings browse (InMemoryReadStore)', () => {
  it('the Vehicles category returns the listing with its instance and live condition', async () => {
    const store = new InMemoryReadStore(readSeedWithVehicleListing(), () => NOW);
    const page = await store.getActiveMarketListings({ category: 'vehicle' });
    expect(page.total).toBe(1);
    const row = page.listings[0];
    expect(row.listing_kind).toBe('vehicle');
    expect(row.category).toBe('vehicle');
    expect(row.identity_key).toBe('vehicle:leviathan_rig:Legendary');
    expect(row.item_instances?.kind).toBe('vehicle');
    expect(row.item_instances?.condition_current).toBe(55);
    expect(row.item_instances?.condition_max).toBe(100);
    expect((row.item_instances?.payload as Record<string, unknown>).vehicleClassId).toBe('leviathan_rig');
  });

  it('the listing does not leak into the gear categories', async () => {
    const store = new InMemoryReadStore(readSeedWithVehicleListing(), () => NOW);
    const weapons = await store.getActiveMarketListings({ category: 'weapon' });
    expect(weapons.total).toBe(0);
    const all = await store.getActiveMarketListings({});
    expect(all.total).toBe(1);
  });
});

// ─── Client adapter ────────────────────────────────────────────────

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/lib/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/http')>();
  return { ...actual, apiRequest: http.apiRequest };
});

import { fetchMarketListings } from '@/lib/api/marketListings';

function vehicleWireRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-veh-1',
    price_credits: 45000,
    listed_at: '2026-11-02T10:00:00.000Z',
    seller_user_id: S,
    seller_name: 'Seller',
    seller_type: 'player',
    listing_kind: 'vehicle',
    quantity: 1,
    identity_key: 'vehicle:leviathan_rig:Legendary',
    category: 'vehicle',
    display_name: 'Leviathan Rig',
    rarity: 'Legendary',
    item_level: 12,
    item_instances: {
      id: LEVIATHAN_ITEM,
      item_level: 12,
      rarity: 'Legendary',
      is_locked: false,
      runtime_state: 'listed',
      equipped_slot: null,
      kind: 'vehicle',
      condition_current: 55,
      condition_max: 100,
      payload: vehiclePayload(),
    },
    ...overrides,
  };
}

describe('vehicle listings adapt (client Buy lane)', () => {
  it('a vehicle row becomes a Listing with the actual instance snapshot', async () => {
    http.apiRequest.mockResolvedValue({ listings: [vehicleWireRow()], total: 1 });
    const page = await fetchMarketListings({ category: 'vehicle' });
    expect(page.total).toBe(1);
    expect(page.listings).toHaveLength(1);
    const listing = page.listings[0];
    expect(listing.kind).toBe('vehicle');
    expect(listing.itemId).toBe(LEVIATHAN_ITEM);
    expect(listing.itemSnapshot).toBeNull();
    expect(listing.vehicleSnapshot?.vehicleClassId).toBe('leviathan_rig');
    expect(listing.vehicleSnapshot?.conditionCurrent).toBe(55);
    expect(listing.vehicleSnapshot?.conditionMax).toBe(100);
    expect(listing.vehicleSnapshot?.affixes).toHaveLength(1);
  });

  it('a vehicle row whose payload cannot adapt still drops (never renders as fake gear)', async () => {
    http.apiRequest.mockResolvedValue({
      listings: [vehicleWireRow({
        item_instances: {
          id: LEVIATHAN_ITEM, item_level: 12, rarity: 'Legendary', is_locked: false,
          runtime_state: 'listed', equipped_slot: null, kind: 'vehicle',
          condition_current: 55, condition_max: 100,
          payload: { id: LEVIATHAN_ITEM, name: 'Mystery Machine' },
        },
      })],
      total: 1,
    });
    const page = await fetchMarketListings({ category: 'vehicle' });
    expect(page.listings).toHaveLength(0);
  });
});
