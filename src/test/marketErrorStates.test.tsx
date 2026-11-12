/**
 * Audit X-07 — Market load failures are persistent, retryable error
 * states, never an empty market.
 *
 * Before the fix, a failed Buy fetch fired only a transient toast;
 * when it cleared, the board rendered "No listings found. List your
 * own gear from the Sell stop." — a server outage presented as an
 * empty market with a sell prompt, and no Retry anywhere. My
 * Listings failure was swallowed silently. The harness mirrors
 * marketComposition.test.tsx (same mocks, same store seeding).
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
  fetchMarketListings: vi.fn(),
  fetchMyMarketListings: vi.fn(),
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

vi.mock('@/lib/api/marketListings', () => ({
  fetchMarketListings: hoisted.fetchMarketListings,
  fetchMyMarketListings: hoisted.fetchMyMarketListings,
}));

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

describe('audit X-07 — market error states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.fetchMyMarketListings.mockResolvedValue([]);
    usePlayerStore.setState({ id: 'guest-1', credits: 1000 });
  });
  afterEach(() => cleanup());

  it('a rejected Buy fetch renders a Retry error state, never "No listings found", and Retry re-fetches', async () => {
    hoisted.fetchMarketListings.mockRejectedValue(new Error('Could not reach the server'));
    render(<MarketScreen />);

    const errorBlock = await screen.findByTestId('market-buy-error');
    expect(errorBlock).toBeTruthy();
    expect(screen.queryByText(/No listings found/)).toBeNull();

    const callsBefore = hoisted.fetchMarketListings.mock.calls.length;
    fireEvent.click(within(errorBlock, 'Retry'));
    await waitFor(() => {
      expect(hoisted.fetchMarketListings.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    // Still failing, still an error state — never the empty copy.
    expect(screen.getByTestId('market-buy-error')).toBeTruthy();
    expect(screen.queryByText(/No listings found/)).toBeNull();
  });

  it('a recovered fetch clears the error state and the empty market reads as empty again', async () => {
    hoisted.fetchMarketListings
      .mockRejectedValueOnce(new Error('Could not reach the server'))
      .mockResolvedValue({ listings: [], total: 0 });
    render(<MarketScreen />);

    const errorBlock = await screen.findByTestId('market-buy-error');
    fireEvent.click(within(errorBlock, 'Retry'));

    await waitFor(() => {
      expect(screen.queryByTestId('market-buy-error')).toBeNull();
    });
    expect(screen.getByText(/No listings found/)).toBeTruthy();
  });
});

function within(el: HTMLElement, text: string): HTMLElement {
  const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`no button containing ${text}`);
  return btn as HTMLElement;
}
