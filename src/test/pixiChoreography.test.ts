import { describe, expect, it } from 'vitest';
import { MOVEMENT, derivePhaseBeats, type PhaseBeat } from '@/lib/pixel/movement';
import {
  EASE,
  HIT_STOP_MS,
  PIXI_MAX_ANIMATED_NODES,
  easeOutBack,
  effectiveTime,
  hitStopWindows,
  pixiAnimatedNodeCount,
  sampleTrack,
  totalHitStopMs,
} from '@/lib/pixel/pixiChoreography';

const beats = (input: Parameters<typeof derivePhaseBeats>[0]): PhaseBeat[] => derivePhaseBeats(input);

describe('sampleTrack (framer-style keyframe sampling)', () => {
  it('holds the first key before the delay and the last key after the duration', () => {
    const spec = { keys: [0, 10, 4], durationMs: 400, delayMs: 100 };
    expect(sampleTrack(0, spec)).toBe(0);
    expect(sampleTrack(99, spec)).toBe(0);
    expect(sampleTrack(500, spec)).toBe(4);
    expect(sampleTrack(9999, spec)).toBe(4);
  });

  it('interpolates through keyframes with even default times', () => {
    const mid = sampleTrack(100, { keys: [0, 100], durationMs: 200, ease: EASE.linear });
    expect(mid).toBeCloseTo(50, 6);
    const quarter = sampleTrack(50, { keys: [0, 100, 0], durationMs: 200, ease: EASE.linear });
    expect(quarter).toBeCloseTo(50, 6);
  });

  it('respects explicit times (the dodge/lunge keyframe shape)', () => {
    const spec = { keys: [0, 0, -30, -26, 0], times: [0, 0.35, 0.55, 0.75, 1], durationMs: 400, ease: EASE.linear };
    expect(sampleTrack(0, spec)).toBe(0);
    expect(sampleTrack(140, spec)).toBeCloseTo(0, 6); // 0.35 boundary
    expect(sampleTrack(220, spec)).toBeCloseTo(-30, 6); // 0.55 boundary
    expect(sampleTrack(400, spec)).toBe(0);
  });

  it('the hit-reaction track returns to rest at exactly HIT_REACTION_MS', () => {
    const spec = { keys: [1, 0.93, 1.03, 1], durationMs: MOVEMENT.HIT_REACTION_MS };
    expect(sampleTrack(0, spec)).toBe(1);
    expect(sampleTrack(MOVEMENT.HIT_REACTION_MS, spec)).toBe(1);
    expect(sampleTrack(MOVEMENT.HIT_REACTION_MS / 3, spec)).toBeLessThan(0.97);
  });
});

describe('hit-stop (owner ruling 2026-11-06: absorbed inside the phase)', () => {
  const shotPhase = beats({ bossDamage: 100, playerDamage: 40, bossMaxHp: 1000, bossDies: false, playerDies: false });
  const critPhase = beats({ bossDamage: 260, playerDamage: 40, bossMaxHp: 1000, bossDies: false, playerDies: false });
  const killPhase = beats({ bossDamage: 150, playerDamage: 0, bossMaxHp: 1000, bossDies: true, playerDies: false });

  it('windows: normal hit 60ms at impact, crit 100ms, death adds 120ms at the death beat', () => {
    expect(hitStopWindows(shotPhase)).toEqual([{ atMs: 0, durationMs: HIT_STOP_MS.hit }]);
    expect(hitStopWindows(critPhase)).toEqual([{ atMs: 0, durationMs: HIT_STOP_MS.crit }]);
    expect(hitStopWindows(killPhase)).toEqual([
      { atMs: 0, durationMs: HIT_STOP_MS.hit },
      { atMs: MOVEMENT.HIT_REACTION_MS, durationMs: HIT_STOP_MS.death },
    ]);
  });

  it('total absorbed hit-stop is always far inside the 1150ms phase', () => {
    for (const phase of [shotPhase, critPhase, killPhase]) {
      expect(totalHitStopMs(phase)).toBeLessThan(MOVEMENT.PHASE_INTERVAL_MS);
    }
    expect(totalHitStopMs(killPhase)).toBe(180);
    // Even the worst legal phase (crit + death) absorbs 220ms.
    const worst = beats({ bossDamage: 300, playerDamage: 0, bossMaxHp: 1000, bossDies: true, playerDies: false });
    expect(totalHitStopMs(worst)).toBeLessThanOrEqual(220);
  });

  it('effectiveTime freezes inside a window and trails afterwards', () => {
    const windows = hitStopWindows(killPhase);
    expect(effectiveTime(0, windows)).toBe(0);
    expect(effectiveTime(30, windows)).toBe(0); // frozen at impact
    expect(effectiveTime(60, windows)).toBe(0); // first window ends
    expect(effectiveTime(160, windows)).toBe(100); // trailing by 60
    expect(effectiveTime(479, windows)).toBe(419); // approaching death freeze
    expect(effectiveTime(480, windows)).toBe(MOVEMENT.HIT_REACTION_MS); // frozen at 420
    expect(effectiveTime(599, windows)).toBe(MOVEMENT.HIT_REACTION_MS);
    expect(effectiveTime(600, windows)).toBe(MOVEMENT.HIT_REACTION_MS); // second window ends
    expect(effectiveTime(700, windows)).toBe(520); // trailing by 180 total
    // The death collapse (420..1170 effective) still completes
    // inside the phase's raw span plus the settle — and every beat
    // still STARTS inside the 1150ms phase.
    expect(effectiveTime(MOVEMENT.PHASE_INTERVAL_MS, windows)).toBe(MOVEMENT.PHASE_INTERVAL_MS - 180);
  });

  it('no beats → no windows → identity clock', () => {
    expect(hitStopWindows([])).toEqual([]);
    expect(effectiveTime(500, [])).toBe(500);
  });
});

describe('easing', () => {
  it('easeOutBack overshoots then settles exactly on target', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 6);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
    expect(easeOutBack(0.7)).toBeLessThan(1.1);
  });

  it('cubic bezier endpoints are exact', () => {
    expect(EASE.easeOut(0)).toBe(0);
    expect(EASE.easeOut(1)).toBeCloseTo(1, 3);
    expect(EASE.easeInOut(0.5)).toBeCloseTo(0.5, 3);
  });
});

describe('pool cap (brief S4: MAX_ANIMATED_NODES discipline)', () => {
  it('the cap is the movement law constant', () => {
    expect(PIXI_MAX_ANIMATED_NODES).toBe(MOVEMENT.SEGMENT.MAX_ANIMATED_NODES);
    expect(PIXI_MAX_ANIMATED_NODES).toBe(40);
  });

  it('a fully armed 11-part hunter + boss + all pools stays within the cap', () => {
    expect(pixiAnimatedNodeCount(11, true)).toBeLessThanOrEqual(PIXI_MAX_ANIMATED_NODES);
    expect(pixiAnimatedNodeCount(11, false)).toBeLessThanOrEqual(PIXI_MAX_ANIMATED_NODES);
    expect(pixiAnimatedNodeCount(10, true)).toBeLessThanOrEqual(PIXI_MAX_ANIMATED_NODES);
  });
});
