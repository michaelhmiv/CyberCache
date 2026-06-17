import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';

const summary: CharacterStatSummary = {
  headline: [],
  all: [
    { key: 'dps', label: 'DPS', value: 50, display: '50', detail: 'weapons + skills', tone: 'red', contributions: [
      { source: 'Weapon A', detail: 'base', value: 40, display: '40', tone: 'red', bucket: 'weapon' },
      { source: 'Skill Tree', detail: 'weaponDamage', value: 10, display: '10', tone: 'purple', bucket: 'skill' },
      { source: 'Med Kit', detail: 'dpsMultiplier', value: 5, display: '5', tone: 'amber', bucket: 'consumable' },
    ] },
    { key: 'health', label: 'Max HP', value: 100, display: '100', detail: '', tone: 'green', contributions: [] },
  ],
};

describe('CharacterStatBreakdownModal', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <CharacterStatBreakdownModal summary={summary} open={false} onClose={() => {}} />,
    );
    expect(container.querySelector('#hunter-totals-breakdown')).toBeNull();
  });

  it('renders the modal with bucketed contributions when open is true', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('hunter-totals-breakdown-modal')).toBeInTheDocument();
    expect(screen.getByText('Source Breakdown')).toBeInTheDocument();
  });

  it('groups contributions by bucket (weapon / skill / consumable visible)', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('source-bucket-weapon')).toBeInTheDocument();
    expect(screen.getByTestId('source-bucket-skill')).toBeInTheDocument();
    expect(screen.getByTestId('source-bucket-consumable')).toBeInTheDocument();
  });

  it('marks consumable-bucket rows as transient', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    const consumableRow = screen.getByTestId('source-row-Med Kit-dpsMultiplier');
    expect(consumableRow.dataset.transient).toBe('true');
  });

  it('invokes onClose when the X button is tapped', () => {
    const onClose = vi.fn();
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close source breakdown'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <CharacterStatBreakdownModal summary={summary} open={true} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('[data-testid="hunter-totals-breakdown-modal"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches active metric when a tab is clicked', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    // Default: DPS tab active, shows Weapon A (in both compact chips and bucketed view)
    expect(screen.getAllByText('Weapon A').length).toBeGreaterThanOrEqual(1);

    // Click Max HP tab
    fireEvent.click(screen.getByText('Max HP'));
    // Health has no contributions — should show empty state
    expect(screen.getByText(/No slotted source/i)).toBeInTheDocument();
  });
});
