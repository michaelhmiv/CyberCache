/**
 * BossStore live-fight state (PR 6).
 *
 * The boss store gains:
 *   - activeBossId, activeBossHp, activeBossMaxHp
 *   - activeStatus: 'idle' | 'active' | 'victory' | 'defeat'
 *   - activeMedkitsConsumed, activeDamageDealt, activeTickCount
 *   - activeStartedAt
 *   - startLiveFight, applyLiveTick, endLiveFight, clearLiveFight
 *
 * All pre-existing boss state (unlockedBossIds, defeatedBossIds,
 * pityCounters, attemptHistory) and methods are preserved unchanged.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useBossStore } from '@/store/slices/bossSlice';

function reset() {
  useBossStore.setState({
    activeBossId: null,
    activeBossHp: 0,
    activeBossMaxHp: 0,
    activeStatus: 'idle',
    activeMedkitsConsumed: 0,
    activeDamageDealt: 0,
    activeTickCount: 0,
    activeStartedAt: 0,
    defeatedBossIds: [],
    pityCounters: {},
  });
}

describe('useBossStore — live fight (PR 6)', () => {
  beforeEach(() => {
    reset();
  });

  it('starts in idle state', () => {
    expect(useBossStore.getState().activeStatus).toBe('idle');
    expect(useBossStore.getState().activeBossId).toBeNull();
  });

  it('startLiveFight sets active state with boss HP', () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 5000);
    const s = useBossStore.getState();
    expect(s.activeBossId).toBe('dune_tyrant');
    expect(s.activeBossHp).toBe(5000);
    expect(s.activeBossMaxHp).toBe(5000);
    expect(s.activeStatus).toBe('active');
    expect(s.activeTickCount).toBe(0);
    expect(s.activeMedkitsConsumed).toBe(0);
    expect(s.activeStartedAt).toBeGreaterThan(0);
  });

  it('applyLiveTick updates boss HP, accumulates medkits and damage', () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    useBossStore.getState().applyLiveTick({ bossHp: 800, medkitsConsumed: 1, damageDealt: 200 });
    const s = useBossStore.getState();
    expect(s.activeBossHp).toBe(800);
    expect(s.activeMedkitsConsumed).toBe(1);
    expect(s.activeDamageDealt).toBe(200);
    expect(s.activeTickCount).toBe(1);
  });

  it('applyLiveTick accumulates across multiple ticks', () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    useBossStore.getState().applyLiveTick({ bossHp: 800, medkitsConsumed: 1, damageDealt: 200 });
    useBossStore.getState().applyLiveTick({ bossHp: 600, medkitsConsumed: 0, damageDealt: 200 });
    useBossStore.getState().applyLiveTick({ bossHp: 0, medkitsConsumed: 1, damageDealt: 600 });
    const s = useBossStore.getState();
    expect(s.activeBossHp).toBe(0);
    expect(s.activeMedkitsConsumed).toBe(2);
    expect(s.activeDamageDealt).toBe(1000);
    expect(s.activeTickCount).toBe(3);
  });

  it('endLiveFight transitions status to victory', () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    useBossStore.getState().endLiveFight('victory');
    expect(useBossStore.getState().activeStatus).toBe('victory');
  });

  it('endLiveFight transitions status to defeat', () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    useBossStore.getState().endLiveFight('defeat');
    expect(useBossStore.getState().activeStatus).toBe('defeat');
  });

  it('clearLiveFight resets all live-fight state to initial', () => {
    useBossStore.getState().startLiveFight('dune_tyrant', 1000);
    useBossStore.getState().applyLiveTick({ bossHp: 500, medkitsConsumed: 2, damageDealt: 500 });
    useBossStore.getState().endLiveFight('victory');
    useBossStore.getState().clearLiveFight();
    const s = useBossStore.getState();
    expect(s.activeBossId).toBeNull();
    expect(s.activeBossHp).toBe(0);
    expect(s.activeBossMaxHp).toBe(0);
    expect(s.activeStatus).toBe('idle');
    expect(s.activeMedkitsConsumed).toBe(0);
    expect(s.activeDamageDealt).toBe(0);
    expect(s.activeTickCount).toBe(0);
    expect(s.activeStartedAt).toBe(0);
  });

  it('preserves existing boss state across live-fight mutations', () => {
    // Existing state should be untouched by the new live-fight code.
    useBossStore.setState({
      unlockedBossIds: ['dune_tyrant', 'silt_warlord'],
      defeatedBossIds: ['dune_tyrant'],
      pityCounters: { dune_tyrant: 3 },
    });
    useBossStore.getState().startLiveFight('silt_warlord', 2000);
    useBossStore.getState().applyLiveTick({ bossHp: 1500, medkitsConsumed: 0, damageDealt: 500 });
    useBossStore.getState().endLiveFight('victory');

    const s = useBossStore.getState();
    expect(s.unlockedBossIds).toEqual(['dune_tyrant', 'silt_warlord']);
    expect(s.defeatedBossIds).toEqual(['dune_tyrant']);
    expect(s.pityCounters.dune_tyrant).toBe(3);
  });

  it('defeatBoss still works after the new live-fight fields were added', () => {
    useBossStore.setState({ defeatedBossIds: [] });
    useBossStore.getState().defeatBoss('dune_tyrant');
    expect(useBossStore.getState().defeatedBossIds).toContain('dune_tyrant');
  });
});
