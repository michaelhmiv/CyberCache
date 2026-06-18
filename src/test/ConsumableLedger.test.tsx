import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConsumableLedger } from '@/components/stats/ConsumableLedger';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { ConsumableType } from '@/types/game';

describe('ConsumableLedger', () => {
  beforeEach(() => {
    useActiveBuffsStore.getState().clear();
  });
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
    // The PreFight row should contain both the consumable name ("Med Kit")
    // and its effect description from runtime.ledgerText. The effect text
    // happens to start with the name, so two DOM nodes match the regex —
    // we scope to the loaded row via its data-slot testid.
    const preFightRow = screen
      .getAllByTestId('consumable-ledger-row')
      .find((row) => row.getAttribute('data-slot') === 'PreFight');
    expect(preFightRow).toBeDefined();
    expect(preFightRow!).toHaveTextContent(/Med Kit/i);
    expect(preFightRow!).toHaveTextContent(/restored emergency HP/i);
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
});
