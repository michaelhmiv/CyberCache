/**
 * SB-3 — Dispatch "Start from build" (saved-builds brief §3 / D7).
 *
 * Laws under test:
 *  - PREFILL FIDELITY: picking a build puts EXACTLY the build's
 *    dispatchable items into the prep form — foot takes the seven
 *    gear slots (never the vehicle), courier takes the vehicle
 *    slot only — in slot order, nothing added, nothing dropped
 *    silently.
 *  - THE FLAG MATRIX: every build item that cannot dispatch now
 *    is reported with its true state — gone (missing from the
 *    Chef's records, or consumed/salvaged on record), listed,
 *    in_service (with the holding mission's return time), locked
 *    (board job), equipped (dispatch sends spares only) — and is
 *    NOT picked.
 *  - REFERENCES, NOT CLAIMS: prefill alone mutates nothing — no
 *    apply-build op, no equip, no departure call. It writes only
 *    the panel's pick state; manual toggles rule afterward.
 *  - DEPARTURE UNCHANGED: Depart sends the same wire shape
 *    (nonce + offer id + picked ids) through the same op as a
 *    hand-picked form; server validation is untouched (covered
 *    by dispatch.test.ts).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountState } from '@/auth/accountState';

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
  startDispatch: vi.fn(),
  applyBuild: vi.fn(async () => ({})),
  equipItem: vi.fn(async () => ({})),
  opNames: [
    'acceptRepairJob', 'cancelRepairJob', 'reclaimRepairJob', 'postRepairJob',
    'acceptShieldTechJob', 'cancelShieldTechJob', 'reclaimShieldTechJob',
    'postShieldTechJob', 'enqueueShieldTechJob', 'finishShieldTechJob',
    'unequipSlot', 'refuelVehicle', 'enqueueRepairJob',
  ],
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    ...Object.fromEntries(hoisted.opNames.map((name) => [name, vi.fn(async () => ({}))])),
    applyBuild: (...args: unknown[]) => hoisted.applyBuild(...(args as [])),
    equipItem: (...args: unknown[]) => hoisted.equipItem(...(args as [])),
    quickbuyQuote: vi.fn(async () => { throw new Error('not in SB-3 tests'); }),
    quickbuyFill: vi.fn(async () => { throw new Error('not in SB-3 tests'); }),
  },
  fetchWorkshopState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chef/chefClient')>();
  return {
    ...actual,
    getDispatchState: (...args: unknown[]) => hoisted.getDispatchState(...args),
    previewDispatch: (...args: unknown[]) => hoisted.previewDispatch(...args),
    startDispatch: (...args: unknown[]) => hoisted.startDispatch(...args),
    recallDispatch: vi.fn(async () => ({ verified: true, dispatch: null })),
    rerollDispatch: vi.fn(async () => ({ verified: true, dispatch: null })),
    newDispatchNonce: (kind: string) => `dispatch-${kind}-test-nonce`,
  };
});

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
import { computeBuildPrefill } from '@/lib/dispatch/buildPrefill';
import {
  useLoadoutPresetsStore,
  type LoadoutPreset,
} from '@/store/slices/loadoutPresetsSlice';
import type {
  ChefDispatchCandidate,
  ChefDispatchMission,
  ChefDispatchState,
} from '@/lib/chef/chefClient';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const EMPTY_SLOTS: Record<LoadoutSlot, string | null> = {
  primary: null, secondary: null, heavy: null, ordnance: null,
  shield: null, classMod: null, relic: null, vehicle: null,
};

function candidate(partial: Partial<ChefDispatchCandidate> & { id: string }): ChefDispatchCandidate {
  return {
    kind: 'weapon',
    name: partial.id,
    itemLevel: 12,
    rarity: 'Rare',
    runtimeState: 'available',
    equippedSlot: null,
    isLocked: false,
    vehicleClassId: null,
    conditionCurrent: null,
    conditionMax: null,
    ...partial,
  };
}

const MISSION: ChefDispatchMission = {
  id: 'mission-1',
  contract_family: 'foot',
  offer_id: 'offer-old',
  destination_area_id: 'dustwaste',
  duration_hours: 8,
  status: 'active',
  loadout_item_ids: ['gun-out'],
  payout_credits: 100,
  payout_scrap: 10,
  payout_material_id: null,
  payout_material_units: 0,
  vehicle_item_id: null,
  vehicle_class_id: null,
  fuel_charged_units: 0,
  fuel_refunded_units: 0,
  wear_projected: null,
  wear_applied: null,
  breakdown_fraction: null,
  payout_fraction: null,
  departed_at: '2026-11-04T00:00:00.000Z',
  ends_at: '2026-11-05T02:10:00.000Z',
  settled_at: null,
};

function build(partial: Partial<LoadoutPreset> & { slots: Record<LoadoutSlot, string | null> }): LoadoutPreset {
  return {
    id: 'preset-1',
    name: 'Crafting',
    consumables: { PreFight: null, MidFight: null, Emergency: null },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* Pure prefill matrix                                                 */
