/**
 * Motion M2b — the travel beat: choreography data, the pan
 * derivation, and the shared tracker both renderers feed.
 *
 * The proof contract:
 *  - the beat's window IS the movement law's walk-in (read, never
 *    restated) and its gait is a STRIDE_SPECS row;
 *  - no foot-skating by construction: the pan multiplier times
 *    the scene's own near-layer rate reproduces the stride's
 *    derived ground speed EXACTLY — one source;
 *  - the tracker engages on roam start and on every
 *    between-enemy advance, preempts on a NEWER combat beat
 *    (never on the stale kill that cleared the way, never on
 *    loot), disengages at exactly start + duration, and cancels
 *    outright when roaming ends (the Stop interrupt);
 *  - the envelope is the M2a actor's: start-beat delay, one-period
 *    ramp, phase clock kept through a one-period settle — and at
 *    amplitude 0 the composed pose is the base pose exactly.
 */
import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '@/lib/pixel/movement';
import { PART_POSES, SKELETON } from '@/lib/pixel/parts';
import { layoutPartSet } from '@/lib/pixel/partsCompositor';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { ROAM_HUNTER_PLACEMENT } from '@/lib/pixel/roamChoreography';
import {
  STRIDE_PERIOD_MS,
  STRIDE_START_DELAY_MS,
  STRIDE_SPECS,
  composeStridePose,
  sampleStride,
} from '@/lib/pixel/strideCycle';
import {
  TRAVEL_SPECS,
  createTravelRun,
  feedTravel,
  sampleTravel,
  strideGroundSpeedPxS,
  travelPanMultiplier,
  travelStrideSpec,
  type TravelRunState,
} from '@/lib/pixel/travelChoreography';
import { CAMP_VISTA_SCENE, VISTA_SCENES, VISTA_STAGE_H } from '@/lib/pixel/vistaScenes';

const SPEC = TRAVEL_SPECS.advance;
const SCENE = VISTA_SCENES.dustwaste_frontier;

const feed = (
  run: TravelRunState,
  now: number,
  over: Partial<{ engaged: boolean; targetKey: string | null; beatKind: 'shot' | 'crit' | 'playerHit' | 'kill' | 'loot' | null; beatEventId: string | null }> = {},
) =>
  feedTravel(run, SPEC, {
    engaged: over.engaged ?? true,
    targetKey: over.targetKey ?? null,
    beatKind: over.beatKind ?? null,
    beatEventId: over.beatEventId ?? null,
    now,
  });

describe('travel choreography — the data', () => {
  it('the advance window is the movement law walk-in, read not restated', () => {
    expect(SPEC.durationMs).toBe(MOVEMENT.WALK_IN_MS);
    expect(travelStrideSpec(SPEC)).toBe(STRIDE_SPECS[SPEC.strideSpecId]);
  });

  it('ground speed derives from the skeleton, the spec swing, and the placement scale', () => {
    const stride = STRIDE_SPECS.stride;
    const legPx = SKELETON.groundLine - SKELETON.hipF.y;
    const stepLen = 2 * legPx * Math.sin((stride.thighSwingDeg * Math.PI) / 180);
    const scale = ((ROAM_HUNTER_PLACEMENT.heightPct / 100) * VISTA_STAGE_H) / SKELETON.frameHeight;
    const expected = (stepLen * scale) / (STRIDE_PERIOD_MS / 2 / 1000);
    expect(strideGroundSpeedPxS(stride)).toBeCloseTo(expected, 10);
    // Sanity band for the shipped gait: a deliberate walk, not a
    // drift and not a sprint (≈111 design px/s at 6.5°).
    expect(expected).toBeGreaterThan(100);
    expect(expected).toBeLessThan(125);
  });

  it('the pan multiplier makes the near layer move at exactly the ground speed', () => {
    const stride = STRIDE_SPECS.stride;
    for (const scene of Object.values(VISTA_SCENES)) {
      if (scene.panPxS.near <= 0) continue;
      const rate = travelPanMultiplier(stride, scene) * scene.panPxS.near;
      expect(rate).toBeCloseTo(strideGroundSpeedPxS(stride), 8);
    }
    // No-pan scenes (camp) have no ground motion to sync.
    expect(travelPanMultiplier(stride, CAMP_VISTA_SCENE)).toBe(1);
  });
});

