/**
 * Work-cycle choreography — Motion Reboot M1 (owner rulings
 * 2026-11-06, brief `motion-reboot-2026-11-06.md`).
 *
 * ONE engine, data-driven: a work cycle is a choreography SPEC —
 * declared data keyed by id in WORK_CYCLE_SPECS — and this module
 * only ever samples specs. Per-family feel (forge strikes, crusher
 * presses, assembly fits, calibration sweeps) lives in the spec
 * rows, never in code paths: a future family, activity, or custom
 * gear shape plugs in by ADDING a spec row (and, for a Home-stage
 * mode, one row in WORK_CYCLE_SPEC_BY_MODE). Hard-coding a family's
 * motion into the engine fails review (flexibility law,
 * 2026-11-06).
 *
 * The period is law, not data: every cycle runs on movement.ts's
 * SEGMENT.WORK_CYCLE_MS (900ms) read from MOVEMENT — specs carry no
 * period field, so nothing here can invent a timing. The start beat
 * is SEGMENT.STEP_BOB_MS (the pose-transition segment): the actor
 * settles into the work pose on the law's own timing before the
 * first cycle begins. Pure functions of (spec, phase-local time):
 * no clocks, no DOM — the timing conformance tests assert the law
 * directly against these samplers, in the pixiChoreography pattern.
 *
 * Node budget: the cycle's set-piece FX (glow + spark burst +
 * sweep steps, see BenchFx) plus one completion rise are counted
 * by benchAnimatedNodeCount; a bench scene stays inside
 * MOVEMENT.SEGMENT.MAX_ANIMATED_NODES with the parts actor and the
 * diorama's ambient embers included.
 */
import { MOVEMENT } from './movement';
import { PART_POSES, type PartPose } from './parts';
import { EASE } from './pixiChoreography';

/** The one period every work cycle runs on — movement law, read
 *  from the law module, never restated as a literal here. */
export const WORK_CYCLE_PERIOD_MS = MOVEMENT.SEGMENT.WORK_CYCLE_MS;

/** Delay before the first cycle after a bench mode engages: the
 *  SEGMENT pose transition into the work pose plays first (the
 *  brief's start beat). movement law, read from the law module. */
export const WORK_CYCLE_START_DELAY_MS = MOVEMENT.SEGMENT.STEP_BOB_MS;

/** One family's choreography, as data. All angles are pose-delta
 *  degrees in the parts rig's skeleton frame; all fractions are
 *  fractions of the shared 900ms period. */
export interface WorkCycleSpec {
  /** Registry key — data identity, not a code branch. */
  id: string;
  /** Fraction of the period where the wind-up peaks (arm fully
   *  lifted, before the drive down). */
  liftAt: number;
  /** Fraction where the drive lands (the strike / fit / press). */
  strikeAt: number;
  /** Fraction of the period spent holding the press after the
   *  strike lands, before the release (assembly's fit pause). */
  holdFrac: number;
  /** Arm lift at the wind-up peak, degrees (delta from work pose). */
  liftDeg: number;
  /** Arm press past the work pose at the strike, degrees. */
  pressDeg: number;
  /** Forearm amplification of the arm delta. */
  foreRatio: number;
  /** Far-arm follow-through ratio of the arm delta. */
  farArmRatio: number;
  /** Torso follow-through ratio of the arm delta. */
  torsoRatio: number;
  /** Head follow-through ratio of the arm delta. */
  headRatio: number;
  /** Skeleton-frame y the torso sinks at full press (the strike's
   *  weight). The wind-up rise is half this, opposite sign. */
  pressUnits: number;
  /** Spark burst at the strike, or null for families whose work
   *  has no impact (assembly fits, calibration sweeps). */
  sparks: { color: string } | null;
  /** Set-piece glow color at the work point. */
  glowColor: string;
  /** Peak glow opacity (0..1) at the strike. */
  glowPeak: number;
  /** Number of sweep steps the cycle walks (calibration's arc
   *  positions); 0 = no sweep for this family. */
  sweepSteps: number;
}