/* ------------------------------------------------------------------ */

describe('computeBuildPrefill — the flag matrix', () => {
  const candidates: ChefDispatchCandidate[] = [
    candidate({ id: 'gun-ready', name: 'Ready Rifle' }),
    candidate({ id: 'gun-worn', name: 'Worn Pistol', equippedSlot: 'secondary' }),
    candidate({ id: 'gun-listed', name: 'Listed Cannon', runtimeState: 'listed' }),
    candidate({ id: 'gun-out', name: 'Outbound SMG', runtimeState: 'in_service', isLocked: true }),
    candidate({ id: 'shield-job', name: 'Jobbed Shield', kind: 'shield', isLocked: true }),
    candidate({ id: 'mod-eaten', name: 'Eaten Mod', kind: 'classMod', runtimeState: 'salvaged' }),
    candidate({ id: 'spare-ride', name: 'Spare Ride', kind: 'vehicle', vehicleClassId: 'cargo_hauler', conditionCurrent: 80, conditionMax: 100 }),
  ];
  const slots: Record<LoadoutSlot, string | null> = {
    primary: 'gun-ready',
    secondary: 'gun-worn',
    heavy: 'gun-listed',
    ordnance: 'gun-out',
    shield: 'shield-job',
    classMod: 'mod-eaten',
    relic: 'relic-sold', // no record at all — gone
    vehicle: 'spare-ride',
  };

  it('foot: every gear slot classified, ready ids exact, vehicle never reported', () => {
    const prefill = computeBuildPrefill({ slots, family: 'foot', candidates, missions: [MISSION] });
    expect(prefill.readyItemIds).toEqual(['gun-ready']);
    expect(prefill.readyVehicleId).toBeNull();
    expect(prefill.lines.map((l) => [l.slot, l.status])).toEqual([
      ['primary', 'ready'],
      ['secondary', 'equipped'],
      ['heavy', 'listed'],
      ['ordnance', 'in_service'],
      ['shield', 'locked'],
      ['classMod', 'gone'],
      ['relic', 'gone'],
    ]);
    const out = prefill.lines.find((l) => l.slot === 'ordnance');
    expect(out?.returnsAt).toBe(MISSION.ends_at);
    expect(out?.name).toBe('Outbound SMG');
    const gone = prefill.lines.find((l) => l.slot === 'relic');
    expect(gone?.name).toBeNull(); // the record — and its name — left with it
  });

  it('courier: only the vehicle slot is read; a spare vehicle is the ready pick', () => {
    const prefill = computeBuildPrefill({ slots, family: 'courier', candidates, missions: [MISSION] });
    expect(prefill.readyItemIds).toEqual([]);
    expect(prefill.readyVehicleId).toBe('spare-ride');
    expect(prefill.lines).toHaveLength(1);
    expect(prefill.lines[0]).toMatchObject({ slot: 'vehicle', status: 'ready' });
  });

  it('courier: the equipped ride is flagged equipped, never picked', () => {
    const worn = [candidate({ id: 'spare-ride', name: 'My Ride', kind: 'vehicle', equippedSlot: 'vehicle', vehicleClassId: 'cargo_hauler' })];
    const prefill = computeBuildPrefill({ slots, family: 'courier', candidates: worn, missions: [] });
    expect(prefill.readyVehicleId).toBeNull();
    expect(prefill.lines[0].status).toBe('equipped');
  });

  it('empty slots are not lines; an in_service item with no mission on record still flags, without a time', () => {
    const prefill = computeBuildPrefill({
      slots: { ...EMPTY_SLOTS, primary: 'gun-out' },
      family: 'foot',
      candidates,
      missions: [],
    });
    expect(prefill.lines).toHaveLength(1);
    expect(prefill.lines[0]).toMatchObject({ status: 'in_service', returnsAt: null });
  });

  it('an unnamed runtime state never reads as ready', () => {
    const weird = [candidate({ id: 'gun-ready', runtimeState: 'escrowed' })];
    const prefill = computeBuildPrefill({
      slots: { ...EMPTY_SLOTS, primary: 'gun-ready' },
      family: 'foot',
      candidates: weird,
      missions: [],
    });
    expect(prefill.readyItemIds).toEqual([]);
    expect(prefill.lines[0].status).not.toBe('ready');
  });
});

