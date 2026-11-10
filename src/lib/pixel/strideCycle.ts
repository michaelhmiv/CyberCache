/**
 * Stride cycle choreography — Motion Reboot M2a (MOTION-AUDIT.md
 * §2.1A + Part 3, verified at master 5a508f5; slice approved
 * 2026-11-08).
 *
 * The walk cycle, in the workCycle pattern: ONE engine, data-driven.
 * A stride is a choreography SPEC — declared data keyed by id in
 * STRIDE_SPECS — and this module only ever samples specs. Per-family
 * feel lives in the spec rows, never in code paths: a future gait,
 * mount, or custom leg shape plugs in by ADDING a spec row
 * (flexibility law, 2026-11-06). No new PART_POSES entries (Motion
 * grill #4): the stride is choreography-layer oscillation composed
 * onto a standing pose, exactly like the work cycle.
 *
 * The period is law-derived, not data: one stride is two steps, and
 * a step is movement.ts's SEGMENT.STEP_BOB_MS — STRIDE_PERIOD_MS
 * reads it from MOVEMENT (2 × STEP_BOB_MS), so nothing here can
 * invent a timing and movement.ts is untouched. Specs carry curves
 * and amplitudes, never a period field.
 *
 * The cycle is only possible because the leg chain is
 * forward-kinematic (partsCompositor M2a): the thigh swing carries
 * the shin, the knee-bend channel rotates the shin about the
 * resolved knee, and the sole-lift channel raises the knee seat —
 * the foot genuinely leaves the ground in swing. Under the old
 * sole-pinned resolver every channel below would have been dropped
 * or grounded. Arms are NEVER touched: the roaming hunter is armed
 * and the arm chain is FK-locked to the weapon grip; the stride
 * sells through legs + bob + slight torso counter-rotation
 * (audit §2.1A point 4).
 *
 * Amplitudes are measured, not guessed (the parts gates' own
 * underlap/interior-hole measures, re-measured on CURRENT master
 * c3a18d2e — the hero polish pass, PR #459, moved the leg sprites
 * after the first tuning, and the numbers moved with them; full
 * record in the slice evidence, m2a-evidence/skirt-measure.json):
 *  - The shipped bar is the FULL stride graded at 32 phases on
 *    all three sets, the G2 discrete-pose pattern: underlap ≥ 4px
 *    (the J3 floor) and interior holes ≤ rest at every phase. At
 *    7° of thigh swing the front knee fails it on current sprites
 *    (3px on SI/Dreadplate, 1px on Bulwark); the largest swing
 *    holding the bar everywhere is 6.5° — the shipped value. The
 *    gait reads through the knee bend + sole lift (the foot
 *    leaving the ground is the cue at 163px), not swing width.
 *  - Honest limit of that bar: sampled at 64 phases, single core
 *    columns dip to 2px at isolated phases at ANY swing in
 *    5–6.5° — rotation re-rasterizes sprite edges and the
 *    min-column measure jitters. It never reaches 0 and holes
 *    never exceed rest: the joint thins at a column, it never
 *    separates. The audit's ±15° envelope is graded on exactly
 *    that separation contract in the tests (underlap ≥ 1 and
 *    holes ≤ rest at ±15° under flatfoot compensation on every
 *    set — worst underlap cell 3px, SI/Dreadplate front knee at
 *    +15°; one documented pinhole cell, Bulwark's back knee at
 *    −15° flatfoot, opens a single interior hole pixel at 10px
 *    underlap and closes under any bent shin); the 4px floor is
 *    NOT held at ±15°, which is why no shipped gait swings
 *    anywhere near it.
 *  - Torso counter-rotation runs at 0 in the shipped gait: just
 *    0.3° of torso rotation thins the SI/Dreadplate back hip's
 *    underlap from 12px to 7–8px (the torso's lower fringe over
 *    the back thigh is thin; Bulwark is unaffected, and nothing
 *    zeroes). The field stays in the spec — a future set with
 *    deeper hip coverage may afford it — but the shipped gait
 *    sways not at all; the bob (pure y) is innocent and stays.
 */
import { MOVEMENT } from './movement';
import { PART_POSES, type PartPose } from './parts';

/** One full stride = two steps; a step is the law's own segment.
 *  Read from MOVEMENT — never restated as a literal here. */
export const STRIDE_PERIOD_MS = 2 * MOVEMENT.SEGMENT.STEP_BOB_MS;

/** Delay before the first stride after the cycle engages: the
 *  SEGMENT pose transition into the base pose plays first (the
 *  work cycle's start beat, same law constant). */
export const STRIDE_START_DELAY_MS = MOVEMENT.SEGMENT.STEP_BOB_MS;

/** One gait's choreography, as data. Angles are pose-delta degrees
 *  in the parts rig's skeleton frame; phases are fractions of the
 *  leg's own cycle. */
