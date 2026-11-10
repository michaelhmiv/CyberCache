/**
 * Vehicle placement (owner decision 2026-11-10) — the pins for
 * the permanent vehicle chip on Home's Strip:
 *
 *  - The chip docks at the Strip's loot segment, immediately
 *    right of the n/7 gear fraction, Home variant only — every
 *    other tab's Strip renders without it.
 *  - Equipped + healthy: a quiet readout (name · fuel units ·
 *    ×yield, condition % when worn) that doors to Gear →
 *    Loadout with the Garage expanded ('garage' intent).
 *  - Out of fuel / worn out: the remedy flip, carried over from
 *    the retired belt chip — Refuel → Garage with a cell
 *    carried, Buy cells → Vendor without, Repair → Garage.
 *  - On foot: the chip is PRESENT (the belt chip vanished) and
 *    reads "On foot" as the same Garage door.
 *  - The consumables belt carries no vehicle chip in any state
 *    — the belt is consumables only again.
 *
 * Store seeding mirrors auditVehicleTruth.test.tsx (the vehicle
 * surfaces' habitat): the tank is the player store's profile
 * mirror, the factor comes from effectiveVehicleYield.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { FUEL_CELL_TYPE } from '@/lib/vehicles/vehicles';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { ConsumableBelt } from '@/components/dashboard/ConsumableBelt';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

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

function seedStores(input: { fuel?: number; consumables?: Record<string, number>; withVehicle?: boolean; bike?: VehicleDisplay } = {}) {
  useLoadoutStore.setState({
    slots: { ...EMPTY_SLOTS, vehicle: input.withVehicle === false ? null : 'veh-1' },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({
    profileLoaded: true, level: 30, consumables: input.consumables ?? {}, vehicleFuel: input.fuel ?? 0,
  });
  useVehicleStore.setState({ vehicles: [input.bike ?? scrapBike()], lastClaimStatus: null });
  useInventoryStore.setState({ items: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seedStores({ fuel: 100 });
});

describe('vehicle strip chip — placement', () => {
  it('docks immediately right of the loot segment on the Home Strip', () => {
    render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    const strip = screen.getByTestId('resource-bar-strip');
    const loot = within(strip).getByTestId('resource-chip-loot');
    const chip = within(strip).getByTestId('vehicle-strip-chip');
    // The chip follows the loot segment in the row — it rides
    // the counter that counts the other seven slots.
    expect(loot.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // …and nothing but the right-end level block follows it.
    const level = within(strip).getByTestId('resource-chip-level');
    expect(chip.compareDocumentPosition(level) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never renders on the plain Strip (other tabs byte-identical)', () => {
    render(<ResourceBar />);
    expect(screen.queryByTestId('vehicle-strip-chip')).toBeNull();
    expect(screen.getByTestId('resource-chip-cacheKey')).toBeTruthy();
  });
});

describe('vehicle strip chip — states', () => {
  it('equipped + healthy: quiet readout, and the tap doors to the Garage', () => {
    const onNavigate = vi.fn();
    seedStores({ fuel: 100 });
    render(<ResourceBar variant="home" onNavigate={onNavigate} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    expect(chip.dataset.state).toBe('ok');
    expect(chip.textContent).toContain('Scrap Bike');
    expect(chip.textContent).toContain('100u');
    expect(chip.textContent).toContain('×1.15');
    fireEvent.click(chip);
    expect(onNavigate).toHaveBeenCalledWith('garage');
  });

  it('worn below full: the condition joins the readout', () => {
    seedStores({ fuel: 40, bike: scrapBike({ conditionCurrent: 50, conditionMax: 100 }) });
    render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    expect(chip.dataset.state).toBe('ok');
    expect(chip.textContent).toContain('40u');
    expect(chip.textContent).toContain('50%');
  });

  it('out of fuel with a cell carried: the remedy flip doors to the Garage', () => {
    const onNavigate = vi.fn();
    seedStores({ fuel: 0, consumables: { [FUEL_CELL_TYPE]: 2 } });
    render(<ResourceBar variant="home" onNavigate={onNavigate} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    expect(chip.dataset.state).toBe('out-of-fuel');
    expect(chip.textContent).toContain('Out of fuel');
    expect(chip.textContent).toContain('Refuel');
    fireEvent.click(chip);
    expect(onNavigate).toHaveBeenCalledWith('garage');
  });

  it('out of fuel with no cells: the remedy doors to the Vendor', () => {
    const onNavigate = vi.fn();
    seedStores({ fuel: 0, consumables: {} });
    render(<ResourceBar variant="home" onNavigate={onNavigate} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    expect(chip.dataset.state).toBe('out-of-fuel');
    expect(chip.textContent).toContain('Buy cells');
    fireEvent.click(chip);
    expect(onNavigate).toHaveBeenCalledWith('market:vendor');
  });

  it('worn out: the remedy is Repair at the Garage', () => {
    const onNavigate = vi.fn();
    seedStores({ fuel: 50, bike: scrapBike({ conditionCurrent: 0, conditionMax: 100 }) });
    render(<ResourceBar variant="home" onNavigate={onNavigate} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    expect(chip.dataset.state).toBe('worn-out');
    expect(chip.textContent).toContain('Worn out');
    expect(chip.textContent).toContain('Repair');
    fireEvent.click(chip);
    expect(onNavigate).toHaveBeenCalledWith('garage');
  });

  it('on foot: the chip is present as the door (the belt chip vanished here)', () => {
    const onNavigate = vi.fn();
    seedStores({ withVehicle: false });
    render(<ResourceBar variant="home" onNavigate={onNavigate} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    expect(chip.dataset.state).toBe('on-foot');
    expect(chip.textContent).toContain('On foot');
    fireEvent.click(chip);
    expect(onNavigate).toHaveBeenCalledWith('garage');
  });
});

describe('the belt is consumables only', () => {
  it('no vehicle chip rides the belt in any state', () => {
    seedStores({ fuel: 0, consumables: { [FUEL_CELL_TYPE]: 1 } });
    render(<ConsumableBelt onNavigate={vi.fn()} />);
    const belt = screen.getByTestId('consumable-belt');
    expect(within(belt).queryByTestId('vehicle-belt-chip')).toBeNull();
    expect(within(belt).queryByTestId('vehicle-strip-chip')).toBeNull();
  });
});
