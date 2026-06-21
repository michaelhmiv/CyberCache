import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConsumablePicker } from '@/components/consumables/ConsumablePicker';

vi.mock('@/store', () => ({
  usePlayerStore: () => ({
    consumables: {
      MedKit: 5,
      ShieldCell: 2,
      AmmoPack: 3,
      Grenade: 1,
      BossScanner: 0,
    },
    getConsumableCount: (id: string) =>
      ({ MedKit: 5, ShieldCell: 2, AmmoPack: 3, Grenade: 1, BossScanner: 0 })[id] ?? 0,
  }),
}));

describe('ConsumablePicker', () => {
  it('renders the slot label header and consumable names', () => {
    render(
      <ConsumablePicker
        slot="PreFight"
        currentId="MedKit"
        onClose={() => {}}
        onEquip={async () => {}}
        onUnequip={async () => {}}
      />,
    );
    // Header with slot label
    expect(screen.getByText(/Slot 1/i)).toBeTruthy();
    // At least some owned consumable names visible (not boss-prep filtered out)
    expect(screen.getByText('Med Kit')).toBeTruthy();
    expect(screen.getByText('Shield Cell')).toBeTruthy();
  });

  it('renders a search input', () => {
    render(
      <ConsumablePicker
        slot="MidFight"
        currentId={null}
        onClose={() => {}}
        onEquip={async () => {}}
        onUnequip={async () => {}}
      />,
    );
    const input = screen.getByPlaceholderText(/search/i);
    expect(input).toBeTruthy();
  });

  it('filters results by search term', () => {
    const { container } = render(
      <ConsumablePicker
        slot="Emergency"
        currentId={null}
        onClose={() => {}}
        onEquip={async () => {}}
        onUnequip={async () => {}}
      />,
    );
    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'med' } });
    // After filtering, Med Kit should be visible, Ammo Pack should not
    expect(screen.getByText('Med Kit')).toBeTruthy();
    const ammoPresent = container.textContent?.includes('Ammo Pack');
    expect(ammoPresent).toBeFalsy();
  });

  it('shows unequip button when currentId is present', () => {
    render(
      <ConsumablePicker
        slot="PreFight"
        currentId="MedKit"
        onClose={() => {}}
        onEquip={async () => {}}
        onUnequip={async () => {}}
      />,
    );
    expect(screen.getByText(/Unequip/i)).toBeTruthy();
  });

  it('does not render boss-context sort when no bossContext provided', () => {
    render(
      <ConsumablePicker
        slot="PreFight"
        currentId={null}
        onClose={() => {}}
        onEquip={async () => {}}
        onUnequip={async () => {}}
      />,
    );
    // boss-context sort option absent without bossContext
    const bossSort = screen.queryByText(/boss/i, { selector: 'option' });
    expect(bossSort).toBeNull();
  });

  it('renders boss-context sort option when bossContext is provided', () => {
    render(
      <ConsumablePicker
        slot="MidFight"
        currentId={null}
        onClose={() => {}}
        onEquip={async () => {}}
        onUnequip={async () => {}}
        bossContext={{ missingCounters: ['shield', 'armor'], bossName: 'Goliath' }}
      />,
    );
    expect(screen.getByText(/matches/i, { selector: 'option' })).toBeTruthy();
  });
});
