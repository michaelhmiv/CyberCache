/**
 * bossTick — pure per-tick model for the live boss fight.
 *
 * Contract:
 *   - Player DPS drains boss HP at DPS * TICK_MS / 1000 per tick.
 *   - Boss DPS drains player HP at the same rate, after shield.
 *   - Shield absorbs up to its remaining value.
 *   - Auto-eat fires when playerHp/maxPlayerHp < autoEatThreshold
 *     and medkitsAvailable > 0, healing 40% maxHp (default).
 *   - Victory: bossHp <= 0. Defeat: playerHp <= 0. Victory wins ties.
 *   - Pure: no store reads, no Date.now(), no Math.random().
 */
import { describe, it, expect } from 'vitest';
import { bossTick, initialBossFightState, bossDamagePerSecond, BOSS_TICK_MS, DEFAULT_MEDKIT_HEAL_PCT } from '@/lib/combat/bossTick';
import type { BossDef } from '@/types/boss';

const fakeBoss: BossDef = {
  id: 'test_boss',
  name: 'Test Boss',
  tier: 1,
  level: 5,
  health: 1000,
  shield: 0,
  armor: 0,
  dps: 100,
  weaknesses: [],
  resistances: [],
  mechanic: { id: 'm', name: 'm', description: '', checkType: 'survival' },
  tags: [],
  phases: [],
  recommendedPower: 100,
  entryCost: 0,
  rematchCost: 0,
  dropTable: [],
  dedicatedDrops: [],
};

