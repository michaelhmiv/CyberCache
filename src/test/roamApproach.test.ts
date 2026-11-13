/**
 * Roam approach staging — animation fix iteration, 2026-11-10
 * (the brief's Q3 item, criterion 1); restaged by the stage-
 * iteration program, 2026-11-12.
 *
 * The 2026-11-10 staging: the enemy appeared 6% of stage width
 * from its settle mark and slid that short distance — the owner's
 * "shooting gallery" complaint (the enemy never closes distance).
 * That fix tightened the settle to 66% and spanned the walk-in
 * the full approach from off-frame right, inside the SAME 850ms
 * window (MOVEMENT.WALK_IN_MS is untouched — the timing law is
 * not this slice's to move).
 *
 * The 2026-11-12 restage (owner directive, capture-measured):
 * at 66% the hunter's extended weapon crossed into the enemy
 * silhouette at rest and the fight read face-to-face. The settle
 * moves back out to 78%, the enemy frame drops to 58% height and
 * the hunter stands at 18% — clear air at rest is the governing
 * criterion now; the approach span and window are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '@/lib/pixel/movement';
import { anchorPoint, getPixelSprite, PIXEL_ENEMY_SPRITES } from '@/lib/pixel/manifest';
import { ENEMY_POSES } from '@/lib/pixel/rig';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import {
  ROAM_APPROACH,
  ROAM_ENEMY_PLACEMENT,
  ROAM_HUNTER_PLACEMENT,
  approachOffsetXPct,
  roamEnemyPlacementFor,
  deriveRoamScene,
  enemyWalkAlpha,
  resolveRoamWalkFrame,
  sampleEnemyWalkPose,
  type RoamSceneModel,
  type RoamWalkState,
} from '@/lib/pixel/roamChoreography';

describe('roam approach staging', () => {
  it('the settle mark restaged: 78% (from the tightened 66%), hunter at 12%', () => {
    expect(ROAM_ENEMY_PLACEMENT.xPct).toBe(78);
    expect(ROAM_HUNTER_PLACEMENT.xPct).toBe(12);
    // The framing gap between the two actors' marks.
    expect(ROAM_ENEMY_PLACEMENT.xPct - ROAM_HUNTER_PLACEMENT.xPct).toBe(66);
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

  it('the spawn point is off-frame: feet at 102%, body past the right edge', () => {
    const spawnFeetXPct = ROAM_ENEMY_PLACEMENT.xPct + approachOffsetXPct(0);
    expect(spawnFeetXPct).toBe(102);
    // Rig body width at roam height (frame 223x384, height 58% of
    // the 420x286 design stage) — the sprite's left edge at spawn:
    const bodyWidthPct = (ROAM_ENEMY_PLACEMENT.heightPct * (223 / 384)) / (420 / 286);
    const feetFrac = 0.5; // rig feet anchor ≈ frame center
    const leftEdgePct = spawnFeetXPct - feetFrac * bodyWidthPct;
    // The body enters FROM the right edge (its left edge starts
    // at/inside the edge, never mid-stage)…
    expect(leftEdgePct).toBeLessThan(100);
    // …and the body's right edge clears the stage's right edge:
    expect(leftEdgePct + bodyWidthPct).toBeGreaterThan(100);
  });

  it('the window is still the movement law walk-in — timing untouched', () => {
    expect(MOVEMENT.WALK_IN_MS).toBe(850);
  });
});

describe('walk articulation — the rig strides through the approach', () => {
  it('the sampled offset is the eased approach; the delta articulates mid-walk', () => {
    const start = sampleEnemyWalkPose(0);
    expect(start.offsetXPct).toBe(ROAM_APPROACH.spawnOffsetXPct);
    const mid = sampleEnemyWalkPose(425);
    expect(mid.offsetXPct).toBeGreaterThan(0);
    expect(mid.offsetXPct).toBeLessThan(ROAM_APPROACH.spawnOffsetXPct);
    // Mid-stride the segments are off rest: some band rotates or
    // sways by a visible margin (the rigid-slide failure shape is
    // every channel at 0 while the offset moves).
    const energy =
      Math.abs(mid.poseDelta.base?.rotate ?? 0) +
      Math.abs(mid.poseDelta.body?.rotate ?? 0) +
      Math.abs(mid.poseDelta.arm?.rotate ?? 0) +
      Math.abs(mid.deltaX);
    expect(energy).toBeGreaterThan(1);
    // The phase clock runs: a quarter-period later the pose differs.
    const later = sampleEnemyWalkPose(425 + 160);
    expect(later.poseDelta).not.toEqual(mid.poseDelta);
  });

  it('arrival is EXACT rest: offset 0 and every channel zeroed at the window edge', () => {
    const end = sampleEnemyWalkPose(MOVEMENT.WALK_IN_MS);
    expect(end.offsetXPct).toBe(0);
    expect(end.deltaX).toBe(0);
    for (const seg of Object.values(end.poseDelta)) {
      expect(Math.abs(seg.rotate ?? 0)).toBe(0);
      expect(Math.abs(seg.y ?? 0)).toBe(0);
    }
    const past = sampleEnemyWalkPose(MOVEMENT.WALK_IN_MS + 500);
    expect(past.offsetXPct).toBe(0);
    expect(past.deltaX).toBe(0);
  });

describe('walk frame resolution — presence is state, not a witnessed transition (invisible-enemy regression)', () => {
  // The defect (2026-11-11 latency audit): the Pixi tick rested on
  // the spawn-instant model (walkMs 0 → offset 24 → alpha 0), so
  // the enemy was visible only inside the 850 ms walk-in window
  // and snapped back to invisible on arrival, for every target.
  // These tests run the tick's exact frame pipeline: resolve the
  // walk frame, derive with its walkMs inside the window, rest on
  // the settled derivation outside it, alpha via enemyWalkAlpha.
  const base = {
    backgroundId: 'zone-dustwaste-bg',
    areaId: 'dustwaste_frontier',
    targetMaxHp: 100,
    currentTargetId: 'dustwaste_drone',
    hunterSet: STANDARD_ISSUE,
  } as const;
  const KEY = 'dustwaste_drone|std';
  function frame(prev: RoamWalkState | null, key: string, now: number): { state: RoamWalkState; model: RoamSceneModel } {
    const f = resolveRoamWalkFrame(prev, key, now);
    const model = f.walkMs !== undefined ? deriveRoamScene({ ...base, walkMs: f.walkMs }) : deriveRoamScene({ ...base });
    return { state: f.walk, model };
  }

  it('an enemy already active at stage mount walks in and REACHES alpha 1 — and stays there', () => {
    // Mount: no clock exists for the already-active target.
    const t0 = 50_000;
    const first = frame(null, KEY, t0);
    expect(first.state).toEqual({ targetKey: KEY, startMs: t0 });
    // Arrival and long after: settled, fully opaque, at the settle point.
    for (const t of [t0 + MOVEMENT.WALK_IN_MS, t0 + 5_000, t0 + 120_000]) {
      const settled = frame(first.state, KEY, t);
      expect(settled.model.enemyWalk).toBeNull();
      expect(settled.model.enemyPlacement.xPct).toBe(roamEnemyPlacementFor('runner').xPct);
      expect(enemyWalkAlpha(settled.model)).toBe(1);
    }
  });

  it('inside the window the approach is live: offset shrinks and alpha rises toward 1', () => {
    const t0 = 10_000;
    const start = frame(null, KEY, t0);
    const mid = frame(start.state, KEY, t0 + 425);
    expect(mid.model.enemyWalk).not.toBeNull();
    expect(mid.model.enemyWalk!.offsetXPct).toBeGreaterThan(0);
    expect(mid.model.enemyWalk!.offsetXPct).toBeLessThan(ROAM_APPROACH.spawnOffsetXPct);
    expect(enemyWalkAlpha(mid.model)).toBeGreaterThan(0);
    expect(enemyWalkAlpha(mid.model)).toBeLessThan(1);
  });

  it('a target change restarts the walk for the new target, which then settles visible', () => {
    const t0 = 20_000;
    const a = frame(null, 'dustwaste_drone|std', t0);
    const settledA = frame(a.state, 'dustwaste_drone|std', t0 + 10_000);
    expect(enemyWalkAlpha(settledA.model)).toBe(1);
    const b = frame(settledA.state, 'dustwaste_brute|std', t0 + 10_000);
    expect(b.state).toEqual({ targetKey: 'dustwaste_brute|std', startMs: t0 + 10_000 });
    const settledB = frame(b.state, 'dustwaste_brute|std', t0 + 10_000 + MOVEMENT.WALK_IN_MS + 1);
    expect(enemyWalkAlpha(settledB.model)).toBe(1);
  });

  it('tab-away-and-back does NOT restart the walk and never returns the spawn frame', () => {
    const t0 = 30_000;
    const start = frame(null, KEY, t0);
    // The ticker pauses while hidden; wall time jumps a minute.
    const back = resolveRoamWalkFrame(start.state, KEY, t0 + 60_000);
    expect(back.walk).toEqual({ targetKey: KEY, startMs: t0 });
    expect(back.walkMs).toBeUndefined();
    const settled = frame(start.state, KEY, t0 + 60_000);
    expect(enemyWalkAlpha(settled.model)).toBe(1);
  });

  it('the settled derivation is the resting model: alpha 1 exactly, never the spawn alpha 0', () => {
    const settled = deriveRoamScene({ ...base });
    expect(enemyWalkAlpha(settled)).toBe(1);
    const spawn = deriveRoamScene({ ...base, walkMs: 0 });
    expect(enemyWalkAlpha(spawn)).toBe(0);
  });
});

  it('the model folds the delta into the rig pose only inside the window', () => {
    const base = {
      backgroundId: 'zone-dustwaste-bg',
      areaId: 'dustwaste_frontier',
      targetMaxHp: 100,
      currentTargetId: 'dustwaste_drone',
      hunterSet: STANDARD_ISSUE,
    } as const;
    const settled = deriveRoamScene({ ...base });
    expect(settled.enemyWalk).toBeNull();
    expect(settled.rigPose).toEqual(ENEMY_POSES.idle);
    const walking = deriveRoamScene({ ...base, walkMs: 300 });
    expect(walking.enemyWalk).not.toBeNull();
    expect(walking.enemyWalk!.offsetXPct).toBeGreaterThan(0);
    expect(walking.rigPose).not.toEqual(ENEMY_POSES.idle);
    const arrived = deriveRoamScene({ ...base, walkMs: MOVEMENT.WALK_IN_MS });
    expect(arrived.enemyWalk).toBeNull();
    expect(arrived.rigPose).toEqual(ENEMY_POSES.idle);
  });
});

describe('rest staging geometry — every archetype keeps its air (stage-iteration program, 2026-11-12)', () => {
  // Box-level tripwire for the program's spacing criterion. The
  // silhouette truth is measured on captures (the program's
  // iteration logs); the sprite BOX is derivable exactly from the
  // manifest through the same math actorAnchorPoint runs, and a
  // staging edit that pushes any archetype's box across these
  // lines has already lost before a capture is taken. (At the
  // pre-program staging — settle 66%, height 66% — the runner's
  // box was 47.5% wide with its left edge at 39.1%: both lines
  // crossed.)
  const ASPECT = 420 / 286;
  for (const archetype of ['fodder', 'runner', 'brute', 'sniper', 'elite'] as const) {
    it(`${archetype}: box ≤45% of stage width, left edge ≥52% at the settle`, () => {
      const sprite = getPixelSprite(PIXEL_ENEMY_SPRITES[archetype])!;
      // The EFFECTIVE settle (per-archetype overrides included) —
      // the guard covers the staging the stage actually renders.
      const placement = roamEnemyPlacementFor(archetype);
      const widthPct = (placement.heightPct * (sprite.width / sprite.height)) / ASPECT;
      const feet = anchorPoint(sprite, 'feet', 100, 100);
      const left = placement.xPct - (feet.x / 100) * widthPct;
      expect(widthPct).toBeLessThanOrEqual(45);
      expect(left).toBeGreaterThanOrEqual(52);
    });
  }

  it('per-archetype overrides: only runner + sniper move off the shared mark', () => {
    expect(roamEnemyPlacementFor('fodder')).toEqual({ xPct: 78, heightPct: 58 });
    expect(roamEnemyPlacementFor('brute')).toEqual({ xPct: 78, heightPct: 58 });
    expect(roamEnemyPlacementFor('elite')).toEqual({ xPct: 78, heightPct: 58 });
    expect(roamEnemyPlacementFor(undefined)).toEqual({ xPct: 78, heightPct: 58 });
    expect(roamEnemyPlacementFor('runner')).toEqual({ xPct: 84, heightPct: 44 });
    expect(roamEnemyPlacementFor('sniper')).toEqual({ xPct: 86, heightPct: 58 });
  });
});
