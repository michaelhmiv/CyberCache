/**
 * Travel beat choreography — Motion Reboot M2b, the final slice
 * of the Motion Reboot program (MOTION-AUDIT.md §2.1C + the M2a
 * record in DESIGN §10; slice approved 2026-11-08).
 *
 * Between encounters the hunter used to teleport in place: a kill
 * swapped the target and the next enemy remounted with its walk-in
 * while the hunter stood at his mark, the world drifting at the
 * ambient pan. M2b inserts the missing beat — the ADVANCE. When a
 * new target arrives while roaming (roam start included), the
 * hunter WALKS: the M2a stride spec drives the legs through the
 * FK resolver, and the vista pan accelerates to the stride's own
 * ground speed, so feet and ground agree. The enemy's walk-in
 * (movement.ts WALK_IN_MS) is the beat's window: the two figures
 * arrive together, and the hunter settles into the exact pose the
 * beat system expects — downstream encounter handoffs (boss,
 * endless, roam combat) are untouched.
 *
 * Choreography as data, like every Motion Reboot tenant: a travel
 * spec names its gait (a STRIDE_SPECS row) and its window (read
 * from MOVEMENT, never restated). The tracker below is the ONE
 * state machine both renderers feed — the Pixi stage per rAF
 * frame, the DOM scene from its own rAF driver — so the beat's
 * triggers, envelope, and pan rate cannot drift between them.
 *
 * The engagement envelope is the stride spec's own envelope
 * (strideCycle.strideEnvelopeAt — start delay + ramp are spec
 * data): the generic gait keeps the M2a actor semantics (SEGMENT
 * start beat, one-period ramp), while the advance's travel gait
 * saturates at 600ms so the stride reaches full amplitude inside
 * the 850ms window (animation fix iteration, 2026-11-10 — the
 * criterion-5 reservation). On disengage the phase clock keeps
 * running while amplitude decays to 0 across one period, handing
 * the figure back to the pose system at amplitude 0 — where the
 * composed pose IS the base pose, byte-exact (M2a rest invariance
 * is the floor).
 *
 * No foot-skating by construction: the pan rate derives from the
 * stride spec itself — step length from the skeleton's leg and
 * the spec's thigh swing, step time from the law-derived period —
 * one source, asserted exactly in the M2b tests. While the
 * amplitude ramps, the pan rate ramps with it (rate = 1 at rest:
 * the ambient drift the roam scene already runs).
 *
 * Presentation only. The beat never gates anything: a combat
 * beat from a NEWER tick event preempts it mid-stride (the
 * tracker disengages and the figure settles over one period
 * while the beat plays), leaving roaming cancels it outright,
 * and no claim, tick, or encounter start ever waits on it.
 * Reduced motion never engages it — the renderers hold the
 * pre-M2b picture (instant target swap + walk-in fade, the
 * game's existing reduced-motion convention for this stage).
 */
import { MOVEMENT, type CombatBeatKind } from './movement';
import { SKELETON } from './parts';
import { ROAM_HUNTER_PLACEMENT } from './roamChoreography';
import {
  STRIDE_PERIOD_MS,
  STRIDE_SPECS,
  strideEnvelopeAt,
  strideEnvelopeStartMs,
  type StrideSpec,
} from './strideCycle';
import { VISTA_STAGE_H, type VistaSceneSpec } from './vistaScenes';

/** One travel beat's choreography, as data. */
export interface TravelSpec {
  /** Registry key — data identity, not a code branch. */
  id: string;
  /** The gait this beat executes — a STRIDE_SPECS row. */
  strideSpecId: string;
  /** The advance window: the movement law's walk-in duration,
   *  shared with the incoming enemy's entrance so the two
   *  figures arrive together. Read from MOVEMENT at the row. */
  durationMs: number;
}

/**
 * The travel registry — THE data surface of the beat. Add a row
 * to give another transition its own advance; the tracker, both
 * renderers, and the pan derivation execute any row unchanged.
 *
 * - advance: the roam advance — roam start and every
 *   between-enemy step of a roam session.
 */