export interface StrideSpec {
  /** Registry key — data identity, not a code branch. */
  id: string;
  /** Peak thigh swing, degrees — each leg, counter-phased. Lives
   *  under the measured knee-skirt ceiling (see header). */
  thighSwingDeg: number;
  /** Peak knee bend past the stance line, degrees, reached at the
   *  middle of the swing-through. */
  kneeBendDeg: number;
  /** Phase offset of the bend envelope's centre, as a fraction of
   *  the leg's cycle (0 = the envelope centres exactly at the
   *  passing point, half a cycle from toe-off symmetry). */
  kneeBendPhase: number;
  /** Peak sole-lift assist, px: the knee seat raises by this much
   *  at full bend, on top of the lift the bent knee's geometry
   *  already produces — at stage scale it reads as the foot
   *  clearing the ground rather than skimming it. */
  soleLiftPx: number;
  /** Torso bob depth, px — the body rises at each passing point
   *  and settles between steps (two rises per stride). */
  bobPx: number;
  /** Torso counter-rotation against the front leg's swing,
   *  degrees — the shoulders sway opposite the hips' line. */
  torsoCounterDeg: number;
  /** Head counter-rotation ratio of the torso's (the head steadies
   *  against the sway). */
  headRatio: number;
  /** Engagement-envelope start delay, ms: how long after the
   *  cycle engages before amplitude leaves 0. Reads MOVEMENT's
   *  SEGMENT start beat by default (see strideEnvelopeStartMs) —
   *  a spec carries a value only to depart from the law's beat. */
  envelopeStartDelayMs?: number;
  /** Engagement-envelope ramp, ms: amplitude 0→1 across this span
   *  once the start delay passes. Defaults to one stride period
   *  (see strideEnvelopeRampMs). The travel beat's window is the
   *  850ms walk-in: at the shipped defaults (320 + 640) the
   *  envelope peaked at 0.784 inside it — the M2b reservation the
   *  animation fix iteration closes by giving the travel gait its
   *  own envelope row (below), not by retiming the law. */
  envelopeRampMs?: number;
}

/**
 * The gait registry — THE data surface of the stride. Add a row to
 * teach a new gait its motion; the sampler, the actor, and the
 * stages execute any row unchanged.
 *
 * - stride: the roaming hunter's travel gait. Measured amplitudes
 *   (see header): 6.5° thigh swing — the largest that holds the
 *   joint gates at every graded phase on current sprites — 26°
 *   knee bend (chosen for read at 163px, a deep enough fold that
 *   the boot visibly tucks under the knee at passing), a 3px lift
 *   assist, a shallow 1.6px bob, and NO torso counter-rotation
 *   (the hip fringe thins too fast — the field is data, the
 *   value is 0).
 */
export const STRIDE_SPECS: Record<string, StrideSpec> = {
  stride: {
    id: 'stride',
    thighSwingDeg: 6.5,
    kneeBendDeg: 26,
    kneeBendPhase: 0,
    soleLiftPx: 3,
    bobPx: 1.6,
    torsoCounterDeg: 0,
    headRatio: 0.5,
  },
  /**
   * The travel gait (Motion M2b's advance): the stride row's leg
   * amplitudes VERBATIM — the pan sync derives from the same swing
   * (strideGroundSpeedPxS), so the legs may not diverge — with its
   * own engagement envelope: no start delay, and the ramp
   * completes at 600ms, inside the 850ms advance window, so the
   * stride reaches FULL amplitude before arrival (the criterion-5
   * fix, animation fix iteration 2026-11-10; the window, the
   * period, and every leg amplitude are unchanged — only WHEN the
   * envelope saturates moved). The settle still decays across one
   * period from wherever the envelope stands.
   */
  travelStride: {
    id: 'travelStride',
    thighSwingDeg: 6.5,
    kneeBendDeg: 26,
    kneeBendPhase: 0,
    soleLiftPx: 3,
    bobPx: 1.6,
    torsoCounterDeg: 0,
    headRatio: 0.5,
    envelopeStartDelayMs: 0,
    envelopeRampMs: 600,
  },
};

/** The spec's engagement-envelope start delay (default: the
 *  SEGMENT start beat — the pose transition into the travel
 *  stance plays first, the shipped M2a semantics). */
export function strideEnvelopeStartMs(spec: StrideSpec): number {
  return spec.envelopeStartDelayMs ?? STRIDE_START_DELAY_MS;
}

/** The spec's engagement-envelope ramp (default: one period). */
export function strideEnvelopeRampMs(spec: StrideSpec): number {
  return spec.envelopeRampMs ?? STRIDE_PERIOD_MS;
}

