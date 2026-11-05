/**
 * Drift-fix F3 — Market composition (FIDELITY-AUDIT finding #3).
 *
 * The shipped Market drifted from the approved proposal (m39/m40/
 * m42/m43): the first Buy listing sat at ~55% of the viewport under
 * a six-row filter stack and full-width Buy bands, the Vendor wore
 * a 30px headline over tall cards, and the service boards' headers
 * spent three lines on their explainers. F3 is composition ONLY —
 * same state, same handlers, same query behavior:
 *
 *  - Buy: search + category chips + count/refresh on the lane; the
 *    detailed filters and the sort live in ONE sheet (DESIGN.md §3)
 *    behind a Filters door that prints the active-filter count and
 *    the current sort. Listings are compact rows: item + seller/
 *    trend in the middle, price over a SMALL Buy button.
 *  - Sell/Mine: the sort rides the rarity rail's row; Mine's
 *    refresh joins the search row; Cancel is a small right-column
 *    button, not a full-width band.
 *  - Vendor: 17px storefront head; consumable/material rows with
 *    Owned over a small Buy; the Item of the Day label folds into
 *    its card as a chip.
 *  - Boards: header explainers compressed to the mocks' one-line
 *    form with every fact kept; browse controls at the Buy lane's
 *    chip geometry and the 11px floor.
 *
 * These tests pin the new composition the way F2's
 * homeComposition.test.tsx pins Home's: rendered journeys for the
 * Buy lane (the door, the sheet, the count) and source pins for the
 * retired chrome.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

describe('F3 — Buy lane composition (rendered)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = guestAccount;
    hoisted.auth.user = { id: 'guest-1' };
    vi.mocked(fetchMarketListings).mockResolvedValue({ listings: [gearListing], total: 1 });
    useMarketStore.setState({ activeTab: 'buy', history: [] });
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, name: 'Guest',
    } as never);
    useInventoryStore.setState({ items: [] } as never);
  });
  afterEach(() => cleanup());

  it('the lane carries search, category chips, the count and the Filters door — the rarity rail is NOT stacked on the lane', async () => {
    render(<MarketScreen />);
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    // The door prints the query state: no active filters, current sort.
    const door = screen.getByRole('button', { name: 'Open market filters' });
    expect(door.textContent).toContain('Filters · Sort: Newest');
    // The count rides the lane next to the category chips.
    expect(screen.getByText('1 listing')).toBeInTheDocument();
    // Rarity chips live in the sheet now — no 'Legendary' chip on the lane.
    expect(screen.queryByRole('button', { name: 'Legendary' })).toBeNull();
    // The small Buy button is on the row, enabled for a guest
    // (the lock still raises at the tap — guestVisibilityScreens).
    expect(screen.getByRole('button', { name: /Buy Now/ })).toBeEnabled();
  }, 30_000);

  it('the Filters door opens ONE sheet holding sort, rarity, type/element and the ranges — and the choices drive the same query state', async () => {
    render(<MarketScreen />);
    expect(await screen.findByText('Guest Gaze Rifle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open market filters' }));
    expect(await screen.findByText('Market Filters')).toBeInTheDocument();
    // Sort select with the lane's exact options.
    expect(screen.getByRole('option', { name: 'Sort: Cheapest' })).toBeInTheDocument();
    // Rarity chips, weapon facets and ranges all present in the sheet.
    expect(screen.getByRole('button', { name: 'Legendary' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Any weapon type' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Lv min')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Max cr')).toBeInTheDocument();
    // Picking a rarity in the sheet updates the door's count badge.
    fireEvent.click(screen.getByRole('button', { name: 'Legendary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Open market filters' }).textContent).toContain('Filters (1)');
  }, 30_000);
});

describe('F3 — retired chrome stays retired (source pins)', () => {
  const market = read('screens/MarketScreen.tsx');
  const vendor = read('screens/VendorScreen.tsx');
  const controls = read('components/market/ServiceBoardControls.tsx');
  const repair = read('components/market/RepairBoard.tsx');
  const shield = read('components/market/ShieldTechBoard.tsx');

  it('Buy: the stacked filter rows and the text refresh lines are gone; the sheet and icon refreshes carry them', () => {
    expect(market).toContain('<PickerSheet');
    expect(market).toContain('title="Market Filters"');
    expect(market).not.toContain('Player Market — refresh');
    expect(market).not.toContain('My Listings — refresh');
    expect(market).toContain('aria-label="Refresh listings"');
    expect(market).toContain('aria-label="Refresh my listings"');
    // The Filters door prints the live query state.
    expect(market).toContain('activeBuyFilterCount');
    expect(market).toContain('BUY_SORT_LABELS[buySort]');
  });

  it('Vendor: the 30px headline and the family-abbrev well are gone; rows carry the item sprite and the full family label', () => {
    expect(vendor).not.toContain('text-3xl');
    expect(vendor).toContain('text-[17px]');
    expect(vendor).not.toContain('FAMILY_LABELS[c.family].slice(0, 3)');
    // Consumable item art (2026-11-04): vendor rows mount the
    // formed-object sprite (consumableArt compositor), not the
    // §7 sheet glyph — the pin moved from `c.visual.icon` to the
    // PixelConsumable mount with the well grown to h-14 w-14.
    expect(vendor).toContain('<PixelConsumable type={c.id} size={52} />');
    expect(vendor).toContain('h-14 w-14');
    expect(vendor).not.toContain('c.visual.icon');
    expect(vendor).toContain('{FAMILY_LABELS[c.family]}');
  });

  it('Boards: explainers are the compressed one-line forms; browse controls sit at the 11px floor', () => {
    expect(repair).toContain('price = kits + labor, escrowed in full');
    expect(shield).toContain('the flip lands only at 100%');
    expect(controls).not.toContain('text-[9px]');
    expect(controls).not.toContain('text-[10px]');
    expect(shield).not.toContain('text-[9px]');
  });


  it('Strip fit: the Market root carries the shared 0.625rem page pad (px-2.5), never a true p-4', () => {
    // Regression pin for the F3 fidelity-gate defect: the Strip's
    // natural row width at ordinary balances is ~383px, and F1's
    // fit invariant (row scrollWidth == clientWidth) holds on the
    // other tabs because .bl-page's density layer (index.css)
    // normalizes their page pad to --cc-page-pad (0.625rem → a
    // 386px column at 412px). Market's root is not a .bl-page, so
    // its original `p-4` computed to a true 16px, the column
    // narrowed to 374px, the row overflowed ~13px, and the level
    // digit clipped at the bar's right edge (live-measured:
    // row scrollWidth 383 > clientWidth 370; level value right
    // edge 395.7 > bar right edge 393). px-2.5 IS 0.625rem — the
    // same pad, stated in the utility scale. If the root's
    // horizontal pad ever widens again, this pin fails before a
    // capture has to catch it.
    expect(market).toContain('className="space-y-3 px-2.5 pt-4 pb-20"');
    expect(market).not.toContain('className="space-y-3 p-4 pb-20"');
    // Second half of the same root cause: the density layer also
    // remaps gap-2 → --cc-gap-sm (0.375rem) under .bl-page, so the
    // Strip row rendered 5 × 2px wider on Market than on the other
    // tabs (live-measured: identical segment widths, gaps 8px on
    // Market vs 6px on Home). The Strip now pins its row gap as
    // gap-1.5 (0.375rem) in ResourceBar itself — the shared
    // chrome's geometry no longer depends on the host page
    // carrying .bl-page. If either half regresses, the digit
    // clips again; both are pinned here.
    const strip = read('components/layout/ResourceBar.tsx');
    expect(strip).toContain('gap-1.5 overflow-x-auto');
    expect(strip).toContain('gap-1.5 overflow-hidden');
    expect(strip).not.toContain('gap-2 overflow-x-auto');
    expect(strip).not.toContain('gap-2 overflow-hidden');
  });

  it('movement.ts is not part of this slice (byte-identical law)', () => {
    // The motion law file is pinned by hash in animationPolish /
    // redesign suites; F3 asserts here only that its own sources
    // never import or re-declare the loot timings.
    expect(market).not.toContain('movement');
  });
});
