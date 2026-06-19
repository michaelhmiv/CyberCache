import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ActiveBuffPills } from '@/components/stats/ActiveBuffPills';
import { ConsumableType } from '@/types/game';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';

describe('ActiveBuffPills', () => {
  beforeEach(() => {
    useActiveBuffsStore.setState({ buffs: [] });
  });

  it('renders all 5 survival stock rows always, even when nothing is loaded', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onClick={() => {}}
      />,
    );

    const rows = container.querySelectorAll('[data-testid="survival-stock-row"]');
    expect(rows.length).toBe(5);

    // Verify all 5 survival consumables are present by name
    const text = container.textContent!;
    expect(text).toContain('Med Kit');
    expect(text).toContain('Med Kit (Refined)');
    expect(text).toContain('Shield Cell');
    expect(text).toContain('Nano Swarm');
    expect(text).toContain('Adrenaline Shot');
  });

  it('shows ×N stock count from inventory', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{ MedKit: 3, ShieldCell: 1 }}
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onClick={() => {}}
      />,
    );

    const medKitRow = container.querySelector('[data-consumable-id="MedKit"]');
    expect(medKitRow?.textContent).toContain('×3');

    const shieldRow = container.querySelector('[data-consumable-id="ShieldCell"]');
    expect(shieldRow?.textContent).toContain('×1');
  });

  it('dims ×0 stock rows', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{ ShieldCell: 1 }}
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onClick={() => {}}
      />,
    );

    // MedKit has 0 stock → dimmed
    const medKitRow = container.querySelector('[data-consumable-id="MedKit"]');
    expect(medKitRow?.className).toContain('opacity-50');
    expect(medKitRow?.textContent).toContain('×0');

    // ShieldCell has 1 in stock → NOT dimmed
    const shieldRow = container.querySelector('[data-consumable-id="ShieldCell"]');
    expect(shieldRow?.className).not.toContain('opacity-50');
    expect(shieldRow?.textContent).toContain('×1');
  });

  it('shows EMG tag when survival item is loaded into Emergency slot', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{ MedKit: 2 }}
        consumables={{ PreFight: null, MidFight: null, Emergency: ConsumableType.MedKit }}
        onClick={() => {}}
      />,
    );

    const medKitRow = container.querySelector('[data-consumable-id="MedKit"]');
    expect(medKitRow?.textContent).toContain('EMG');

    // Other survival rows should NOT have EMG tag
    const shieldRow = container.querySelector('[data-consumable-id="ShieldCell"]');
    expect(shieldRow?.textContent).not.toContain('EMG');
  });

  it('shows trigger threshold label on survival rows', () => {
    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
        consumables={{ PreFight: null, MidFight: null, Emergency: null }}
        onClick={() => {}}
      />,
    );

    // Med Kit triggers at 50% HP
    const medKitRow = container.querySelector('[data-consumable-id="MedKit"]');
    expect(medKitRow?.textContent).toContain('@ 50% HP');

    // Shield Cell triggers at 25% Shield
    const shieldRow = container.querySelector('[data-consumable-id="ShieldCell"]');
    expect(shieldRow?.textContent).toContain('@ 25% Shield');
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

  it('renders armed indicators for loaded-but-not-firing', () => {
    useActiveBuffsStore.setState({ buffs: [] });

    const { container } = render(
      <ActiveBuffPills
        inventory={{}}
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
        inventory={{}}
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
        inventory={{}}
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