/** The engagement envelope at stride-local time `tMs` (the clock
 *  sampleStride consumes: 0 at the engage instant): 0 through the
 *  start delay, then a LINEAR ramp across the ramp span — the one
 *  envelope both stride executions (the travel tracker and the
 *  DOM actor) and the anim-replay metrics share, so the amplitude
 *  a run reports is the amplitude the specs define. */
export function strideEnvelopeAt(spec: StrideSpec, tMs: number): number {
  const start = strideEnvelopeStartMs(spec);
  if (tMs < start) return 0;
  const ramp = strideEnvelopeRampMs(spec);
  return ramp > 0 ? Math.min(1, (tMs - start) / ramp) : 1;
}

/** One sampled instant of a stride. */
export interface StrideFrame {
  /** Cycle phase, 0..1 (one full stride = two steps). */
  phase: number;
  /** Pose deltas to compose onto the base pose, already scaled by
   *  amplitude. Legs + torso + head only — never arms. */
  poseDelta: PartPose;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The knee-bend envelope over a leg's own cycle: 0 through the
 *  stance sweep, rising after toe-off (u = 0.25) to full bend at
 *  the passing point (u = 0.5), released by plant (u = 0.75).
 *  A raised cosine — the same smooth family the work cycle's
 *  envelopes use — never a corner. */
function bendEnvelope(u: number, phaseOffset: number): number {
  const shifted = (((u - phaseOffset) % 1) + 1) % 1;
  return Math.max(0, -Math.cos(TAU * shifted));
}

/** One leg's channels at its local phase u. Sign law (skeleton
 *  frame, hunter facing +x): positive rotation swings the knee
 *  BACK (−x); the thigh channel is a plain counter-phased sine,
 *  the shin channel cancels the thigh's swing during stance (the
 *  foot stays flat while planted) and adds the bend through the
 *  swing, and the lift channel rides the bend envelope. */
function legChannels(spec: StrideSpec, u: number): { thigh: number; shin: number; lift: number } {
  const thigh = spec.thighSwingDeg * Math.sin(TAU * u);
  const bend = spec.kneeBendDeg * bendEnvelope(u, spec.kneeBendPhase);
  const lift = spec.soleLiftPx * bendEnvelope(u, spec.kneeBendPhase);
  return { thigh, shin: -thigh + bend, lift };
}

/**
 * Sample a stride at phase-local time `tMs` (any real number; the
 * phase wraps on the law-derived period). `amplitude` (0..1) is
 * the engagement ramp the actor drives on start/stop — at 0 every
 * delta is zero and the composed pose is the base pose exactly
 * (rest-pose invariance: the cycle at rest IS the standing pose).
 */
export function sampleStride(spec: StrideSpec, tMs: number, amplitude = 1): StrideFrame {
  const phase = (((tMs % STRIDE_PERIOD_MS) + STRIDE_PERIOD_MS) % STRIDE_PERIOD_MS) / STRIDE_PERIOD_MS;
  const amp = clamp01(amplitude);
  // Linear in amplitude on purpose: a sampled frame is a pure
  // function of (spec, t, amplitude); the engagement easing lives
  // in the actor's ramp, so tests can assert the law directly.
  const f = legChannels(spec, phase);
  const b = legChannels(spec, phase + 0.5);
  const sway = Math.sin(TAU * phase);
  const bob = -spec.bobPx * (0.5 + 0.5 * Math.cos(2 * TAU * phase));
  return {
    phase,
    poseDelta: {
      thighF: { rotate: f.thigh * amp },
      lowerLegF: { rotate: f.shin * amp, y: -f.lift * amp },
      thighB: { rotate: b.thigh * amp },
      lowerLegB: { rotate: b.shin * amp, y: -b.lift * amp },
      torso: { rotate: spec.torsoCounterDeg * sway * amp, y: bob * amp },
      head: { rotate: -spec.torsoCounterDeg * spec.headRatio * sway * amp },
    },
  };
}

/** Compose a sampled frame onto a base pose (the 'roam' pose by
 *  default — the roaming stance the travel beat departs from):
 *  rotations and offsets SUM, exactly like the pose system's own
 *  semantics — the cycle rides the pose, it never replaces it. */
export function composeStridePose(frame: StrideFrame, base: PartPose = PART_POSES.roam): PartPose {
  const out: PartPose = {};
  const slots = new Set([...Object.keys(base), ...Object.keys(frame.poseDelta)]);
  for (const slot of slots) {
    const b = base[slot as keyof PartPose];
    const d = frame.poseDelta[slot as keyof PartPose];
    if (!b && !d) continue;
    out[slot as keyof PartPose] = {
      rotate: (b?.rotate ?? 0) + (d?.rotate ?? 0),
      x: (b?.x ?? 0) + (d?.x ?? 0),
      y: (b?.y ?? 0) + (d?.y ?? 0),
    };
  }
  return out;
}
