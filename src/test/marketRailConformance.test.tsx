/**
 * Market rail conformance (DESIGN.md §2/§9, Wave D cleanup) —
 * mounted-screen journeys for the two structural fixes:
 *
 *  - the rail carries exactly §2's seven stops (Buy · Sell ·
 *    Vendor · Repair · Shield Tech · Rep Desk · Slots); My
 *    Listings and History are segments of the Sell stop — the
 *    Mine segment keeps the live listings + cancel action, the
 *    History segment keeps the trade record, nothing removed;
 *  - the tab→stop deep link: a recorded market-stop intent (what
 *    App's handleNavigate stores for a 'market:<stop>' route —
 *    Home's Slots card navigated 'market:slots' until the Home
 *    consolidation retired the card, 2026-11-03) lands the player
 *    ON the named stop when Market mounts, and is consumed so a
 *    later plain visit keeps the player's own stop.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1' } as { id: string } | null,
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
    'retrain', 'slotPull', 'trainSkill', 'unequipSlot', 'unlockCraftBench', 'vendorBuy',
    'vendorSellConsumable', 'vendorSellGear', 'vendorSellMaterial',
  ],
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
  fetchMarketListings: vi.fn(),
  fetchMyMarketListings: vi.fn(),
}));

vi.mock('@/lib/api/marketPriceStats', () => ({
  fetchPriceStats: vi.fn(async () => ({})),
}));

vi.mock('@/lib/api/cacheLaneService', () => ({
  fetchCacheLane: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/api/slotService', () => ({
  fetchSlotState: vi.fn(async () => null),
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
import { fetchMarketListings, fetchMyMarketListings } from '@/lib/api/marketListings';
import { useInventoryStore, useMarketStore, usePlayerStore } from '@/store';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { Listing, MarketHistory } from '@/types/market';
import type { AccountState } from '@/auth/accountState';

const verifiedAccount: AccountState = {
  userId: 'user-1',
  accountType: 'verified',
  username: 'hunter',
  hasUsername: true,
  email: 'hunter@example.com',
  emailVerifiedAt: '2026-06-14T00:00:00.000Z',
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: false,
};

const weapon: Weapon = {
  id: 'weapon-1',
  name: 'Rail Conformance Rifle',
  level: 5,
  rarity: Rarity.Rare,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  rollQuality: 50,
  baseDamage: 40,
  attackSpeed: 1,
  critChance: 0.1,
  critDamage: 1.5,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 0,
  waveDamageMod: 0,
  shieldDamageMod: 0,
  armorDamageMod: 0,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [],
  affixes: [],
  legendaryEffectId: undefined,
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 0,
  combatPower: 120,
  bossPower: 0,
  farmPower: 0,
  economyScore: 0,
};

const buyListing: Listing = {
  id: 'listing-1',
  sellerId: 'seller-9',
  sellerName: 'Dust Hawk',
  sellerType: 'player',
  kind: 'gear',
  itemId: weapon.id,
  itemSnapshot: weapon,
  category: 'weapon',
  displayName: weapon.name,
  quantity: 1,
  qualityPercent: null,
  consumableType: null,
  materialId: null,
  essenceId: null,
  identityKey: null,
  weaponType: 'Pistol',
  element: 'Kinetic',
  rarity: 'Rare',
  itemLevel: 5,
  price: 500,
  unitPrice: 500,
  listedAt: Date.now(),
  feePaid: 0,
};

const ownListing: Listing = {
  ...buyListing,
  id: 'listing-mine',
  sellerId: 'user-1',
  sellerName: 'hunter',
  displayName: 'My Own Cannon',
  itemSnapshot: { ...weapon, id: 'weapon-2', name: 'My Own Cannon' },
  itemId: 'weapon-2',
  price: 900,
  unitPrice: 900,
};

const historyEntry: MarketHistory = {
  id: 'hist-1',
  type: 'sell',
  itemId: 'weapon-0',
  itemName: 'History Blade',
  itemRarity: 'Epic',
  price: 750,
  fee: 37,
  otherPartyId: 'buyer-7',
  timestamp: Date.now(),
};

describe('market rail conformance — seven stops, Sell segments (§2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = verifiedAccount;
    hoisted.auth.user = { id: 'user-1' };
    vi.mocked(fetchMarketListings).mockResolvedValue({ listings: [buyListing], total: 1 });
    vi.mocked(fetchMyMarketListings).mockResolvedValue([ownListing]);
    useMarketStore.setState({ activeTab: 'buy', history: [historyEntry], marketStopIntent: null });
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, name: 'Hunter',
    } as never);
    useInventoryStore.setState({ items: [] } as never);
  });
  afterEach(() => cleanup());

  it('the rail carries exactly the seven §2 stops — no My Listings or History stop', async () => {
    render(<MarketScreen />);
    for (const label of ['Buy', 'Sell', 'Vendor', 'Repair', 'Shield Tech', 'Rep Desk', 'Slots']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'My Listings' })).toBeNull();
    // History exists only as a Sell segment, so no History control
    // is on screen while the Buy stop is showing.
    expect(screen.queryByRole('tab', { name: 'History' })).toBeNull();
    expect(await screen.findByText('Rail Conformance Rifle')).toBeInTheDocument();
  }, 30_000);

  it('the Sell stop switches Sell · Mine · History segments; Mine keeps cancel, History keeps its rows', async () => {
    render(<MarketScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));

    // The segment control rides the top of the stop.
    expect(screen.getByRole('tab', { name: 'Sell' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
    // Default segment is the listing form.
    expect(screen.getByPlaceholderText('Search items to list…')).toBeInTheDocument();
    expect(screen.queryByText('History Blade')).toBeNull();

    // Mine: the player's own listings, with the cancel action.
    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }));
    expect(await screen.findByText('My Own Cannon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel Listing/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search items to list…')).toBeNull();
    expect(screen.queryByText('History Blade')).toBeNull();

    // History: the trade record, seller names on its face.
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('History Blade')).toBeInTheDocument();
    expect(screen.getByText(/Sold to/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel Listing/ })).toBeNull();
  }, 30_000);
});

describe('market rail conformance — tab→stop deep link (§9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = verifiedAccount;
    hoisted.auth.user = { id: 'user-1' };
    vi.mocked(fetchMarketListings).mockResolvedValue({ listings: [buyListing], total: 1 });
    vi.mocked(fetchMyMarketListings).mockResolvedValue([]);
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, name: 'Hunter',
    } as never);
    useInventoryStore.setState({ items: [] } as never);
  });
  afterEach(() => cleanup());

  it('a recorded Slots intent lands ON the Slots stop when Market mounts, and is consumed', async () => {
    // What App's handleNavigate stores for the Home deck card's
    // 'market:slots' route (the card's navigate arg is pinned in
    // homeComposition.test.tsx; the route resolution in App is
    // pinned below by source).
    useMarketStore.setState({ activeTab: 'buy', history: [], marketStopIntent: null });
    useMarketStore.getState().requestMarketStop('slots');

    render(<MarketScreen />);
    expect(await screen.findByText('Data Slots')).toBeInTheDocument();
    expect(screen.getByText(/Pulls left today/)).toBeInTheDocument();
    // The intent fired once and cleared — the stop is the
    // player's own state now.
    expect(useMarketStore.getState().activeTab).toBe('slots');
    expect(useMarketStore.getState().marketStopIntent).toBeNull();
  }, 30_000);

  it('control: with no intent, Market opens on its current stop', async () => {
    useMarketStore.setState({ activeTab: 'buy', history: [], marketStopIntent: null });
    render(<MarketScreen />);
    expect(await screen.findByText('Rail Conformance Rifle')).toBeInTheDocument();
    expect(screen.queryByText('Data Slots')).toBeNull();
  }, 30_000);

  it("App resolves the 'market:<stop>' route into the intent (source pin)", async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const app = readFileSync(join(__dirname, '../..', 'src/App.tsx'), 'utf8');
    expect(app).toContain("screen.startsWith('market:')");
    expect(app).toContain('isMarketStopId(stop)');
    expect(app).toContain('requestMarketStop(stop)');
    const deck = readFileSync(join(__dirname, '../..', 'src/components/dashboard/DashboardDeck.tsx'), 'utf8');
    // Home consolidation (2026-11-03): the deck's Slots card —
    // the route's Home emitter — left the deck; the Slots
    // stop's only door is the Market rail itself now
    // (DESIGN.md §9). The App resolution legs above are the
    // surviving wiring, and the deck no longer emits the route.
    expect(deck).not.toContain("onNavigate('market:slots')");
  });
});
