import { describe, it, expect, beforeEach } from 'vitest';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
import { requireMonster } from '@/constants/monsters';

describe('killCycleSlice', () => {
  beforeEach(() => {
    useKillCycleStore.setState({
      currentTargetId: null,
      currentTargetHp: 0,
      currentTargetHpMax: 0,
      monstersKilledCount: 0,
      totalKills: 0,
      lastKilledMonsterId: null,
      targetSpawnedAt: null,
    });
  });

  it('starts with no target', () => {
    const s = useKillCycleStore.getState();
    expect(s.currentTargetId).toBeNull();
    expect(s.currentTargetHp).toBe(0);
  });

  it('spawnTarget sets the current target id and HP', () => {
    const monster = requireMonster('dustwaste_raider');
    useKillCycleStore.getState().spawnTarget(monster);
    const s = useKillCycleStore.getState();
    expect(s.currentTargetId).toBe('dustwaste_raider');
    expect(s.currentTargetHp).toBe(monster.hp);
    expect(s.currentTargetHpMax).toBe(monster.hp);
    expect(s.targetSpawnedAt).not.toBeNull();
  });

  it('applyPlayerDamage reduces currentTargetHp but not below 0', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    useKillCycleStore.getState().applyPlayerDamage(10);
    expect(useKillCycleStore.getState().currentTargetHp).toBe(35); // 45 - 10
    useKillCycleStore.getState().applyPlayerDamage(9999);
    expect(useKillCycleStore.getState().currentTargetHp).toBe(0);
  });

  it('applyPlayerDamage is a no-op when no target', () => {
    useKillCycleStore.getState().applyPlayerDamage(10);
    const s = useKillCycleStore.getState();
    expect(s.currentTargetHp).toBe(0);
    expect(s.currentTargetId).toBeNull();
  });

  it('killCurrentTarget returns the killed id and increments counters', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    const killedId = useKillCycleStore.getState().killCurrentTarget();
    expect(killedId).toBe('dustwaste_raider');
    const s = useKillCycleStore.getState();
    expect(s.currentTargetId).toBeNull();
    expect(s.currentTargetHp).toBe(0);
    expect(s.lastKilledMonsterId).toBe('dustwaste_raider');
    expect(s.monstersKilledCount).toBe(1);
    expect(s.totalKills).toBe(1);
  });

  it('killCurrentTarget returns null when no target', () => {
    const result = useKillCycleStore.getState().killCurrentTarget();
    expect(result).toBeNull();
  });

  it('totalKills accumulates across multiple kills', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    useKillCycleStore.getState().killCurrentTarget();
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_drone'));
    useKillCycleStore.getState().killCurrentTarget();
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_brute'));
    useKillCycleStore.getState().killCurrentTarget();
    expect(useKillCycleStore.getState().totalKills).toBe(3);
    expect(useKillCycleStore.getState().monstersKilledCount).toBe(3);
  });

  it('resetForAreaChange clears target and per-area counter, keeps totalKills', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    useKillCycleStore.getState().killCurrentTarget();
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_drone'));
    useKillCycleStore.getState().killCurrentTarget();
    expect(useKillCycleStore.getState().monstersKilledCount).toBe(2);
    expect(useKillCycleStore.getState().totalKills).toBe(2);

    useKillCycleStore.getState().resetForAreaChange();
    const s = useKillCycleStore.getState();
    expect(s.currentTargetId).toBeNull();
    expect(s.monstersKilledCount).toBe(0);
    expect(s.totalKills).toBe(2); // lifetime stat preserved
  });

  it('clearTarget removes target without counting as a kill', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    useKillCycleStore.getState().clearTarget();
    const s = useKillCycleStore.getState();
    expect(s.currentTargetId).toBeNull();
    expect(s.totalKills).toBe(0);
    expect(s.monstersKilledCount).toBe(0);
    expect(s.lastKilledMonsterId).toBeNull();
  });

  it('lastKilledMonsterId is updated to the most recent kill', () => {
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_raider'));
    useKillCycleStore.getState().killCurrentTarget();
    expect(useKillCycleStore.getState().lastKilledMonsterId).toBe('dustwaste_raider');
    useKillCycleStore.getState().spawnTarget(requireMonster('dustwaste_elite'));
    useKillCycleStore.getState().killCurrentTarget();
    expect(useKillCycleStore.getState().lastKilledMonsterId).toBe('dustwaste_elite');
  });
});