/**
 * The family registry — THE data surface of the work cycle. Add a
 * row to teach a new family its motion; the engine, the actor,
 * and the FX kit execute any row unchanged.
 *
 * - forge: the crafting bench. A real strike: high lift, fast
 *   drive, a spark burst and the forge glow peaking at impact.
 * - crush: the salvage refinery. Heavier and slower-feeling at
 *   the same 900ms: lower lift, deeper press, longer hold, a
 *   dull debris burst.
 * - assembly: workshop service (repair bay). No strike at all —
 *   a low lift and a long fit pause; no sparks, a cool work light.
 * - calibration: the shield-tech rig. Delicate small motions and
 *   a three-step sweep around the rig; no sparks, violet glow.
 */
export const WORK_CYCLE_SPECS: Record<string, WorkCycleSpec> = {
  forge: {
    id: 'forge',
    liftAt: 0.30,
    strikeAt: 0.45,
    holdFrac: 0.08,
    liftDeg: 16,
    pressDeg: 7,
    foreRatio: 1.15,
    farArmRatio: 0.55,
    torsoRatio: 0.28,
    headRatio: 0.35,
    pressUnits: 1.1,
    sparks: { color: '#FFC65C' },
    glowColor: '#FF8A3C',
    glowPeak: 0.5,
    sweepSteps: 0,
  },
  crush: {
    id: 'crush',
    liftAt: 0.32,
    strikeAt: 0.50,
    holdFrac: 0.12,
    liftDeg: 11,
    pressDeg: 10,
    foreRatio: 1.05,
    farArmRatio: 0.5,
    torsoRatio: 0.34,
    headRatio: 0.3,
    pressUnits: 1.5,
    sparks: { color: '#D8D3C8' },
    glowColor: '#B8C4D4',
    glowPeak: 0.25,
    sweepSteps: 0,
  },
  assembly: {
    id: 'assembly',
    liftAt: 0.34,
    strikeAt: 0.55,
    holdFrac: 0.30,
    liftDeg: 9,
    pressDeg: 4,
    foreRatio: 0.9,
    farArmRatio: 0.6,
    torsoRatio: 0.2,
    headRatio: 0.4,
    pressUnits: 0.7,
    sparks: null,
    glowColor: '#7DD3FC',
    glowPeak: 0.18,
    sweepSteps: 0,
  },
  calibration: {
    id: 'calibration',
    liftAt: 0.30,
    strikeAt: 0.50,
    holdFrac: 0.10,
    liftDeg: 6,
    pressDeg: 2,
    foreRatio: 0.85,
    farArmRatio: 0.45,
    torsoRatio: 0.15,
    headRatio: 0.3,
    pressUnits: 0.4,
    sparks: null,
    glowColor: '#A78BFA',
    glowPeak: 0.35,
    sweepSteps: 3,
  },
};

/**
 * Home-stage mode → choreography spec id, as data. Modes absent
 * here are not work-cycle tenants (roam, boss, extraction, market
 * listing — the listing's low-amplitude cycle is M4's tenant).
 */
export const WORK_CYCLE_SPEC_BY_MODE: Record<string, string> = {
  crafting: 'forge',
  salvaging: 'crush',
  workshopService: 'assembly',
};

/**
 * Panel bay scene → choreography spec id, as data (the same
 * families, bound to the workshop's own rooms). The shield-tech
 * bay runs the calibration family — its own accent, not the
 * repair bay's assembly fit.
 */
export const WORK_CYCLE_SPEC_BY_SCENE: Record<string, string> = {
  craftingBench: 'forge',
  repairBay: 'assembly',
  shieldTechBay: 'calibration',
};

