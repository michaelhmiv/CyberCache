import { describe, it, expect, beforeEach } from 'vitest';
import { useSurvivalStore } from '@/store/slices/survivalSlice';

describe('survivalSlice', () => {
  beforeEach(() => {
    // Reset to a clean state between tests.
    useSurvivalStore.setState({
      currentHp: 700,
      maxHp: 700,
      shieldHp: 0,
      isDead: false,
      lastKilledBy: null,
      deathLog: [],
      resurrectionStartedAt: null,
      resurrectionReadyAt: null,
      autoEatThreshold: 0.7,
    });
  });

  it('starts at full HP, alive', () => {
    const s = useSurvivalStore.getState();
    expect(s.currentHp).toBe(700);
    expect(s.maxHp).toBe(700);
    expect(s.isDead).toBe(false);
  });

  it('applyDamage reduces current HP', () => {
    useSurvivalStore.getState().applyDamage(200);
    expect(useSurvivalStore.getState().currentHp).toBe(500);
  });

  it('applyDamage clamps to 0 and sets isDead=true at lethal damage', () => {
    useSurvivalStore.getState().applyDamage(9999);
    const s = useSurvivalStore.getState();
    expect(s.currentHp).toBe(0);
    expect(s.isDead).toBe(true);
  });

  it('applyDamage is a no-op when already dead', () => {
    useSurvivalStore.setState({ isDead: true, currentHp: 0 });
    useSurvivalStore.getState().applyDamage(100);
    const s = useSurvivalStore.getState();
    expect(s.currentHp).toBe(0);
    expect(s.isDead).toBe(true);
  });

  it('heal restores HP up to max', () => {
    useSurvivalStore.getState().applyDamage(500);
    useSurvivalStore.getState().heal(200);
    expect(useSurvivalStore.getState().currentHp).toBe(400);
  });

  it('heal is a no-op when dead', () => {
    useSurvivalStore.setState({ isDead: true, currentHp: 0 });
    useSurvivalStore.getState().heal(500);
    expect(useSurvivalStore.getState().currentHp).toBe(0);
  });

  it('heal does not exceed maxHp', () => {
    useSurvivalStore.getState().applyDamage(100);
    useSurvivalStore.getState().heal(9999);
    expect(useSurvivalStore.getState().currentHp).toBe(700);
  });

  it('refillShield adds to shield pool', () => {
    useSurvivalStore.getState().refillShield(100);
    useSurvivalStore.getState().refillShield(50);
    expect(useSurvivalStore.getState().shieldHp).toBe(150);
  });

  it('consumeConsumable refills shield when given a ShieldCell id', () => {
    useSurvivalStore.getState().consumeConsumable('ShieldCell');
    expect(useSurvivalStore.getState().shieldHp).toBe(100);
  });

  it('die sets isDead, currentHp=0, lastKilledBy, and appends to deathLog', () => {
    useSurvivalStore.getState().die({
      monsterId: 'dustwaste_brute',
      monsterName: 'Salvage Brute',
      areaId: 'dustwaste_frontier',
      at: 12345,
    });
    const s = useSurvivalStore.getState();
    expect(s.isDead).toBe(true);
    expect(s.currentHp).toBe(0);
    expect(s.lastKilledBy?.monsterId).toBe('dustwaste_brute');
    expect(s.deathLog).toHaveLength(1);
    // The free timer anchors to the death's timestamp (12345), the
    // same diedAt the server validates against — not Date.now().
    expect(s.resurrectionStartedAt).toBe(12345);
    expect(s.resurrectionReadyAt).toBe(12345 + 5 * 60 * 1000);
  });

  it('deathLog is capped at 20 entries', () => {
    for (let i = 0; i < 25; i += 1) {
      useSurvivalStore.getState().die({
        monsterId: `monster_${i}`,
        monsterName: `Monster ${i}`,
        areaId: 'dustwaste_frontier',
        at: 1000 + i,
      });
      useSurvivalStore.getState().resurrect(); // clear so die() can be called again
    }
    expect(useSurvivalStore.getState().deathLog.length).toBe(20);
  });

  it('resurrect clears death state and refills HP', () => {
    useSurvivalStore.getState().die({
      monsterId: 'dustwaste_brute',
      monsterName: 'Salvage Brute',
      areaId: 'dustwaste_frontier',
      at: 12345,
    });
    useSurvivalStore.getState().resurrect();
    const s = useSurvivalStore.getState();
    expect(s.isDead).toBe(false);
    expect(s.currentHp).toBe(700);
    expect(s.lastKilledBy).not.toBeNull(); // kept for the profile log
    expect(s.resurrectionReadyAt).toBeNull();
  });

  it('recomputeMaxHp scales current HP proportionally', () => {
    useSurvivalStore.setState({ maxHp: 700, currentHp: 350 }); // 50% HP
    useSurvivalStore.getState().recomputeMaxHp(5, 100); // new max = 700 + 300 + 100 = 1100
    const s = useSurvivalStore.getState();
    expect(s.maxHp).toBe(1100);
    expect(s.currentHp).toBe(550); // 50% of new max
  });

  it('setAutoEatThreshold updates the threshold', () => {
    useSurvivalStore.getState().setAutoEatThreshold(0.5);
    expect(useSurvivalStore.getState().autoEatThreshold).toBe(0.5);
  });
});