export const TRAVEL_SPECS: Record<string, TravelSpec> = {
  advance: {
    id: 'advance',
    // The travel gait row (animation fix iteration, 2026-11-10):
    // the stride row's leg amplitudes with an envelope tuned to
    // the 850ms window, so the stride reaches full amplitude
    // before arrival — see STRIDE_SPECS.travelStride.
    strideSpecId: 'travelStride',
    durationMs: MOVEMENT.WALK_IN_MS,
  },
};

/** The gait a travel spec executes. */
export function travelStrideSpec(spec: TravelSpec): StrideSpec {
  return STRIDE_SPECS[spec.strideSpecId];
}

/**
 * The gait's ground speed in vista design px/s — the speed the
 * world must move under the hunter for the planted foot to hold
 * its ground. Derived, never tuned: a step carries the foot
 * 2 × leg × sin(swing) (the thigh sweeps ±swing about the hip,
 * the leg is the skeleton's hip-to-ground length), a step lasts
 * half the law-derived stride period, and skeleton px become
 * design px at the roam placement's display scale (the hunter's
 * frame height over the stage's design height).
 */
export function strideGroundSpeedPxS(stride: StrideSpec): number {
  const legPx = SKELETON.groundLine - SKELETON.hipF.y;
  const stepLenSkeletonPx = 2 * legPx * Math.sin((stride.thighSwingDeg * Math.PI) / 180);
  const designScale =
    ((ROAM_HUNTER_PLACEMENT.heightPct / 100) * VISTA_STAGE_H) / SKELETON.frameHeight;
  const stepMs = STRIDE_PERIOD_MS / 2;
  return (stepLenSkeletonPx * designScale) / (stepMs / 1000);
}

/**
 * The pan multiplier that makes the vista's ground layer move at
 * the gait's ground speed: the scene's own near-layer rate is
 * the yardstick (panPxS is per-scene data), so the far/mid
 * layers keep their authored parallax ratios under the boost.
 * A scene with no pan (camp) has no ground motion to sync — 1.
 */
export function travelPanMultiplier(stride: StrideSpec, scene: VistaSceneSpec): number {
  const near = scene.panPxS.near;
  if (!(near > 0)) return 1;
  return strideGroundSpeedPxS(stride) / near;
}

// ── The travel tracker ──────────────────────────────────────────
// One run state per renderer, fed the same inputs, sampled by the
// same functions. Deterministic in (inputs, now): the renderers
// observe store state, they never own beat timing.

export interface TravelRunState {
  /** The target the current/last run advanced toward. */
  targetKey: string | null;
  /** The tick event that was latest when the run engaged — a
   *  combat beat from THAT event is the stale kill that cleared
   *  the way, not an interruption (see feedTravel). */
  engageEventId: string | null;
  /** Engage timestamp (the renderer's clock), null at rest. */
  startMs: number | null;
  /** Disengage timestamp once the run is settling, else null. */
  stopAt: number | null;
  /** Envelope amplitude captured at the disengage instant. */
  ampAtStop: number;
}

export function createTravelRun(): TravelRunState {
  return { targetKey: null, engageEventId: null, startMs: null, stopAt: null, ampAtStop: 0 };
}

export interface TravelFeedInput {
  /** The renderer is staging a roam with motion allowed. False
   *  (other activity, reduced motion, renderer unmounted) cancels
   *  any run outright — the Stop/activity-switch interrupt. */
  engaged: boolean;
  /** The current roaming target id, null in the kill gap. */
  targetKey: string | null;
  /** The latest tick event's classified beat kind, if any. */
  beatKind: CombatBeatKind | null;
  /** The latest tick event's id — preemption provenance. */
  beatEventId: string | null;
  now: number;
}

/** Combat beats preempt the advance; loot does NOT — a drop's
 *  celebration rides its own layer and the advance continues
 *  under it, as it does under the enemy's walk-in. */
const PREEMPTING_BEATS: ReadonlySet<CombatBeatKind> = new Set(['shot', 'crit', 'playerHit', 'kill']);

