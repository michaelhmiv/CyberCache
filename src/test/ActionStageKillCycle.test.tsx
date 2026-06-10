import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionStage } from '@/lib/activity/ActionStage';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { requireMonster } from '@/constants/monsters';

/**
 * ActionStage — target HP bar tests (updated for PR #81)
 *
 * The target HP bar was moved from ActionStage to LiveTurfDiorama
 * as TargetHpOverlay (data-testid="primary-diorama-target-hp").
 * ActionStage is now pure beat/sprite presentation with no combat HUD.
 */
describe('ActionStage — target HP bar (PR 4 → PR 81 update)', () => {
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

  it('does not render the HP bar when a target is spawned (moved to LiveTurfDiorama)', () => {
    // The target HP bar was moved to LiveTurfDiorama as TargetHpOverlay
    // (data-testid="primary-diorama-target-hp"). ActionStage no longer
    // renders any combat HUD — it is pure beat/sprite presentation.
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    render(<ActionStage kind="roaming_loot" />);
    expect(screen.queryByTestId('target-hp-bar')).toBeNull();
  });

  it('uses the live monster visualKey from the spawned target', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_drone'));
    const { container } = render(<ActionStage kind="roaming_loot" />);
    const droneSprite = container.querySelector('[data-visual-key="monster_drone"]');
    expect(droneSprite).toBeInTheDocument();
    const scavengerSprite = container.querySelector('[data-visual-key="monster_scavenger"]');
    expect(scavengerSprite).toBeNull();
  });

  it('does not render the HP bar after target dies (HP bar is not in this component)', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    render(<ActionStage kind="roaming_loot" />);
    expect(screen.queryByTestId('target-hp-bar')).toBeNull();

    useKillCycleStore.getState().killCurrentTarget();
    expect(screen.queryByTestId('target-hp-bar')).toBeNull();
  });
});
