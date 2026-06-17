import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetricCard } from '@/components/stats/MetricCard';
import type { StatMetric } from '@/lib/stats/characterStats';

const metric: StatMetric = {
  key: 'rareFind', label: 'Rare Find', value: 0.18, display: '+18%', detail: 'drop chance modifiers', tone: 'amber',
  contributions: [
    { source: 'Weapon A', detail: 'rareDropChanceMod', value: 0.05, display: '+5%', tone: 'amber', bucket: 'weapon' },
    { source: 'Skill Tree', detail: 'rareDropChance', value: 0.04, display: '+4%', tone: 'purple', bucket: 'skill' },
    { source: 'Med Kit', detail: 'bonusLootChance', value: 0.09, display: '+9%', tone: 'amber', bucket: 'consumable' },
  ],
};

describe('MetricCard bucket grouping', () => {
  it('renders a composition bar with segments', () => {
    render(<MetricCard metric={metric} max={0.1} />);
    const bar = screen.getByTestId('composition-bar');
    expect(bar).toBeInTheDocument();
    // Three nonzero contributions → three segments
    expect(screen.getByTestId('composition-segment-0')).toBeInTheDocument();
    expect(screen.getByTestId('composition-segment-1')).toBeInTheDocument();
    expect(screen.getByTestId('composition-segment-2')).toBeInTheDocument();
  });

  it('renders collapsible detail list on expand', () => {
    render(<MetricCard metric={metric} max={0.1} />);
    // Detail rows not visible by default
    expect(screen.queryAllByTestId('metric-card-source-row')).toHaveLength(0);
    // Expand
    const expandBtn = screen.getByText(/show 3 sources/i);
    fireEvent.click(expandBtn);
    // Now detail rows visible
    expect(screen.queryAllByTestId('metric-card-source-row')).toHaveLength(3);
  });

  it('marks consumable-bucket rows as transient', () => {
    render(<MetricCard metric={metric} max={0.1} />);
    fireEvent.click(screen.getByText(/show 3 sources/i));
    // Consumable bucket should exist
    expect(screen.getByTestId('metric-card-bucket-consumable')).toBeInTheDocument();
    // The consumable row should have animate-pulse class
    const consumableRows = screen.getByTestId('metric-card-bucket-consumable').querySelectorAll('[data-testid="metric-card-source-row"]');
    expect(consumableRows[0].className).toContain('animate-pulse');
  });

  it('renders empty state when no contributions', () => {
    const emptyMetric: StatMetric = {
      ...metric,
      contributions: [],
    };
    render(<MetricCard metric={emptyMetric} max={0.1} />);
    expect(screen.getByTestId('composition-bar-empty')).toBeInTheDocument();
  });

  it('skips bar for integer metrics', () => {
    const intMetric: StatMetric = {
      key: 'parallelQueueSlots', label: 'Parallel Slots', value: 1, display: '+1', detail: 'queue slots', tone: 'amber',
      contributions: [
        { source: 'Class Mod', detail: 'parallelQueueSlots', value: 1, display: '+1', tone: 'amber', bucket: 'gear' },
      ],
    };
    render(<MetricCard metric={intMetric} max={1} />);
    expect(screen.queryByTestId('composition-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('composition-bar-empty')).not.toBeInTheDocument();
  });
});
