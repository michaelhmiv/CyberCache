import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourceRow } from '@/components/stats/CharacterStatBar';
import type { StatMetric } from '@/lib/stats/characterStats';

const metric: StatMetric = {
  key: 'rareFind', label: 'Rare Find', value: 0.18, display: '+18%', detail: '', tone: 'amber',
  contributions: [
    { source: 'Weapon A', detail: 'rareDropChanceMod', value: 0.05, display: '+5%', tone: 'amber', bucket: 'weapon' },
    { source: 'Skill Tree', detail: 'rareDropChance', value: 0.04, display: '+4%', tone: 'purple', bucket: 'skill' },
    { source: 'Med Kit', detail: 'bonusLootChance', value: 0.09, display: '+9%', tone: 'amber', bucket: 'consumable' },
  ],
};

describe('SourceRow bucket grouping', () => {
  it('renders one section per bucket that has contributions', () => {
    render(<SourceRow metric={metric} max={0.1} groupByBucket />);
    expect(screen.getByTestId('source-bucket-weapon')).toBeInTheDocument();
    expect(screen.getByTestId('source-bucket-skill')).toBeInTheDocument();
    expect(screen.getByTestId('source-bucket-consumable')).toBeInTheDocument();
  });

  it('marks consumable-bucket rows as transient', () => {
    render(<SourceRow metric={metric} max={0.1} groupByBucket />);
    const consumableRow = screen.getByTestId('source-row-Med Kit-bonusLootChance');
    expect(consumableRow.dataset.transient).toBe('true');
  });
});
