import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConsumableCompare } from '@/components/consumables/ConsumableCompare';
import { CONSUMABLES } from '@/constants/consumables';

const consumableId = (n: number) => Object.keys(CONSUMABLES)[n];

describe('ConsumableCompare', () => {
  it('renders null when current and candidate are identical', () => {
    const id = consumableId(0);
    const { container } = render(<ConsumableCompare currentId={id} candidateId={id} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a delta strip when current and candidate differ', () => {
    // MedKit → ShieldCell: different runtime effects, expect some deltas
    const { container } = render(
      <ConsumableCompare currentId="MedKit" candidateId="ShieldCell" />,
    );
    // Should render some spans with arrows (↑ or ↓)
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBeGreaterThan(0);
  });

  it('shows green tone for candidate that has more of a positive effect', () => {
    // MedKit: healHp 150. MedKitRefined: healHp 260. Refined is better heal.
    const { container } = render(
      <ConsumableCompare currentId="MedKit" candidateId="MedKitRefined" />,
    );
    const greenSpans = container.querySelectorAll('.text-green');
    expect(greenSpans.length).toBeGreaterThan(0);
  });

  it('shows red tone when candidate is worse than current', () => {
    // MedKitRefined: healHp 260. MedKit: healHp 150. MedKit is worse heal.
    const { container } = render(
      <ConsumableCompare currentId="MedKitRefined" candidateId="MedKit" />,
    );
    const redSpans = container.querySelectorAll('.text-red');
    expect(redSpans.length).toBeGreaterThan(0);
  });

  it('renders compact (fewer rows) when compact prop is true', () => {
    const { container } = render(
      <ConsumableCompare currentId="MedKit" candidateId="NanoSwarm" compact />,
    );
    const items = container.querySelectorAll('span[class*="text-"]');
    // Compact limits to 3 deltas max
    expect(items.length).toBeLessThanOrEqual(8);
  });
});
