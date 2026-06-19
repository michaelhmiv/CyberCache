import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ActiveBuffPills } from '@/components/stats/ActiveBuffPills';
import { ConsumableType } from '@/types/game';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';

describe('ActiveBuffPills', () => {
  beforeEach(() => {
    useActiveBuffsStore.setState({ buffs: [] });
  });

  it('renders 3 slot buttons always, even when empty', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onSlotClick={() => {}}
      />,
    );

    const rows = container.querySelectorAll('[data-testid="slot-row"]');
    expect(rows.length).toBe(3);

    // Empty slots show "Slot N" and "Empty"
    expect(container.textContent).toContain('Empty');
    expect(container.textContent).toContain('Slot 1');
    expect(container.textContent).toContain('Slot 3');
  });

  it('renders 3 slot buttons in a single horizontal row', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onSlotClick={() => {}}
      />,
    );

    const slotsSection = container.querySelector('[data-testid="slots-section"]');
    expect(slotsSection?.className).toContain('flex-row');

    // Each slot is a flex-1 button for equal horizontal sizing
    const slots = container.querySelectorAll('[data-testid="slot-row"]');
    slots.forEach((slot) => {
      expect(slot.tagName).toBe('BUTTON');
      expect(slot.className).toContain('flex-1');
    });
  });

  it('shows loaded consumable name and stock count in slot button', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{ MedKit: 3, AmmoPack: 1 }}
        consumables={{ PreFight: ConsumableType.MedKit, MidFight: ConsumableType.AmmoPack, Emergency: null }}
        onSlotClick={() => {}}
      />,
    );

    const slot1Row = container.querySelector('[data-slot="PreFight"]');
    expect(slot1Row?.textContent).toContain('Med Kit');
    expect(slot1Row?.textContent).toContain('×3');

    const slot2Row = container.querySelector('[data-slot="MidFight"]');
    expect(slot2Row?.textContent).toContain('Ammo Pack');
    expect(slot2Row?.textContent).toContain('×1');

    const slot3Row = container.querySelector('[data-slot="Emergency"]');
    expect(slot3Row?.textContent).toContain('Empty');
  });

  it('dims empty slots', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{ MedKit: 1 }}
        consumables={{ PreFight: ConsumableType.MedKit, MidFight: null, Emergency: null }}
        onSlotClick={() => {}}
      />,
    );

    // Slot 1 has a consumable → NOT dimmed
    const slot1Row = container.querySelector('[data-slot="PreFight"]');
    expect(slot1Row?.className).not.toContain('opacity-50');

    // Slot 2 is empty → dimmed
    const slot2Row = container.querySelector('[data-slot="MidFight"]');
    expect(slot2Row?.className).toContain('opacity-50');
  });

  it('shows LIVE tag on slot when consumable is actively firing', () => {
    const now = Date.now();
    useActiveBuffsStore.setState({
      buffs: [
        {
          id: 'buff-1',
          consumableId: ConsumableType.AmmoPack,
          family: 'ammo',
          source: 'roaming-coverage',
          sourceId: 'test',
          startedAt: now - 10000,
          expiresAt: now + 50000,
          durationMs: 60000,
          displayState: 'active',
        },
      ],
    });

    const { container } = render(
      <ActiveBuffPills
        inventory={{ AmmoPack: 2 }}
        consumables={{ PreFight: null, MidFight: ConsumableType.AmmoPack, Emergency: null }}
        onSlotClick={() => {}}
      />,
    );

    const slot2Row = container.querySelector('[data-slot="MidFight"]');
    expect(slot2Row?.textContent).toContain('LIVE');

    // Slot 1 is empty → should NOT have LIVE
    const slot1Row = container.querySelector('[data-slot="PreFight"]');
    expect(slot1Row?.textContent).not.toContain('LIVE');
  });

  it('onSlotClick fires with the correct slot when a slot is tapped', () => {
    const onSlotClick = vi.fn();
    useActiveBuffsStore.setState({ buffs: [] });

    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
        consumables={{ PreFight: ConsumableType.MedKit, MidFight: null, Emergency: null }}
        onSlotClick={onSlotClick}
      />,
    );

    // Click Slot 2 (MidFight)
    const slot2 = container.querySelector('[data-slot="MidFight"]')!;
    fireEvent.click(slot2);
    expect(onSlotClick).toHaveBeenCalledWith('MidFight');

    // Click Slot 1 (PreFight)
    const slot1 = container.querySelector('[data-slot="PreFight"]')!;
    fireEvent.click(slot1);
    expect(onSlotClick).toHaveBeenCalledWith('PreFight');
  });

  it('renders active buff pills with countdown', () => {
    const now = Date.now();
    useActiveBuffsStore.setState({
      buffs: [
        {
          id: 'buff-1',
          consumableId: ConsumableType.AmmoPack,
          family: 'ammo',
          source: 'roaming-coverage',
          sourceId: 'test',
          startedAt: now - 10000,
          expiresAt: now + 50000,
          durationMs: 60000,
          displayState: 'active',
        },
      ],
    });

    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
        consumables={{ PreFight: null, MidFight: ConsumableType.AmmoPack, Emergency: null }}
        onSlotClick={() => {}}
      />,
    );

    const pills = container.querySelectorAll('[data-testid="active-buff-pill"]');
    expect(pills.length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('[data-testid="buff-countdown"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="buff-progress"]')).toBeInTheDocument();
  });

  it('countdown updates over time', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    useActiveBuffsStore.setState({
      buffs: [
        {
          id: 'buff-timer',
          consumableId: ConsumableType.NanoSwarm,
          family: 'survival',
          source: 'auto-eat',
          sourceId: 'test',
          startedAt: now,
          expiresAt: now + 30000,
          durationMs: 30000,
          displayState: 'active',
        },
      ],
    });

    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
        consumables={{ PreFight: null, MidFight: null, Emergency: ConsumableType.NanoSwarm }}
        onSlotClick={() => {}}
      />,
    );

    const initialCountdown = container.querySelector('[data-testid="buff-countdown"]')!.textContent;
    expect(initialCountdown).toContain('30s');

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const updatedCountdown = container.querySelector('[data-testid="buff-countdown"]')!.textContent;
    expect(updatedCountdown).toContain('25s');

    vi.useRealTimers();
  });
});
