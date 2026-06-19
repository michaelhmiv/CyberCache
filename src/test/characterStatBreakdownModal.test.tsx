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
    { key: 'health', label: 'Max HP', value: 100, display: '100', detail: '', tone: 'green',
      contributions: [],
      stacked: [
        { value: 70, display: '70', tone: 'muted', label: 'Chassis' },
        { value: 30, display: '30', tone: 'cyan', label: 'Shield' },
      ],
    },
  ],
};

describe('CharacterStatBreakdownModal', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <CharacterStatBreakdownModal summary={summary} open={false} onClose={() => {}} />,
    );
    expect(container.querySelector('#hunter-totals-breakdown')).toBeNull();
  });

  it('renders the full-screen overlay with header when open', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    expect(screen.getByTestId('hunter-totals-breakdown-modal')).toBeInTheDocument();
    expect(screen.getByText('Source Breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('breakdown-header')).toBeInTheDocument();
  });

  it('renders all scoped metrics as cards in a grid (no tabs)', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    // Both metrics should be visible simultaneously — no tab switching
    expect(screen.getByTestId('metric-card-dps')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-health')).toBeInTheDocument();
  });

  it('renders composition bars for both metrics at once', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    // DPS has 3 contributions → bar with 3 segments
    const dpsCard = screen.getByTestId('metric-card-dps');
    expect(dpsCard.querySelector('[data-testid="composition-bar"]')).toBeInTheDocument();
    // Health has stacked segments → bar
    const healthCard = screen.getByTestId('metric-card-health');
    expect(healthCard.querySelector('[data-testid="composition-bar"]')).toBeInTheDocument();
  });

  it('shows bucket-grouped detail rows on expand', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} />);
    // Detail rows not visible by default
    expect(screen.queryAllByTestId('metric-card-source-row')).toHaveLength(0);
    // Expand DPS card
    fireEvent.click(screen.getByText(/show 3 sources/i));
    // Detail rows visible, grouped by bucket
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
    render(
      <CharacterStatBreakdownModal summary={summary} open={true} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId('hunter-totals-breakdown-modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows activity label in header when activityKind is provided', () => {
    render(<CharacterStatBreakdownModal summary={summary} open={true} onClose={() => {}} activityKind="roaming_loot" />);
    expect(screen.getByText(/Roaming loot/)).toBeInTheDocument();
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
    // DPS and craftingSpeed should be visible as cards
    expect(screen.getByTestId('metric-card-dps')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-craftingSpeed')).toBeInTheDocument();
    // SalvageYield should NOT be visible
    expect(screen.queryByTestId('metric-card-salvageYield')).not.toBeInTheDocument();
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
    // Only one Drone Assist card should exist
    expect(screen.getAllByTestId('metric-card-droneAssistSpeed')).toHaveLength(1);
  });

  it('renders section dividers for combat core and activity', () => {
    const summaryWithActivity: CharacterStatSummary = {
      headline: [],
      all: [
        { key: 'dps', label: 'DPS', value: 50, display: '50', detail: '', tone: 'red', contributions: [] },
        { key: 'health', label: 'Max HP', value: 100, display: '100', detail: '', tone: 'green', contributions: [] },
        { key: 'craftingSpeed', label: 'Crafting Speed', value: 0.08, display: '+8%', detail: '', tone: 'amber', contributions: [], sourceActivity: 'crafting' },
      ],
    };
    render(<CharacterStatBreakdownModal summary={summaryWithActivity} open={true} onClose={() => {}} activityKind="crafting" />);
    expect(screen.getByText('Combat Core')).toBeInTheDocument();
    expect(screen.getByText('Crafting')).toBeInTheDocument();
  });
});
