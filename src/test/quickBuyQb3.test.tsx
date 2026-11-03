/**
 * QuickBuy QB-3 — the render rule on the new surfaces, plus the
 * fuel shortfall helper the dispatch mount is keyed to.
 *
 *  - Dispatch courier preview: the + exists on the fuel line
 *    exactly when the server's own shortfall (fuel cost vs the
 *    tank the preview priced against) is positive, in whole
 *    Generic Fuel Cells — the count the Chef's refusal names.
 *    Covered tanks and foot contracts never show it. Clicking it
 *    opens the sheet at the exact shortfall.
 *  - Boss prep + Endless belt: the + exists on a belt row exactly
 *    when the belt's commitment (preparedConsumables — restored
 *    unclamped) exceeds the stock on hand. Covered commitments
 *    never show it. Clicking it opens the sheet at the gap.
 *  - dispatchFuelShortfallCells restates the dispatch route's
 *    refusal formula (src/server/routes/dispatch.ts) verbatim.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountState } from '@/auth/accountState';
import type { QuickBuyQuote } from '@/lib/market/quickBuy';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'player-1' } as { id: string } | null,
    account: null as AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
  getDispatchState: vi.fn(),
  previewDispatch: vi.fn(),
  getEndlessMe: vi.fn(),
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
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/chef/chefClient', () => ({
  getDispatchState: (...args: unknown[]) => hoisted.getDispatchState(...args),
  previewDispatch: (...args: unknown[]) => hoisted.previewDispatch(...args),
  startDispatch: vi.fn(async () => { throw new Error('not in QB-3 tests'); }),
  recallDispatch: vi.fn(async () => { throw new Error('not in QB-3 tests'); }),
  newDispatchNonce: (kind: string) => `dispatch-${kind}-test-nonce`,
  verifyBossFight: vi.fn(async () => { throw new Error('not in QB-3 tests'); }),
  getActionSkillState: vi.fn(async () => ({
    verified: true,
    actionSkill: {
      charge: 0,
      chargeMax: 100,
      charged: false,
      selection: null,
      selected: null,
      qualified: [],
      signatures: [],
      noKeystoneNote: 'No action skill yet.',
    },
  })),
  getEndlessMe: (...args: unknown[]) => hoisted.getEndlessMe(...args),
  advanceEndlessEncounter: vi.fn(async () => { throw new Error('not in QB-3 tests'); }),
  bankEndlessRun: vi.fn(async () => { throw new Error('not in QB-3 tests'); }),
  startEndlessRun: vi.fn(async () => { throw new Error('not in QB-3 tests'); }),
  newEndlessNonce: (kind: string) => `endless-${kind}-test-nonce`,
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

import { DispatchPanel } from '@/components/dispatch/DispatchPanel';
import { BossEncounterPanel } from '@/components/fight/BossEncounterPanel';
import { EndlessPanel } from '@/components/fight/EndlessPanel';
import { dispatchFuelShortfallCells } from '@/content/dispatch';
import { endlessIntel } from '@/content/endless';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { RiskSetting } from '@/types/game';
import { useBossStore, useLoadoutStore, usePlayerStore } from '@/store';
import type { ChefDispatchState } from '@/lib/chef/chefClient';

const verifiedAccount: AccountState = {
  userId: 'player-1',
  accountType: 'verified',
  username: 'hunter',
  hasUsername: true,
  email: 'hunter@example.com',
  emailVerifiedAt: '2026-06-14T00:00:00.000Z',
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: false,
};

function quoteFor(id: string, qty: number, vendorUnit: number | null): QuickBuyQuote {
  return {
    action_type: 'cc_quickbuy_quote',
    good: { kind: 'consumable', id },
    requested_qty: qty,
    balance: 100_000,
    market: { listings: [], fills: [], total: 0, fillableQty: 0, supplyQty: 0, partial: true, worstUnitPrice: null },
    vendor: vendorUnit === null
      ? null
      : { unitPrice: vendorUnit, basePrice: vendorUnit, itemOfTheDay: false, staple: true, total: vendorUnit * qty },
  };
}

const FUEL_PLUS = 'quickbuy-plus-consumable-GenericFuelCell';
const MEDKIT_PLUS = 'quickbuy-plus-consumable-MedKit';

describe('dispatchFuelShortfallCells — the route refusal formula, restated', () => {
  it('prices the unit gap in whole cells, rounded up', () => {
    expect(dispatchFuelShortfallCells(300, 100)).toBe(2);
    expect(dispatchFuelShortfallCells(301, 300)).toBe(1);
    expect(dispatchFuelShortfallCells(250, 0)).toBe(3);
    expect(dispatchFuelShortfallCells(100, 0)).toBe(1);
  });

  it('is 0 when the tank covers the route or the inputs are degenerate', () => {
    expect(dispatchFuelShortfallCells(300, 300)).toBe(0);
    expect(dispatchFuelShortfallCells(300, 450)).toBe(0);
    expect(dispatchFuelShortfallCells(0, 0)).toBe(0);
    expect(dispatchFuelShortfallCells(Number.NaN, 100)).toBe(0);
    expect(dispatchFuelShortfallCells(300, Number.NaN)).toBe(0);
  });
});

describe('DispatchPanel — courier fuel quick-buy mount', () => {
  const courierOffer = {
    id: 'offer-courier-1', family: 'courier' as const, areaId: 'dustwaste',
    durationHours: 4, areaName: 'Dustwaste Frontier', dangerRating: 'High',
  };
  const footOffer = {
    id: 'offer-foot-1', family: 'foot' as const, areaId: 'dustwaste',
    durationHours: 2, areaName: 'Dustwaste Frontier', dangerRating: 'Low',
  };
  const vehicle = {
    id: 'veh-1', kind: 'vehicle', name: 'Trusty Hauler', itemLevel: 10,
    rarity: 'Common', runtimeState: 'available', equippedSlot: null,
    isLocked: false, vehicleClassId: 'cargo_hauler', conditionCurrent: 90, conditionMax: 100,
  };

  function stateWith(offers: ChefDispatchState['offers']): ChefDispatchState {
    return {
      slots: 2, slotsUsed: 0, playerLevel: 20, vehicleFuel: 100,
      offers, missions: [], candidates: [vehicle],
    };
  }

  function courierPreview(fuelUnits: number, fuelAvailable: number) {
    return {
      verified: true as const,
      eligible: fuelAvailable >= fuelUnits,
      reasons: fuelAvailable >= fuelUnits
        ? []
        : [`Insufficient vehicle fuel — needs ${dispatchFuelShortfallCells(fuelUnits, fuelAvailable)} more Generic Fuel Cells`],
      preview: {
        family: 'courier', vehicleName: 'Trusty Hauler',
        fuelUnits, fuelCells: Math.ceil(fuelUnits / 100), fuelAvailable,
        wearProjected: 5, returnCondition: 85, breaksDown: false, breakdownFraction: null,
        payout: { credits: 500, scrap: 10, materialId: null, materialUnits: 0 },
        cargoBonusUnits: 0, premiumMultiplier: 1,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = verifiedAccount;
    hoisted.quickbuyQuote.mockImplementation(async (_kind: string, id: string, qty: number) =>
      quoteFor(id, qty, id === 'GenericFuelCell' ? 40 : null));
  });

  afterEach(() => cleanup());

  async function openCourier(preview: ReturnType<typeof courierPreview>) {
    hoisted.getDispatchState.mockResolvedValue({ verified: true, dispatch: stateWith([courierOffer]) });
    hoisted.previewDispatch.mockResolvedValue(preview);
    render(<DispatchPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Courier/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Trusty Hauler/ }));
    await screen.findByText(/Fuel cost:/);
  }

  it('short tank: the + sits on the fuel line and the sheet opens at the exact cell shortfall', async () => {
    await openCourier(courierPreview(300, 100));
    const plus = await screen.findByTestId(FUEL_PLUS);
    expect(plus).toBeInTheDocument();
    fireEvent.click(plus);
    await waitFor(() =>
      expect(hoisted.quickbuyQuote).toHaveBeenCalledWith('consumable', 'GenericFuelCell', 2));
  });

  it('covered tank: no + on the fuel line', async () => {
    await openCourier(courierPreview(300, 300));
    expect(screen.queryByTestId(FUEL_PLUS)).not.toBeInTheDocument();
  });

  it('foot contract: no fuel line, no +', async () => {
    hoisted.getDispatchState.mockResolvedValue({ verified: true, dispatch: stateWith([footOffer]) });
    hoisted.previewDispatch.mockResolvedValue({
      verified: true, eligible: false, reasons: ['Pick at least one spare item for the loadout'],
      preview: { family: 'foot', strengthFactor: 0, payout: { credits: 0, scrap: 0, materialId: null, materialUnits: 0 } },
    });
    render(<DispatchPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Foot/ }));
    await screen.findByText(/Assign a spare loadout/);
    expect(screen.queryByTestId(FUEL_PLUS)).not.toBeInTheDocument();
  });
});

describe('boss + endless belt — commitment-over-stock quick-buy mount', () => {
  const boss = REGION_1_BOSSES[0];

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.account = verifiedAccount;
    // The Chamber's /me resolves with the content owner's own intel
    // and no active run, so the panel lands on its prep stage (a
    // rejection renders the error screen instead of the belt).
    hoisted.getEndlessMe.mockResolvedValue({
      verified: true,
      intel: endlessIntel(20, 0),
      bestDepth: 0,
      runsStartedToday: 0,
      recentRuns: [],
      activeRun: null,
    });
    hoisted.quickbuyQuote.mockImplementation(async (_kind: string, id: string, qty: number) =>
      quoteFor(id, qty, id === 'MedKit' ? 250 : null));
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, shield: null, ordnance: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    useBossStore.setState({
      currentBossId: boss.id,
      unlockedBossIds: [boss.id],
      defeatedBossIds: [],
      pityCounters: {},
      preparedConsumables: {},
      selectedRisk: RiskSetting.Balanced,
      attemptHistory: [],
    });
  });

  afterEach(() => cleanup());

  function seedBelt(owned: number, committed: number) {
    usePlayerStore.setState({ id: 'player-1', level: 20, credits: 100_000, consumables: { MedKit: owned } });
    useBossStore.setState({ preparedConsumables: committed > 0 ? { MedKit: committed } : {} });
  }

  it('boss prep: commitment 3 vs stock 1 — the + opens the sheet at the gap of 2', async () => {
    seedBelt(1, 3);
    render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);
    const plus = await screen.findByTestId(MEDKIT_PLUS);
    fireEvent.click(plus);
    await waitFor(() =>
      expect(hoisted.quickbuyQuote).toHaveBeenCalledWith('consumable', 'MedKit', 2));
  });

  it('boss prep: stock covers the commitment — no +', async () => {
    seedBelt(5, 3);
    render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);
    await screen.findByText('Owned 5 · spent:', { exact: false });
    expect(screen.queryByTestId(MEDKIT_PLUS)).not.toBeInTheDocument();
  });

  it('boss prep: no commitment — no +', async () => {
    seedBelt(2, 0);
    render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);
    await screen.findByText('Owned 2 · spent:', { exact: false });
    expect(screen.queryByTestId(MEDKIT_PLUS)).not.toBeInTheDocument();
  });

  it('endless belt: commitment 3 vs stock 1 — the + is on the belt row', async () => {
    seedBelt(1, 3);
    render(<EndlessPanel onLeave={() => {}} />);
    expect(await screen.findByTestId(MEDKIT_PLUS)).toBeInTheDocument();
  });

  it('endless belt: stock covers the commitment — no +', async () => {
    seedBelt(4, 2);
    render(<EndlessPanel onLeave={() => {}} />);
    await screen.findByText('Prepare Belt');
    expect(screen.queryByTestId(MEDKIT_PLUS)).not.toBeInTheDocument();
  });
});
