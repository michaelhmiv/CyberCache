/**
 * Roam approach staging — animation fix iteration, 2026-11-10
 * (the brief's Q3 item, criterion 1).
 *
 * The shipped staging: the enemy appeared 6% of stage width from
 * its settle mark and slid that short distance — the owner's
 * "shooting gallery" complaint (the enemy never closes distance).
 * The fix is staging data only: the settle mark tightens and the
 * walk-in spans the full approach from off-frame right, inside
 * the SAME 850ms window (MOVEMENT.WALK_IN_MS is untouched — the
 * timing law is not this slice's to move).
 */
import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '@/lib/pixel/movement';
import {
  ROAM_APPROACH,
  ROAM_ENEMY_PLACEMENT,
  ROAM_HUNTER_PLACEMENT,
  approachOffsetXPct,
} from '@/lib/pixel/roamChoreography';

describe('roam approach staging', () => {
  it('the settle mark tightened: 66% (from the shipped 74%), hunter at 22%', () => {
    expect(ROAM_ENEMY_PLACEMENT.xPct).toBe(66);
    expect(ROAM_HUNTER_PLACEMENT.xPct).toBe(22);
    // The framing gap between the two actors' marks.
    expect(ROAM_ENEMY_PLACEMENT.xPct - ROAM_HUNTER_PLACEMENT.xPct).toBe(44);
  });

  it('the approach spans 24% of stage width — 4x the shipped 6% slide', () => {
    expect(ROAM_APPROACH.spawnOffsetXPct).toBe(24);
    expect(approachOffsetXPct(0)).toBe(24);
    expect(approachOffsetXPct(1)).toBe(0);
    // Monotonic approach: the offset only ever shrinks.
    let prev = Number.POSITIVE_INFINITY;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = approachOffsetXPct(p);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    // Progress clamps outside the window.
    expect(approachOffsetXPct(-0.5)).toBe(24);
    expect(approachOffsetXPct(1.5)).toBe(0);
  });

  it('the spawn point is off-frame: feet at 90%, body past the right edge', () => {
    const spawnFeetXPct = ROAM_ENEMY_PLACEMENT.xPct + approachOffsetXPct(0);
    expect(spawnFeetXPct).toBe(90);
    // Rig body width at roam height (frame 223x384, height 66% of
    // the 420x286 design stage) — the sprite's left edge at spawn:
    const bodyWidthPct = (ROAM_ENEMY_PLACEMENT.heightPct * (223 / 384)) / (420 / 286);
    const feetFrac = 0.5; // rig feet anchor ≈ frame center
    const leftEdgePct = spawnFeetXPct - feetFrac * bodyWidthPct;
    expect(leftEdgePct).toBeLessThan(90);
    // …and the body's right edge clears the stage's right edge:
    expect(leftEdgePct + bodyWidthPct).toBeGreaterThan(100);
  });

  it('the window is still the movement law walk-in — timing untouched', () => {
    expect(MOVEMENT.WALK_IN_MS).toBe(850);
  });
});
