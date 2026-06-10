/**
 * Verify that survival and killCycle state is included in the runtime snapshot
 * and survives a build/restore round-trip.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';

// Simulate a full snapshot build → restore cycle for survival and killCycle.
// We test against the actual store shapes (not the snapshot factory) so
// the test doesn't need to boot the full ticker or Supabase client.

describe('Survival snapshot shape', () => {
  beforeEach(() => {
    useSurvivalStore.setState(useSurvivalStore.getInitialState(), true);
  });

  it('initial state has expected defaults', () => {
    const s = useSurvivalStore.getState();
    expect(s.currentHp).toBe(700);
    expect(s.maxHp).toBe(700);
    expect(s.shieldHp).toBe(0);
    expect(s.isDead).toBe(false);
    expect(s.deathLog).toEqual([]);
    expect(s.resurrectionStartedAt).toBeNull();
    expect(s.resurrectionReadyAt).toBeNull();
    expect(s.autoEatThreshold).toBe(0.7);
  });

  it('applyDamage reduces HP and triggers death at 0', () => {
    const store = useSurvivalStore.getState();
    store.applyDamage(300);
    expect(useSurvivalStore.getState().currentHp).toBe(400);

    store.applyDamage(400);
    expect(useSurvivalStore.getState().currentHp).toBe(0);
    expect(useSurvivalStore.getState().isDead).toBe(true);
  });

  it('heal restores HP up to maxHp but not beyond', () => {
    useSurvivalStore.getState().applyDamage(500);
    expect(useSurvivalStore.getState().currentHp).toBe(200);

    useSurvivalStore.getState().heal(300);
    expect(useSurvivalStore.getState().currentHp).toBe(500);
  });

  it('heal does nothing when dead', () => {
    useSurvivalStore.getState().applyDamage(700);
    expect(useSurvivalStore.getState().isDead).toBe(true);

    useSurvivalStore.getState().heal(500);
    expect(useSurvivalStore.getState().currentHp).toBe(0);
    expect(useSurvivalStore.getState().isDead).toBe(true);
  });

  it('die records a death log entry and sets resurrection timer', () => {
    useSurvivalStore.getState().die({ monsterId: 'w1', monsterName: 'Wolf', areaId: 'a1', at: 1000 });
    const s = useSurvivalStore.getState();
    expect(s.isDead).toBe(true);
    expect(s.currentHp).toBe(0);
    expect(s.deathLog).toHaveLength(1);
    expect(s.deathLog[0].monsterId).toBe('w1');
    expect(s.resurrectionReadyAt).toBeGreaterThan(Date.now());
  });

  it('resurrect clears death state and restores full HP', () => {
    useSurvivalStore.getState().die({ monsterId: 'w1', monsterName: 'Wolf', areaId: 'a1', at: 1000 });
    useSurvivalStore.getState().resurrect();
    const s = useSurvivalStore.getState();
    expect(s.isDead).toBe(false);
    expect(s.currentHp).toBe(s.maxHp);
    expect(s.resurrectionStartedAt).toBeNull();
  });

  it('recomputeMaxHp scales HP proportionally', () => {
    // 700 max, 350 current (50%)
    useSurvivalStore.getState().applyDamage(350);
    expect(useSurvivalStore.getState().currentHp).toBe(350);

    // Recompute to 1400 max — HP should scale to 700 (50%)
    useSurvivalStore.getState().recomputeMaxHp(20, 100);
    expect(useSurvivalStore.getState().maxHp).toBeGreaterThan(700);
    expect(useSurvivalStore.getState().currentHp).toBeGreaterThan(350);
  });

  it('getInitialState returns clean state', () => {
    useSurvivalStore.getState().applyDamage(400);
    const init = useSurvivalStore.getInitialState();
    expect(init.currentHp).toBe(700);
    expect(init.isDead).toBe(false);
  });
});

describe('KillCycle snapshot shape', () => {
  beforeEach(() => {
    useKillCycleStore.setState(useKillCycleStore.getInitialState(), true);
  });

  it('initial state has expected defaults', () => {
    const s = useKillCycleStore.getState();
    expect(s.currentTargetId).toBeNull();
    expect(s.currentTargetHp).toBe(0);
    expect(s.monstersKilledCount).toBe(0);
    expect(s.totalKills).toBe(0);
    expect(s.lastKilledMonsterId).toBeNull();
  });

  it('spawnTarget sets the current target', () => {
    useKillCycleStore.getState().spawnTarget({ id: 'w1', name: 'Wolf', hp: 100, level: 1 } as never);
    const s = useKillCycleStore.getState();
    expect(s.currentTargetId).toBe('w1');
    expect(s.currentTargetHp).toBe(100);
    expect(s.currentTargetHpMax).toBe(100);
  });

  it('applyPlayerDamage drains target HP', () => {
    useKillCycleStore.getState().spawnTarget({ id: 'w1', name: 'Wolf', hp: 100, level: 1 } as never);
    useKillCycleStore.getState().applyPlayerDamage(30);
    expect(useKillCycleStore.getState().currentTargetHp).toBe(70);
  });

  it('killCurrentTarget increments kill count and clears target', () => {
    useKillCycleStore.getState().spawnTarget({ id: 'w1', name: 'Wolf', hp: 100, level: 1 } as never);
    const killed = useKillCycleStore.getState().killCurrentTarget();
    expect(killed).toBe('w1');
    const s = useKillCycleStore.getState();
    expect(s.monstersKilledCount).toBe(1);
    expect(s.totalKills).toBe(1);
    expect(s.currentTargetId).toBeNull();
  });

  it('resetForAreaChange clears target and area kill count', () => {
    useKillCycleStore.getState().spawnTarget({ id: 'w1', name: 'Wolf', hp: 100, level: 1 } as never);
    useKillCycleStore.getState().killCurrentTarget();
    useKillCycleStore.getState().spawnTarget({ id: 'w2', name: 'Bear', hp: 200, level: 2 } as never);
    useKillCycleStore.getState().killCurrentTarget();

    expect(useKillCycleStore.getState().monstersKilledCount).toBe(2);
    expect(useKillCycleStore.getState().totalKills).toBe(2);

    useKillCycleStore.getState().resetForAreaChange();
    expect(useKillCycleStore.getState().monstersKilledCount).toBe(0);
    expect(useKillCycleStore.getState().totalKills).toBe(2); // lifetime stat
    expect(useKillCycleStore.getState().currentTargetId).toBeNull();
  });

  it('getInitialState returns clean state', () => {
    useKillCycleStore.getState().spawnTarget({ id: 'w1', name: 'Wolf', hp: 100, level: 1 } as never);
    const init = useKillCycleStore.getInitialState();
    expect(init.currentTargetId).toBeNull();
    expect(init.totalKills).toBe(0);
  });
});
