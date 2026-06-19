import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConsumableLedger } from '@/components/stats/ConsumableLedger';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { ConsumableType } from '@/types/game';

describe('ConsumableLedger', () => {
  beforeEach(() => {
    useActiveBuffsStore.getState().clear();
  });

  // ── Full ledger mode (no focusedSlot) ──

  it('renders one row per slot, even when empty', () => {
    render(
      <ConsumableLedger
        consumables={{ PreFight: null, MidFight: 'MedKit', Emergency: null }} inventory={{}}
        onClose={() => {}}
      />
    );
    expect(screen.getAllByTestId('consumable-ledger-row')).toHaveLength(3);
  });

  it('shows the consumable name and effect for loaded slots', () => {
    render(
      <ConsumableLedger
        consumables={{ PreFight: 'MedKit', MidFight: null, Emergency: null }} inventory={{}}
        onClose={() => {}}
      />
    );
    const preFightRow = screen
      .getAllByTestId('consumable-ledger-row')
      .find((row) => row.getAttribute('data-slot') === 'PreFight');
    expect(preFightRow).toBeDefined();
    expect(preFightRow!).toHaveTextContent(/Med Kit/i);
    expect(preFightRow!).toHaveTextContent(/Emergency Heal/i);
  });

  it('renders active consumable rows from the active buff store', () => {
    useActiveBuffsStore.getState().add({
      id: 'buff-1',
      consumableId: ConsumableType.AdrenalineShot,
      family: 'survival',
      source: 'auto-eat',
      sourceId: 'test',
      startedAt: Date.now(),
      expiresAt: Date.now() + 20_000,
      durationMs: 20_000,
      displayState: 'active',
      value: 1.1,
    });
    render(<ConsumableLedger consumables={{ PreFight: null, MidFight: null, Emergency: null }} inventory={{}} onClose={() => {}} />);
    expect(screen.getByTestId('active-consumable-section')).toHaveTextContent(/1 live/i);
    expect(screen.getByTestId('active-consumable-row')).toHaveTextContent(/Adrenaline/i);
  });

  it('invokes onClose when the close button is tapped', () => {
    const onClose = vi.fn();
    render(
      <ConsumableLedger
        consumables={{ PreFight: null, MidFight: null, Emergency: null }} inventory={{}}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByLabelText('Close consumable ledger'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Focused slot mode ──

  it('shows only the focused slot title in focused mode', () => {
    render(
      <ConsumableLedger
        consumables={{ PreFight: 'MedKit', MidFight: null, Emergency: null }}
        inventory={{ MedKit: 3 }}
        focusedSlot="PreFight"
        onClose={() => {}}
      />
    );
    // Header should show "Slot 1" not "Consumable Ledger"
    expect(screen.getByText('Slot 1')).toBeInTheDocument();
    // Should NOT show the full ledger rows or active section
    expect(screen.queryAllByTestId('consumable-ledger-row')).toHaveLength(0);
    expect(screen.queryByTestId('active-consumable-section')).not.toBeInTheDocument();
  });

  it('shows the focused slot picker list and current loadout', () => {
    render(
      <ConsumableLedger
        consumables={{ PreFight: 'MedKit', MidFight: 'AmmoPack', Emergency: null }}
        inventory={{ MedKit: 3, AmmoPack: 2 }}
        focusedSlot="PreFight"
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('slot-picker-PreFight')).toBeInTheDocument();
    // The focused slot's current consumable should show (in preview + picker)
    const medKitElements = screen.getAllByText('Med Kit');
    expect(medKitElements.length).toBeGreaterThanOrEqual(1);
    // The other slot's consumable should NOT be shown as a separate slot row
    expect(screen.queryAllByTestId('consumable-ledger-row')).toHaveLength(0);
  });

  it('shows "Empty slot" when focused slot has no consumable', () => {
    render(
      <ConsumableLedger
        consumables={{ PreFight: null, MidFight: 'MedKit', Emergency: null }}
        inventory={{ MedKit: 1 }}
        focusedSlot="PreFight"
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Empty slot')).toBeInTheDocument();
  });

  it('shows "Clear slot" button when focused slot has a consumable', () => {
    render(
      <ConsumableLedger
        consumables={{ PreFight: 'MedKit', MidFight: null, Emergency: null }}
        inventory={{ MedKit: 1 }}
        focusedSlot="PreFight"
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Clear slot')).toBeInTheDocument();
  });
});
