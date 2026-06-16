import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ConsumableRing } from '@/components/stats/ConsumableRing';

describe('ConsumableRing', () => {
  it('renders an empty ring with no slices when no consumables are loaded', () => {
    const { container } = render(
      <ConsumableRing consumables={{ PreFight: null, MidFight: null, Emergency: null }} onClick={() => {}} />
    );
    expect(container.querySelectorAll('[data-consumable-slice]')).toHaveLength(0);
    expect(container.querySelector('[data-consumable-empty]')).toBeInTheDocument();
  });

  it('renders one slice per loaded consumable', () => {
    const { container } = render(
      <ConsumableRing
        consumables={{ PreFight: 'MedKit', MidFight: 'AmmoPack', Emergency: null }}
        onClick={() => {}}
      />
    );
    expect(container.querySelectorAll('[data-consumable-slice]')).toHaveLength(2);
  });

  it('invokes onClick when the ring is tapped', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ConsumableRing
        consumables={{ PreFight: 'MedKit', MidFight: null, Emergency: null }}
        onClick={onClick}
      />
    );
    fireEvent.click(container.querySelector('[data-consumable-ring]')!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