/** The engagement envelope at `t` (before any disengage decay):
 *  the spec's own envelope (strideCycle.strideEnvelopeAt — start
 *  delay + ramp are spec data; the advance spec's travel gait
 *  saturates inside the 850ms window). */
function envelopeAmp(run: TravelRunState, spec: TravelSpec, t: number): number {
  if (run.startMs === null) return 0;
  return strideEnvelopeAt(travelStrideSpec(spec), t - run.startMs);
}

function disengage(run: TravelRunState, spec: TravelSpec, atMs: number): void {
  run.ampAtStop = envelopeAmp(run, spec, atMs);
  run.stopAt = atMs;
}

/**
 * Feed one observation into the run. Engage rules: a target
 * appearing (first sighting in roam = roam start; a swap or a
 * spawn out of the kill gap = the between-enemy advance) starts
 * the beat. Preempt rule: a combat beat whose event arrived
 * AFTER the engage disengages the run at once — game events
 * preempt the beat, never wait for it. The window rule: the run
 * disengages at exactly startMs + spec.durationMs regardless of
 * when a renderer next observes it.
 */
export function feedTravel(run: TravelRunState, spec: TravelSpec, input: TravelFeedInput): void {
  if (!input.engaged) {
    run.targetKey = null;
    run.engageEventId = null;
    run.startMs = null;
    run.stopAt = null;
    run.ampAtStop = 0;
    return;
  }
  if (input.targetKey !== run.targetKey) {
    if (input.targetKey !== null) {
      run.targetKey = input.targetKey;
      run.engageEventId = input.beatEventId;
      run.startMs = input.now;
      run.stopAt = null;
      run.ampAtStop = 0;
    } else {
      // The target vanished mid-beat (killed on its spawn tick,
      // area reset): settle from here.
      run.targetKey = null;
      if (run.startMs !== null && run.stopAt === null) disengage(run, spec, input.now);
    }
  }
  if (run.startMs !== null && run.stopAt === null) {
    if (
      input.beatKind !== null &&
      PREEMPTING_BEATS.has(input.beatKind) &&
      input.beatEventId !== run.engageEventId
    ) {
      disengage(run, spec, input.now);
    } else if (input.now - run.startMs >= spec.durationMs) {
      disengage(run, spec, run.startMs + spec.durationMs);
    }
  }
}

export interface TravelSample {
  /** The engage window is open — renderers bind the stride
   *  execution (the DOM actor's `active`) on this. */
  active: boolean;
  /** Amplitude > 0: the legs are off the base pose this instant. */
  driving: boolean;
  /** Engagement amplitude 0..1 (the M2a envelope). */
  amplitude: number;
  /** Stride-local ms for sampleStride: 0 at the spec's envelope
   *  start, the phase clock that keeps running through the settle. */
  phaseMs: number;
  /** Vista pan clock multiplier this instant: 1 at rest (the
   *  ambient drift), rising with amplitude to the stride-synced
   *  rate — feet and ground agree at every amplitude. */
  panRate: number;
}

/** Sample the run at `now`. At amplitude 0 the composed stride
 *  pose is the base pose exactly — arrival lands on the pose the
 *  beat system holds, byte-exact. */
export function sampleTravel(
  run: TravelRunState,
  spec: TravelSpec,
  scene: VistaSceneSpec | null,
  now: number,
): TravelSample {
  if (run.startMs === null) {
    return { active: false, driving: false, amplitude: 0, phaseMs: 0, panRate: 1 };
  }
  const phaseStart = run.startMs + strideEnvelopeStartMs(travelStrideSpec(spec));
  const phaseMs = Math.max(0, now - phaseStart);
  let amplitude = envelopeAmp(run, spec, now);
  if (run.stopAt !== null) {
    amplitude = run.ampAtStop * Math.max(0, 1 - (now - run.stopAt) / STRIDE_PERIOD_MS);
  }
  const multiplier = scene ? travelPanMultiplier(travelStrideSpec(spec), scene) : 1;
  return {
    active: run.stopAt === null,
    driving: amplitude > 0,
    amplitude,
    phaseMs,
    panRate: 1 + (multiplier - 1) * amplitude,
  };
}
