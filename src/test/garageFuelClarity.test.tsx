/**
 * Garage fuel/condition clarity (owner feedback 2026-11-02) + the
 * equip gate's client death (owner ruling 2026-11-02):
 *
 *   - The status line prints the TANK (units) and the CELLS CARRIED
 *     (count) as the two different numbers they are — a bare
 *     "fuel 0" read as either and left the player stuck.
 *   - The Garage's out-of-fuel state carries its remedy IN the
 *     block: the Load buttons when cells are on hand (rendered
 *     exactly once — they move out of the tank panel), tappable
 *     Vendor / Workshop / Player Market doors when empty-handed.
 *   - A wrecked vehicle names patch kits as the fix beside the
 *     repair controls, with doors when the player owns no kits.
 *   - Equip carries no level gate: a level-1 hunter's Leviathan Rig
 *     shows a live "Equip" button, never "Requires level 75".
 *
 * Scaffolding mirrors qcAffordances' GaragePanel describe (stores
 * seeded directly; verifiedOps mocked at the module seam).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import { useLoadoutStore, usePlayerStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { GaragePanel } from '@/components/gear/GaragePanel';
import { VehicleStatusLine } from '@/components/gear/VehicleStatusLine';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    equipItem: vi.fn(async () => ({})),
    unequipSlot: vi.fn(async () => ({})),
    refuelVehicle: vi.fn(async () => ({})),
    enqueueRepairJob: vi.fn(async () => ({})),
  },
}));

afterEach(() => cleanup());

const bike = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => ({
  id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
  runtimeState: 'available',
  ...overrides,
});

const rig = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => bike({
  id: 'veh-rig', name: 'Leviathan Rig', vehicleClassId: 'leviathan_rig', level: 40,
  rarity: Rarity.Legendary,
  ...overrides,
});

function seed(opts: {
  level?: number;
  fuel?: number;
  consumables?: Record<string, number>;
  vehicles: VehicleDisplay[];
  equippedId?: string | null;
}) {
  useLoadoutStore.setState({
    slots: {
      primary: null, secondary: null, heavy: null, ordnance: null,
      shield: null, classMod: null, relic: null,
      vehicle: opts.equippedId === undefined ? (opts.vehicles[0]?.id ?? null) : opts.equippedId,
    },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({
    level: opts.level ?? 1,
    consumables: opts.consumables ?? {},
    vehicleFuel: opts.fuel ?? 0,
  });
  useVehicleStore.setState({ vehicles: opts.vehicles, lastClaimStatus: null });
}

describe('status line — tank and cells are different numbers', () => {
  it('prints tank units and carried cells, labeled, with the load remedy when cells are on hand', () => {
    seed({ fuel: 0, consumables: { GenericFuelCell: 2 }, vehicles: [bike()] });
    render(<VehicleStatusLine />);
    const status = screen.getByTestId('vehicle-status');
    expect(status.textContent).toContain('tank');
    expect(status.textContent).toContain('0 units');
    expect(status.textContent).toContain('2 fuel cells carried');
    expect(status.textContent).toContain('Load a fuel cell in the Garage');
  });

  it('with zero cells the remedy names where to get them', () => {
    seed({ fuel: 0, consumables: {}, vehicles: [bike()] });
    render(<VehicleStatusLine />);
    const status = screen.getByTestId('vehicle-status');
    expect(status.textContent).toContain('0 fuel cells carried');
    expect(status.textContent).toContain('No fuel cells carried');
    expect(status.textContent).toContain('Vendor in the Market');
  });
});

describe('Garage — out of fuel carries its remedy', () => {
  it('with cells on hand, the Load buttons live inside the out-of-fuel block — exactly once', async () => {
    seed({ fuel: 0, consumables: { GenericFuelCell: 2 }, vehicles: [bike()] });
    render(<GaragePanel onNavigate={vi.fn()} />);
    const block = await screen.findByTestId('garage-out-of-fuel');
    expect(within(block).getByRole('button', { name: 'Load 1 cell (+100 units)' })).toBeTruthy();
    expect(within(block).getByRole('button', { name: 'Load all' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Load all' })).toHaveLength(1);
    expect(screen.queryByTestId('garage-fuel-hint')).toBeNull();
  });

  it('empty-handed, the block shows the hint plus tappable doors to Vendor / Workshop / Player Market', async () => {
    const onNavigate = vi.fn();
    seed({ fuel: 0, consumables: {}, vehicles: [bike()] });
    render(<GaragePanel onNavigate={onNavigate} />);
    const block = await screen.findByTestId('garage-out-of-fuel');
    expect(within(block).getByTestId('garage-fuel-hint')).toBeTruthy();
    fireEvent.click(within(block).getByRole('button', { name: /Vendor/ }));
    expect(onNavigate).toHaveBeenCalledWith('market:vendor');
    fireEvent.click(within(block).getByRole('button', { name: /Workshop/ }));
    expect(onNavigate).toHaveBeenCalledWith('workshop');
    fireEvent.click(within(block).getByRole('button', { name: /Player Market/ }));
    expect(onNavigate).toHaveBeenCalledWith('market:buy');
    // The tank panel's Load buttons stay, disabled — no dead end.
    const loadOne = screen.getByRole('button', { name: /Load 1 cell/ });
    expect((loadOne as HTMLButtonElement).disabled).toBe(true);
  });

  it('with fuel in the tank there is no out-of-fuel block and the Load buttons sit in the tank panel', async () => {
    seed({ fuel: 250, consumables: { GenericFuelCell: 1 }, vehicles: [bike()] });
    render(<GaragePanel onNavigate={vi.fn()} />);
    expect(await screen.findByText('250 units')).toBeTruthy();
    expect(screen.queryByTestId('garage-out-of-fuel')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Load all' })).toHaveLength(1);
  });
});

describe('Garage — condition states name their fix', () => {
  it('a wrecked vehicle with no patch kits shows the wreck block and the kit doors', async () => {
    const onNavigate = vi.fn();
    seed({ fuel: 100, consumables: {}, vehicles: [bike({ conditionCurrent: 0 })] });
    render(<GaragePanel onNavigate={onNavigate} />);
    const wreck = await screen.findByTestId('garage-worn-out');
    expect(wreck.textContent).toContain('Patch kits are the fix');
    // The doors stand in BOTH adjacencies: the wreck block itself and
    // the repair controls below it. Either one navigates.
    const doors = within(wreck).getByTestId('garage-kit-doors');
    fireEvent.click(within(doors).getByRole('button', { name: /Vendor/ }));
    expect(onNavigate).toHaveBeenCalledWith('market:vendor');
  });

  it('a worn vehicle with kits on hand shows the repair controls and no doors', async () => {
    seed({ fuel: 100, consumables: { PatchKit: 2 }, vehicles: [bike({ conditionCurrent: 40 })] });
    render(<GaragePanel onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Restore Condition/)).toBeTruthy();
    expect(screen.queryByTestId('garage-kit-doors')).toBeNull();
    expect(screen.queryByTestId('garage-worn-out')).toBeNull();
  });
});

describe('Garage — no equip level gate', () => {
  it("a level-1 hunter's Leviathan Rig equips from a live Equip button", async () => {
    seed({ level: 1, fuel: 100, consumables: {}, vehicles: [bike(), rig()], equippedId: 'veh-1' });
    render(<GaragePanel />);
    expect((await screen.findAllByText('Leviathan Rig')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Requires level/)).toBeNull();
    expect(screen.queryByText(/requires level/)).toBeNull();
    const equipButtons = screen.getAllByRole('button', { name: 'Equip' });
    expect(equipButtons.length).toBeGreaterThanOrEqual(1);
    for (const b of equipButtons) expect((b as HTMLButtonElement).disabled).toBe(false);
  });
});
