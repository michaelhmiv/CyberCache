import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ConsumableRing } from '@/components/stats/ConsumableRing';
import { ConsumableType } from '@/types/game';

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

  it('renders three slices when all slots are loaded', () => {
    const { container } = render(
      <ConsumableRing
        consumables={{ PreFight: 'MedKit', MidFight: 'AmmoPack', Emergency: 'AdrenalineShot' }}
        onClick={() => {}}
      />
    );
    expect(container.querySelectorAll('[data-consumable-slice]')).toHaveLength(3);
  });

  it('ignores invalid consumable IDs without crashing', () => {
    // Defensive: a stale persisted loadout might reference a consumable
    // that no longer exists. The component should render only the valid
    // slots, not throw.
    const { container } = render(
      <ConsumableRing
        consumables={{ PreFight: 'MedKit', MidFight: 'NotARealConsumable', Emergency: null }}
        onClick={() => {}}
      />
    );
    expect(container.querySelectorAll('[data-consumable-slice]')).toHaveLength(1);
  });

  it('honors the size prop for the SVG viewport', () => {
    const { container } = render(
      <ConsumableRing
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onClick={() => {}}
        size={80}
      />
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('80');
    expect(svg?.getAttribute('height')).toBe('80');
  });

  it('shows an active pulse when active buffs are supplied', () => {
    const { container } = render(
      <ConsumableRing
        consumables={{ PreFight: 'MedKit', MidFight: null, Emergency: null }}
        activeBuffs={[{
          id: 'buff-1', consumableId: ConsumableType.MedKit, family: 'survival', source: 'auto-eat', sourceId: 'test', startedAt: 0, expiresAt: Date.now() + 1000, durationMs: 1000, displayState: 'active',
        }]}
        onClick={() => {}}
      />
    );
    expect(container.querySelector('[data-consumable-active-pulse]')).toBeInTheDocument();
    expect(container.querySelector('[data-consumable-ring]')?.getAttribute('data-active-consumables')).toBe('1');
  });

  it('uses the singular "consumable" in the aria-label when exactly one is loaded', () => {
    const { container } = render(
      <ConsumableRing
        consumables={{ PreFight: 'MedKit', MidFight: null, Emergency: null }}
        onClick={() => {}}
      />
    );
    const ring = container.querySelector('[data-consumable-ring]');
    expect(ring?.getAttribute('aria-label')).toMatch(/^1 consumable\b/);
  });
});
