import { describe, it, expect, beforeEach } from 'vitest';
import { useSurvivalStore } from '@/store/slices/survivalSlice';

describe('survivalSlice — resurrectPaid / resurrectToken', () => {
  beforeEach(() => {
    useSurvivalStore.setState({
      currentHp: 0,
      maxHp: 700,
      shieldHp: 0,
      isDead: true,
      lastKilledBy: { monsterId: 'dustwaste_raider', monsterName: 'Dustwaste Raider', areaId: 'dustwaste_frontier', at: 1000 },
      deathLog: [],
      resurrectionStartedAt: 1000,
      resurrectionReadyAt: 1000 + 5 * 60 * 1000,
      autoEatThreshold: 0.7,
    });
  });

  it('resurrectPaid flips isDead to false, refills HP, clears timer', () => {
    useSurvivalStore.getState().resurrectPaid();
    const s = useSurvivalStore.getState();
    expect(s.isDead).toBe(false);
    expect(s.currentHp).toBe(700);
    expect(s.shieldHp).toBe(0);
    expect(s.resurrectionStartedAt).toBe(null);
    expect(s.resurrectionReadyAt).toBe(null);
  });

  it('resurrectPaid is a no-op when not dead', () => {
    useSurvivalStore.setState({ isDead: false, currentHp: 200 });
    useSurvivalStore.getState().resurrectPaid();
    const s = useSurvivalStore.getState();
    // HP unchanged because we only mutate when isDead
    expect(s.isDead).toBe(false);
    expect(s.currentHp).toBe(200);
  });

  it('resurrectToken flips isDead to false and refills HP', () => {
    useSurvivalStore.getState().resurrectToken();
    const s = useSurvivalStore.getState();
    expect(s.isDead).toBe(false);
    expect(s.currentHp).toBe(700);
    expect(s.resurrectionStartedAt).toBe(null);
  });

  it('resurrectToken is a no-op when not dead', () => {
    useSurvivalStore.setState({ isDead: false, currentHp: 350 });
    useSurvivalStore.getState().resurrectToken();
    expect(useSurvivalStore.getState().currentHp).toBe(350);
  });
});
