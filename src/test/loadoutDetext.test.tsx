/**
 * Loadout de-texting (owner ruling 2026-11-05 — the no-paragraphs
 * law, generalizing the 2026-11-03 card-face law):
 *
 *   - The Loadout's belt section is its label ("Consumable Belt"),
 *     the chips, and a "?" beside the label. The two instruction
 *     sentences the screen used to print (the empty-slot remedy
 *     line inside the chips, and the "Belt — …" caption under
 *     them) are GONE from the screen; the explanation lives in
 *     the HelpHint sheet the "?" opens.
 *   - The vehicle slot is a button in the panel header; the
 *     bottom status strip (vehicle-status) renders nowhere.
 *
 * The deep vehicle-truth pins live in auditVehicleTruth /
 * garageFuelClarity / gearComposition; this file pins the
 * de-texting itself.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import { useLoadoutStore, usePlayerStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { SyncedLoadoutScreen } from '@/screens/SyncedLoadoutScreen';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    equipItem: vi.fn(async () => ({})),
    unequipSlot: vi.fn(async () => ({})),
    refuelVehicle: vi.fn(async () => ({})),
    enqueueRepairJob: vi.fn(async () => ({})),
  },
  fetchWorkshopState: vi.fn(async () => ({
    benches: 1, tools: {}, jobs: [], masteries: {},
    activeActionKind: null, recentCompletions: [],
  })),
}));

const scrapBike = (overrides: Partial<VehicleDisplay> = {}): VehicleDisplay => ({
  id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
  rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
  isLocked: false, pixelSeed: 1, conditionCurrent: 100, conditionMax: 100,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLoadoutStore.setState({
    slots: {
      primary: null, secondary: null, heavy: null, ordnance: null,
      shield: null, classMod: null, relic: null, vehicle: null,
    },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({ consumables: {}, vehicleFuel: 0 });
  useVehicleStore.setState({ vehicles: [], lastClaimStatus: null });
});

describe('de-texted belt — label, slots, and a "?" (owner ruling 2026-11-05)', () => {
  it('the belt prints its label and the chips — and no instruction sentences', () => {
    render(<ActionLoadout />);
    expect(screen.getByText('Consumable Belt')).toBeTruthy();
    expect(screen.getByTestId('consumables-chips')).toBeTruthy();
    // Both retired sentences are off the screen entirely.
    expect(screen.queryByText(/Empty belt slots load/)).toBeNull();
    expect(screen.queryByText(/auto-activate while roaming/)).toBeNull();
    expect(screen.queryByText(/no Save button/)).toBeNull();
    // The "?" stands beside the label, named for its section.
    expect(screen.getByRole('button', { name: 'About Consumable Belt' })).toBeTruthy();
  });

  it('the "?" carries a full 44px hit area behind its small plate', () => {
    render(<ActionLoadout />);
    const button = screen.getByTestId('help-hint-button');
    expect(button.className).toContain('h-11');
    expect(button.className).toContain('w-11');
  });

  it('the "?" opens a sheet carrying the whole explanation, and it closes', async () => {
    render(<ActionLoadout />);
    fireEvent.click(screen.getByRole('button', { name: 'About Consumable Belt' }));
    const sheet = await screen.findByTestId('help-hint-sheet');
    expect(sheet.textContent).toContain('Empty belt slots load at the Loadout Bench — Gear tab.');
    expect(sheet.textContent).toContain('All owned consumables auto-activate while roaming.');
    expect(sheet.textContent).toContain('Changes verify server-side; no Save button.');
    fireEvent.click(screen.getByRole('button', { name: 'Close Consumable Belt' }));
    await waitFor(() => expect(screen.queryByTestId('help-hint-sheet')).toBeNull());
  });

  it('a loaded belt shows its chips loaded — still with no sentences', () => {
    useLoadoutStore.setState({
      consumables: { PreFight: 'MedKit', MidFight: null, Emergency: null },
    });
    usePlayerStore.setState({ consumables: { MedKit: 3 } });
    render(<ActionLoadout />);
    const chips = screen.getByTestId('consumables-chips');
    const loaded = chips.querySelector('[data-consumable-type="MedKit"]');
    expect(loaded).toBeTruthy();
    expect(loaded?.getAttribute('data-count')).toBe('3');
    expect(screen.queryByText(/Empty belt slots load/)).toBeNull();
  });
});

describe('de-texted vehicle — a header button, no bottom strip', () => {
  it('the vehicle button sits in the loadout panel and toggles the Garage in place', async () => {
    useVehicleStore.setState({ vehicles: [scrapBike()] });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, vehicle: 'veh-1' } }));
    usePlayerStore.setState({ vehicleFuel: 0 });
    render(<SyncedLoadoutScreen />);
    const panel = screen.getByTestId('action-loadout');
    const button = screen.getByTestId('vehicle-button');
    expect(panel.contains(button)).toBe(true);
    expect(button.dataset.state).toBe('out-of-fuel');
    // The retired strip renders nowhere on the page — its
    // out-of-fuel remedy paragraph is gone with it (the button's
    // screen-reader description is not screen text and is not
    // what this pins).
    expect(screen.queryByTestId('vehicle-status')).toBeNull();
    expect(screen.queryByText(/No fuel cells carried — the Vendor/)).toBeNull();
    expect(screen.queryByText(/roaming on foot at ×1\.00\. Load/)).toBeNull();
    expect(screen.queryByTestId('garage-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Garage' }));
    expect(await screen.findByTestId('garage-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Garage' }));
    await waitFor(() => expect(screen.queryByTestId('garage-panel')).toBeNull());
  });
});