/** One sampled instant of a cycle. */
export interface WorkCycleFrame {
  /** Cycle phase, 0..1. */
  phase: number;
  /** Pose deltas to compose onto the work pose (degrees / frame
   *  units), already scaled by amplitude. */
  poseDelta: PartPose;
  /** Strike envelope: 1 at the strike instant, decaying across
   *  IMPACT_SPARKS_MS; 0 before the strike. */
  strike: number;
  /** Glow intensity at the work point, 0..spec.glowPeak. */
  glow: number;
  /** Active sweep step (-1 when the family has no sweep). */
  sweepStep: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The arm's rotation delta across the cycle — the curve every
 * other channel derives from:
 *   wind-up  [0, liftAt)          0 → −liftDeg (easeInOut)
 *   drive    [liftAt, strikeAt)   −liftDeg → +pressDeg (easeIn —
 *                                 the strike accelerates in)
 *   hold     [strikeAt, +hold)    press, settling to 75%
 *   release  [+hold, 1)           back to 0 (easeInOut)
 */
function armDeltaAt(spec: WorkCycleSpec, p: number): number {
  const { liftAt, strikeAt, holdFrac, liftDeg, pressDeg } = spec;
  if (p < liftAt) {
    return -liftDeg * EASE.easeInOut(clamp01(p / liftAt));
  }
  if (p < strikeAt) {
    const u = clamp01((p - liftAt) / Math.max(1e-6, strikeAt - liftAt));
    return -liftDeg + (liftDeg + pressDeg) * EASE.easeIn(u);
  }
  const holdEnd = strikeAt + holdFrac;
  if (p < holdEnd) {
    const u = clamp01((p - strikeAt) / Math.max(1e-6, holdFrac));
    return pressDeg * (1 - 0.25 * u);
  }
  const u = clamp01((p - holdEnd) / Math.max(1e-6, 1 - holdEnd));
  return pressDeg * 0.75 * (1 - EASE.easeInOut(u));
}

/** Glow envelope shape (pre-peak): brightens through the wind-up,
 *  crests at the strike, cools through the hold and release. */
function glowShapeAt(spec: WorkCycleSpec, p: number): number {
  const { liftAt, strikeAt, holdFrac } = spec;
  if (p < liftAt) return 0.35 + 0.4 * clamp01(p / liftAt);
  if (p < strikeAt) {
    const u = clamp01((p - liftAt) / Math.max(1e-6, strikeAt - liftAt));
    return 0.75 + 0.25 * u;
  }
  const holdEnd = strikeAt + holdFrac;
  if (p < holdEnd) {
    const u = clamp01((p - strikeAt) / Math.max(1e-6, holdFrac));
    return 1 - 0.3 * u;
  }
  const u = clamp01((p - holdEnd) / Math.max(1e-6, 1 - holdEnd));
  return 0.7 - 0.5 * u;
}

/**
 * Sample a cycle at phase-local time `tMs` (any real number; the
 * phase wraps on the law period). `amplitude` (0..1) is the
 * engagement ramp the actor drives on start/stop — at 0 every
 * delta is zero and the composed pose is the held work pose.
 */
export function sampleWorkCycle(spec: WorkCycleSpec, tMs: number, amplitude = 1): WorkCycleFrame {
  const period = WORK_CYCLE_PERIOD_MS;
  const phase = (((tMs % period) + period) % period) / period;
  const arm = armDeltaAt(spec, phase) * amplitude;
  const liftAmt = spec.liftDeg > 0 ? clamp01(-arm / spec.liftDeg) : 0;
  const pressAmt = spec.pressDeg > 0 ? clamp01(arm / spec.pressDeg) : 0;
  const pressY = spec.pressUnits * pressAmt - spec.pressUnits * 0.5 * liftAmt;

  const sparksWindow = MOVEMENT.IMPACT_SPARKS_MS / period;
  const strike = phase < spec.strikeAt
    ? 0
    : Math.max(0, 1 - (phase - spec.strikeAt) / sparksWindow);

  return {
    phase,
    poseDelta: {
      armUpperN: { rotate: arm },
      armForeN: { rotate: arm * spec.foreRatio },
      armFar: { rotate: arm * spec.farArmRatio },
      torso: { rotate: arm * spec.torsoRatio, y: pressY },
      head: { rotate: arm * spec.headRatio, y: pressY * 0.5 },
    },
    strike,
    glow: spec.glowPeak * glowShapeAt(spec, phase) * amplitude,
    sweepStep: spec.sweepSteps > 0
      ? Math.min(spec.sweepSteps - 1, Math.floor(phase * spec.sweepSteps))
      : -1,
  };
}

/** Compose a sampled frame onto a base pose (the work pose by
 *  default): rotations and offsets SUM, exactly like the pose
 *  system's own semantics — the cycle rides the pose the SEGMENT
 *  transition delivered, it never replaces it. */
export function composeWorkPose(frame: WorkCycleFrame, base: PartPose = PART_POSES.work): PartPose {
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

// ── Set-piece FX tracks (BenchFx) ─────────────────────────────────

/** Keyframe tracks for one cycle's set-piece FX, DERIVED by
 *  sampling sampleWorkCycle — the FX can never drift from the
 *  sampler's timing because they are the sampler, tabulated.
 *  Framer loops these at the law period with linear easing (the
 *  sampled points already encode the curves). */
export interface WorkCycleFxTracks {
  times: number[];
  /** Glow opacity keys (0..spec.glowPeak). */
  glow: number[];
  /** Spark burst opacity keys (the strike envelope; all-zero for
   *  sparking-less families). */
  sparkOpacity: number[];
  /** Spark burst scale keys — the burst expands as it fades. */
  sparkScale: number[];
  /** Per-step sweep dot opacities: [step][key]. Empty when the
   *  family has no sweep. */
  sweepOpacity: number[][];
}

const FX_SAMPLES = 32;

export function workCycleFxTracks(spec: WorkCycleSpec): WorkCycleFxTracks {
  const times: number[] = [];
  const glow: number[] = [];
  const sparkOpacity: number[] = [];
  const sparkScale: number[] = [];
  const sweepOpacity: number[][] = Array.from({ length: spec.sweepSteps }, () => []);
  for (let i = 0; i <= FX_SAMPLES; i += 1) {
    const tMs = (i / FX_SAMPLES) * WORK_CYCLE_PERIOD_MS;
    const frame = sampleWorkCycle(spec, tMs);
    times.push(i / FX_SAMPLES);
    glow.push(frame.glow);
    sparkOpacity.push(spec.sparks ? frame.strike : 0);
    sparkScale.push(0.6 + 0.7 * (1 - frame.strike));
    for (let s = 0; s < spec.sweepSteps; s += 1) {
      sweepOpacity[s].push(frame.sweepStep === s ? 0.95 : 0.14);
    }
  }
  return { times, glow, sparkOpacity, sparkScale, sweepOpacity };
}

// ── Node budget ───────────────────────────────────────────────────

/** Animated nodes the cycle's set-piece FX add: glow (1) + spark
 *  burst (1 when the family sparks, else 0) + sweep dots (one per
 *  step). */
export function workCycleFxNodeCount(spec: WorkCycleSpec): number {
  return 1 + (spec.sparks ? 1 : 0) + spec.sweepSteps;
}

/**
 * Total animated nodes on a bench scene: the parts actor's visible
 * parts + the set piece's own motion + the cycle FX + the
 * completion rise + ambient embers (diorama scenes). Asserted
 * against MOVEMENT.SEGMENT.MAX_ANIMATED_NODES in the tests.
 */
export function benchAnimatedNodeCount(input: {
  partCount: number;
  setPieceNodes: number;
  spec: WorkCycleSpec;
  embers: number;
  completionRise: boolean;
}): number {
  return input.partCount
    + input.setPieceNodes
    + workCycleFxNodeCount(input.spec)
    + input.embers
    + (input.completionRise ? 1 : 0);
}
