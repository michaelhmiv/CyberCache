/**
 * Assumption-gaps fix program, slice A — service-board remedies
 * (audit G2 + the queue-full half of G8; DESIGN.md standing rule
 * "every 'no' carries its remedy", owner-approved 2026-11-02).
 *
 * Pins:
 *  - Repair board: the no-supply blocker names the READER as the
 *    supplier ("You supply the kits" — the old "The mechanic
 *    supplies the kits" misled, because the mechanic is the player),
 *    and names every real source: Vendor staple, Workshop Basic
 *    Bench craft, player Market — with working doors on the line.
 *  - Shield-Tech board: same shape for Calibration Cores, with the
 *    craft gate stated plainly (Lv 15 + Forge bench — the only
 *    self-supply path, invisible before this fix) plus the Market
 *    door, the only path for a sub-15 tech.
 *  - The Market door lands on Buy → Consumables pre-searched for the
 *    missing supply (buy-browse intent), and is consumed once.
 *  - Workshop (G8): the bench-queue-full disabled reason names its
 *    remedy, and a locked bench in the bench picker points at the
 *    Benches & Tools card that unlocks it (source pins).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { fetchRepairBoard, fetchShieldTechBoard } from '@/lib/api/verifiedOps';
import { fetchMarketListings } from '@/lib/api/marketListings';
import { useInventoryStore, useMarketStore, usePlayerStore } from '@/store';
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

const repairBoardView = {
  open: [{
    id: 'job-1',
    ownerUserId: 'owner-9',
    ownerName: 'someoneelse',
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
    requirements: {
      escrowCredits: 600,
      canTake: false,
      blockers: ['no_supply'],
      kitOptions: [
        { kitType: 'PatchKit', onHand: 0, estimatedKits: 1, coversTarget: false },
        { kitType: 'FieldPatchKit', onHand: 0, estimatedKits: 1, coversTarget: false },
        { kitType: 'MasterPatchKit', onHand: 0, estimatedKits: 1, coversTarget: false },
      ],
      estimatedHours: null,
    },
  }],
  openTotal: 1,
  mine: [],
  work: [],
  stats: { medianCreditsPerPoint: 20, medianSampleSize: 3, myMasteryLevel: 1, myJobsCompleted: 0, myJobsAbandoned: 0 },
  levers: { serviceXpPerPoint: 2, repairAbandonWindowHours: 24, repairListingExpiryDays: 3, marketFeeRate: 0.05 },
};

const shieldTechBoardView = {
  open: [{
    id: 'stjob-1',
    ownerUserId: 'owner-9',
    ownerName: 'someoneelse',
    providerUserId: null,
    providerName: null,
    status: 'listed',
    outcome: null,
    shield: { itemId: 'shield-1', rarity: 'Rare', capacity: 1500, behavior: 'standard', behaviorName: 'Standard' },
    fromBehavior: 'standard',
    fromBehaviorName: 'Standard',
    fromBehaviorDescription: null,
    toBehavior: 'nova',
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
    requirements: {
      escrowCredits: 900,
      canTake: false,
      blockers: ['no_supply'],
      coresOnHand: 0,
      estimatedCores: 1,
      coversTarget: false,
      estimatedHours: null,
    },
  }],
  openTotal: 1,
  mine: [],
  work: [],
  medianPerThousandByRarity: {},
  stats: { medianSampleSize: 0, myMasteryLevel: 1, myMasteryXp: 0, myJobsCompleted: 0, myJobsAbandoned: 0 },
  levers: { shieldTechXpPerPoint: 2, shieldTechAbandonWindowHours: 24, shieldTechListingExpiryDays: 3, marketFeeRate: 0.05 },
};

describe('service-board remedies — blocker lines name the supply, its sources, and its doors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = verifiedAccount;
    hoisted.auth.user = { id: 'user-1' };
    vi.mocked(fetchMarketListings).mockResolvedValue({ listings: [], total: 0 });
    vi.mocked(fetchRepairBoard).mockResolvedValue(repairBoardView as never);
    vi.mocked(fetchShieldTechBoard).mockResolvedValue(shieldTechBoardView as never);
    useMarketStore.setState({ activeTab: 'buy', history: [], buyBrowseIntent: null, marketStopIntent: null });
    usePlayerStore.setState({
      credits: 100_000, consumables: {}, consumableBatches: [], materials: {}, name: 'Hunter',
    } as never);
    useInventoryStore.setState({ items: [] } as never);
  });
  afterEach(() => cleanup());

  it('Repair board: the no-kits blocker names YOU as supplier and every source', async () => {
    useMarketStore.setState({ activeTab: 'repair' });
    render(<MarketScreen />);
    expect(await screen.findByText(/Needs patch kits to start/)).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).toContain('You supply the kits; the price covers kits + labor.');
    expect(text).toContain('Basic Bench');
    expect(text).not.toContain('The mechanic supplies the kits');
    expect(screen.getByRole('button', { name: 'Get Patch Kits from the Vendor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy Patch Kits on the player Market' })).toBeInTheDocument();
  }, 30_000);

  it('Repair board: the Market door lands on Buy → Consumables searched for Patch Kits', async () => {
    useMarketStore.setState({ activeTab: 'repair' });
    render(<MarketScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Patch Kits on the player Market' }));
    expect(useMarketStore.getState().activeTab).toBe('buy');
    await vi.waitFor(() =>
      expect(vi.mocked(fetchMarketListings)).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'consumable', search: 'Patch Kit' }),
      ),
    );
    // The intent is one-shot: consumed on landing, not sticky.
    expect(useMarketStore.getState().buyBrowseIntent).toBeNull();
    expect((screen.getByPlaceholderText('Search items…') as HTMLInputElement).value).toBe('Patch Kit');
  }, 30_000);

  it('Repair board: the Vendor door lands on the Vendor stop', async () => {
    useMarketStore.setState({ activeTab: 'repair' });
    render(<MarketScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Get Patch Kits from the Vendor' }));
    expect(useMarketStore.getState().activeTab).toBe('vendor');
  }, 30_000);

  it('Shield-Tech board: the no-cores blocker states the craft gate plainly and drops the misleading supplier', async () => {
    useMarketStore.setState({ activeTab: 'shieldTech' });
    render(<MarketScreen />);
    expect(await screen.findByText(/Needs Calibration Cores to start/)).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).toContain('You supply the cores; the price covers cores + labor.');
    expect(text).toContain('Lv 15');
    expect(text).toContain('Forge bench');
    expect(text).not.toContain('The tech supplies the cores');
    expect(screen.getByRole('button', { name: 'Buy Calibration Cores on the player Market' })).toBeInTheDocument();
  }, 30_000);

  it('Shield-Tech board: the Market door lands on Buy → Consumables searched for Calibration Cores', async () => {
    useMarketStore.setState({ activeTab: 'shieldTech' });
    render(<MarketScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Calibration Cores on the player Market' }));
    expect(useMarketStore.getState().activeTab).toBe('buy');
    await vi.waitFor(() =>
      expect(vi.mocked(fetchMarketListings)).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'consumable', search: 'Calibration Core' }),
      ),
    );
    expect(useMarketStore.getState().buyBrowseIntent).toBeNull();
  }, 30_000);
});

describe('remedy-law source pins — G8 queue remedy + the standing rule', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  it('Workshop: the bench-queue-full reason names its remedy, and a locked bench points at its unlock card', () => {
    const workshop = read('screens/WorkshopScreen.tsx');
    expect(workshop).toContain(
      'Bench queue full — jobs finish while Crafting is your action, or cancel one above',
    );
    expect(workshop).toContain('(locked — unlock at Benches & Tools above)');
  });

  it('Boards: the misleading supplier lines are gone from both boards', () => {
    expect(read('components/market/RepairBoard.tsx')).not.toContain('The mechanic supplies the kits');
    expect(read('components/market/ShieldTechBoard.tsx')).not.toContain('The tech supplies the cores');
  });

  it('DESIGN.md carries the standing rule, dated and owner-approved', () => {
    const design = read('../DESIGN.md');
    expect(design).toContain('Every "no" carries its remedy (owner-approved 2026-11-02)');
    expect(design).toContain('a shortage names');
    expect(design).toContain('where it comes from');
  });
});
