import { describe, expect, it, vi } from 'vitest';
import {
  FIGHT_FINAL_PAUSE_MS,
  FIGHT_PHASE_MS,
  FIGHT_TOTAL_BUDGET_MS,
  buildInitialTimeline,
  computePlayerMaxHp,
  runFightAnimation,
  type FightOutcome,
  type FightTimeline,
} from '../lib/animation/fightTimeline';
import type { PhaseAnalysis } from '../types/boss';

// A small set of phase analyses used by the tests. Real phases come from
// bossSimulator.ts but the timeline helper only needs phaseId, phaseName,
// and status to interpolate HP — any shape with these three is fine.
const makePhases = (count: number): PhaseAnalysis[] =>
  Array.from({ length: count }, (_, i) => ({
    phaseId: `phase-${i + 1}`,
    phaseName: `Phase ${i + 1}`,
    description: `Test phase ${i + 1}`,
    score: 0.8,
    status: 'safe' as const,
    currentAnswers: ['weapon'],
    missingCounters: [],
    relevantConsumables: [],
    explanation: 'Test',
  }));

const makeOutcome = (victory: boolean, winChance = 0.75, bossHpRemaining = 30): FightOutcome => ({
  result: { victory, winChance, bossHpRemaining, phaseFailed: victory ? undefined : 'survival' },
  creditsDelta: victory ? 1500 : -250,
  bonusLootRolls: victory ? 1 : 0,
  consumedConsumables: {},
  loot: [],
  extraLoot: false,
});

describe('computePlayerMaxHp', () => {
  it('matches the sim formula: 500 + level*40 + shieldHp + 200 + level*20', () => {
    // Reference: src/lib/simulation/bossSimulator.ts:364-365
    // playerHP = 500 + playerLevel * 40
    // playerShieldHP = shield.hp + 200 + playerLevel * 20
    // Sum is what the player "has" in the fight window.
    expect(computePlayerMaxHp(10, 100)).toBe(500 + 400 + 100 + 200 + 200);
    expect(computePlayerMaxHp(20, 0)).toBe(500 + 800 + 0 + 200 + 400);
    expect(computePlayerMaxHp(1, 50)).toBe(500 + 40 + 50 + 200 + 20);
  });
});

describe('buildInitialTimeline', () => {
  it('starts the player at ~30% HP on victory and 0 on defeat', () => {
    const victory = buildInitialTimeline(makeOutcome(true), 10000, 10, 100);
    expect(victory.playerHp).toBeGreaterThan(0);
    expect(victory.playerHp).toBeLessThanOrEqual(victory.playerHpMax);
    expect(victory.playerHp / victory.playerHpMax).toBeCloseTo(0.3, 1);

    const defeat = buildInitialTimeline(makeOutcome(false), 10000, 10, 100);
    expect(defeat.playerHp).toBe(0);
  });

  it('starts the boss at 100% on victory (we walk it down) and bossHpRemaining% on defeat', () => {
    const victory = buildInitialTimeline(makeOutcome(true), 10000, 10, 100);
    expect(victory.bossHp).toBe(10000);
    expect(victory.bossHp).toBe(victory.bossHpMax);

    const defeat = buildInitialTimeline(makeOutcome(false, 0.2, 30), 10000, 10, 100);
    // 30% of 10000 = 3000
    expect(defeat.bossHp).toBe(3000);
  });

  it('uses bossHealth as the bossHpMax', () => {
    const timeline = buildInitialTimeline(makeOutcome(true), 12345, 10, 100);
    expect(timeline.bossHpMax).toBe(12345);
  });
});

