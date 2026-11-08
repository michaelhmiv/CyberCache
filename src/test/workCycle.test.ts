/**
 * Work cycle (Motion Reboot M1) — the choreography engine's law
 * tests. The cycle is data (WORK_CYCLE_SPECS) executed by a pure
 * sampler; these tests assert:
 *  - the period IS movement.ts's SEGMENT.WORK_CYCLE_MS (read from
 *    the law module, never a restated literal), and the start
 *    delay IS SEGMENT.STEP_BOB_MS;
 *  - the curve's beats land where each spec's data says (wind-up
 *    peak at liftAt, press at strikeAt, sweep steps walk in
 *    order, glow crests at the strike);
 *  - amplitude scales deltas linearly and zero amplitude is the
 *    held work pose exactly (compose identity);
 *  - the engine executes ANY spec row — a synthetic spec with
 *    invented values samples by its own data, proving no family
 *    is hard-coded (flexibility law, 2026-11-06);
 *  - FX tracks are the sampler tabulated (peaks align), and the
 *    bench scene's node accounting stays inside
 *    MAX_ANIMATED_NODES with parts + embers + rise included.
 */
import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '@/lib/pixel/movement';
import { PART_POSES } from '@/lib/pixel/parts';
import {
  WORK_CYCLE_PERIOD_MS,
  WORK_CYCLE_SPECS,
  WORK_CYCLE_SPEC_BY_MODE,
  WORK_CYCLE_SPEC_BY_SCENE,
  WORK_CYCLE_START_DELAY_MS,
  benchAnimatedNodeCount,
  composeWorkPose,
  sampleWorkCycle,
  workCycleFxNodeCount,
  workCycleFxTracks,
  type WorkCycleSpec,
} from '@/lib/pixel/workCycle';

const ALL_SPECS = Object.values(WORK_CYCLE_SPECS);

describe('work cycle — law anchoring', () => {
  it('the period is SEGMENT.WORK_CYCLE_MS itself (900ms), not a restated value', () => {
    expect(WORK_CYCLE_PERIOD_MS).toBe(MOVEMENT.SEGMENT.WORK_CYCLE_MS);
    expect(WORK_CYCLE_PERIOD_MS).toBe(900);
  });

  it('the start delay is SEGMENT.STEP_BOB_MS (the pose transition plays first)', () => {
    expect(WORK_CYCLE_START_DELAY_MS).toBe(MOVEMENT.SEGMENT.STEP_BOB_MS);
  });

  it('every spec is keyed by its own id and keeps its beats inside the period', () => {
    for (const [key, spec] of Object.entries(WORK_CYCLE_SPECS)) {
      expect(spec.id).toBe(key);
      expect(spec.liftAt).toBeGreaterThan(0);
      expect(spec.liftAt).toBeLessThan(spec.strikeAt);
      expect(spec.strikeAt + spec.holdFrac).toBeLessThan(1);
      expect(spec.glowPeak).toBeGreaterThan(0);
      expect(spec.glowPeak).toBeLessThanOrEqual(1);
    }
  });

  it('the family accents are data: forge/crush/sift spark; only calibration sweeps', () => {
    expect(WORK_CYCLE_SPECS.forge.sparks).not.toBeNull();
    expect(WORK_CYCLE_SPECS.crush.sparks).not.toBeNull();
    // M4a: the sift's burst is grit off the screen — a dust color,
    // not a metal spark — declared in its spec row like any accent.
    expect(WORK_CYCLE_SPECS.sift.sparks).toEqual({ color: '#C9B18C' });
    expect(WORK_CYCLE_SPECS.assembly.sparks).toBeNull();
    expect(WORK_CYCLE_SPECS.calibration.sparks).toBeNull();
    // M4c: the stall has no strike at all — no sparks, no sweep,
    // and the lowest arm amplitude in the registry (tending, not
    // working). Its presence reads through the long hold instead.
    expect(WORK_CYCLE_SPECS.stall.sparks).toBeNull();
    expect(WORK_CYCLE_SPECS.stall.sweepSteps).toBe(0);
    expect(WORK_CYCLE_SPECS.stall.liftDeg).toBeLessThan(WORK_CYCLE_SPECS.calibration.liftDeg);
    expect(WORK_CYCLE_SPECS.stall.holdFrac).toBeGreaterThan(WORK_CYCLE_SPECS.forge.holdFrac);
    expect(WORK_CYCLE_SPECS.calibration.sweepSteps).toBe(3);
    expect(WORK_CYCLE_SPECS.forge.sweepSteps).toBe(0);
    expect(WORK_CYCLE_SPECS.sift.sweepSteps).toBe(0);
  });

  it('mode and scene bindings are data rows naming registry specs', () => {
    expect(WORK_CYCLE_SPEC_BY_MODE).toEqual({
      crafting: 'forge',
      salvaging: 'crush',
      workshopService: 'assembly',
      // M4a supersedes the M1-era pin that extraction never
      // cycles: the site-work variant is a registry row, executed
      // by the same engine (motion audit §2.3 / slice M4a).
      extraction: 'sift',
      // M4c supersedes the M1-era pin that market listing never
      // cycles: the stall variant is a registry row, executed by
      // the same engine (motion audit M4c / slice M4c).
      marketListing: 'stall',
    });
    expect(WORK_CYCLE_SPEC_BY_SCENE).toEqual({
      craftingBench: 'forge',
      repairBay: 'assembly',
      shieldTechBay: 'calibration',
    });
    for (const id of [...Object.values(WORK_CYCLE_SPEC_BY_MODE), ...Object.values(WORK_CYCLE_SPEC_BY_SCENE)]) {
      expect(WORK_CYCLE_SPECS[id]).toBeDefined();
    }
    // Not tenants: roam/boss never cycle.
    expect(WORK_CYCLE_SPEC_BY_MODE.roaming).toBeUndefined();
  });
});

