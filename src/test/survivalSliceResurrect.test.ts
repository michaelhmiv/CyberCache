import { describe, it, expect, beforeEach } from 'vitest';
import { useSurvivalStore } from '@/store/slices/survivalSlice';

/**
 * Resurrection slice contract (Phase 0 Slice 4).
 *
 * The slice no longer owns resurrection paths: `resurrectPaid` /
 * `resurrectToken` (which trusted the caller to have deducted
 * credits / a ReviveToken that never existed) are gone. The server
 * op (POST /api/resurrect) validates and charges; the slice exposes
 * exactly one applier, `resurrect()`, for the server's confirmed
 * result, plus `syncDeathLogFromServer` for the canonical log.
 */
describe('survivalSlice — server-confirmed resurrection applier', () => {
  beforeEach(() => {
    useSurvivalStore.setState({
      currentHp: 0,
      maxHp: 700,
      shieldHp: 0,
      isDead: true,
      lastKilledBy: { monsterId: 'dustwaste_raider', monsterName: 'Dustwaste Raider', areaId: 'dustwaste_frontier', at: 1000 },
      deathLog: [{ monsterId: 'dustwaste_raider', monsterName: 'Dustwaste Raider', areaId: 'dustwaste_frontier', at: 1000 }],
      resurrectionStartedAt: 1000,
      resurrectionReadyAt: 1000 + 5 * 60 * 1000,
      autoEatThreshold: 0.7,
    });
  });

  it('resurrect flips isDead to false, refills HP, clears timers', () => {
    useSurvivalStore.getState().resurrect();
    const s = useSurvivalStore.getState();
    expect(s.isDead).toBe(false);
    expect(s.currentHp).toBe(700);
    expect(s.shieldHp).toBe(0);
    expect(s.resurrectionStartedAt).toBe(null);
    expect(s.resurrectionReadyAt).toBe(null);
    // The death itself stays in the log after resurrection.
    expect(s.deathLog).toHaveLength(1);
    expect(s.lastKilledBy?.monsterId).toBe('dustwaste_raider');
  });

  it('the local-only resurrect paths are gone (server op owns charging)', () => {
    const state = useSurvivalStore.getState() as unknown as Record<string, unknown>;
    expect(state.resurrectPaid).toBeUndefined();
    expect(state.resurrectToken).toBeUndefined();
  });

  it('syncDeathLogFromServer replaces the log with the canonical copy', () => {
    useSurvivalStore.getState().syncDeathLogFromServer([
      { monsterId: 'm2', monsterName: 'Newer Death', areaId: 'a2', at: 2000 },
      { monsterId: 'm1', monsterName: 'Older Death', areaId: 'a1', at: 1000 },
    ]);
    const s = useSurvivalStore.getState();
    expect(s.deathLog).toHaveLength(2);
    expect(s.deathLog[0].monsterId).toBe('m2');
    expect(s.deathLog[1].monsterId).toBe('m1');
  });

  it('syncDeathLogFromServer caps the log at 20 entries', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      monsterId: `m${i}`,
      monsterName: `Monster ${i}`,
      areaId: 'a1',
      at: 1000 + i,
    }));
    useSurvivalStore.getState().syncDeathLogFromServer(entries);
    expect(useSurvivalStore.getState().deathLog).toHaveLength(20);
  });
});
