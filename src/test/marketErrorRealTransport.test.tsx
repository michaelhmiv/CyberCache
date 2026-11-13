/**
 * Audit #568 — the X-07 error state, proven against the REAL read
 * layer.
 *
 * marketErrorStates.test.tsx pins the screen seam with the listings
 * module mocked to reject. That mock hid the production defect: the
 * shipped `fetchMarketListings` swallowed every failure into an
 * empty page, so the seam's rejection never happened in the real
 * app. This harness is identical EXCEPT the listings module is real
 * and the transport (`apiRequest`) is the mock — a rejecting
 * transport must now drive the same error state end to end, and a
 * resolving-empty transport must still read as an empty market.
 * (This is the behavior the e2e-browser lane's `market-error-state`
 * case asserts against the production build.)
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'guest-1' } as { id: string } | null,
    account: null as import('@/auth/accountState').AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
  opNames: [
    'acceptListing', 'acceptRepairJob', 'acceptShieldTechJob', 'battleResult',
    'cancelCraftJob', 'cancelRepairJob', 'cancelShieldTechJob', 'claimCraftedConsumable',
    'consumeConsumable', 'disablePushDevice', 'enqueueCraftJob', 'enqueueRepairJob',
    'enqueueShieldTechJob', 'equipItem', 'finishRepairJob', 'finishShieldTechJob',
    'fitWorkshopTool', 'idleClaim', 'initialBundle', 'itemLock', 'makeItem',
    'marketCancel', 'marketCreate', 'marketCreateConsumable', 'marketCreateCore',
    'marketCreateEssence', 'marketCreateFragment', 'marketCreateMaterial',
    'postRepairJob', 'postShieldTechJob', 'reclaimRepairJob', 'reclaimShieldTechJob',
    'recycleItem', 'reforgeItem', 'refuelVehicle', 'registerPushDevice', 'resetProgress',
    'retrain', 'trainSkill', 'unequipSlot', 'unlockCraftBench', 'vendorBuy',
    'vendorSellConsumable', 'vendorSellGear', 'vendorSellMaterial',
  ],
  apiRequest: vi.fn(),
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: Object.fromEntries(hoisted.opNames.map((name) => [name, vi.fn(async () => ({}))])),
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchRepairBoard: vi.fn(),
  fetchShieldTechBoard: vi.fn(),
  fetchCollections: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

// The transport is the mock; src/lib/api/marketListings itself is REAL.
vi.mock('@/lib/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/http')>();
  return { ...actual, apiRequest: hoisted.apiRequest };
});

vi.mock('@/lib/api/marketPriceStats', () => ({
  fetchPriceStats: vi.fn(async () => ({})),
}));

vi.mock('@/lib/api/cacheLaneService', () => ({
  fetchCacheLane: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/ads/rewardedCacheAd', () => ({
  canUseRewardedCacheAds: () => false,
  showRewardedCacheAd: vi.fn(async () => { throw new Error('ads unavailable in tests'); }),
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

import { MarketScreen } from '@/screens/MarketScreen';
import { usePlayerStore } from '@/store';

function listingsCalls(): number {
  return hoisted.apiRequest.mock.calls.filter(
    (call) => typeof call[0] === 'string' && call[0].startsWith('/market/listings'),
  ).length;
}

describe('audit #568 — market error state via the real fetch layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({ id: 'guest-1', credits: 1000 });
  });
  afterEach(() => cleanup());

  it('a rejecting transport renders the Retry error state, never "No listings found", and Retry re-fetches', async () => {
    hoisted.apiRequest.mockRejectedValue(new Error('Could not reach the server. Check your connection and try again.'));
    render(<MarketScreen />);

    const errorBlock = await screen.findByTestId('market-buy-error');
    expect(errorBlock).toBeTruthy();
    expect(screen.queryByText(/No listings found/)).toBeNull();

    const callsBefore = listingsCalls();
    expect(callsBefore).toBeGreaterThan(0);
    fireEvent.click(within(errorBlock, 'Retry'));
    await waitFor(() => {
      expect(listingsCalls()).toBeGreaterThan(callsBefore);
    });
    // Still failing, still an error state — never the empty copy.
    expect(screen.getByTestId('market-buy-error')).toBeTruthy();
    expect(screen.queryByText(/No listings found/)).toBeNull();
  });

  it('a resolving-empty transport renders the empty market, never the error state', async () => {
    hoisted.apiRequest.mockImplementation(async (path: string) => (
      typeof path === 'string' && path.startsWith('/market/listings')
        ? { listings: [], total: 0 }
        : {}
    ));
    render(<MarketScreen />);

    expect(await screen.findByText(/No listings found/)).toBeTruthy();
    expect(screen.queryByTestId('market-buy-error')).toBeNull();
  });
});

function within(el: HTMLElement, text: string): HTMLElement {
  const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`no button containing ${text}`);
  return btn as HTMLElement;
}