/* ------------------------------------------------------------------ */
/* Panel behaviour                                                     */
/* ------------------------------------------------------------------ */

const FOOT_OFFER = {
  id: 'offer-foot-1', family: 'foot' as const, areaId: 'dustwaste',
  durationHours: 2, areaName: 'Dustwaste Frontier', dangerRating: 'Low',
};
const COURIER_OFFER = {
  id: 'offer-courier-1', family: 'courier' as const, areaId: 'dustwaste',
  durationHours: 4, areaName: 'Dustwaste Frontier', dangerRating: 'High',
};

const PANEL_CANDIDATES: ChefDispatchCandidate[] = [
  candidate({ id: 'gun-ready', name: 'Ready Rifle' }),
  candidate({ id: 'shield-ready', name: 'Ready Shield', kind: 'shield' }),
  candidate({ id: 'gun-out', name: 'Outbound SMG', runtimeState: 'in_service', isLocked: true }),
  candidate({ id: 'gun-listed', name: 'Listed Cannon', runtimeState: 'listed' }),
  candidate({ id: 'spare-ride', name: 'Spare Ride', kind: 'vehicle', vehicleClassId: 'cargo_hauler', conditionCurrent: 80, conditionMax: 100 }),
  candidate({ id: 'my-ride', name: 'My Ride', kind: 'vehicle', equippedSlot: 'vehicle', vehicleClassId: 'scout' }),
];

function dispatchState(): ChefDispatchState {
  return {
    slots: 2,
    slotsUsed: 1,
    playerLevel: 20,
    vehicleFuel: 500,
    credits: 5000,
    boardIndex: 0,
    boardDay: '2026-11-04',
    rerollsUsed: 0,
    rerollsRemaining: 5,
    rerollPrice: 250,
    departedOfferIds: [],
    offers: [FOOT_OFFER, COURIER_OFFER],
    missions: [MISSION],
    candidates: PANEL_CANDIDATES,
  };
}

async function renderPanel() {
  render(<DispatchPanel />);
  // The foot offer button is the door into the foot prep form.
  const offerButton = await screen.findByRole('button', { name: /Foot — Dustwaste Frontier/ });
  return offerButton;
}