describe('bossTick', () => {
  it('deals playerDps * seconds of damage to the boss per tick', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 500,
      currentPlayerShield: 0,
      playerDps: 200,
      bossDps: 0, // disable boss damage for this assertion
      maxPlayerHp: 500,
      autoEatThreshold: 0.5,
      medkitsAvailable: 0,
    });
    expect(result.bossHp).toBeCloseTo(1000 - 200 * (BOSS_TICK_MS / 1000), 5);
    expect(result.damageDealt).toBeCloseTo(200 * (BOSS_TICK_MS / 1000), 5);
  });

  it('deals bossDps * seconds of damage to the player per tick', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 500,
      currentPlayerShield: 0,
      playerDps: 0,
      bossDps: 150,
      maxPlayerHp: 500,
      autoEatThreshold: 0.5,
      medkitsAvailable: 0,
    });
    expect(result.playerHp).toBeCloseTo(500 - 150 * (BOSS_TICK_MS / 1000), 5);
    expect(result.damageTaken).toBeCloseTo(150 * (BOSS_TICK_MS / 1000), 5);
  });

  it('absorbs boss damage with shield first', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 500,
      currentPlayerShield: 50, // shields 50 HP of damage
      playerDps: 0,
      bossDps: 30, // 30 dps * 3s = 90 damage; shield absorbs 50
      maxPlayerHp: 500,
      autoEatThreshold: 0.5,
      medkitsAvailable: 0,
    });
    const rawDamage = 30 * (BOSS_TICK_MS / 1000);
    expect(result.playerShield).toBe(0);
    expect(result.playerHp).toBeCloseTo(500 - (rawDamage - 50), 5);
    expect(result.damageTaken).toBeCloseTo(rawDamage - 50, 5);
  });

  it('does not heal above maxPlayerHp', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 450,
      currentPlayerShield: 0,
      playerDps: 0,
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.99, // always below threshold
      medkitsAvailable: 1,
    });
    const healAmt = Math.round(500 * DEFAULT_MEDKIT_HEAL_PCT);
    expect(result.playerHp).toBe(Math.min(500, 450 + healAmt));
    expect(result.medkitsConsumed).toBe(1);
  });

  it('does not consume medkit when player is above auto-eat threshold', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 490, // 98% — above 95% threshold
      currentPlayerShield: 0,
      playerDps: 0,
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.95,
      medkitsAvailable: 5,
    });
    expect(result.medkitsConsumed).toBe(0);
    expect(result.playerHp).toBe(490);
  });

  it('consumes a medkit when below threshold and has medkits', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 100, // 20% — below 40% threshold
      currentPlayerShield: 0,
      playerDps: 0,
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 3,
    });
    expect(result.medkitsConsumed).toBe(1);
    expect(result.playerHp).toBe(100 + Math.round(500 * DEFAULT_MEDKIT_HEAL_PCT));
  });

  it('does not consume medkit when zero medkits available', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 50, // 10% — below 40% threshold
      currentPlayerShield: 0,
      playerDps: 0,
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 0,
    });
    expect(result.medkitsConsumed).toBe(0);
    expect(result.playerHp).toBe(50);
  });

  it('status is "victory" when boss HP drops to 0', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 50,
      currentPlayerHp: 500,
      currentPlayerShield: 0,
      playerDps: 1000, // huge DPS, one-shots
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 0,
    });
    expect(result.status).toBe('victory');
    expect(result.bossHp).toBe(0);
  });

  it('status is "defeat" when player HP drops to 0', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 50,
      currentPlayerShield: 0,
      playerDps: 0,
      bossDps: 1000,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 0,
    });
    expect(result.status).toBe('defeat');
    expect(result.playerHp).toBe(0);
  });

  it('victory takes precedence when both HP and boss HP drop to 0 in the same tick', () => {
    // Edge case: player and boss deal lethal damage to each other
    // in the same tick. We want victory (the boss is the "boss",
    // and a killing blow to it is a win).
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1, // boss has 1 HP
      currentPlayerHp: 1, // player has 1 HP
      currentPlayerShield: 0,
      playerDps: 1000, // player one-shots boss
      bossDps: 1000, // boss one-shots player
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 0,
    });
    expect(result.status).toBe('victory');
  });

  it('status is "ongoing" when neither HP reaches 0', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 500,
      currentPlayerShield: 0,
      playerDps: 50,
      bossDps: 50,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 0,
    });
    expect(result.status).toBe('ongoing');
  });

  it('clamps damageDealt to ≥ 0 when playerDps is negative', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 500,
      currentPlayerShield: 0,
      playerDps: -100,
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 0,
    });
    expect(result.damageDealt).toBe(0);
    expect(result.bossHp).toBe(1000);
  });

  it('clamps damageTaken to ≥ 0 when bossDps is negative', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 500,
      currentPlayerShield: 0,
      playerDps: 0,
      bossDps: -50,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 0,
    });
    expect(result.damageTaken).toBe(0);
    expect(result.playerHp).toBe(500);
  });

  it('does not heal past maxPlayerHp even with low threshold', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 100, // well below threshold
      currentPlayerShield: 0,
      playerDps: 0,
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 1,
    });
    // Heal is min(500, 100 + 200) = 300 (capped by max)
    expect(result.playerHp).toBe(300);
    expect(result.medkitsConsumed).toBe(1);
  });

  it('respects custom tickMs (slower ticks do more damage)', () => {
    const slow = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 500,
      currentPlayerShield: 0,
      playerDps: 100,
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 0,
      tickMs: 6000,
    });
    const fast = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 500,
      currentPlayerShield: 0,
      playerDps: 100,
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 0,
      tickMs: 3000,
    });
    expect(slow.damageDealt).toBe(2 * fast.damageDealt);
  });

  it('respects custom medkitHeal', () => {
    const result = bossTick({
      boss: fakeBoss,
      currentBossHp: 1000,
      currentPlayerHp: 100,
      currentPlayerShield: 0,
      playerDps: 0,
      bossDps: 0,
      maxPlayerHp: 500,
      autoEatThreshold: 0.4,
      medkitsAvailable: 1,
      medkitHeal: 50, // custom heal
    });
    expect(result.medkitsConsumed).toBe(1);
    expect(result.playerHp).toBe(150);
  });
});

describe('initialBossFightState', () => {
  it('returns the boss starting HP', () => {
    expect(initialBossFightState(fakeBoss).bossHp).toBe(1000);
  });
});

describe('bossDamagePerSecond', () => {
  it('returns the boss.dps field', () => {
    expect(bossDamagePerSecond(fakeBoss)).toBe(100);
  });
  it('clamps negative values to 0', () => {
    const evilBoss = { ...fakeBoss, dps: -50 };
    expect(bossDamagePerSecond(evilBoss)).toBe(0);
  });
});
