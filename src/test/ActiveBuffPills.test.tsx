import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ActiveBuffPills } from '@/components/stats/ActiveBuffPills';
import { ConsumableType } from '@/types/game';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';

describe('ActiveBuffPills', () => {
  beforeEach(() => {
    useActiveBuffsStore.setState({ buffs: [] });
  });

  it('renders "No consumables loaded" when empty', () => {
    const { container } = render(
      <ActiveBuffPills
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onClick={() => {}}
      />,
    );
    expect(container.querySelector('[data-pills-empty]')).toBeInTheDocument();
    expect(container.textContent).toContain('No consumables loaded');
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
        consumables={{ PreFight: null, MidFight: ConsumableType.AmmoPack, Emergency: null }}
        onClick={() => {}}
      />,
    );

    const pills = container.querySelectorAll('[data-testid="active-buff-pill"]');
    expect(pills.length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('[data-testid="buff-countdown"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="buff-progress"]')).toBeInTheDocument();
  });

  it('renders armed indicators for loaded-but-not-firing', () => {
    useActiveBuffsStore.setState({ buffs: [] });

    const { container } = render(
      <ActiveBuffPills
        consumables={{ PreFight: ConsumableType.MedKit, MidFight: ConsumableType.AmmoPack, Emergency: null }}
        onClick={() => {}}
      />,
    );

    expect(container.querySelector('[data-testid="armed-slots-row"]')).toBeInTheDocument();
    expect(container.textContent).toContain('Med Kit');
    expect(container.textContent).toContain('Ammo Pack');
    expect(container.textContent).toContain('LOADED');
  });

  it('onClick fires when tapped', () => {
    const onClick = vi.fn();
    useActiveBuffsStore.setState({ buffs: [] });

    const { container } = render(
      <ActiveBuffPills
        consumables={{ PreFight: ConsumableType.MedKit, MidFight: null, Emergency: null }}
        onClick={onClick}
      />,
    );

    const btn = container.querySelector('[data-testid="active-buff-pills"]')!;
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('hides armed slots for consumables that are already firing as active buffs', () => {
    const now = Date.now();
    useActiveBuffsStore.setState({
      buffs: [
        {
          id: 'buff-active',
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
        consumables={{ PreFight: null, MidFight: ConsumableType.AmmoPack, Emergency: null }}
        onClick={() => {}}
      />,
    );

    // AmmoPack is active, so it should NOT appear in armed-slots-row
    const armedRow = container.querySelector('[data-testid="armed-slots-row"]');
    expect(armedRow).toBeNull();
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
