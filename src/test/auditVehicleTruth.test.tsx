/**
 * Audit fix B — "Vehicle truth & the Garage" regression tests.
 *
 * From the 2026-11-01 UX audit's live production walk (fresh guest):
 *
 *  CONS-01 — the Action-tab vehicle banner (VehicleStatusLine,
 *    superseded by the VehicleButton in the Loadout panel header —
 *    owner ruling 2026-11-05) read its fuel from the vehicle
 *    store's lastClaimStatus — a snapshot of the LAST claim — in
 *    preference to the server profile's vehicle_fuel. After the
 *    player loaded a fuel cell, the Garage (which reads the
 *    profile) showed "Fuel tank 100 units · ×1.15" while the banner
 *    kept reading "fuel 0 units · out of fuel" through the refuel,
 *    a boss fight, and a reload. Fixed: the vehicle surface and
 *    the Garage read ONE source — the player store's profile
 *    mirror (vehicleFuel); the claim block is history only, never
 *    the tank. The button carries the same discipline: it never
 *    reads lastClaimStatus at all.
 *  UX-06 — the Garage was an unlabeled-feeling section buried in
 *    the Loadout scroll while the banner directed players to "the
 *    Garage" by name. Fixed then: the section carried the labeled
 *    #garage-panel anchor, and the banner's "Open Garage" door
 *    navigated through the shipped tab intent (App 'garage' →
 *    Inventory loadout tab + anchor seq → scroll into view).
 *    Superseded by redesign Wave D (DESIGN.md §11 F1): the Garage
 *    became a Gear rail stop in its own right, and the same door's
 *    intent named the stop (App 'garage' → Inventory { tab:
 *    'garage' } → Garage stop mounted, no scroll needed).
 *    Superseded again by the owner ruling of 2026-11-02 (§11 F1
 *    as amended): the Garage folds into the Loadout stop, and the
 *    door's intent now lands on Loadout with the vehicle section
 *    expanded (App 'garage' → Inventory { tab: 'loadout',
 *    expandVehicle: true } → Garage panel mounted inside Loadout).
 *    The tests below pin the current threading.
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
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import { useLoadoutStore, usePlayerStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { verifiedOps } from '@/lib/api/verifiedOps';
import type { ChefVehicleStatus } from '@/lib/chef/chefClient';
import { VehicleButton } from '@/components/gear/VehicleButton';
import { GaragePanel } from '@/components/gear/GaragePanel';
import { InventoryScreen } from '@/screens/InventoryScreen';

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

describe('audit B — CONS-01: the vehicle button reads the profile tank, not the last claim', () => {
  it('a refuel is reflected even though the last claim ended out of fuel', async () => {
    seedStores({ fuel: 0 });
    useVehicleStore.setState({
      lastClaimStatus: claimStatus({
        fuelUnitsStart: 100, fuelUnitsRemaining: 0, fuelConsumed: 100,
        activeTicks: 0, inactiveReason: 'out_of_fuel',
      }),
    });
    render(<VehicleButton expanded={false} onToggle={vi.fn()} />);
    const button = screen.getByTestId('vehicle-button');
    expect(button.dataset.state).toBe('out-of-fuel');
    expect(button.textContent).toContain('NO FUEL');
    expect(button.textContent).toContain('×1.00');

    // The refuel's verified sync lands the new profile fuel — the
    // exact store write syncVerifiedResult performs for the op.
    usePlayerStore.setState({ vehicleFuel: 100 });

    await screen.findByText('×1.15');
    expect(button.dataset.state).toBe('ok');
    expect(button.textContent).not.toContain('NO FUEL');
    expect(button.textContent).toContain('100');
    expect(button.textContent).toContain('tank');
  });

  it('an optimistic claim block cannot resurrect an empty tank', () => {
    // E.g. a courier departure burned the tank after the last
    // roaming claim: the claim block still says 100 remaining, the
    // profile says 0 — the profile is the tank.
    seedStores({ fuel: 0 });
    useVehicleStore.setState({ lastClaimStatus: claimStatus({ fuelUnitsRemaining: 100 }) });
    render(<VehicleButton expanded={false} onToggle={vi.fn()} />);
    const button = screen.getByTestId('vehicle-button');
    expect(button.dataset.state).toBe('out-of-fuel');
    expect(button.textContent).toContain('NO FUEL');
    expect(button.textContent).toContain('×1.00');
  });

  it('claim history never reaches the button face (no mid-claim line)', () => {
    seedStores({ fuel: 50 });
    useVehicleStore.setState({ lastClaimStatus: claimStatus({ activeTicks: 4, ticks: 10 }) });
    render(<VehicleButton expanded={false} onToggle={vi.fn()} />);
    const button = screen.getByTestId('vehicle-button');
    expect(button.textContent).toContain('50');
    expect(button.textContent).toContain('tank');
    expect(button.textContent).not.toContain('Bonus active');
  });
});

// ── Copy — the class echo ────────────────────────────────────────

describe('audit B — the button names the vehicle once', () => {
  it('no class echo when the name IS the class name', () => {
    seedStores({ fuel: 100 });
    const { container } = render(<VehicleButton expanded={false} onToggle={vi.fn()} />);
    expect(container.textContent).not.toContain('Scrap Bike (Scrap Bike)');
    expect(container.textContent).toContain('Scrap Bike');
  });

  it('the class still shows when the vehicle carries its own name', () => {
    seedStores({ fuel: 100 });
    useVehicleStore.setState({ vehicles: [scrapBike({ name: 'Rust Runner' })] });
    const { container } = render(<VehicleButton expanded={false} onToggle={vi.fn()} />);
    expect(container.textContent).toContain('Rust Runner (Scrap Bike)');
  });
});

// ── UX-06 — the Garage door ──────────────────────────────────────

describe('audit B — UX-06: the Garage is labeled and reachable from the vehicle button', () => {
  it('the button offers an Open Garage door with a vehicle equipped', () => {
    seedStores({ fuel: 0 });
    const onToggle = vi.fn();
    render(<VehicleButton expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Garage' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('the button offers the same door on foot (no vehicle equipped)', () => {
    seedStores({ withVehicle: false });
    const onToggle = vi.fn();
    render(<VehicleButton expanded={false} onToggle={onToggle} />);
    expect(screen.getByTestId('vehicle-button').dataset.state).toBe('on-foot');
    fireEvent.click(screen.getByRole('button', { name: 'Open Garage' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('the Garage panel is labeled and carries its panel anchor', () => {
    render(<GaragePanel />);
    const section = document.getElementById('garage-panel');
    expect(section).toBeTruthy();
    expect(section?.querySelector(':scope > div')?.textContent).toContain('Garage');
    expect(screen.getByText('Garage')).toBeTruthy();
  });

  it('a garage intent opens the gear home on Loadout with the Garage expanded inside it (owner ruling 2026-11-02)', async () => {
    render(<InventoryScreen onNavigate={vi.fn()} tabIntent={{ tab: 'loadout', expandVehicle: true, seq: 7 }} />);
    // The Loadout page is mounted, and the Garage panel is
    // already expanded within it — no stop switch, no scroll
    // hunt. (Crafting consolidation, 2026-11-04: the rail and
    // its stops are retired — the page is the only stop now.)
    expect(await screen.findByTestId('garage-panel')).toBeTruthy();
    expect(screen.queryByTestId('gear-rail')).toBeNull();
    expect(screen.queryByTestId('gear-stop-garage')).toBeNull();
    // The Loadout composition is present too (F5 landmark: the
    // panel header's "Tap a slot to equip" hint).
    expect(screen.getByText('Tap a slot to equip')).toBeTruthy();
  });

  it('without a garage intent the gear home opens on Loadout and the Garage is not mounted', async () => {
    render(<InventoryScreen onNavigate={vi.fn()} />);
    expect(await screen.findByText('Tap a slot to equip')).toBeTruthy();
    expect(screen.queryByTestId('garage-panel')).toBeNull();
    expect(screen.queryByTestId('gear-rail')).toBeNull();
  });

  it('the navigation threading is wired App → Inventory → expanded Garage section (structural pin)', () => {
    const readSource = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');
    const app = readSource('src/App.tsx');
    expect(app).toContain("screen === 'garage'");
    expect(app).toContain("setInventoryTabIntent({ tab: 'loadout', expandVehicle: true");
    const inventory = readSource('src/screens/InventoryScreen.tsx');
    // Consolidation successor pins: with the stops retired, the
    // intent's only job is the vehicle expansion signal itself.
    expect(inventory).toContain('tabIntent?.expandVehicle ? tabIntent.seq : null');
    expect(inventory).toContain('if (tabIntent.expandVehicle) setVehicleExpandSeq(tabIntent.seq)');
    expect(inventory).toContain('vehicleExpandSignal={vehicleExpandSeq}');
    const action = readSource('src/screens/ActionScreenContextual.tsx');
    // Home consolidation (2026-11-03): the vehicle banner left
    // Home, and its Garage door is the belt chip now — threaded
    // through the belt's onNavigate prop on the same screen,
    // landing on the same 'garage' intent pinned above.
    expect(action).toContain('<ConsumableBelt onNavigate={(target) => onNavigate?.(target)} />');
    const chip = readSource('src/components/dashboard/VehicleBeltChip.tsx');
    expect(chip).toContain("? 'market:vendor' : 'garage'");
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
    // Icon-only controls (owner ruling 2026-11-03) carry their
    // name in the aria-label; the opening tag runs to its '>'.
    const anchor = source.indexOf(`aria-label="${label}"`);
    expect(anchor, `the ${label} button exists`).toBeGreaterThan(-1);
    const start = source.lastIndexOf('<button', anchor);
    const end = source.indexOf('>', anchor);
    return source.slice(start, end);
  }

  it('Switch and Stop are both 44px squares (h-11 w-11)', () => {
    const source = readSource('src/screens/ActionScreenContextual.tsx');
    // Fix B's 44px touch guarantee, in the icon-only form the
    // 2026-11-03 owner ruling gave the stage controls: h-11
    // w-11 IS 44px, on both axes now.
    expect(buttonOpeningTag(source, 'Switch Action')).toContain('h-11 w-11');
    expect(buttonOpeningTag(source, 'Stop')).toContain('h-11 w-11');
  });
});