describe('runFightAnimation — duration', () => {
  it('total animation time stays under the 800ms budget for any reasonable phase count', () => {
    // 8 phases is the realistic upper bound for CyberCache bosses.
    const phases = makePhases(8);
    const expectedTotal = phases.length * FIGHT_PHASE_MS + FIGHT_FINAL_PAUSE_MS;
    // Hard guard: this is the assertion that would have caught a
    // regression to the old 1.2s fake delay.
    expect(expectedTotal).toBeLessThanOrEqual(FIGHT_TOTAL_BUDGET_MS);
    expect(expectedTotal).toBeLessThan(1200); // the old fake delay
  });

  it('skipAnimation=true returns immediately without onPhase ticks', async () => {
    const outcome = makeOutcome(true);
    const initial = buildInitialTimeline(outcome, 1000, 1, 0);
    const cancel = { cancelled: false };
    const onPhase = vi.fn();

    const t0 = performance.now();
    const result = await runFightAnimation(initial, makePhases(4), true, cancel, onPhase);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(20); // effectively instant
    expect(onPhase).not.toHaveBeenCalled();
    expect(result.finishedAt).not.toBeNull();
    expect(result.currentPhaseIndex).toBe(4);
  });

  it('zero phases returns immediately', async () => {
    const outcome = makeOutcome(true);
    const initial = buildInitialTimeline(outcome, 1000, 1, 0);
    const cancel = { cancelled: false };
    const onPhase = vi.fn();

    const result = await runFightAnimation(initial, [], false, cancel, onPhase);
    expect(onPhase).not.toHaveBeenCalled();
    expect(result.currentPhaseIndex).toBe(0);
  });

  it('cancel ref flipped before the first phase tick aborts the animation', async () => {
    const outcome = makeOutcome(true);
    const initial = buildInitialTimeline(outcome, 1000, 1, 0);
    const cancel = { cancelled: false };
    const onPhase = vi.fn();

    // Flip the cancel flag synchronously before awaiting the promise.
    // The first iteration of the loop checks cancel.cancelled and returns
    // the initial timeline. This is the "user closed the modal mid-fight"
    // path.
    const promise = runFightAnimation(initial, makePhases(4), false, cancel, onPhase);
    cancel.cancelled = true;
    const result = await promise;
    expect(result).toBe(initial);
  });
});

describe('runFightAnimation — phase callback behavior', () => {
  it('calls onPhase exactly once per phase with monotonically decreasing bossHp on victory', async () => {
    const outcome = makeOutcome(true);
    const initial = buildInitialTimeline(outcome, 1000, 1, 0);
    const cancel = { cancelled: false };
    const onPhase = vi.fn();
    const phases = makePhases(5);

    await runFightAnimation(initial, phases, false, cancel, onPhase);
    expect(onPhase).toHaveBeenCalledTimes(5);

    // On victory, bossHp interpolates from bossHealth (1000) at the first
    // tick down to 0 at the last tick. Linear interpolation in t.
    const bossHps = onPhase.mock.calls.map((call) => call[0].bossHp as number);
    for (let i = 1; i < bossHps.length; i++) {
      expect(bossHps[i]).toBeLessThanOrEqual(bossHps[i - 1]);
    }
    // First tick is near full, last tick is near 0.
    expect(bossHps[0]).toBeGreaterThan(500);
    expect(bossHps[bossHps.length - 1]).toBeLessThan(500);
  });

  it('keeps damageLog capped to 6 entries across many phases', async () => {
    const outcome = makeOutcome(true);
    const initial = buildInitialTimeline(outcome, 1000, 1, 0);
    const cancel = { cancelled: false };
    const onPhase = vi.fn();
    const phases = makePhases(20);

    await runFightAnimation(initial, phases, false, cancel, onPhase);
    // The final snapshot's damageLog is the cumulative cap.
    const finalCall = onPhase.mock.calls[onPhase.mock.calls.length - 1][0] as FightTimeline;
    expect(finalCall.damageLog.length).toBeLessThanOrEqual(6);
  });
});

describe('fight animation — store integration', () => {
  // Smoke test for the full pipeline without bootstrapping React. The
  // full handleFight flow lives in BossPrepModal and would belong in a
  // separate RTL test. Here we just confirm buildInitialTimeline +
  // runFightAnimation compose and produce a result with finishedAt set.
  it('the full pipeline (buildInitialTimeline → runFightAnimation) sets finishedAt on the result', async () => {
    const outcome = makeOutcome(true);
    const initial = buildInitialTimeline(outcome, 1000, 5, 0);
    expect(initial.finishedAt).toBeNull();

    const cancel = { cancelled: false };
    const onPhase = vi.fn();
    const result = await runFightAnimation(initial, makePhases(3), false, cancel, onPhase);
    expect(result.finishedAt).not.toBeNull();
  });
});
