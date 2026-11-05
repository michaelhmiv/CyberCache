/**
 * Market compact list rows (owner addition 2026-11-04: the Gear
 * list treatment of PR #385 applies to the Market lists too).
 *
 * The Buy/Mine lanes render ONE line per listing on the 46px row
 * anatomy (components/market/ListingRow.tsx): rarity spine, thumb
 * with the element corner badge, level column, rarity-colored
 * name — with the market substitutions pinned here:
 *
 *  - PRICE IS THE HERO in the headline slot (priceRowHeadline,
 *    the gearRowHeadline variant); the item's own stat headline
 *    leads the fact line instead.
 *  - The fact line carries what a listing has and an owned item
 *    does not: the counterparty ("Seller · {name}" — a hunter
 *    name, never an id), the recent-sales median + trend AS TEXT
 *    (the sparkline drawing left the row face), and the listing
 *    AGE — listings never expire in the data model, so there is
 *    no ends-at to print.
 *  - Mine rows read their listed state at a glance: "Listed {age}"
 *    + the net-proceeds line, Cancel Listing on the row.
 *  - What left the face stays off it: no stat pills, no badge
 *    line, no compare block, no sparkline polyline.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { ListingRow, GearCandidateRow, VehicleCandidateRow } from '@/components/market/ListingRow';
import { listingAgeLabel } from '@/lib/market/listingAge';
import { priceRowHeadline } from '@/lib/gear/gearCardSummary';
import { getVehicleClass } from '@/lib/vehicles/vehicles';
import { fetchMarketListings, fetchMyMarketListings } from '@/lib/api/marketListings';
import { fetchPriceStats } from '@/lib/api/marketPriceStats';
import { useInventoryStore, useMarketStore, usePlayerStore } from '@/store';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { Listing } from '@/types/market';
import type { VehicleDisplay } from '@/store/slices/vehicleSlice';
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

const HOUR = 3_600_000;
const NOW = Date.now();

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

function baseListing(overrides: Partial<Listing>): Listing {
  return {
    id: 'listing-x',
    sellerId: 'seller-9',
    sellerName: 'Rook Sandoval',
    sellerType: 'player',
    kind: 'gear',
    itemId: null,
    itemSnapshot: null,
    vehicleSnapshot: null,
    category: 'weapon',
    displayName: 'Listing',
    quantity: 1,
    qualityPercent: null,
    consumableType: null,
    materialId: null,
    essenceId: null,
    partId: null,
    tintPaletteId: null,
    identityKey: null,
    weaponType: null,
    element: null,
    rarity: null,
    itemLevel: null,
    price: 0,
    unitPrice: 0,
    listedAt: NOW,
    feePaid: 0,
    ...overrides,
  } as Listing;
}

const gearListing = baseListing({
  id: 'listing-gear',
  itemId: weapon.id,
  itemSnapshot: weapon,
  displayName: weapon.name,
  identityKey: 'weapon:storm-ledger',
  weaponType: 'Pistol',
  element: 'Shock',
  rarity: 'Rare',
  itemLevel: 5,
  price: 12_500,
  unitPrice: 12_500,
  listedAt: NOW - 2 * HOUR,
});

const materialListing = baseListing({
  id: 'listing-mat',
  kind: 'material',
  category: 'material',
  displayName: 'BallisticParts',
  materialId: 'BallisticParts',
  quantity: 12,
  price: 3_000,
  unitPrice: 250,
  listedAt: NOW - 5 * 60_000,
});

const vehicle: VehicleDisplay = {
  id: 'veh-1',
  name: 'Leviathan Rig',
  vehicleClassId: 'leviathan_rig',
  level: 12,
  rarity: Rarity.Legendary,
  affixes: [{ id: 'aff-1', category: 'activity', stat: 'vehicleYieldPct', value: 0.08, displayText: 'vehicleYieldPct +8%' } as never],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 7,
  conditionCurrent: 55,
  conditionMax: 100,
};

const vehicleListing = baseListing({
  id: 'listing-veh',
  kind: 'vehicle',
  category: 'vehicle',
  vehicleSnapshot: vehicle,
  displayName: vehicle.name,
  rarity: 'Legendary',
  itemLevel: 12,
  price: 45_000,
  unitPrice: 45_000,
  listedAt: NOW - 26 * HOUR,
});

describe('compact market rows — Buy lane (rendered)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = guestAccount;
    hoisted.auth.user = { id: 'guest-1' };
    vi.mocked(fetchMarketListings).mockResolvedValue({ listings: [gearListing, materialListing], total: 2 });
    vi.mocked(fetchPriceStats).mockResolvedValue({
      'weapon:storm-ledger': {
        identityKey: 'weapon:storm-ledger',
        recentUnitPrices: [11_000, 11_500, 12_000],
        medianUnitPrice: 11_900,
        lastUnitPrice: 12_000,
        salesCount: 3,
        trend: 'up',
        trendPct: 0.12,
      },
    } as never);
    useMarketStore.setState({ activeTab: 'buy', history: [] });
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, name: 'Guest',
    } as never);
    useInventoryStore.setState({ items: [] } as never);
  });
  afterEach(() => cleanup());

  it('one 46px row per listing: badge, stage-density thumb, price hero, seller + median + age on the fact line', async () => {
    render(<MarketScreen />);
    expect(await screen.findByText('Storm Ledger Rifle')).toBeInTheDocument();
    const rows = screen.getAllByTestId('market-list-row');
    expect(rows).toHaveLength(2);

    const gearRow = rows.find((r) => r.getAttribute('data-kind') === 'gear')!;
    expect(gearRow.className).toContain('min-h-[46px]');
    // Element corner badge on the thumb; weapons compose at stage density.
    expect(gearRow.querySelector('[data-element-badge]')).not.toBeNull();
    expect(gearRow.querySelector('[data-density="stage"]')).not.toBeNull();
    // NO level column on listing rows (capture-pass trade: price +
    // action own the right side; the level lives in inspect and
    // the lane's level filter/sort).
    expect(within(gearRow).queryByText('Lv 5')).toBeNull();
    // PRICE IS THE HERO.
    expect(gearRow.textContent).toContain('12,500cr');
    // The item's own stat headline leads the fact line.
    expect(gearRow.textContent).toContain('DPS');
    // Counterparty as a labeled hunter name — never an id.
    expect(gearRow.textContent).toContain('Seller · Rook Sandoval');
    expect(gearRow.textContent).not.toContain('seller-9');
    // Median + trend survive as TEXT; the sparkline drawing is gone.
    // (Price stats land through the screen's 250ms-debounced fetch.)
    await waitFor(() => expect(gearRow.textContent).toContain('med 11,900cr'));
    expect(gearRow.textContent).toContain('12%');
    expect(gearRow.textContent).not.toContain('median');
    expect(gearRow.querySelector('polyline')).toBeNull();
    // Listing AGE — the only time fact a listing carries (no expiry exists).
    expect(gearRow.textContent).toContain('2h');
    // The lane action rides the row.
    expect(within(gearRow).getByRole('button', { name: /Buy Now/ })).toBeEnabled();
    // Node budget: a listing row stays a row, not a card.
    expect(gearRow.querySelectorAll('*').length).toBeLessThanOrEqual(64);
  }, 30_000);

  it('stack rows: quantity + unit price + seller + age on the fact line, Used in door intact', async () => {
    render(<MarketScreen />);
    expect(await screen.findByText('BallisticParts')).toBeInTheDocument();
    const row = screen.getAllByTestId('market-list-row').find((r) => r.getAttribute('data-kind') === 'material')!;
    expect(row.textContent).toContain('×12');
    expect(row.textContent).toContain('250cr ea');
    expect(row.textContent).toContain('3,000cr');
    expect(row.textContent).toContain('Seller · Rook Sandoval');
    expect(row.textContent).toContain('5m');
    expect(within(row).getByRole('button', { name: /Used in/ })).toBeInTheDocument();
  }, 30_000);
});

describe('compact market rows — Mine lane (rendered)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = guestAccount;
    hoisted.auth.user = { id: 'guest-1' };
    vi.mocked(fetchMarketListings).mockResolvedValue({ listings: [], total: 0 });
    vi.mocked(fetchMyMarketListings).mockResolvedValue([
      baseListing({
        id: 'listing-mine',
        sellerId: 'guest-1',
        itemId: weapon.id,
        itemSnapshot: weapon,
        displayName: weapon.name,
        weaponType: 'Pistol',
        element: 'Shock',
        rarity: 'Rare',
        itemLevel: 5,
        price: 8_000,
        unitPrice: 8_000,
        listedAt: NOW - 3 * HOUR,
      }),
    ]);
    useMarketStore.setState({ activeTab: 'sell', history: [] });
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, name: 'Guest',
    } as never);
    useInventoryStore.setState({ items: [] } as never);
  });
  afterEach(() => cleanup());

  it('own listings read at a glance: Listed age + net proceeds + price hero + Cancel on the row', async () => {
    render(<MarketScreen />);
    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }));
    expect(await screen.findByText('Storm Ledger Rifle')).toBeInTheDocument();
    const row = screen.getByTestId('market-list-row');
    expect(row.getAttribute('data-kind')).toBe('gear');
    expect(row.className).toContain('min-h-[46px]');
    expect(row.textContent).toContain('8,000cr');
    expect(row.textContent).toContain('Listed 3h');
    // The net amount leads the proceeds fact (the full fee sentence
    // lives on the Sell form; the row is a glance surface).
    expect(row.textContent).toContain('Net 7,600cr');
    expect(row.textContent).toContain('after the 5% fee');
    expect(within(row).getByRole('button', { name: /Cancel Listing/ })).toBeInTheDocument();
  }, 30_000);
});

describe('ListingRow — per-kind anatomy (component)', () => {
  afterEach(() => cleanup());
  const now = NOW;

  it('vehicle row: class + condition + seller + age, sprite thumb, price hero', () => {
    render(
      <ListingRow
        listing={vehicleListing}
        index={0}
        reduceMotion
        now={now}
        sellerLabel={<>Seller · Rook Sandoval</>}
        action={<button type="button">Buy Now</button>}
      />,
    );
    const row = screen.getByTestId('market-list-row');
    expect(row.getAttribute('data-kind')).toBe('vehicle');
    expect(row.textContent).toContain('Leviathan Rig');
    expect(row.textContent).toContain(getVehicleClass('leviathan_rig')!.displayName);
    expect(row.textContent).toContain('Cond 55%');
    expect(row.textContent).toContain('45,000cr');
    expect(row.textContent).toContain('1d');
    expect(row.querySelector('[data-testid="garage-vehicle-sprite"]')).not.toBeNull();
  });

  it('cosmetic row: compact portrait well (not the tall card), set · slot · quality on the fact line', () => {
    render(
      <ListingRow
        listing={baseListing({
          id: 'listing-cos',
          kind: 'cosmetic',
          category: 'cosmetic',
          partId: 'bulwark-torso',
          displayName: 'Bulwark Siege Torso',
          qualityPercent: 80,
          price: 2_400,
          unitPrice: 2_400,
          listedAt: NOW - 30 * 60_000,
        })}
        index={0}
        reduceMotion
        now={now}
        sellerLabel={<>Seller · Rook Sandoval</>}
      />,
    );
    const row = screen.getByTestId('market-list-row');
    expect(row.getAttribute('data-kind')).toBe('cosmetic');
    expect(row.textContent).toContain('Bulwark Siege Torso');
    expect(row.textContent).toContain('Q80%');
    expect(row.textContent).toContain('torso');
    expect(row.textContent).toContain('2,400cr');
    expect(row.textContent).toContain('30m');
  });

  it('consumable stack row: quality percent rides the fact line', () => {
    render(
      <ListingRow
        listing={baseListing({
          id: 'listing-cons',
          kind: 'consumable',
          category: 'consumable',
          displayName: 'MedKit',
          consumableType: 'MedKit',
          quantity: 4,
          qualityPercent: 85,
          price: 1_000,
          unitPrice: 250,
          listedAt: NOW - 10 * 60_000,
        })}
        index={0}
        reduceMotion
        now={now}
        sellerLabel={<>Seller · Rook Sandoval</>}
      />,
    );
    const row = screen.getByTestId('market-list-row');
    expect(row.textContent).toContain('85% quality');
    expect(row.textContent).toContain('×4');
    expect(row.textContent).toContain('1,000cr');
  });
});

describe('Sell-lane candidate identity rows (component)', () => {
  afterEach(() => cleanup());

  it('gear candidate: Gear anatomy with the stat headline — no price yet', () => {
    render(<GearCandidateRow item={weapon} onInspect={() => {}} />);
    expect(screen.getByText('Storm Ledger Rifle')).toBeInTheDocument();
    expect(screen.getByText('Lv 5')).toBeInTheDocument();
    expect(document.querySelector('[data-element-badge]')).not.toBeNull();
    expect(document.querySelector('[data-density="stage"]')).not.toBeNull();
    expect(document.body.textContent).toContain('DPS');
    expect(document.body.textContent).not.toContain('cr');
  });

  it('vehicle candidate: class + condition + first affix fact line, Yield headline', () => {
    render(<VehicleCandidateRow vehicle={vehicle} />);
    // Name + class line both read 'Leviathan Rig' for this fixture.
    expect(screen.getAllByText('Leviathan Rig').length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).toContain('Cond 55%');
    expect(document.body.textContent).toContain('Yield');
  });
});

describe('price headline + age (units)', () => {
  it('priceRowHeadline is the gearRowHeadline variant: total price, amber, no label', () => {
    expect(priceRowHeadline(12_500)).toEqual({ label: null, value: '12,500cr', tone: 'text-amber' });
    expect(priceRowHeadline(0).value).toBe('0cr');
  });

  it('listingAgeLabel compacts the listing age', () => {
    expect(listingAgeLabel(NOW - 30_000, NOW)).toBe('now');
    expect(listingAgeLabel(NOW - 5 * 60_000, NOW)).toBe('5m');
    expect(listingAgeLabel(NOW - 2 * HOUR, NOW)).toBe('2h');
    expect(listingAgeLabel(NOW - 3 * 24 * HOUR, NOW)).toBe('3d');
    expect(listingAgeLabel(NOW - 15 * 24 * HOUR, NOW)).toBe('2w');
  });
});
