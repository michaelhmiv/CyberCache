/**
 * Audit #568 — the market read layer must be honest about failure.
 *
 * Before the fix, `fetchMarketListings` caught every transport error
 * and returned `{ listings: [], total: 0 }`, indistinguishable from a
 * genuinely empty market — so MarketScreen's X-07 error state + Retry
 * could never fire in production and an outage rendered as "No
 * listings found." These tests pin the real module against a mocked
 * TRANSPORT (the pattern from vehiclesMarketGoods.test.ts), not a
 * mocked module: a rejecting transport must reject here too, so the
 * screen's catch is reachable; a successful response — empty or
 * not — must resolve exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/lib/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/http')>();
  return { ...actual, apiRequest: http.apiRequest };
});

import { ApiError } from '@/lib/api/http';
import { fetchMarketListings, fetchMyMarketListings } from '@/lib/api/marketListings';

function materialWireRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-mat-1',
    price_credits: 300,
    listed_at: '2026-11-02T10:00:00.000Z',
    seller_user_id: 'seller-1',
    seller_name: 'Seller',
    seller_type: 'player',
    listing_kind: 'material',
    quantity: 3,
    material_id: 'scrap',
    display_name: 'Scrap',
    item_instances: null,
    ...overrides,
  };
}

describe('marketListings error contract (#568)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a failed Buy fetch rejects with the transport error — never an empty page', async () => {
    const failure = new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
    http.apiRequest.mockRejectedValue(failure);
    await expect(fetchMarketListings()).rejects.toBe(failure);
  });

  it('a failed My Listings fetch rejects too (the swallow was inherited)', async () => {
    http.apiRequest.mockRejectedValue(new ApiError(503, 'http_error', 'Request failed (503).'));
    await expect(fetchMyMarketListings('seller-1')).rejects.toThrow('Request failed (503).');
  });

  it('a genuinely empty market still resolves as an empty page', async () => {
    http.apiRequest.mockResolvedValue({ listings: [], total: 0 });
    await expect(fetchMarketListings()).resolves.toEqual({ listings: [], total: 0 });
  });

  it('a successful-but-bodiless response still resolves as an empty page', async () => {
    http.apiRequest.mockResolvedValue(null);
    await expect(fetchMarketListings()).resolves.toEqual({ listings: [], total: 0 });
  });

  it('a successful page still adapts rows and reports the full match count', async () => {
    http.apiRequest.mockResolvedValue({ listings: [materialWireRow()], total: 7 });
    const page = await fetchMarketListings({ category: 'material' });
    expect(http.apiRequest).toHaveBeenCalledWith(expect.stringContaining('/market/listings'));
    expect(page.total).toBe(7);
    expect(page.listings).toHaveLength(1);
    expect(page.listings[0].kind).toBe('material');
    expect(page.listings[0].displayName).toBe('Scrap');
    expect(page.listings[0].quantity).toBe(3);
    expect(page.listings[0].unitPrice).toBe(100);
  });
});
