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
 *  4. The Garage stop's vehicle cards carry the v1 content design
 *     DESIGN.md §11 F1 preserves: the class sprite of the actual
 *     instance, with its condition wear rendered on it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { GaragePanel } from '@/components/gear/GaragePanel';
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

describe('F5 — slot chips at the floor, names whole', () => {
  it('a long item name prints in full, unwrapped by no truncate class', () => {
    const longName = 'Prismatek Velocity Beam Cannon of the Endless Wastes Mk. VII';
    const weapon = makeWeapon('w-long', longName);
    useInventoryStore.setState({ items: [weapon] });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, primary: 'w-long' } }));
    render(<ActionLoadout />);
    const nameEl = screen.getByText(longName);
    expect(nameEl.className).not.toContain('truncate');
    // The chip renders the actual instance's compositor art.
    expect(screen.getByTestId('slot-weapon-primary')).toBeTruthy();
    // Slot label rides at the §5 floor size.
    const labelEl = screen.getByText('Primary', { exact: true });
    expect(labelEl.closest('div')?.className).toContain('text-[11px]');
  });
});

describe('F5 — the Garage stop wears the v1 content design', () => {
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
