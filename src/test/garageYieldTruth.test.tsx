/**
 * G-F6 — the Garage contradicted itself out of fuel: the banner
 * said the vehicle pays no yield bonus (×1.00, on foot) while the
 * vehicle card printed "Effective yield now: ×1.15" — the card's
 * figure came from the condition-only helper and never saw the
 * empty tank.
 *
 * The audit's CI assertion: render the Garage out-of-fuel; assert
 * every yield figure on the screen is identical. (The card's
 * "base yield ×1.15" line is the vehicle CLASS's spec figure,
 * labeled as such — it is not a current-yield figure and is out of
 * this assertion's scope, exactly as the banner's prose ×1.00 is
 * the statement the card must agree with.)
 *
 * Scaffolding mirrors garageFuelClarity.test.tsx.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLoadoutStore, usePlayerStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { GaragePanel } from '@/components/gear/GaragePanel';
import { DropSource, Rarity } from '@/types/game';

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

function seed(opts: { fuel: number; vehicles: VehicleDisplay[] }) {
  useLoadoutStore.setState({
    slots: {
      primary: null, secondary: null, heavy: null, ordnance: null,
      shield: null, classMod: null, relic: null,
      vehicle: opts.vehicles[0]?.id ?? null,
    },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({ level: 1, consumables: {}, vehicleFuel: opts.fuel });
  useVehicleStore.setState({ vehicles: opts.vehicles, lastClaimStatus: null });
}

describe('Garage yield truth — one derived yield value (audit G-F6)', () => {
  it('out of fuel: the card agrees with the banner — effective yield is ×1.00', () => {
    seed({ fuel: 0, vehicles: [bike()] });
    render(<GaragePanel onNavigate={vi.fn()} />);
    const panel = screen.getByTestId('garage-panel');
    expect(screen.getByTestId('garage-out-of-fuel').textContent).toContain('×1.00');
    expect(panel.textContent).toContain('Effective yield now: ×1.00');
    expect(panel.textContent).not.toContain('Effective yield now: ×1.15');
  });

  it('fueled: the card prints the real condition-scaled yield', () => {
    seed({ fuel: 250, vehicles: [bike()] });
    render(<GaragePanel onNavigate={vi.fn()} />);
    const panel = screen.getByTestId('garage-panel');
    expect(panel.textContent).toContain('Effective yield now: ×1.15');
  });
});