describe('DispatchPanel — Start from a build (SB-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const state = dispatchState();
    hoisted.getDispatchState.mockResolvedValue({ verified: true, dispatch: state });
    hoisted.previewDispatch.mockResolvedValue({
      verified: true,
      eligible: true,
      reasons: [],
      preview: { strengthFactor: 1.2, payout: { credits: 40, scrap: 8, materialId: null, materialUnits: 0 } },
    });
    hoisted.startDispatch.mockResolvedValue({ verified: true, departed: {}, dispatch: state });
    useLoadoutPresetsStore.setState({
      presets: [],
      activePresetId: null,
      presetLoadError: null,
      lastApplyReport: null,
    });
  });

  afterEach(() => cleanup());

  it('clean prefill: the form takes exactly the build’s ready gear; prefill itself mutates nothing', async () => {
    useLoadoutPresetsStore.setState({
      presets: [build({
        name: 'Crafting',
        slots: { ...EMPTY_SLOTS, primary: 'gun-ready', shield: 'shield-ready', vehicle: 'spare-ride' },
      })],
    });
    const offerButton = await renderPanel();
    fireEvent.click(offerButton);
    fireEvent.click(await screen.findByRole('button', { name: 'Crafting' }));

    // Fidelity: the preview (the form's own pricing read) is fed
    // exactly the build's two ready gear items — not the vehicle,
    // nothing else.
    await waitFor(() => {
      expect(hoisted.previewDispatch).toHaveBeenCalledWith({
        offerId: 'offer-foot-1',
        itemIds: ['gun-ready', 'shield-ready'],
        vehicleItemId: null,
      });
    });
    const report = await screen.findByTestId('dispatch-prefill-report');
    expect(report.textContent).toContain('Started from Crafting — every item ready and picked.');

    // References, not claims: no server op of any kind fired.
    expect(hoisted.startDispatch).not.toHaveBeenCalled();
    expect(hoisted.applyBuild).not.toHaveBeenCalled();
    expect(hoisted.equipItem).not.toHaveBeenCalled();
  });

  it('conflicted prefill: in-service and listed items are flagged with remedies, never picked', async () => {
    useLoadoutPresetsStore.setState({
      presets: [build({
        name: 'Combat',
        slots: {
          ...EMPTY_SLOTS,
          primary: 'gun-ready',
          secondary: 'gun-out',
          heavy: 'gun-listed',
          relic: 'relic-sold',
        },
      })],
    });
    const offerButton = await renderPanel();
    fireEvent.click(offerButton);
    fireEvent.click(await screen.findByRole('button', { name: 'Combat' }));

    await waitFor(() => {
      expect(hoisted.previewDispatch).toHaveBeenCalledWith({
        offerId: 'offer-foot-1',
        itemIds: ['gun-ready'],
        vehicleItemId: null,
      });
    });
    const report = await screen.findByTestId('dispatch-prefill-report');
    expect(report.textContent).toContain('1 ready and picked, 3 flagged');
    expect(report.textContent).toContain('Outbound SMG is out on a contract — back');
    expect(report.textContent).toContain('Recall it from the bay above');
    expect(report.textContent).toContain('Listed Cannon is listed on the market — delist it in the Market tab');
    expect(report.textContent).toContain('Your saved Relic is gone (sold, salvaged, or traded away)');
    expect(hoisted.startDispatch).not.toHaveBeenCalled();
    expect(hoisted.applyBuild).not.toHaveBeenCalled();
  });

  it('manual toggles rule after a prefill, and Depart sends the same wire shape as a hand-picked form', async () => {
    useLoadoutPresetsStore.setState({
      presets: [build({
        name: 'Crafting',
        slots: { ...EMPTY_SLOTS, primary: 'gun-ready', shield: 'shield-ready' },
      })],
    });
    const offerButton = await renderPanel();
    fireEvent.click(offerButton);
    fireEvent.click(await screen.findByRole('button', { name: 'Crafting' }));
    await waitFor(() => {
      expect(hoisted.previewDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ itemIds: ['gun-ready', 'shield-ready'] }),
      );
    });

    // Untick the shield by hand — the form, not the build, departs.
    fireEvent.click(screen.getByRole('button', { name: /Ready Shield/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Depart' }));
    await waitFor(() => expect(hoisted.startDispatch).toHaveBeenCalledTimes(1));
    expect(hoisted.startDispatch).toHaveBeenCalledWith({
      nonce: 'dispatch-start-test-nonce',
      offerId: 'offer-foot-1',
      itemIds: ['gun-ready'],
      vehicleItemId: null,
    });
  });

  it('courier prefill: a spare build vehicle is picked; the equipped ride is flagged, not picked', async () => {
    useLoadoutPresetsStore.setState({
      presets: [
        build({ id: 'p-haul', name: 'Hauler', slots: { ...EMPTY_SLOTS, vehicle: 'spare-ride' } }),
        build({ id: 'p-ride', name: 'Daily', slots: { ...EMPTY_SLOTS, vehicle: 'my-ride' } }),
      ],
    });
    render(<DispatchPanel />);
    const courierButton = await screen.findByRole('button', { name: /Courier — Dustwaste Frontier/ });
    fireEvent.click(courierButton);

    fireEvent.click(await screen.findByRole('button', { name: 'Hauler' }));
    await waitFor(() => {
      expect(hoisted.previewDispatch).toHaveBeenCalledWith({
        offerId: 'offer-courier-1',
        itemIds: [],
        vehicleItemId: 'spare-ride',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Daily' }));
    const report = await screen.findByTestId('dispatch-prefill-report');
    expect(report.textContent).toContain('My Ride is your current ride — courier sends a spare vehicle.');
    // The Daily prefill replaced the pick with nothing dispatchable.
    await waitFor(() => {
      expect(hoisted.previewDispatch).toHaveBeenLastCalledWith({
        offerId: 'offer-courier-1',
        itemIds: [],
        vehicleItemId: null,
      });
    });
    expect(hoisted.startDispatch).not.toHaveBeenCalled();
  });

  it('no saved builds: the door explains itself and where builds are made', async () => {
    const offerButton = await renderPanel();
    fireEvent.click(offerButton);
    expect(await screen.findByText(/No saved builds yet — save one on the Gear tab's Loadout screen/)).toBeTruthy();
    expect(screen.queryByTestId('dispatch-prefill-report')).toBeNull();
  });
});