describe('travel tracker — triggers', () => {
  it('rests while there is no target', () => {
    const run = createTravelRun();
    feed(run, 1000);
    feed(run, 2000);
    const s = sampleTravel(run, SPEC, SCENE, 2000);
    expect(s.active).toBe(false);
    expect(s.amplitude).toBe(0);
    expect(s.panRate).toBe(1);
  });

  it('engages on roam start — the first target sighting', () => {
    const run = createTravelRun();
    feed(run, 1000, { targetKey: 'a' });
    const s = sampleTravel(run, SPEC, SCENE, 1000);
    expect(s.active).toBe(true);
    expect(run.startMs).toBe(1000);
  });

  it('engages on the between-enemy advance: kill gap, then spawn', () => {
    const run = createTravelRun();
    feed(run, 0, { targetKey: 'a', beatEventId: 'e0' });
    // The window closes, the run settles.
    feed(run, SPEC.durationMs + 10, { targetKey: 'a', beatEventId: 'e0' });
    expect(sampleTravel(run, SPEC, SCENE, SPEC.durationMs + 10).active).toBe(false);
    // Kill: the target vanishes (the run was already settling).
    feed(run, 2000, { targetKey: null, beatKind: 'kill', beatEventId: 'kill-1' });
    // Spawn: a fresh advance engages, keyed to the spawn instant.
    feed(run, 2100, { targetKey: 'b', beatKind: 'kill', beatEventId: 'kill-1' });
    expect(run.startMs).toBe(2100);
    expect(sampleTravel(run, SPEC, SCENE, 2100).active).toBe(true);
  });

  it('engages on a direct target swap (server sync jump)', () => {
    const run = createTravelRun();
    feed(run, 0, { targetKey: 'a' });
    feed(run, 300, { targetKey: 'b' });
    expect(run.startMs).toBe(300);
    expect(run.targetKey).toBe('b');
  });

  it('settles if the target vanishes mid-window', () => {
    const run = createTravelRun();
    feed(run, 0, { targetKey: 'a' });
    feed(run, 400, { targetKey: null, beatKind: 'kill', beatEventId: 'k' });
    expect(run.stopAt).toBe(400);
    expect(sampleTravel(run, SPEC, SCENE, 400).active).toBe(false);
  });
});

describe('travel tracker — preemption', () => {
  it('the stale kill that cleared the way does NOT preempt its own advance', () => {
    const run = createTravelRun();
    // Spawn arrives while the kill event is still the latest.
    feed(run, 500, { targetKey: 'b', beatKind: 'kill', beatEventId: 'kill-1' });
    feed(run, 700, { targetKey: 'b', beatKind: 'kill', beatEventId: 'kill-1' });
    expect(sampleTravel(run, SPEC, SCENE, 700).active).toBe(true);
  });

  it('a combat beat from a NEWER event preempts mid-stride', () => {
    const run = createTravelRun();
    feed(run, 0, { targetKey: 'a', beatKind: 'kill', beatEventId: 'kill-1' });
    feed(run, 600, { targetKey: 'a', beatKind: 'shot', beatEventId: 'shot-2' });
    expect(run.stopAt).toBe(600);
    const s = sampleTravel(run, SPEC, SCENE, 600);
    expect(s.active).toBe(false);
    expect(s.amplitude).toBeGreaterThan(0); // settles, never snaps
  });

  it('loot never preempts — the celebration rides its own layer', () => {
    const run = createTravelRun();
    feed(run, 0, { targetKey: 'a', beatEventId: 'e0' });
    feed(run, 400, { targetKey: 'a', beatKind: 'loot', beatEventId: 'loot-1' });
    expect(sampleTravel(run, SPEC, SCENE, 400).active).toBe(true);
  });

  it('leaving roaming cancels outright — the Stop interrupt', () => {
    const run = createTravelRun();
    feed(run, 0, { targetKey: 'a' });
    feed(run, 600, { targetKey: 'a' });
    feed(run, 650, { engaged: false, targetKey: 'a' });
    const s = sampleTravel(run, SPEC, SCENE, 650);
    expect(s.active).toBe(false);
    expect(s.amplitude).toBe(0);
    expect(run.startMs).toBeNull();
    // And a later roam start with the SAME target re-engages.
    feed(run, 5000, { targetKey: 'a' });
    expect(run.startMs).toBe(5000);
  });
});

