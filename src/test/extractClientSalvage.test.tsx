/**
 * Client extraction salvage pins (PR #646 extraction, owner-rescoped
 * 2026-11-21: "Keep only the non-visual fixes — no layout changes").
 *
 * These pins cover ONLY the behavior taken from PR #646:
 *  1. Honest load states: Research / Cache Rank / Dispatch render a
 *     loading line, then a named unavailable state with Retry when
 *     the Chef read fails — and the raw error text NEVER reaches the
 *     player (hard law: raw server text is never rendered).
 *  2. Two-tap destructive confirms: market cancel-listing (with the
 *     corrected "Confirm — deposit is lost" label) and vendor gear
 *     sell arm a confirm first; the destructive op fires only on
 *     the second tap.
 *  3. Boss Intel Law: the Activity Log card and boss sheet no longer
 *     carry "Win chance" / "Won at" readouts (source pin).
 *  4. Onboarding order: App gates the handle and hunter invitation
 *     mounts on the starter bundle reveal (source pin).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RAW_MARKER = 'RAW-DB-DETAIL-4711: relation "secret_table" does not exist';

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

vi.mock('@/lib/chef/chefClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/chef/chefClient')>();
  return {
    ...original,
    getResearchState: vi.fn(),
    getCacheRankState: vi.fn(),
    getDispatchState: vi.fn(),
  };
});

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

import { ResearchPanel } from '@/components/profile/ResearchPanel';
import { CacheRankPanel } from '@/components/profile/CacheRankPanel';
import { DispatchPanel } from '@/components/dispatch/DispatchPanel';
import { MarketScreen } from '@/screens/MarketScreen';
import { VendorScreen } from '@/screens/VendorScreen';
import { getCacheRankState, getDispatchState, getResearchState } from '@/lib/chef/chefClient';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { fetchMarketListings, fetchMyMarketListings } from '@/lib/api/marketListings';
import { useInventoryStore, useMarketStore, usePlayerStore } from '@/store';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { Listing } from '@/types/market';
import type { AccountState } from '@/auth/accountState';

afterEach(() => cleanup());

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

// ─── 1. Honest load states ────────────────────────────────────────

describe('salvage — honest load states render fixed copy only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = guestAccount;
    hoisted.auth.user = { id: 'guest-1' };
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, name: 'Guest',
    } as never);
  });

  it('Research: a failed read shows the named unavailable state, never the raw error', async () => {
    vi.mocked(getResearchState).mockRejectedValue(new Error(RAW_MARKER));
    render(<ResearchPanel />);
    expect(await screen.findByText('Research unavailable')).toBeInTheDocument();
    expect(screen.getByText('Unable to load Research right now.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RAW_MARKER);
    expect(document.body.textContent).not.toContain('secret_table');
    // Retry re-runs the read.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(vi.mocked(getResearchState).mock.calls.length).toBe(2));
  });

  it('Research: a pending read shows the loading line', () => {
    vi.mocked(getResearchState).mockImplementation(() => new Promise(() => {}));
    render(<ResearchPanel />);
    expect(screen.getByText('Loading Research…')).toBeInTheDocument();
  });

  it('Cache Rank: a failed read shows the named unavailable state, never the raw error', async () => {
    vi.mocked(getCacheRankState).mockRejectedValue(new Error(RAW_MARKER));
    render(<CacheRankPanel />);
    expect(await screen.findByText('Cache Rank unavailable')).toBeInTheDocument();
    expect(screen.getByText('Unable to load Cache Rank right now.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RAW_MARKER);
    expect(document.body.textContent).not.toContain('secret_table');
  });

  it('Dispatch: a failed read shows the named unavailable state, never the raw error', async () => {
    vi.mocked(getDispatchState).mockRejectedValue(new Error(RAW_MARKER));
    render(<DispatchPanel />);
    expect(await screen.findByText('Dispatch unavailable')).toBeInTheDocument();
    expect(screen.getByText('Unable to load Dispatch right now.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RAW_MARKER);
    expect(document.body.textContent).not.toContain('secret_table');
  });
});

// ─── 2. Two-tap confirms ──────────────────────────────────────────

const weapon: Weapon = {
  id: 'weapon-1',
  name: 'Storm Ledger Rifle',
  level: 5,
  rarity: Rarity.Rare,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Shock,
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
  combatPower: 240,
  bossPower: 0,
  farmPower: 0,
  economyScore: 0,
};

const myListing = {
  id: 'listing-mine',
  sellerId: 'guest-1',
  sellerName: 'Guest',
  sellerType: 'player',
  kind: 'gear',
  itemId: weapon.id,
  itemSnapshot: weapon,
  vehicleSnapshot: null,
  category: 'weapon',
  displayName: weapon.name,
  quantity: 1,
  qualityPercent: null,
  consumableType: null,
  materialId: null,
  essenceId: null,
  partId: null,
  tintPaletteId: null,
  identityKey: 'weapon:storm-ledger',
  weaponType: 'Pistol',
  element: 'Shock',
  rarity: 'Rare',
  itemLevel: 5,
  price: 8_000,
  unitPrice: 8_000,
  listedAt: Date.now() - 3 * 3_600_000,
  feePaid: 0,
} as unknown as Listing;

describe('salvage — market cancel-listing is two-tap with the corrected label', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = guestAccount;
    hoisted.auth.user = { id: 'guest-1' };
    vi.mocked(fetchMarketListings).mockResolvedValue({ listings: [], total: 0 });
    vi.mocked(fetchMyMarketListings).mockResolvedValue([myListing]);
    useMarketStore.setState({ activeTab: 'sell', history: [] });
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, name: 'Guest',
    } as never);
    useInventoryStore.setState({ items: [] } as never);
  });

  it('first tap arms, second tap cancels; the confirm names the lost deposit', async () => {
    render(<MarketScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }));
    expect(await screen.findByText('Storm Ledger Rifle')).toBeInTheDocument();
    const row = screen.getByTestId('market-list-row');
    fireEvent.click(within(row).getByRole('button', { name: /Cancel Listing/ }));
    // Armed only — the destructive op has not fired.
    expect(vi.mocked(verifiedOps.marketCancel)).not.toHaveBeenCalled();
    const confirm = within(row).getByRole('button', { name: 'Confirm — deposit is lost' });
    fireEvent.click(confirm);
    await waitFor(() => expect(vi.mocked(verifiedOps.marketCancel)).toHaveBeenCalled());
  }, 30_000);
});

describe('salvage — vendor gear sell is two-tap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = guestAccount;
    hoisted.auth.user = { id: 'guest-1' };
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, essences: {}, name: 'Guest',
    } as never);
    useInventoryStore.setState({ items: [weapon] } as never);
  });

  it('first tap arms the Confirm/Keep pair, second tap sells', async () => {
    render(<VendorScreen />);
    fireEvent.click(screen.getByText('Sell to Vendor — Buyback'));
    const sellButton = await screen.findByRole('button', { name: /Sell • ~/ });
    fireEvent.click(sellButton);
    expect(vi.mocked(verifiedOps.vendorSellGear)).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('button', { name: /^Confirm • ~/ });
    fireEvent.click(confirm);
    await waitFor(() => expect(vi.mocked(verifiedOps.vendorSellGear)).toHaveBeenCalledWith('weapon-1'));
  }, 30_000);
});

// ─── 3 + 4. Source pins ───────────────────────────────────────────

describe('salvage — boss intel + onboarding source pins', () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

  it('Activity Log card and boss sheet carry no win-chance readouts', () => {
    const card = read('src/components/activity/ActivityRecordCard.tsx');
    const sheet = read('src/components/activity/ActivityRecordSheet.tsx');
    expect(card).not.toContain('Won at');
    expect(card).not.toContain('Win chance');
    expect(sheet).not.toContain('Win chance');
  });

  it('App gates handle + hunter invitations behind the starter bundle reveal', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('!starterBundleOpen && usernamePrompt.prompt');
    expect(app).toContain('!starterBundleOpen && hunterPick.prompt && !usernamePrompt.prompt');
  });
});
