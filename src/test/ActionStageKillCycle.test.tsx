import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ActionStage } from '@/lib/activity/ActionStage';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { requireMonster } from '@/constants/monsters';

describe('ActionStage — target HP bar (PR 4)', () => {
  beforeEach(() => {
    useKillCycleStore.setState({
      currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0,
      monstersKilledCount: 0, totalKills: 0, lastKilledMonsterId: null, targetSpawnedAt: null,
    });
    useSurvivalStore.setState({
      currentHp: 700, maxHp: 700, shieldHp: 0, isDead: false, lastKilledBy: null,
      deathLog: [], resurrectionStartedAt: null, resurrectionReadyAt: null, autoEatThreshold: 0.7,
    });
  });

  afterEach(() => {
    useKillCycleStore.setState({
      currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0,
      monstersKilledCount: 0, totalKills: 0, lastKilledMonsterId: null, targetSpawnedAt: null,
    });
  });

  it('does not render the HP bar for non-roaming activity kinds', () => {
    render(<ActionStage kind="crafting" />);
    expect(screen.queryByTestId('target-hp-bar')).toBeNull();
  });

  it('does not render the HP bar when no target is spawned', () => {
    render(<ActionStage kind="roaming_loot" />);
    expect(screen.queryByTestId('target-hp-bar')).toBeNull();
  });

  it('renders the HP bar when a target is spawned', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    render(<ActionStage kind="roaming_loot" />);
    const bar = screen.getByTestId('target-hp-bar');
    expect(bar).toBeInTheDocument();
    expect(bar.dataset.targetId).toBe('dustwaste_raider');
    expect(bar.dataset.targetHpMax).toBe('45');
  });

  it('updates the HP value as the kill cycle drains it', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    const { rerender } = render(<ActionStage kind="roaming_loot" />);
    expect(screen.getByTestId('target-hp-bar').dataset.targetHp).toBe('45');

    act(() => {
      useKillCycleStore.getState().applyPlayerDamage(15);
      rerender(<ActionStage kind="roaming_loot" />);
    });
    expect(screen.getByTestId('target-hp-bar').dataset.targetHp).toBe('30');
  });

  it('uses the live monster visualKey from the spawned target', () => {
    // Spawn a monster whose visualKey is unique ('monster_drone' for
    // dustwaste_drone). The default spec target is 'monster_scavenger'.
    // The action stage should render the drone's sprite, not scavenger.
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_drone'));
    const { container } = render(<ActionStage kind="roaming_loot" />);
    const droneSprite = container.querySelector('[data-visual-key="monster_drone"]');
    expect(droneSprite).toBeInTheDocument();
    const scavengerSprite = container.querySelector('[data-visual-key="monster_scavenger"]');
    expect(scavengerSprite).toBeNull();
  });

  it('removes the HP bar when the target dies (slice is null)', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    const { rerender } = render(<ActionStage kind="roaming_loot" />);
    expect(screen.getByTestId('target-hp-bar')).toBeInTheDocument();

    act(() => {
      useKillCycleStore.getState().killCurrentTarget();
      rerender(<ActionStage kind="roaming_loot" />);
    });
    expect(screen.queryByTestId('target-hp-bar')).toBeNull();
  });
});
