/**
 * Drift-fix F5 — Gear composition pins.
 *
 * The fidelity audit's Gear finding, as executable contracts:
 *  1. The loadout panel no longer re-prints the wallet. Credits /
 *     Scrap / Items / Keys all live in the Strip (F1); the panel
 *     header carries only what the Strip doesn't print (DPS, HP,
 *     the equipped count).
 *  2. The constellation leads with the equipped hunter himself —
 *     the parts actor wearing the actual instances (held weapon
 *     layer present iff a primary is equipped) — not a sprawled
 *     diagram in an aspect-ratio box of air.
 *  3. Slot chips print at the §5 floor and item names WRAP whole —
 *     the old chips ran 7–10px type and truncated the name.
 *  4. The Garage's vehicle cards carry the v1 content design
 *     DESIGN.md §11 F1 preserves: the class sprite of the actual
 *     instance, with its condition wear rendered on it.
 *  5. The fold (owner ruling 2026-11-02, superseding the original
 *     §11 F1 rail-stop decision): the Garage is NOT a rail stop —
 *     it expands in place inside the Loadout stop under the
 *     vehicle status line, revealing the tank panel, the vehicle
 *     cards, and the repair blocks; a deep-link signal opens it
 *     already expanded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { GaragePanel } from '@/components/gear/GaragePanel';
import { GearRail } from '@/components/gear/GearRail';
import { SyncedLoadoutScreen } from '@/screens/SyncedLoadoutScreen';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { Rarity, WeaponType, Manufacturer, Element, DropSource } from '@/types/game';
import type { Weapon } from '@/types/items';

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
    refuelVehicle: vi.fn(async () => ({})),
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

// jsdom has no IntersectionObserver; same stub shape as
// deviceFeedbackR2.test.tsx.
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

function makeWeapon(id: string, name: string): Weapon {
  return {
    id, name, level: 5, rarity: Rarity.Rare,
    weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Ironwood,
    element: Element.Kinetic, rollQuality: 50, baseDamage: 25, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0, statusDamage: 0,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0, armorDamageMod: 0,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 7, combatPower: 50, bossPower: 50, farmPower: 50, economyScore: 0,
  };
}

const scrapBike = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => ({
  id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
  runtimeState: 'in_inventory',
  ...overrides,
} as VehicleDisplay);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useInventoryStore.setState({ items: [] });
  useLoadoutStore.setState({ slots: { ...EMPTY_SLOTS } });
  useVehicleStore.setState({ vehicles: [] });
  usePlayerStore.setState({ consumables: {}, vehicleFuel: 0 });
});

describe('F5 — the panel does not re-print the wallet', () => {
  it('carries DPS and HP in the header, and no Credits/Scrap/Items/Keys stats', () => {
    render(<ActionLoadout />);
    const panel = within(screen.getByTestId('action-loadout'));
    expect(panel.getByText('DPS')).toBeTruthy();
    expect(panel.getByText('HP')).toBeTruthy();
    // The Strip owns these four — the panel must not print them again.
    expect(panel.queryByText('Credits')).toBeNull();
    expect(panel.queryByText('Scrap')).toBeNull();
    expect(panel.queryByText('Items')).toBeNull();
    expect(panel.queryByText('Keys')).toBeNull();
    // The manage hint the old Gear intro sentence carried now lives
    // in the header.
    expect(panel.getByText('Tap a slot to equip')).toBeTruthy();
  });
});

describe('F5 — the doll leads the constellation', () => {
  it('renders the hunter figure; unarmed, there is no held-weapon layer', () => {
    render(<ActionLoadout />);
    expect(screen.getByTestId('loadout-figure')).toBeTruthy();
    expect(screen.getByTestId('loadout-hunter')).toBeTruthy();
    expect(screen.queryByTestId('loadout-held-weapon')).toBeNull();
  });

  it('an equipped primary renders as the held instance on the figure', () => {
    const weapon = makeWeapon('w-fig', 'Figure Pistol');
    useInventoryStore.setState({ items: [weapon] });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, primary: 'w-fig' } }));
    render(<ActionLoadout />);
    expect(screen.getByTestId('loadout-held-weapon')).toBeTruthy();
  });
});

describe('F5 successor — merged blocks: names whole in the tree, at the sanctioned sizes', () => {
  it('a long item name rides the poster block complete, at poster size', async () => {
    const longName = 'Prismatek Velocity Beam Cannon of the Endless Wastes Mk. VII';
    const weapon = makeWeapon('w-long', longName);
    useInventoryStore.setState({ items: [weapon] });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, primary: 'w-long' } }));
    render(<ActionLoadout />);
    const block = screen.getByTestId('slot-block-primary');
    // The approved Exec C mock's measured property is FULL names:
    // the name WRAPS (the row grows) — truncation never, and no
    // shrink below the floor. The §6 bargain is that nothing
    // abbreviates or re-titles the item — the COMPLETE name is
    // what the block carries, and the same complete name prints
    // at the destination (asserted below). This supersedes the
    // F5 chip-era assertion, which governed the retired
    // constellation chips; the wrap-not-truncate half of F5 is
    // restored by the class assertion here (parent capture
    // review of PR #319 caught ellipsized names in the rows).
    const nameEl = within(block).getByText(longName);
    expect(nameEl.className).toContain('text-[13px]');
    expect(nameEl.className).not.toContain('truncate');
    // The block renders the actual instance's compositor art.
    expect(screen.getByTestId('slot-weapon-primary')).toBeTruthy();
    // The slot rides the block's accessible name; the printed line
    // is perks only (owner ruling 2026-11-03 — no rarity/element
    // words; the headline DPS leads).
    expect(block.getAttribute('aria-label')).toContain('Primary');
    expect(block.textContent).toContain('DPS');
    // Destination: the picker's Currently Equipped card carries the
    // same complete name.
    fireEvent.click(block);
    expect(await screen.findByText('Currently Equipped')).toBeTruthy();
    expect(screen.getAllByText(longName).length).toBeGreaterThanOrEqual(2);
  });
});

describe('F5 — the Garage wears the v1 content design', () => {
  it('a vehicle card renders the class sprite of the actual instance', () => {
    useVehicleStore.setState({ vehicles: [scrapBike()] });
    render(<GaragePanel />);
    const well = screen.getByTestId('garage-vehicle-sprite');
    const imgs = well.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs[0].getAttribute('src')).toContain('vehicle-scrap-bike');
  });

  it('a worn vehicle (under 35% condition) renders its scuff layer', () => {
    useVehicleStore.setState({
      vehicles: [scrapBike({ conditionCurrent: 30, conditionMax: 100 })],
    });
    render(<GaragePanel />);
    const well = screen.getByTestId('garage-vehicle-sprite');
    const srcs = Array.from(well.querySelectorAll('img')).map((i) => i.getAttribute('src') ?? '');
    expect(srcs.some((s) => s.includes('vehicle-condition-scuff'))).toBe(true);
  });

  it('a sound vehicle renders no scuff layer', () => {
    useVehicleStore.setState({
      vehicles: [scrapBike({ conditionCurrent: 90, conditionMax: 100 })],
    });
    render(<GaragePanel />);
    const well = screen.getByTestId('garage-vehicle-sprite');
    const srcs = Array.from(well.querySelectorAll('img')).map((i) => i.getAttribute('src') ?? '');
    expect(srcs.some((s) => s.includes('vehicle-condition-scuff'))).toBe(false);
  });
});

describe('F5 successor — the Garage folds into Loadout (owner ruling 2026-11-02)', () => {
  const seedGarageLoadout = (vehicle: VehicleDisplay) => {
    useVehicleStore.setState({ vehicles: [vehicle] });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, vehicle: vehicle.id } }));
    usePlayerStore.setState({
      consumables: { GenericFuelCell: 2, PatchKit: 2 },
      vehicleFuel: 250,
    });
  };

  it('the Gear rail carries no Garage stop', () => {
    render(<GearRail activeStop="loadout" onSelect={() => undefined} />);
    const rail = screen.getByTestId('gear-rail');
    const stops = [...rail.querySelectorAll('[data-testid^="gear-stop-"]')].map((el) => el.getAttribute('data-testid'));
    // Merged page (Exec C, 2026-11-03): Loadout · Workshop only —
    // and still no Garage stop (the §11 F1 fold stands).
    expect(stops).toEqual(['gear-stop-loadout', 'gear-stop-workshop']);
    expect(screen.queryByTestId('gear-stop-garage')).toBeNull();
  });

  it('the Loadout vehicle section starts collapsed behind its status line, summary visible', () => {
    seedGarageLoadout(scrapBike());
    render(<SyncedLoadoutScreen />);
    // The section header prints the summary the mock keeps visible:
    // vehicle name, fuel, condition.
    const status = screen.getByTestId('vehicle-status');
    expect(status.textContent).toContain('Scrap Bike');
    expect(status.textContent).toContain('fuel');
    expect(status.textContent).toContain('250 units');
    expect(status.textContent).toContain('condition');
    expect(status.textContent).toContain('100%');
    expect(screen.queryByTestId('garage-panel')).toBeNull();
  });

  it('one tap expands the full Garage in place — tank, vehicle card, sprite', async () => {
    seedGarageLoadout(scrapBike());
    render(<SyncedLoadoutScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Garage' }));
    const panel = await screen.findByTestId('garage-panel');
    expect(within(panel).getByText('Fuel tank')).toBeTruthy();
    expect(within(panel).getByText('250 units')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Load 1 cell (+100 units)' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Load all' })).toBeTruthy();
    expect(within(panel).getByText(/Patch Kits owned: 2/)).toBeTruthy();
    expect(within(panel).getByTestId('garage-vehicle-sprite')).toBeTruthy();
    expect(within(panel).getByText('Condition')).toBeTruthy();
    // The toggle now offers the collapse, state exposed to AT.
    const toggle = screen.getByRole('button', { name: 'Close Garage' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('the expanded section reveals the repair-start block for a worn vehicle', async () => {
    seedGarageLoadout(scrapBike({ conditionCurrent: 40, conditionMax: 100 }));
    render(<SyncedLoadoutScreen onRequestService={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Garage' }));
    const panel = await screen.findByTestId('garage-panel');
    expect(within(panel).getByLabelText('Patch kit type')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Start repair job' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: /Repair Services board/ })).toBeTruthy();
  });

  it('a deep-link expand signal opens the section already expanded', async () => {
    seedGarageLoadout(scrapBike());
    render(<SyncedLoadoutScreen vehicleExpandSignal={9} />);
    expect(await screen.findByTestId('garage-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close Garage' })).toBeTruthy();
  });
});
