/**
 * Audit fix B — "Vehicle truth & the Garage" regression tests.
 *
 * From the 2026-11-01 UX audit's live production walk (fresh guest):
 *
 *  CONS-01 — the Action-tab vehicle banner (VehicleStatusLine) read
 *    its fuel from the vehicle store's lastClaimStatus — a snapshot
 *    of the LAST claim — in preference to the server profile's
 *    vehicle_fuel. After the player loaded a fuel cell, the Garage
 *    (which reads the profile) showed "Fuel tank 100 units · ×1.15"
 *    while the banner kept reading "fuel 0 units · out of fuel"
 *    through the refuel, a boss fight, and a reload. Fixed: banner
 *    and Garage read ONE source — the player store's profile mirror
 *    (vehicleFuel); the claim block is history only (its mid-claim
 *    line), never the tank.
 *  UX-06 — the Garage was an unlabeled-feeling section buried in
 *    the Loadout scroll while the banner directed players to "the
 *    Garage" by name. Fixed: the section carries the labeled
 *    #garage-panel anchor, and the banner's "Open Garage" door
 *    navigates through the shipped tab intent (App 'garage' →
 *    Inventory loadout tab + anchor seq → scroll into view).
 *  UX-08 — refueling confirmed nothing, and "Load all" stayed
 *    disabled with exactly 1 cell owned. Fixed: a vendor-pattern
 *    notice ("Loaded N cell(s) — tank at X units.") read back from
 *    the synced profile, and Load all enables at ≥1 cell.
 *  Copy — the banner echoed the class when the vehicle's name IS
 *    the class ("Scrap Bike (Scrap Bike)"); the echo now shows
 *    only when the class adds information.
 *  Touch — the Action workspace Switch/Stop controls rendered
 *    ~28–32px tall; both now carry a 44px minimum touch height
 *    (Material guidance + the project's device-done rule).
 *
 * verifiedOps is mocked at the transport boundary (the repo's
 * client-test convention): the mocks apply the same store end state
 * the real op's server snapshot sync produces.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import { useLoadoutStore, usePlayerStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import type { ChefVehicleStatus } from '@/lib/chef/chefClient';
import { VehicleStatusLine } from '@/components/gear/VehicleStatusLine';
import { GaragePanel } from '@/components/gear/GaragePanel';
import { SyncedLoadoutScreen } from '@/screens/SyncedLoadoutScreen';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    equipItem: vi.fn(async (itemId: string, slot: string) => {
      useLoadoutStore.setState((s) => ({
        slots: { ...s.slots, [slot]: itemId } as typeof s.slots,
      }));
    }),
    unequipSlot: vi.fn(async (slot: string) => {
      useLoadoutStore.setState((s) => ({
        slots: { ...s.slots, [slot]: null } as typeof s.slots,
      }));
    }),
    // The real op's end state: cc_refuel_vehicle moves the cells
    // into profiles.vehicle_fuel (1 cell = 100 units, 0021) and the
    // response sync mirrors profile + consumables into the player
    // store — the same numbers the Garage tank row reads.
    refuelVehicle: vi.fn(async (cells: number) => {
      usePlayerStore.setState((s) => ({
        vehicleFuel: s.vehicleFuel + cells * 100,
        consumables: {
          ...s.consumables,
          GenericFuelCell: Math.max(0, (s.consumables.GenericFuelCell ?? 0) - cells),
        },
      }));
      return {};
    }),
    enqueueRepairJob: vi.fn(async () => ({})),
    itemLock: vi.fn(async () => ({})),
    recycleItem: vi.fn(async () => ({})),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
  fetchWorkshopState: vi.fn(async () => ({
    benches: 1,
    tools: {},
    jobs: [],
    masteries: {},
    activeActionKind: null,
    recentCompletions: [],
  })),
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

// jsdom has no IntersectionObserver; ChipRail (inside the Slot
// Picker) needs one. Same stub shape as deviceFeedbackR2.test.tsx.
globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

const EMPTY_SLOTS = {
  primary: null, secondary: null, heavy: null,
  ordnance: null, shield: null, classMod: null, relic: null, vehicle: null,
} as const;

const scrapBike = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => ({
  id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
  ...overrides,
});

const claimStatus = (overrides: Partial<ChefVehicleStatus> = {}): ChefVehicleStatus => ({
  equipped: true, vehicleClassId: 'scrap_bike', activeTicks: 10, ticks: 10,
  fuelUnitsStart: 100, fuelUnitsRemaining: 100, fuelConsumed: 0,
  conditionStart: 100, conditionCurrent: 100, conditionMax: 100,
  inactiveReason: null,
  ...overrides,
});

function seedStores(input: { fuel?: number; consumables?: Record<string, number>; withVehicle?: boolean } = {}) {
  useLoadoutStore.setState({
    slots: { ...EMPTY_SLOTS, vehicle: input.withVehicle === false ? null : 'veh-1' },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({ level: 30, consumables: input.consumables ?? {}, vehicleFuel: input.fuel ?? 0 });
  useVehicleStore.setState({ vehicles: [scrapBike()], lastClaimStatus: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seedStores();
});

// ── CONS-01 — one tank truth ─────────────────────────────────────

describe('audit B — CONS-01: the banner reads the profile tank, not the last claim', () => {
  it('a refuel is reflected even though the last claim ended out of fuel', async () => {
    seedStores({ fuel: 0 });
    useVehicleStore.setState({
      lastClaimStatus: claimStatus({
        fuelUnitsStart: 100, fuelUnitsRemaining: 0, fuelConsumed: 100,
        activeTicks: 0, inactiveReason: 'out_of_fuel',
      }),
    });
    render(<VehicleStatusLine />);
    expect(screen.getByText(/Out of fuel — vehicle bonus inactive/)).toBeTruthy();
    expect(screen.getByText('0 units')).toBeTruthy();

    // The refuel's verified sync lands the new profile fuel — the
    // exact store write syncVerifiedResult performs for the op.
    usePlayerStore.setState({ vehicleFuel: 100 });

    await screen.findByText('100 units');
    expect(screen.queryByText(/Out of fuel/)).toBeNull();
    expect(screen.getByText('×1.15')).toBeTruthy();
  });

  it('an optimistic claim block cannot resurrect an empty tank', () => {
    // E.g. a courier departure burned the tank after the last
    // roaming claim: the claim block still says 100 remaining, the
    // profile says 0 — the profile is the tank.
    seedStores({ fuel: 0 });
    useVehicleStore.setState({ lastClaimStatus: claimStatus({ fuelUnitsRemaining: 100 }) });
    render(<VehicleStatusLine />);
    expect(screen.getByText(/Out of fuel — vehicle bonus inactive/)).toBeTruthy();
    expect(screen.getByText('0 units')).toBeTruthy();
    expect(screen.getByText('×1.00')).toBeTruthy();
  });

  it('the claim block still owns its history line (ran dry mid-claim)', () => {
    seedStores({ fuel: 50 });
    useVehicleStore.setState({ lastClaimStatus: claimStatus({ activeTicks: 4, ticks: 10 }) });
    render(<VehicleStatusLine />);
    expect(screen.getByText(/Bonus active for 4 of the last 10 ticks/)).toBeTruthy();
    expect(screen.getByText('50 units')).toBeTruthy();
  });
});

// ── Copy — the class echo ────────────────────────────────────────

describe('audit B — banner names the vehicle once', () => {
  it('no class echo when the name IS the class name', () => {
    seedStores({ fuel: 100 });
    const { container } = render(<VehicleStatusLine />);
    expect(container.textContent).not.toContain('Scrap Bike (Scrap Bike)');
    expect(container.textContent).toContain('Scrap Bike');
  });

  it('the class still shows when the vehicle carries its own name', () => {
    seedStores({ fuel: 100 });
    useVehicleStore.setState({ vehicles: [scrapBike({ name: 'Rust Runner' })] });
    const { container } = render(<VehicleStatusLine />);
    expect(container.textContent).toContain('Rust Runner (Scrap Bike)');
  });
});

// ── UX-06 — the Garage door ──────────────────────────────────────

describe('audit B — UX-06: the Garage is labeled and reachable from the banner', () => {
  it('the banner offers an Open Garage door with a vehicle equipped', () => {
    seedStores({ fuel: 0 });
    const onOpenGarage = vi.fn();
    render(<VehicleStatusLine onOpenGarage={onOpenGarage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Garage' }));
    expect(onOpenGarage).toHaveBeenCalledTimes(1);
  });

  it('the banner offers the same door on foot (no vehicle equipped)', () => {
    seedStores({ withVehicle: false });
    const onOpenGarage = vi.fn();
    render(<VehicleStatusLine onOpenGarage={onOpenGarage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Garage' }));
    expect(onOpenGarage).toHaveBeenCalledTimes(1);
  });

  it('the Garage section is labeled and carries the scroll anchor', () => {
    render(<GaragePanel />);
    const section = document.getElementById('garage-panel');
    expect(section).toBeTruthy();
    expect(section?.querySelector(':scope > div')?.textContent).toContain('Garage');
    expect(screen.getByText('Garage')).toBeTruthy();
  });

  it('the Loadout tab scrolls the Garage into view on a garage intent seq', async () => {
    const scrollSpy = vi.fn(function (this: Element) { return this; });
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    try {
      render(<SyncedLoadoutScreen focusGarageSeq={7} />);
      await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
      const target = (scrollSpy.mock.instances[0] as unknown as Element);
      expect(target.id).toBe('garage-panel');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('without a garage intent the Loadout tab does not scroll', async () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    try {
      render(<SyncedLoadoutScreen focusGarageSeq={null} />);
      // Give any (buggy) effect a chance to fire.
      await new Promise((r) => setTimeout(r, 50));
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('the navigation threading is wired App → Inventory → Loadout (structural pin)', () => {
    const readSource = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');
    const app = readSource('src/App.tsx');
    expect(app).toContain("screen === 'garage'");
    expect(app).toContain("anchor: 'garage'");
    const inventory = readSource('src/screens/InventoryScreen.tsx');
    expect(inventory).toContain("tabIntent?.anchor === 'garage' ? tabIntent.seq : null");
    const action = readSource('src/screens/ActionScreenContextual.tsx');
    expect(action).toContain("onOpenGarage={() => onNavigate?.('garage')}");
  });
});

// ── UX-08 — refuel confirmation + Load all ───────────────────────

describe('audit B — UX-08: refueling confirms, and Load all works with one cell', () => {
  it('Load all is enabled with exactly 1 cell owned', () => {
    seedStores({ fuel: 0, consumables: { GenericFuelCell: 1 } });
    render(<GaragePanel />);
    const loadAll = screen.getByRole('button', { name: 'Load all' }) as HTMLButtonElement;
    expect(loadAll.disabled).toBe(false);
  });

  it('loading one cell confirms with the synced tank figure', async () => {
    seedStores({ fuel: 0, consumables: { GenericFuelCell: 1 } });
    render(<GaragePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 cell (+100 units)' }));
    await screen.findByText('Loaded 1 cell — tank at 100 units.');
    expect(vi.mocked(verifiedOps.refuelVehicle)).toHaveBeenCalledWith(1);
    // The Garage tank row and the store agree (one source).
    expect(screen.getByText('100 units')).toBeTruthy();
    expect(usePlayerStore.getState().vehicleFuel).toBe(100);
  });

  it('Load all loads every owned cell and confirms the total', async () => {
    seedStores({ fuel: 0, consumables: { GenericFuelCell: 2 } });
    render(<GaragePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Load all' }));
    await screen.findByText('Loaded 2 cells — tank at 200 units.');
    expect(vi.mocked(verifiedOps.refuelVehicle)).toHaveBeenCalledWith(2);
  });
});

// ── Touch targets — Switch / Stop ────────────────────────────────

describe('audit B — Action workspace Switch/Stop carry a 44px touch height', () => {
  const readSource = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

  function buttonOpeningTag(source: string, label: string): string {
    const end = source.indexOf(`>${label}</button>`);
    expect(end, `the ${label} button exists`).toBeGreaterThan(-1);
    const start = source.lastIndexOf('<button', end);
    return source.slice(start, end);
  }

  it('Switch and Stop both declare min-h-[44px]', () => {
    const source = readSource('src/screens/ActionScreenContextual.tsx');
    expect(buttonOpeningTag(source, 'Switch')).toContain('min-h-[44px]');
    expect(buttonOpeningTag(source, 'Stop')).toContain('min-h-[44px]');
  });
});
