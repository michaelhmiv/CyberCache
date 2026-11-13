import { describe, expect, it } from 'vitest';
import { deriveRoamScene, roamPosesAt, sampleRoamBeat } from '@/lib/pixel/roamChoreography';
import { ENEMY_POSES } from '@/lib/pixel/rig';
import { MOVEMENT } from '@/lib/pixel/movement';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import type { TickEvent } from '@/store/slices/tickSlice';

/**
 * Regression — post-kill next-enemy invisibility (2026-11-13).
 *
 * The sequence the stage actually lives: a kill event for target A is
 * delivered by the SAME claim response that advances the roster to
 * target B (the Chef settles spawnNextTarget inside the kill claim),
 * so the kill beat stands next to B for the rest of its window. The
 * beat names A. Before the fix, roamPosesAt returned the 'death' pose
 * for whatever enemy was current and both renderers applied the kill
 * dissolve track to it — B spawned hidden, missed its walk-in, and
 * popped in settled up to a full 3s tick later.
 *
 * The contract pinned here: with beatForCurrentTarget=false (the
 * renderer's verdict that the standing beat names a previous target),
 * B never takes the death pose at ANY beat age; with the flag true or
 * omitted (the corpse composition), A's death pose still plays and is
 * retained until the next target — the bound on the corpse is the
 * target advance, per roamPoseRecovery's pinned law.
 */
const killEvent = {
  id: 'kill-event-1',
  at: 1,
  tone: 'kill',
  label: 'kill',
  value: 10,
  detail: 'test kill',
} as unknown as TickEvent;

const ELAPSED_SWEEP = [
  0,
  100,
  300,
  MOVEMENT.HIT_REACTION_MS - 1,
  MOVEMENT.HIT_REACTION_MS,
  499,
  500,
  MOVEMENT.WALK_IN_MS,
  1200,
  3000,
  10000,
];

describe('post-kill advance: the next enemy never inherits the death state', () => {
  it('poses: B (the beat names A) is never death at any beat age; the hunter celebrate is unchanged', () => {
    for (const elapsedMs of ELAPSED_SWEEP) {
      const poses = roamPosesAt({ kind: 'kill' }, true, elapsedMs, { beatForCurrentTarget: false });
      expect(poses.enemy).toBe('idle');
      expect(poses.hunter).toBe(elapsedMs < MOVEMENT.HIT_REACTION_MS ? 'celebrate' : 'aim');
    }
  });

  it('poses: A (the enemy the beat names) still dies — death at every age until the target advances', () => {
    for (const elapsedMs of ELAPSED_SWEEP) {
      expect(roamPosesAt({ kind: 'kill' }, true, elapsedMs).enemy).toBe('death');
      expect(roamPosesAt({ kind: 'kill' }, true, elapsedMs, { beatForCurrentTarget: true }).enemy).toBe('death');
    }
  });

  it('scene: B derives the idle rig pose settled and through its walk-in; A derives the death pose', () => {
    const base = {
      backgroundId: 'zone-dustwaste-bg',
      areaId: 'dustwaste',
      targetMaxHp: 100,
      hunterSet: STANDARD_ISSUE,
      event: killEvent,
    };
    for (const beatElapsedMs of ELAPSED_SWEEP) {
      const next = deriveRoamScene({
        ...base,
        currentTargetId: 'dustwaste_drone',
        beatElapsedMs,
        beatForCurrentTarget: false,
      });
      expect(next.beat?.kind).toBe('kill');
      expect(next.rigPose).toEqual(ENEMY_POSES.idle);
      expect(next.poseKey.endsWith('|idle')).toBe(true);
      // The walk-in still runs for B inside the movement window.
      const walking = deriveRoamScene({
        ...base,
        currentTargetId: 'dustwaste_drone',
        beatElapsedMs,
        beatForCurrentTarget: false,
        walkMs: 120,
      });
      expect(walking.enemyWalk).not.toBeNull();
      expect(walking.poseKey.endsWith('|idle')).toBe(true);
    }
    const corpse = deriveRoamScene({ ...base, currentTargetId: 'dustwaste_raider', beatElapsedMs: 1200 });
    expect(corpse.rigPose).toEqual(ENEMY_POSES.death);
  });

  it('the corpse dissolve track itself is untouched (renderers gate its application, not the track)', () => {
    // The killed enemy's own dissolve still plays fully: opacity 1
    // through the hold, gone by 500ms, and the hunter hop settles by
    // HIT_REACTION_MS.
    expect(sampleRoamBeat({ kind: 'kill' }, 0, killEvent).enemyHit.opacity).toBe(1);
    expect(sampleRoamBeat({ kind: 'kill' }, 600, killEvent).enemyHit.opacity).toBe(0);
    expect(sampleRoamBeat({ kind: 'kill' }, MOVEMENT.HIT_REACTION_MS, killEvent).hunter.y).toBe(0);
  });
});