describe('work cycle — the sampler', () => {
  it('is periodic on the law period for every spec', () => {
    for (const spec of ALL_SPECS) {
      for (const t of [0, 137, 405, 720, 899]) {
        const a = sampleWorkCycle(spec, t);
        const b = sampleWorkCycle(spec, t + WORK_CYCLE_PERIOD_MS);
        expect(b.phase).toBeCloseTo(a.phase, 9);
        expect(b.poseDelta.armUpperN?.rotate).toBeCloseTo(a.poseDelta.armUpperN?.rotate ?? 0, 9);
        expect(b.glow).toBeCloseTo(a.glow, 9);
        expect(b.sweepStep).toBe(a.sweepStep);
      }
    }
  });

  it('rests at zero delta at phase 0 and peaks the lift at liftAt', () => {
    for (const spec of ALL_SPECS) {
      const rest = sampleWorkCycle(spec, 0);
      expect(rest.poseDelta.armUpperN?.rotate).toBeCloseTo(0, 9);
      const peak = sampleWorkCycle(spec, spec.liftAt * WORK_CYCLE_PERIOD_MS);
      expect(peak.poseDelta.armUpperN?.rotate).toBeCloseTo(-spec.liftDeg, 6);
    }
  });

  it('lands the press exactly at strikeAt, and the strike envelope fires there', () => {
    for (const spec of ALL_SPECS) {
      const atStrike = sampleWorkCycle(spec, spec.strikeAt * WORK_CYCLE_PERIOD_MS);
      expect(atStrike.poseDelta.armUpperN?.rotate).toBeCloseTo(spec.pressDeg, 6);
      expect(atStrike.strike).toBeCloseTo(1, 9);
      const before = sampleWorkCycle(spec, spec.strikeAt * WORK_CYCLE_PERIOD_MS - 5);
      expect(before.strike).toBe(0);
      const after = sampleWorkCycle(
        spec,
        spec.strikeAt * WORK_CYCLE_PERIOD_MS + MOVEMENT.IMPACT_SPARKS_MS + 5,
      );
      expect(after.strike).toBe(0);
    }
  });

  it('derives the body from the arm: ratios and press weight come from the spec row', () => {
    const spec = WORK_CYCLE_SPECS.crush;
    const atStrike = sampleWorkCycle(spec, spec.strikeAt * WORK_CYCLE_PERIOD_MS);
    expect(atStrike.poseDelta.armForeN?.rotate).toBeCloseTo(spec.pressDeg * spec.foreRatio, 6);
    expect(atStrike.poseDelta.armFar?.rotate).toBeCloseTo(spec.pressDeg * spec.farArmRatio, 6);
    expect(atStrike.poseDelta.torso?.rotate).toBeCloseTo(spec.pressDeg * spec.torsoRatio, 6);
    expect(atStrike.poseDelta.torso?.y).toBeCloseTo(spec.pressUnits, 6);
  });

  it('amplitude scales deltas linearly; zero amplitude is stillness', () => {
    const spec = WORK_CYCLE_SPECS.forge;
    const t = 500;
    const full = sampleWorkCycle(spec, t, 1);
    const half = sampleWorkCycle(spec, t, 0.5);
    expect(half.poseDelta.armUpperN?.rotate).toBeCloseTo((full.poseDelta.armUpperN?.rotate ?? 0) * 0.5, 9);
    expect(half.glow).toBeCloseTo(full.glow * 0.5, 9);
    const zero = sampleWorkCycle(spec, t, 0);
    expect(zero.poseDelta.armUpperN?.rotate).toBe(0);
    expect(zero.poseDelta.torso?.y).toBe(0);
    expect(zero.glow).toBe(0);
  });

  it('compose at zero amplitude returns the base work pose untouched', () => {
    const composed = composeWorkPose(sampleWorkCycle(WORK_CYCLE_SPECS.forge, 333, 0));
    for (const [slot, transform] of Object.entries(PART_POSES.work)) {
      expect(composed[slot as keyof typeof composed]?.rotate).toBeCloseTo(transform?.rotate ?? 0, 9);
      expect(composed[slot as keyof typeof composed]?.y).toBeCloseTo(transform?.y ?? 0, 9);
    }
  });

  it('compose sums the press onto the work pose at the strike', () => {
    const spec = WORK_CYCLE_SPECS.forge;
    const composed = composeWorkPose(sampleWorkCycle(spec, spec.strikeAt * WORK_CYCLE_PERIOD_MS));
    expect(composed.armUpperN?.rotate).toBeCloseTo((PART_POSES.work.armUpperN?.rotate ?? 0) + spec.pressDeg, 6);
  });

  it('the calibration sweep walks its steps in order; other families never sweep', () => {
    const cal = WORK_CYCLE_SPECS.calibration;
    expect(sampleWorkCycle(cal, 10).sweepStep).toBe(0);
    expect(sampleWorkCycle(cal, 450).sweepStep).toBe(1);
    expect(sampleWorkCycle(cal, 890).sweepStep).toBe(2);
    expect(sampleWorkCycle(WORK_CYCLE_SPECS.forge, 450).sweepStep).toBe(-1);
  });

  it('glow crests at the strike at the spec peak', () => {
    for (const spec of ALL_SPECS) {
      const atStrike = sampleWorkCycle(spec, spec.strikeAt * WORK_CYCLE_PERIOD_MS);
      expect(atStrike.glow).toBeCloseTo(spec.glowPeak, 6);
      const atRest = sampleWorkCycle(spec, 0);
      expect(atRest.glow).toBeCloseTo(spec.glowPeak * 0.35, 6);
    }
  });

  it('executes a synthetic spec by its own data — no family is hard-coded', () => {
    const synthetic: WorkCycleSpec = {
      ...WORK_CYCLE_SPECS.forge,
      id: 'synthetic',
      liftAt: 0.2,
      strikeAt: 0.6,
      holdFrac: 0.05,
      liftDeg: 30,
      pressDeg: 12,
    };
    expect(sampleWorkCycle(synthetic, 0.2 * WORK_CYCLE_PERIOD_MS).poseDelta.armUpperN?.rotate).toBeCloseTo(-30, 6);
    expect(sampleWorkCycle(synthetic, 0.6 * WORK_CYCLE_PERIOD_MS).poseDelta.armUpperN?.rotate).toBeCloseTo(12, 6);
    // The forge row is unmoved by the synthetic row's existence.
    expect(sampleWorkCycle(WORK_CYCLE_SPECS.forge, 0.2 * WORK_CYCLE_PERIOD_MS).poseDelta.armUpperN?.rotate)
      .not.toBeCloseTo(-30, 3);
  });
});

