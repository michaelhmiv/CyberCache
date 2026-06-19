import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ActiveBuffPills } from '@/components/stats/ActiveBuffPills';
import { ConsumableType } from '@/types/game';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';

describe('ActiveBuffPills', () => {
  beforeEach(() => {
    useActiveBuffsStore.setState({ buffs: [] });
  });

  it('renders 3 slot rows always, even when empty', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onClick={() => {}}
      />,
    );

    const rows = container.querySelectorAll('[data-testid="slot-row"]');
    expect(rows.length).toBe(3);

    // Empty slots show "Empty"
    expect(container.textContent).toContain('Empty');
    expect(container.textContent).toContain('Slot 1');
    expect(container.textContent).toContain('Slot 3');
  });

  it('shows loaded consumable name and stock count in slot row', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{ MedKit: 3, AmmoPack: 1 }}
        consumables={{ PreFight: ConsumableType.MedKit, MidFight: ConsumableType.AmmoPack, Emergency: null }}
        onClick={() => {}}
      />,
    );

    const slot1Row = container.querySelector('[data-slot="PreFight"]');
    expect(slot1Row?.textContent).toContain('Med Kit');
    expect(slot1Row?.textContent).toContain('3 in stock');

    const slot2Row = container.querySelector('[data-slot="MidFight"]');
    expect(slot2Row?.textContent).toContain('Ammo Pack');
    expect(slot2Row?.textContent).toContain('1 in stock');

    const slot3Row = container.querySelector('[data-slot="Emergency"]');
    expect(slot3Row?.textContent).toContain('Empty');
  });

  it('dims empty slots', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{ MedKit: 1 }}
        consumables={{ PreFight: ConsumableType.MedKit, MidFight: null, Emergency: null }}
        onClick={() => {}}
      />,
    );

    // Slot 1 has a consumable → NOT dimmed
    const slot1Row = container.querySelector('[data-slot="PreFight"]');
    expect(slot1Row?.className).not.toContain('opacity-60');

    // Slot 2 is empty → dimmed
    const slot2Row = container.querySelector('[data-slot="MidFight"]');
    expect(slot2Row?.className).toContain('opacity-60');
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
        onClick={() => {}}
      />,
    );

    const slot2Row = container.querySelector('[data-slot="MidFight"]');
    expect(slot2Row?.textContent).toContain('LIVE');

    // Slot 1 is empty → should NOT have LIVE
    const slot1Row = container.querySelector('[data-slot="PreFight"]');
    expect(slot1Row?.textContent).not.toContain('LIVE');
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
        onClick={() => {}}
      />,
    );

    const pills = container.querySelectorAll('[data-testid="active-buff-pill"]');
    expect(pills.length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('[data-testid="buff-countdown"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="buff-progress"]')).toBeInTheDocument();
  });

  it('onClick fires when tapped', () => {
    const onClick = vi.fn();
    useActiveBuffsStore.setState({ buffs: [] });

    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
        consumables={{ PreFight: ConsumableType.MedKit, MidFight: null, Emergency: null }}
        onClick={onClick}
      />,
    );

    const btn = container.querySelector('[data-testid="active-buff-pills"]')!;
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
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
        onClick={() => {}}
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
