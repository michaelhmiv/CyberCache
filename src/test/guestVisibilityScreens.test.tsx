/**
 * Guest-visibility law (owner ruling, 2026-11-01) — screen journeys.
 *
 * Guests SEE everything with real data; only transacting requires
 * sign-in. These tests walk the flows the way the device-done rule
 * demands — mounted screens, real stores, tapped controls:
 *
 *  - Market → Buy: a guest sees the real listing, taps Buy Now, and
 *    gets the sign-in prompt; the buy op never fires.
 *  - Market → Sell: a guest sees their own items with List buttons,
 *    taps List, gets the prompt; the create op never fires.
 *  - Market → Repair Services: a guest sees the open board, taps
 *    Accept job, gets the prompt; the accept op never fires.
 *  - Market → Shield Tech: same shape for the shield-tech board.
 *  - Control: a verified account taps Buy Now and the op DOES fire —
 *    the lock guards guests, not everyone.
 *
 * Server-side, the ops refuse guests regardless of what the client
 * does (guestVisibilityServer.test.ts + the repair/shield/market
 * suites pin the 403s); this file pins the client half of the law.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  fetchMyMarketListings: vi.fn(async () => []),
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
import { verifiedOps, fetchRepairBoard, fetchShieldTechBoard } from '@/lib/api/verifiedOps';
import { fetchMarketListings } from '@/lib/api/marketListings';
import { useInventoryStore, useMarketStore, usePlayerStore } from '@/store';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { Listing } from '@/types/market';
import type { AccountState } from '@/auth/accountState';

const guestAccount: AccountState = {
  userId: 'guest-1',
  accountType: 'guest',
  username: null,
  hasUsername: false,
  email: null,
  emailVerifiedAt: null,
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: true,
};

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
  name: 'Guest Gaze Rifle',
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

const gearListing: Listing = {
  id: 'listing-1',
  sellerId: 'seller-9',
  sellerName: '',
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

const repairBoardView = {
  open: [{
    id: 'job-1',
    ownerUserId: 'owner-9',
    providerUserId: null,
    status: 'listed',
    outcome: null,
    vehicle: {
      itemId: 'veh-1', classId: 'dune_buggy', className: 'Dune Buggy', rarity: 'Rare',
      conditionCurrent: 20, conditionMax: 50,
    },
    targetPoints: 30,
    pointsRestored: 0,
    progress: 0,
    kitProgress: 0,
    priceCredits: 600,
    creditsPerPoint: 20,
    kitType: null,
    kitsConsumed: [],
    paidCredits: null,
    feeCredits: null,
    xpAwarded: null,
    createdAtMs: Date.now(),
    acceptedAtMs: null,
    completedAtMs: null,
    expiresAtMs: Date.now() + 48 * 3600_000,
    reclaimable: false,
    queuePosition: null,
  }],
  mine: [],
  work: [],
  stats: { medianCreditsPerPoint: 20, medianSampleSize: 3, myMasteryLevel: 1, myJobsCompleted: 0, myJobsAbandoned: 0 },
  levers: { serviceXpPerPoint: 2, repairAbandonWindowHours: 24, repairListingExpiryDays: 3, marketFeeRate: 0.05 },
};

const shieldTechBoardView = {
  open: [{
    id: 'stjob-1',
    ownerUserId: 'owner-9',
    ownerName: null,
    providerUserId: null,
    providerName: null,
    status: 'listed',
    outcome: null,
    shield: { itemId: 'shield-1', rarity: 'Rare', capacity: 1500, behavior: 'standard' as const, behaviorName: 'Standard' },
    fromBehavior: 'standard' as const,
    fromBehaviorName: 'Standard',
    fromBehaviorDescription: null,
    toBehavior: 'nova' as const,
    toBehaviorName: 'Nova',
    toBehaviorDescription: null,
    flipApplied: null,
    targetPoints: 1500,
    pointsCalibrated: 0,
    progress: 0,
    coreProgress: 0,
    priceCredits: 900,
    creditsPerPoint: 0.6,
    estimatedCoresForReader: null,
    kitsConsumed: [],
    paidCredits: null,
    feeCredits: null,
    xpAwarded: null,
    createdAtMs: Date.now(),
    acceptedAtMs: null,
    completedAtMs: null,
    expiresAtMs: Date.now() + 48 * 3600_000,
    lastProgressAtMs: null,
    reclaimable: false,
    queuePosition: null,
  }],
  mine: [],
  work: [],
  medianPerThousandByRarity: {},
  stats: { medianSampleSize: 0, myMasteryLevel: 1, myMasteryXp: 0, myJobsCompleted: 0, myJobsAbandoned: 0 },
  levers: { shieldTechXpPerPoint: 2, shieldTechAbandonWindowHours: 24, shieldTechListingExpiryDays: 3, marketFeeRate: 0.05 },
};

describe('guest visibility — market journeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = guestAccount;
    hoisted.auth.user = { id: 'guest-1' };
    vi.mocked(fetchMarketListings).mockResolvedValue({ listings: [gearListing], total: 1 });
    vi.mocked(fetchRepairBoard).mockResolvedValue(repairBoardView as never);
    vi.mocked(fetchShieldTechBoard).mockResolvedValue(shieldTechBoardView as never);
    useMarketStore.setState({ activeTab: 'buy', history: [] });
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, name: 'Guest',
    } as never);
    useInventoryStore.setState({ items: [] } as never);
  });
  afterEach(() => cleanup());

  it('Buy tab: a guest sees the real listing; tapping Buy Now raises the sign-in prompt and never fires the op', async () => {
    render(<MarketScreen />);
    // Real data renders — no lock wall, no Locked tab badges.
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    expect(screen.queryByText('Account upgrade needed')).toBeNull();
    const buyButton = screen.getByRole('button', { name: /Buy Now/ });
    expect((buyButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(buyButton);
    expect(await screen.findByText('Sign in to buy — your guest progress carries over')).toBeInTheDocument();
    expect(screen.getByText('Sign in with Google — keep your progress')).toBeInTheDocument();
    expect(verifiedOps.acceptListing).not.toHaveBeenCalled();
  }, 30_000);

  it('Sell tab: a guest sees their own items; tapping List raises the prompt and never fires the op', async () => {
    useInventoryStore.setState({ items: [weapon] } as never);
    render(<MarketScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(await screen.findByText('Sign in to sell — your guest progress carries over')).toBeInTheDocument();
    expect(verifiedOps.marketCreate).not.toHaveBeenCalled();
  }, 30_000);

  it('Repair Services: a guest sees the open board; tapping Accept job raises the prompt and never fires the op', async () => {
    useMarketStore.setState({ activeTab: 'repair' });
    render(<MarketScreen />);
    expect(await screen.findByText('Dune Buggy')).toBeInTheDocument();
    const accept = screen.getByRole('button', { name: /Accept job/ });
    expect((accept as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(accept);
    expect(await screen.findByText('Sign in to take this repair job — your guest progress carries over')).toBeInTheDocument();
    expect(verifiedOps.acceptRepairJob).not.toHaveBeenCalled();
  }, 30_000);

  it('Shield Tech: a guest sees the open board; tapping Accept job raises the prompt and never fires the op', async () => {
    useMarketStore.setState({ activeTab: 'shieldTech' });
    render(<MarketScreen />);
    expect(await screen.findByText('Rare Shield')).toBeInTheDocument();
    const accept = screen.getByRole('button', { name: /Accept job/ });
    expect((accept as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(accept);
    expect(await screen.findByText('Sign in to take this shield-tech job — your guest progress carries over')).toBeInTheDocument();
    expect(verifiedOps.acceptShieldTechJob).not.toHaveBeenCalled();
  }, 30_000);

  it('control: a verified account taps Buy Now and the op fires — the lock guards guests, not everyone', async () => {
    hoisted.auth.account = verifiedAccount;
    hoisted.auth.user = { id: 'user-1' };
    render(<MarketScreen />);
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Buy Now/ }));
    await vi.waitFor(() => expect(verifiedOps.acceptListing).toHaveBeenCalledWith('listing-1'));
    expect(screen.queryByText(/Sign in to buy/)).toBeNull();
  }, 30_000);
});
