/**
 * QuickBuy QB-2 — the render rule on the new surfaces.
 *
 * The + exists exactly on shortfall GOODS lines and nowhere else:
 *  - RepairBoard: on the open card's requirements line, keyed to
 *    the SELECTED kit's server shortfall — present when short,
 *    absent when covered, absent on the reader's own posting, and
 *    never on the card's credit lines (price / escrow).
 *  - ShieldTechBoard: same rule on the Calibration Core line.
 *  - Garage: on the repair controls row when the selected kit is
 *    short of a FULL restore of the vehicle's deficit (walked from
 *    the player's real batches), absent when the stock covers it
 *    and absent on a whole vehicle (no repair lane at all).
 *  - A fill through the sheet re-reads the board view (onFilled):
 *    the board's requirements are a server view and would
 *    otherwise keep showing pre-fill stock.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountState } from '@/auth/accountState';
import type { QuickBuyQuote } from '@/lib/market/quickBuy';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'reader-1' } as { id: string } | null,
    account: null as AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
  fetchRepairBoard: vi.fn(),
  fetchShieldTechBoard: vi.fn(),
  quickbuyQuote: vi.fn(),
  quickbuyFill: vi.fn(),
  opNames: [
    'acceptRepairJob', 'cancelRepairJob', 'reclaimRepairJob', 'postRepairJob',
    'acceptShieldTechJob', 'cancelShieldTechJob', 'reclaimShieldTechJob',
    'postShieldTechJob', 'enqueueShieldTechJob', 'finishShieldTechJob',
    'equipItem', 'unequipSlot', 'refuelVehicle', 'enqueueRepairJob',
  ],
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    ...Object.fromEntries(hoisted.opNames.map((name) => [name, vi.fn(async () => ({}))])),
    quickbuyQuote: (...args: unknown[]) => hoisted.quickbuyQuote(...args),
    quickbuyFill: (...args: unknown[]) => hoisted.quickbuyFill(...args),
  },
  fetchRepairBoard: hoisted.fetchRepairBoard,
  fetchShieldTechBoard: hoisted.fetchShieldTechBoard,
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
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

import { RepairBoard } from '@/components/market/RepairBoard';
import { ShieldTechBoard } from '@/components/market/ShieldTechBoard';
import { GaragePanel } from '@/components/gear/GaragePanel';
import { useLoadoutStore, usePlayerStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { DropSource, Rarity } from '@/types/game';
import type { ConsumableBatch } from '@/types/player';

const verifiedAccount: AccountState = {
  userId: 'reader-1',
  accountType: 'verified',
  username: 'hunter',
  hasUsername: true,
  email: 'hunter@example.com',
  emailVerifiedAt: '2026-06-14T00:00:00.000Z',
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: false,
};

const pluses = (container: HTMLElement) =>
  container.querySelectorAll('[data-testid^="quickbuy-plus-"]');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function repairBoardView(opts: {
  ownerUserId?: string;
  patchShortfall?: number;
  fieldShortfall?: number;
  masterShortfall?: number;
  covers?: boolean;
} = {}) {
  const covers = opts.covers ?? false;
  const kit = (kitType: string, shortfall: number) => ({
    kitType,
    onHand: covers ? 3 : 0,
    estimatedKits: covers ? 1 : null,
    coversTarget: covers,
    shortfallKits: shortfall,
  });
  return {
    open: [{
      id: 'job-1',
      ownerUserId: opts.ownerUserId ?? 'owner-9',
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
        canTake: !covers ? false : true,
        blockers: covers ? [] : ['no_supply'],
        kitOptions: [
          kit('PatchKit', opts.patchShortfall ?? 2),
          kit('FieldPatchKit', opts.fieldShortfall ?? 1),
          kit('MasterPatchKit', opts.masterShortfall ?? 1),
        ],
        estimatedHours: 2,
      },
    }],
    openTotal: 1,
    mine: [],
    work: [],
    stats: { medianCreditsPerPoint: 20, medianSampleSize: 3, myMasteryLevel: 1, myJobsCompleted: 0, myJobsAbandoned: 0 },
    levers: { serviceXpPerPoint: 2, repairAbandonWindowHours: 24, repairListingExpiryDays: 3, marketFeeRate: 0.05 },
  };
}

function shieldTechBoardView(opts: { ownerUserId?: string; shortfallCores?: number } = {}) {
  const shortfall = opts.shortfallCores ?? 2;
  return {
    open: [{
      id: 'stjob-1',
      ownerUserId: opts.ownerUserId ?? 'owner-9',
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
        canTake: shortfall === 0,
        blockers: shortfall === 0 ? [] : ['no_supply'],
        coresOnHand: shortfall === 0 ? 4 : 0,
        estimatedCores: shortfall === 0 ? 1 : null,
        coversTarget: shortfall === 0,
        shortfallCores: shortfall,
        estimatedHours: 4,
      },
    }],
    openTotal: 1,
    mine: [],
    work: [],
    medianPerThousandByRarity: {},
    stats: { medianSampleSize: 0, myMasteryLevel: 1, myMasteryXp: 0, myJobsCompleted: 0, myJobsAbandoned: 0 },
    levers: { shieldTechXpPerPoint: 2, shieldTechAbandonWindowHours: 24, shieldTechListingExpiryDays: 3, marketFeeRate: 0.05 },
  };
}

function patchKitQuote(): QuickBuyQuote {
  return {
    action_type: 'cc_quickbuy_quote',
    good: { kind: 'consumable', id: 'PatchKit' },
    requested_qty: 2,
    balance: 100_000,
    market: {
      supplyQty: 5,
      fillableQty: 2,
      partial: false,
      total: 300,
      worstUnitPrice: 150,
      fills: [{ listingId: 'l1', sellerKind: 'player', takeQty: 2, unitPrice: 150, charge: 300, qualityPercent: 100 }],
      listings: [
        { id: 'l1', sellerUserId: 's1', sellerKind: 'player', quantity: 5, priceCredits: 750, qualityPercent: 100, listedAt: '2026-11-04T07:00:00.000Z' },
      ],
    },
    vendor: { unitPrice: 150, basePrice: 150, itemOfTheDay: false, staple: true, total: 300 },
  };
}

beforeEach(() => {
  hoisted.auth.account = verifiedAccount;
  hoisted.fetchRepairBoard.mockReset();
  hoisted.fetchShieldTechBoard.mockReset();
  hoisted.quickbuyQuote.mockReset();
  hoisted.quickbuyFill.mockReset();
  hoisted.quickbuyQuote.mockResolvedValue(patchKitQuote());
  usePlayerStore.setState({ consumables: {}, consumableBatches: [], vehicleFuel: 0 });
  useVehicleStore.setState({ vehicles: [], lastClaimStatus: null });
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// RepairBoard
// ---------------------------------------------------------------------------

describe('QB-2 render rule — RepairBoard', () => {
  it('mounts the + for the selected kit exactly when the server says the reader is short', async () => {
    hoisted.fetchRepairBoard.mockResolvedValue(repairBoardView());
    const { container } = render(<RepairBoard />);
    const plus = await screen.findByTestId('quickbuy-plus-consumable-PatchKit');
    expect(plus.getAttribute('aria-label')).toBe('Buy more Patch Kit');
    // Exactly one + on the card — the credit lines (price, escrow)
    // never get one.
    expect(pluses(container)).toHaveLength(1);
  });

  it('follows the kit picker: each kit line carries its own shortfall', async () => {
    hoisted.fetchRepairBoard.mockResolvedValue(repairBoardView());
    render(<RepairBoard />);
    await screen.findByTestId('quickbuy-plus-consumable-PatchKit');
    fireEvent.change(screen.getByLabelText('Kit you will supply'), { target: { value: 'FieldPatchKit' } });
    expect(await screen.findByTestId('quickbuy-plus-consumable-FieldPatchKit')).toBeTruthy();
    expect(screen.queryByTestId('quickbuy-plus-consumable-PatchKit')).toBeNull();
  });

  it('mounts nothing when the reader’s stock covers the job', async () => {
    hoisted.fetchRepairBoard.mockResolvedValue(
      repairBoardView({ covers: true, patchShortfall: 0, fieldShortfall: 0, masterShortfall: 0 }),
    );
    const { container } = render(<RepairBoard />);
    await screen.findByText(/Escrow held/);
    expect(pluses(container)).toHaveLength(0);
  });

  it('mounts nothing on the reader’s own posting', async () => {
    hoisted.fetchRepairBoard.mockResolvedValue(repairBoardView({ ownerUserId: 'reader-1' }));
    const { container } = render(<RepairBoard />);
    await screen.findByText(/your posting/);
    expect(pluses(container)).toHaveLength(0);
  });

  it('a fill through the sheet re-reads the board view (onFilled)', async () => {
    hoisted.fetchRepairBoard.mockResolvedValue(repairBoardView());
    hoisted.quickbuyFill.mockResolvedValue({
      status: 'filled', quantity: 2, total_charged: 300, profile: { credits: 99_700 },
    });
    render(<RepairBoard />);
    fireEvent.click(await screen.findByTestId('quickbuy-plus-consumable-PatchKit'));
    await waitFor(() => expect(hoisted.quickbuyQuote).toHaveBeenCalledWith('consumable', 'PatchKit', 2));
    fireEvent.click(await screen.findByTestId('quickbuy-buy'));
    await screen.findByTestId('quickbuy-receipt');
    await waitFor(() => expect(hoisted.fetchRepairBoard.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

// ---------------------------------------------------------------------------
// ShieldTechBoard
// ---------------------------------------------------------------------------

describe('QB-2 render rule — ShieldTechBoard', () => {
  it('mounts the + on the Calibration Core line when the reader is short', async () => {
    hoisted.fetchShieldTechBoard.mockResolvedValue(shieldTechBoardView());
    const { container } = render(<ShieldTechBoard />);
    const plus = await screen.findByTestId('quickbuy-plus-consumable-CalibrationCore');
    expect(plus.getAttribute('aria-label')).toBe('Buy more Calibration Core');
    expect(pluses(container)).toHaveLength(1);
  });

  it('mounts nothing when the reader’s cores cover the job', async () => {
    hoisted.fetchShieldTechBoard.mockResolvedValue(shieldTechBoardView({ shortfallCores: 0 }));
    const { container } = render(<ShieldTechBoard />);
    await screen.findByText(/Escrow held/);
    expect(pluses(container)).toHaveLength(0);
  });

  it('mounts nothing on the reader’s own posting', async () => {
    hoisted.fetchShieldTechBoard.mockResolvedValue(shieldTechBoardView({ ownerUserId: 'reader-1' }));
    const { container } = render(<ShieldTechBoard />);
    await screen.findByText(/posted by/);
    expect(pluses(container)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Garage
// ---------------------------------------------------------------------------

const bike = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => ({
  id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 40, conditionMax: 100,
  runtimeState: 'available',
  ...overrides,
});

const batch = (type: string, quality: number, quantity: number): ConsumableBatch => ({
  id: `batch-${type}-${quality}-${quantity}`,
  consumable_type: type,
  quality_percent: quality,
  quantity,
  origin: 'crafted',
});

function seedGarage(opts: {
  vehicle: VehicleDisplay;
  consumables?: Record<string, number>;
  batches?: ConsumableBatch[];
}) {
  useLoadoutStore.setState({
    slots: {
      primary: null, secondary: null, heavy: null, ordnance: null,
      shield: null, classMod: null, relic: null, vehicle: opts.vehicle.id,
    },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({
    level: 10,
    consumables: opts.consumables ?? {},
    consumableBatches: opts.batches ?? [],
    vehicleFuel: 0,
  });
  useVehicleStore.setState({ vehicles: [opts.vehicle], lastClaimStatus: null });
}

describe('QB-2 render rule — Garage repair lane', () => {
  it('mounts the + when the selected kit cannot fully restore the vehicle (deficit 60, no kits)', async () => {
    seedGarage({ vehicle: bike() });
    const { container } = render(<GaragePanel onNavigate={vi.fn()} />);
    const plus = await screen.findByTestId('quickbuy-plus-consumable-PatchKit');
    expect(plus.getAttribute('aria-label')).toBe('Buy more Patch Kit');
    expect(pluses(container)).toHaveLength(1);
  });

  it('still mounts with a partial stock (1 kit covers 30 of the 60-point deficit)', async () => {
    seedGarage({
      vehicle: bike(),
      consumables: { PatchKit: 1 },
      batches: [batch('PatchKit', 100, 1)],
    });
    render(<GaragePanel onNavigate={vi.fn()} />);
    expect(await screen.findByTestId('quickbuy-plus-consumable-PatchKit')).toBeTruthy();
  });

  it('mounts nothing when the stock covers a full restore (3 kits cover 90 ≥ 60)', async () => {
    seedGarage({
      vehicle: bike(),
      consumables: { PatchKit: 3 },
      batches: [batch('PatchKit', 100, 3)],
    });
    const { container } = render(<GaragePanel onNavigate={vi.fn()} />);
    await screen.findByText(/Restore Condition/);
    expect(pluses(container)).toHaveLength(0);
  });

  it('mounts nothing on a whole vehicle — there is no repair lane and no fuel line gets one', async () => {
    seedGarage({ vehicle: bike({ conditionCurrent: 100 }) });
    const { container } = render(<GaragePanel onNavigate={vi.fn()} />);
    await screen.findByText(/Condition/);
    expect(pluses(container)).toHaveLength(0);
  });
});
