/**
 * Remedy program slice B — G3: market silent disables.
 *
 * The audit (assumption-gaps-audit-2026-11-02.md, G3) found the
 * Market Buy button disabled at 40% opacity when a signed-in
 * player couldn't afford a listing — visually identical to the
 * guest sign-in lock's dim, and it made handleBuy's
 * 'Not enough credits.' toast unreachable (a disabled button
 * never fires). (Slots tier buttons had the same silent-disable
 * shape; that half of G3 was removed with Data Slots itself,
 * migration 0074.) The fix is presentation only:
 *
 *  - can't-afford renders a TAPPABLE button that prints
 *    "Short by X cr" in its own treatment (no amber fill, no
 *    dim); tapping surfaces the toast with the shortfall and
 *    where credits come from;
 *  - the guest lock is byte-for-byte the old treatment
 *    (Buy Now + lock glyph, enabled, tap raises the prompt);
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
import { fetchMarketListings } from '@/lib/api/marketListings';
import { verifiedOps } from '@/lib/api/verifiedOps';
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

function setPlayerCredits(credits: number) {
  usePlayerStore.setState({
    credits, consumables: {}, consumableBatches: [], materials: {}, name: 'Hunter',
  } as never);
}

describe('G3 — Market Buy: the shortfall prints, the guest lock does not change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = verifiedAccount;
    hoisted.auth.user = { id: 'user-1' };
    vi.mocked(fetchMarketListings).mockResolvedValue({ listings: [gearListing], total: 1 });
    useMarketStore.setState({ activeTab: 'buy', history: [] });
    useInventoryStore.setState({ items: [] } as never);
  });
  afterEach(() => cleanup());

  it('a broke verified player gets a tappable "Short by X cr" button — not the silent dim', async () => {
    setPlayerCredits(100); // listing is 500 → short by 400
    render(<MarketScreen />);
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /short by 400 cr/i });
    expect(button.textContent).toContain('Short by 400 cr');
    // Tappable: the whole point is the tap now answers.
    expect((button as HTMLButtonElement).disabled).toBe(false);
    // Visually distinct from the amber Buy Now / guest lock.
    expect(button.className).not.toContain('bg-amber');
    expect(button.className).toContain('text-red-300');
    // And there is no Buy Now button to confuse it with.
    expect(screen.queryByRole('button', { name: /Buy Now/ })).toBeNull();
  }, 30_000);

  it('tapping the shortfall button surfaces the toast with the shortfall and where credits come from — and never fires the op', async () => {
    setPlayerCredits(100);
    render(<MarketScreen />);
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /short by 400 cr/i }));
    expect(await screen.findByText(/Not enough credits — short by 400 cr\. Earn credits roaming, running contracts, or selling loot\./)).toBeInTheDocument();
    expect(verifiedOps.acceptListing).not.toHaveBeenCalled();
  }, 30_000);

  it('the shortfall math is price − balance, locale-formatted', async () => {
    setPlayerCredits(250);
    vi.mocked(fetchMarketListings).mockResolvedValue({
      listings: [{ ...gearListing, price: 12_500, unitPrice: 12_500 }],
      total: 1,
    });
    render(<MarketScreen />);
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /short by 12,250 cr/i })).toBeInTheDocument();
  }, 30_000);

  it('a guest who also cannot afford the listing keeps the exact guest treatment — Buy Now + lock, no shortfall print', async () => {
    hoisted.auth.account = guestAccount;
    hoisted.auth.user = { id: 'guest-1' };
    setPlayerCredits(0);
    render(<MarketScreen />);
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Buy Now/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.className).toContain('bg-amber');
    expect(screen.queryByText(/Short by/)).toBeNull();
  }, 30_000);

  it('control: a verified player who can afford the listing still buys with one tap', async () => {
    setPlayerCredits(100_000);
    render(<MarketScreen />);
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Buy Now/ }));
    await vi.waitFor(() => expect(verifiedOps.acceptListing).toHaveBeenCalledWith('listing-1'));
  }, 30_000);
});

