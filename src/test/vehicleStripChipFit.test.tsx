/**
 * Vehicle strip chip — the stacked-fit pins (fix pass on the
 * placement slice, owner decision 2026-11-10).
 *
 * The slice's first captures measured the one-line readout
 * against the Strip's real width budget at 390px and it did
 * not fit: in the healthy state the vehicle name truncated to
 * zero width (only "100u · ×1.15" showed), and in the remedy
 * states the unshrinkable state span painted over the LV
 * block and clipped at the frame edge. The fix stacks the
 * cell — name over facts, state over door (the belt chip's
 * own stack) — inside a clip wrapper, on the row's one
 * elastic root (basis-0).
 *
 * jsdom computes no layout, so these pins are structural:
 * they lock the exact mechanism the captures verified —
 * the elastic name (truncate) on its own line, the facts
 * whole on theirs, the remedy's state and door on separate
 * lines, the readout clipped at the chip's own edge
 * (overflow-hidden), the yielded basis, and the ±9px
 * invisible touch extension that brings the ~26px cell to
 * the Strip row's full 44px height.
 *
 * Seeding mirrors vehicleStripChip.test.tsx.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import { useVehicleStore, type VehicleDisplay } from '@/store/slices/vehicleSlice';
import { FUEL_CELL_TYPE } from '@/lib/vehicles/vehicles';
import { ResourceBar } from '@/components/layout/ResourceBar';

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

describe('vehicle strip chip — the stacked fit', () => {
  it('healthy: the name renders on its own line; the facts stay whole on theirs', () => {
    seedStores({ fuel: 100 });
    render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    const name = within(chip).getByTestId('vehicle-chip-name');
    const facts = within(chip).getByTestId('vehicle-chip-facts');
    expect(name.textContent).toBe('Scrap Bike');
    expect(facts.textContent).toContain('100u');
    expect(facts.textContent).toContain('×1.15');
    // The name and the facts are separate lines in one column:
    // the facts are a direct child of the column, the name sits
    // one level deeper, inside the name line above them.
    expect(name.parentElement).not.toBe(facts.parentElement);
    expect(facts.parentElement).toBe(name.parentElement?.parentElement);
  });

  it('the fit mechanism: elastic name, clipped readout, yielded basis', () => {
    seedStores({ fuel: 100 });
    render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    // The name is the row's one elastic part.
    expect(within(chip).getByTestId('vehicle-chip-name').className).toContain('truncate');
    // The readout clips at the chip's own edge — no state can
    // paint over the level block again.
    expect(within(chip).getByTestId('vehicle-chip-readout').className).toContain('overflow-hidden');
    expect(within(chip).getByTestId('vehicle-chip-readout').className).toContain('min-w-0');
    // The root yields its basis so the row can give the cell
    // the width the wallet leaves.
    expect(chip.className).toContain('basis-0');
    expect(chip.className).toContain('min-w-0');
    // The facts never shrink and never truncate.
    const facts = within(chip).getByTestId('vehicle-chip-facts');
    expect(facts.className).toContain('whitespace-nowrap');
    expect(facts.className).not.toContain('truncate');
  });

  it('worn below full: the condition rides the name line, not the facts line', () => {
    seedStores({ fuel: 40, bike: scrapBike({ conditionCurrent: 50, conditionMax: 100 }) });
    render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    expect(within(chip).getByTestId('vehicle-chip-condition').textContent).toBe('50%');
    expect(within(chip).getByTestId('vehicle-chip-facts').textContent).not.toContain('50%');
    expect(within(chip).getByTestId('vehicle-chip-facts').textContent).toContain('40u');
  });

  it('remedy: state and door stack on separate lines; the name rides the aria-label', () => {
    seedStores({ fuel: 0, consumables: { [FUEL_CELL_TYPE]: 2 } });
    render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    const state = within(chip).getByTestId('vehicle-chip-state');
    const door = within(chip).getByTestId('vehicle-chip-door');
    expect(state.textContent).toBe('Out of fuel');
    expect(door.textContent).toContain('Refuel');
    // One column, two lines: both are direct children of the
    // flex-col stack (not one horizontal row).
    expect(state.parentElement).toBe(door.parentElement);
    expect(state.parentElement?.className).toContain('flex-col');
    expect(chip.getAttribute('aria-label')).toContain('Scrap Bike');
  });

  it('remedy root sizes to content so the state/door words print whole (audit H-04)', () => {
    seedStores({ fuel: 0, consumables: {} });
    render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    // The elastic basis-0 root let the wallet squeeze the remedy
    // cell below the words' width ("OUT OF" / "BUY CE" in the
    // audit's captures). The remedy root is content-sized instead;
    // the strip's overflow-x-auto absorbs the few pixels.
    expect(chip.className).toContain('flex-none');
    expect(chip.className).not.toContain('basis-0');
    const state = within(chip).getByTestId('vehicle-chip-state');
    const door = within(chip).getByTestId('vehicle-chip-door');
    expect(state.textContent).toBe('Out of fuel');
    expect(door.textContent).toContain('Buy cells');
    expect(state.className).toContain('whitespace-nowrap');
    expect(door.className).toContain('whitespace-nowrap');
  });

  it('remedy (worn out): the stack holds for Repair as well', () => {
    seedStores({ fuel: 50, bike: scrapBike({ conditionCurrent: 0, conditionMax: 100 }) });
    render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    const chip = screen.getByTestId('vehicle-strip-chip');
    expect(within(chip).getByTestId('vehicle-chip-state').textContent).toBe('Worn out');
    expect(within(chip).getByTestId('vehicle-chip-door').textContent).toContain('Repair');
  });

  it('every state carries the ±9px touch extension (the ~26px cell reaches the row’s 44px)', () => {
    seedStores({ fuel: 100 });
    const first = render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    expect(screen.getByTestId('vehicle-strip-chip').className).toContain('after:-inset-y-[9px]');
    first.unmount();
    seedStores({ fuel: 0, consumables: {} });
    const second = render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    expect(screen.getByTestId('vehicle-strip-chip').className).toContain('after:-inset-y-[9px]');
    second.unmount();
    seedStores({ withVehicle: false });
    render(<ResourceBar variant="home" onNavigate={vi.fn()} />);
    expect(screen.getByTestId('vehicle-strip-chip').className).toContain('after:-inset-y-[9px]');
  });
});
