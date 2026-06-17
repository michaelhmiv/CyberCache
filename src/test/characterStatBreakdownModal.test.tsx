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

  it('renders the modal with metric card when open is true', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('hunter-totals-breakdown-modal')).toBeInTheDocument();
    expect(screen.getByText('Source Breakdown')).toBeInTheDocument();
  });

  it('renders composition bar for the active metric', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    // DPS is the first metric — should have a composition bar with 3 segments
    expect(screen.getByTestId('composition-bar')).toBeInTheDocument();
  });

  it('shows bucket-grouped detail rows on expand', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    // Detail rows not visible by default
    expect(screen.queryAllByTestId('metric-card-source-row')).toHaveLength(0);
    // Expand
    fireEvent.click(screen.getByText(/show 3 sources/i));
    // Now detail rows visible, grouped by bucket
    expect(screen.getByTestId('metric-card-bucket-weapon')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-bucket-skill')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-bucket-consumable')).toBeInTheDocument();
  });

  it('marks consumable-bucket rows as transient', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/show 3 sources/i));
    const consumableBucket = screen.getByTestId('metric-card-bucket-consumable');
    const consumableRow = consumableBucket.querySelector('[data-testid="metric-card-source-row"]')!;
    expect(consumableRow.className).toContain('animate-pulse');
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
    // Default: DPS tab active, shows composition bar
    expect(screen.getByTestId('composition-bar')).toBeInTheDocument();

    // Click Max HP tab
    fireEvent.click(screen.getByText('Max HP'));
    // Health has no contributions — should show empty state
    expect(screen.getByTestId('composition-bar-empty')).toBeInTheDocument();
  });

  it('filters metrics by activityKind', () => {
    const summaryWithActivity: CharacterStatSummary = {
      headline: [],
      all: [
        { key: 'dps', label: 'DPS', value: 50, display: '50', detail: '', tone: 'red', contributions: [] },
        { key: 'craftingSpeed', label: 'Crafting Speed', value: 0.08, display: '+8%', detail: '', tone: 'amber', contributions: [], sourceActivity: 'crafting' },
        { key: 'salvageYield', label: 'Salvage Yield', value: 0.10, display: '+10%', detail: '', tone: 'amber', contributions: [], sourceActivity: 'salvaging' },
      ],
    };
    render(<CharacterStatBreakdownModal summary={summaryWithActivity} open={true} onClose={() => {}} activityKind="crafting" />);
    // DPS and craftingSpeed should be visible as tabs
    expect(screen.getAllByText('DPS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Crafting Speed')).toBeInTheDocument();
    // SalvageYield should NOT be visible
    expect(screen.queryByText('Salvage Yield')).not.toBeInTheDocument();
  });

  it('disambiguates duplicate keys by sourceActivity', () => {
    const summaryWithDup: CharacterStatSummary = {
      headline: [],
      all: [
        { key: 'dps', label: 'DPS', value: 50, display: '50', detail: '', tone: 'red', contributions: [] },
        { key: 'droneAssistSpeed', label: 'Drone Assist', value: 0.04, display: '+4%', detail: 'Crafting', tone: 'amber', contributions: [], sourceActivity: 'crafting' },
        { key: 'droneAssistSpeed', label: 'Drone Assist', value: 0.04, display: '+4%', detail: 'Workshop', tone: 'amber', contributions: [], sourceActivity: 'workshop_service' },
      ],
    };
    render(<CharacterStatBreakdownModal summary={summaryWithDup} open={true} onClose={() => {}} activityKind="crafting" />);
    // Only the crafting variant should be present
    const droneTabs = screen.getAllByText('Drone Assist');
    expect(droneTabs).toHaveLength(1);
  });
});