describe('work cycle — FX tracks and node budget', () => {
  it('tracks tabulate the sampler: 33 keys across the period', () => {
    for (const spec of ALL_SPECS) {
      const tracks = workCycleFxTracks(spec);
      expect(tracks.times).toHaveLength(33);
      expect(tracks.times[0]).toBe(0);
      expect(tracks.times[32]).toBe(1);
      expect(tracks.glow).toHaveLength(33);
      expect(Math.max(...tracks.glow)).toBeGreaterThan(spec.glowPeak * 0.9);
    }
  });

  it('spark tracks fire only for sparking families; the sweep tracks walk', () => {
    expect(Math.max(...workCycleFxTracks(WORK_CYCLE_SPECS.forge).sparkOpacity)).toBeGreaterThan(0.9);
    expect(Math.max(...workCycleFxTracks(WORK_CYCLE_SPECS.assembly).sparkOpacity)).toBe(0);
    const sweep = workCycleFxTracks(WORK_CYCLE_SPECS.calibration).sweepOpacity;
    expect(sweep).toHaveLength(3);
    for (const step of sweep) expect(Math.max(...step)).toBeCloseTo(0.95, 6);
    expect(workCycleFxTracks(WORK_CYCLE_SPECS.forge).sweepOpacity).toHaveLength(0);
  });

  it('a full bench scene stays inside MAX_ANIMATED_NODES for every family', () => {
    for (const spec of ALL_SPECS) {
      const total = benchAnimatedNodeCount({
        partCount: 13, // every slot of the parts rig
        setPieceNodes: 0, // bench set pieces render breathe={false} — static
        spec,
        embers: MOVEMENT.EMBER_COUNT,
        completionRise: true,
      });
      expect(total).toBeLessThanOrEqual(MOVEMENT.SEGMENT.MAX_ANIMATED_NODES);
    }
    expect(workCycleFxNodeCount(WORK_CYCLE_SPECS.calibration)).toBe(4); // glow + 3 sweep dots
    expect(workCycleFxNodeCount(WORK_CYCLE_SPECS.forge)).toBe(2); // glow + spark burst
    expect(workCycleFxNodeCount(WORK_CYCLE_SPECS.assembly)).toBe(1); // glow only
  });
});