describe('travel tracker — the envelope', () => {
  it('holds at zero through the SEGMENT start beat, then ramps over one period', () => {
    const run = createTravelRun();
    feed(run, 1000, { targetKey: 'a' });
    const at = (t: number) => sampleTravel(run, SPEC, SCENE, t);
    expect(at(1000 + STRIDE_START_DELAY_MS - 1).amplitude).toBe(0);
    expect(at(1000 + STRIDE_START_DELAY_MS).amplitude).toBe(0);
    expect(at(1000 + STRIDE_START_DELAY_MS + STRIDE_PERIOD_MS / 2).amplitude).toBeCloseTo(0.5, 6);
    expect(at(1000 + STRIDE_START_DELAY_MS + STRIDE_PERIOD_MS).amplitude).toBe(1);
    expect(at(1000 + STRIDE_START_DELAY_MS).phaseMs).toBe(0);
    expect(at(1000 + STRIDE_START_DELAY_MS + 200).phaseMs).toBe(200);
  });

  it('disengages at exactly start + duration, with the envelope amplitude of that instant', () => {
    const run = createTravelRun();
    feed(run, 0, { targetKey: 'a' });
    feed(run, SPEC.durationMs + 5000, { targetKey: 'a' }); // observed late
    expect(run.stopAt).toBe(SPEC.durationMs);
    const expectedAmp = Math.min(1, (SPEC.durationMs - STRIDE_START_DELAY_MS) / STRIDE_PERIOD_MS);
    expect(run.ampAtStop).toBeCloseTo(expectedAmp, 10);
    // The settle: phase clock kept, amplitude decays over one period.
    const mid = sampleTravel(run, SPEC, SCENE, SPEC.durationMs + STRIDE_PERIOD_MS / 2);
    expect(mid.amplitude).toBeCloseTo(expectedAmp * 0.5, 6);
    expect(mid.phaseMs).toBe(SPEC.durationMs - STRIDE_START_DELAY_MS + STRIDE_PERIOD_MS / 2);
    const done = sampleTravel(run, SPEC, SCENE, SPEC.durationMs + STRIDE_PERIOD_MS);
    expect(done.amplitude).toBe(0);
    expect(done.driving).toBe(false);
  });

  it('pan rate rides the same envelope: 1 at rest, full multiplier at full amplitude', () => {
    const run = createTravelRun();
    feed(run, 0, { targetKey: 'a' });
    const mult = travelPanMultiplier(STRIDE_SPECS.stride, SCENE);
    const half = sampleTravel(run, SPEC, SCENE, STRIDE_START_DELAY_MS + STRIDE_PERIOD_MS / 2);
    expect(half.panRate).toBeCloseTo(1 + (mult - 1) * 0.5, 6);
    // A null scene (non-vista background) strides without a pan boost.
    expect(sampleTravel(run, SPEC, null, STRIDE_START_DELAY_MS + 100).panRate).toBe(1);
  });

  it('amplitude 0 resolves to the base layout exactly — arrival is rest, byte-exact', () => {
    const stride = STRIDE_SPECS.stride;
    const rest = layoutPartSet(STANDARD_ISSUE, PART_POSES.roam);
    for (const phaseMs of [0, 137, 320, 641]) {
      const composed = composeStridePose(sampleStride(stride, phaseMs, 0), PART_POSES.roam);
      expect(layoutPartSet(STANDARD_ISSUE, composed)).toEqual(rest);
    }
  });
});
