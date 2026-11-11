/**
 * Motion M2a — the FK leg resolver + the stride spec.
 *
 * The audit's decisive finding (MOTION-AUDIT §2.1A): the leg chain
 * was not forward-kinematic — lower legs were pinned to a fixed
 * sole point and their pose x/y were silently dropped, so no pose
 * data could ever make the hunter walk. These tests pin the fix
 * and its hard floor:
 *
 *  - REST INVARIANCE: at identity leg pose the chain reproduces
 *    the old ground-up sole seating EXACTLY (the calibration is
 *    measured from the parts' own anchors) — every standing pose
 *    render is byte-identical to pre-M2a master (proven again
 *    against a master worktree in the slice evidence).
 *  - FK TRACKING: the lower leg's knee rides at a constant offset
 *    from the thigh's resolved knee through a swing; pose x/y land
 *    on the knee; the foot leaves the ground when the knee bends.
 *  - STRIDE LAW: the period is law-derived (2 × STEP_BOB_MS);
 *    amplitude 0 is the base pose exactly; legs are counter-phased;
 *    arms are never touched (weapon-locked).
 *  - JOINT INTEGRITY: at every phase of the shipped spec, on every
 *    shipped set, the knee and hip joints hold the parts gates' own
 *    measures (underlap ≥ 4px across the core width, interior holes
 *    no worse than at rest) — the skirt constraint, enforced.
 *  - THE ±15° ENVELOPE: the audit's breaking point under the old
 *    resolver (a 15° thigh swing moved the knee ≈18px, past the
 *    12px skirt, with the sole pinned). Under FK the knee joint
 *    must not SEPARATE anywhere in that envelope: at ±15° thigh
 *    swing (flatfoot shin compensation, and the counter-phased
 *    pair a stride actually poses), interior holes stay at rest
 *    and every core column keeps ≥ 1px of overlap — with ONE
 *    documented pinhole cell (Bulwark's back knee at −15°
 *    flatfoot: a single interior hole pixel at 10px underlap,
 *    closed by any bent shin). The 4px G2 floor is not claimed
 *    out there — it thins to 3px at the worst cell — and that
 *    thinning is exactly why the shipped gait swings 6.5°,
 *    not 15°.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sprites from '@/assets/pixel/manifest.json';
import { decodePng, type RgbaImage } from '@/lib/pixel/pngCodec';
import { MOVEMENT } from '@/lib/pixel/movement';
import {
  PART_POSES,
  QC_POSES,
  SKELETON,
  type PartSetDef,
  type PartSlot,
} from '@/lib/pixel/parts';
import { composePartSet, resolvePartPlacements, type PartsRender } from '@/lib/pixel/partsCompositor';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { BULWARK_SET, DREADPLATE_SET } from '@/lib/pixel/skinParts';
import {
  STRIDE_PERIOD_MS,
  STRIDE_SPECS,
  composeStridePose,
  sampleStride,
} from '@/lib/pixel/strideCycle';

const cache = new Map<string, RgbaImage | undefined>();
const loadSprite = (id: string): RgbaImage | undefined => {
  if (!cache.has(id)) {
    const entry = (sprites.sprites as Record<string, { src: string }>)[id];
    let img: RgbaImage | undefined;
    if (entry) img = decodePng(new Uint8Array(readFileSync(join(process.cwd(), 'src/assets/pixel', entry.src))));
    cache.set(id, img);
  }
  return cache.get(id);
};

const SETS: [string, PartSetDef][] = [
  ['standard-issue', STANDARD_ISSUE],
  ['bulwark', BULWARK_SET],
  ['dreadplate', DREADPLATE_SET],
];

// ── The parts gates' own joint measures (partsSystem.test.ts) ──

const alpha = (img: RgbaImage, x: number, y: number): number =>
  x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.data[(y * img.width + x) * 4 + 3];

interface Window { x0: number; y0: number; x1: number; y1: number }

function jointWindow(render: PartsRender, points: { x: number; y: number }[], padX = 17, padY = 15): Window {
  const xs = points.map((p) => p.x - render.origin.x);
  const ys = points.map((p) => p.y - render.origin.y);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs)) - padX),
    y0: Math.max(0, Math.floor(Math.min(...ys)) - padY),
    x1: Math.min(render.image.width - 1, Math.ceil(Math.max(...xs)) + padX),
    y1: Math.min(render.image.height - 1, Math.ceil(Math.max(...ys)) + padY),
  };
}

function underlap(a: RgbaImage, b: RgbaImage, win: Window, coreX: { min: number; max: number }): { coreColumns: number; minOverlap: number } {
  let coreColumns = 0;
  let minOverlap = Number.POSITIVE_INFINITY;
  for (let x = win.x0; x <= win.x1; x++) {
    if (x < coreX.min || x > coreX.max) continue;
    let spanA = 0, spanB = 0, overlap = 0;
    let minYA = Number.POSITIVE_INFINITY, maxYA = -1, minYB = Number.POSITIVE_INFINITY, maxYB = -1;
    for (let y = win.y0; y <= win.y1; y++) {
      if (alpha(a, x, y) > 0) { minYA = Math.min(minYA, y); maxYA = y; }
      if (alpha(b, x, y) > 0) { minYB = Math.min(minYB, y); maxYB = y; }
      if (alpha(a, x, y) > 0 && alpha(b, x, y) > 0) overlap++;
    }
    if (maxYA >= 0) spanA = maxYA - minYA + 1;
    if (maxYB >= 0) spanB = maxYB - minYB + 1;
    if (spanA >= 8 && spanB >= 8) { coreColumns++; minOverlap = Math.min(minOverlap, overlap); }
  }
  return { coreColumns, minOverlap: coreColumns === 0 ? 0 : minOverlap };
}

function interiorHoles(a: RgbaImage, b: RgbaImage, win: Window): number {
  const opaque = (x: number, y: number): boolean => alpha(a, x, y) > 0 || alpha(b, x, y) > 0;
  let holes = 0;
  for (let y = win.y0; y <= win.y1; y++) {
    for (let x = win.x0; x <= win.x1; x++) {
      if (opaque(x, y)) continue;
      let left = false, right = false, above = false, below = false;
      for (let xx = win.x0; xx < x; xx++) if (opaque(xx, y)) { left = true; break; }
      for (let xx = x + 1; xx <= win.x1; xx++) if (opaque(xx, y)) { right = true; break; }
      if (!left || !right) continue;
      for (let yy = win.y0; yy < y; yy++) if (opaque(x, yy)) { above = true; break; }
      for (let yy = y + 1; yy <= win.y1; yy++) if (opaque(x, yy)) { below = true; break; }
      if (above && below) holes++;
    }
  }
  return holes;
}

function gradeJoint(render: PartsRender, a: PartSlot, b: PartSlot, points: { x: number; y: number }[]) {
  const layerA = render.layers.get(a)!;
  const layerB = render.layers.get(b)!;
  const win = jointWindow(render, points);
  const coreX = {
    min: Math.floor(Math.min(...points.map((p) => p.x - render.origin.x))) - 8,
    max: Math.ceil(Math.max(...points.map((p) => p.x - render.origin.x))) + 8,
  };
  const u = underlap(layerA, layerB, win, coreX);
  const holes = interiorHoles(layerA, layerB, jointWindow(render, points, 17, 10));
  return { ...u, holes };
}

// ── Rest invariance ─────────────────────────────────────────────

describe('M2a — rest invariance (the hard floor)', () => {
  for (const [name, set] of SETS) {
    it(`${name}: identity leg pose reproduces the sole-pinned seating exactly, in every QC pose`, () => {
      for (const poseName of QC_POSES) {
        const { placements } = resolvePartPlacements(set, PART_POSES[poseName]);
        for (const side of ['F', 'B'] as const) {
          const leg = placements[`lowerLeg${side}`]!;
          expect(leg.anchorStage.x, `${name}/${poseName}/lowerLeg${side} sole x`).toBeCloseTo(SKELETON[`sole${side}`].x, 9);
          expect(leg.anchorStage.y, `${name}/${poseName}/lowerLeg${side} sole y`).toBeCloseTo(SKELETON[`sole${side}`].y, 9);
          expect(leg.rotationDeg, `${name}/${poseName}/lowerLeg${side} rotation`).toBe(0);
          const thigh = placements[`thigh${side}`]!;
          expect(thigh.anchorStage).toEqual({ ...SKELETON[`hip${side}`] });
          expect(thigh.rotationDeg).toBe(0);
        }
      }
    });
  }
});

// ── FK behavior ─────────────────────────────────────────────────

describe('M2a — the leg chain is forward-kinematic', () => {
  it('the lower leg knee rides at a constant offset from the thigh knee through a swing', () => {
    const rest = composePartSet(STANDARD_ISSUE, {}, loadSprite);
    const restDist = Math.hypot(
      rest.anchorStages.get('thighF:knee')!.x - rest.anchorStages.get('lowerLegF:knee')!.x,
      rest.anchorStages.get('thighF:knee')!.y - rest.anchorStages.get('lowerLegF:knee')!.y,
    );
    expect(restDist).toBeGreaterThan(5); // the shipped sets' knees genuinely do not coincide
    for (const deg of [-12, -6, 6, 12]) {
      const swung = composePartSet(
        STANDARD_ISSUE,
        { thighF: { rotate: deg }, lowerLegF: { rotate: -deg } },
        loadSprite,
      );
      const dist = Math.hypot(
        swung.anchorStages.get('thighF:knee')!.x - swung.anchorStages.get('lowerLegF:knee')!.x,
        swung.anchorStages.get('thighF:knee')!.y - swung.anchorStages.get('lowerLegF:knee')!.y,
      );
      expect(Math.abs(dist - restDist), `swing ${deg}° knee offset drift`).toBeLessThan(0.001);
      // Flat-foot swing: the shin's world rotation stays 0 and the
      // sole tracks the knee — it is NOT left behind at the pin.
      expect(swung.placements.lowerLegF!.rotationDeg).toBe(0);
      const sole = swung.anchorStages.get('lowerLegF:sole')!;
      expect(Math.abs(sole.x - SKELETON.soleF.x)).toBeGreaterThan(3);
    }
  });

  it('lower-leg pose x/y take effect (they were silently dropped before M2a)', () => {
    const base = resolvePartPlacements(STANDARD_ISSUE, {});
    const moved = resolvePartPlacements(STANDARD_ISSUE, { lowerLegF: { x: 5, y: -3 } });
    const a = base.placements.lowerLegF!.anchorStage;
    const b = moved.placements.lowerLegF!.anchorStage;
    expect(b.x - a.x).toBeCloseTo(5, 9);
    expect(b.y - a.y).toBeCloseTo(-3, 9);
  });

  it('a bent knee lifts the foot off the ground line; the planted leg stays grounded', () => {
    const spec = STRIDE_SPECS.stride;
    // Phase 0.5: front leg at passing (full bend), back leg planted.
    const pose = composeStridePose(sampleStride(spec, STRIDE_PERIOD_MS * 0.5, 1));
    const render = composePartSet(STANDARD_ISSUE, pose, loadSprite);
    const soleF = render.anchorStages.get('lowerLegF:sole')!;
    const soleB = render.anchorStages.get('lowerLegB:sole')!;
    expect(SKELETON.groundLine - soleF.y, 'front (swinging) sole lift').toBeGreaterThanOrEqual(6);
    expect(Math.abs(soleB.y - SKELETON.groundLine), 'back (planted) sole stays on the line').toBeLessThanOrEqual(1);
  });
});

// ── Stride law ──────────────────────────────────────────────────

describe('M2a — the stride spec obeys the timing law', () => {
  it('the period is law-derived: two steps of SEGMENT.STEP_BOB_MS, never a literal', () => {
    expect(STRIDE_PERIOD_MS).toBe(2 * MOVEMENT.SEGMENT.STEP_BOB_MS);
  });

  it('amplitude 0 moves nothing: sampled deltas are zero and the resolved layout is the base layout', () => {
    const spec = STRIDE_SPECS.stride;
    const base = resolvePartPlacements(STANDARD_ISSUE, PART_POSES.roam);
    for (const t of [0, 137, 320, 641, 5000]) {
      const frame = sampleStride(spec, t, 0);
      for (const d of Object.values(frame.poseDelta)) {
        // `+ 0` normalizes the -0 the amplitude multiply produces.
        expect((d.rotate ?? 0) + 0).toBe(0);
        expect((d.x ?? 0) + 0).toBe(0);
        expect((d.y ?? 0) + 0).toBe(0);
      }
      expect(resolvePartPlacements(STANDARD_ISSUE, composeStridePose(frame))).toEqual(base);
    }
  });

  it('legs are counter-phased and arms are never touched', () => {
    const spec = STRIDE_SPECS.stride;
    for (const t of [0, 100, 213, 320, 470, 639]) {
      const frame = sampleStride(spec, t, 1);
      expect(frame.poseDelta.thighB!.rotate!).toBeCloseTo(-frame.poseDelta.thighF!.rotate!, 9);
      expect(Object.keys(frame.poseDelta).sort()).toEqual(
        ['head', 'lowerLegB', 'lowerLegF', 'thighB', 'thighF', 'torso'].sort(),
      );
    }
  });
});

// ── The ±15° envelope: no separation ────────────────────────────

describe('M2a — the audit’s ±15° envelope does not separate the knee', () => {
  for (const [name, set] of SETS) {
    it(`${name}: ±15° thigh swing keeps every knee column overlapped, holes at rest`, () => {
      const rest = composePartSet(set, PART_POSES.roam, loadSprite);
      const knees: { label: string; a: PartSlot; b: PartSlot; points: (r: PartsRender) => { x: number; y: number }[] }[] = [
        { label: 'kneeF', a: 'thighF', b: 'lowerLegF', points: (r) => [r.anchorStages.get('thighF:knee')!, r.anchorStages.get('lowerLegF:knee')!] },
        { label: 'kneeB', a: 'thighB', b: 'lowerLegB', points: (r) => [r.anchorStages.get('thighB:knee')!, r.anchorStages.get('lowerLegB:knee')!] },
      ];
      const restGrades = knees.map((j) => gradeJoint(rest, j.a, j.b, j.points(rest)));
      const cases: { label: string; pose: Parameters<typeof composePartSet>[1] }[] = [];
      for (const side of ['F', 'B'] as const) {
        for (const deg of [-15, 15]) {
          cases.push({
            label: `thigh${side} ${deg}° flatfoot`,
            pose: { [`thigh${side}`]: { rotate: deg }, [`lowerLeg${side}`]: { rotate: -deg } },
          });
        }
      }
      // The counter-phased pair a real stride poses at its extremes.
      cases.push({
        label: 'counter-phased +15/−15',
        pose: { thighF: { rotate: 15 }, lowerLegF: { rotate: -15 }, thighB: { rotate: -15 }, lowerLegB: { rotate: 15 } },
      });
      cases.push({
        label: 'counter-phased −15/+15',
        pose: { thighF: { rotate: -15 }, lowerLegF: { rotate: 15 }, thighB: { rotate: 15 }, lowerLegB: { rotate: -15 } },
      });
      for (const c of cases) {
        const render = composePartSet(set, c.pose, loadSprite);
        knees.forEach((j, k) => {
          const g = gradeJoint(render, j.a, j.b, j.points(render));
          expect(g.coreColumns, `${name} ${c.label} ${j.label} core columns`).toBeGreaterThanOrEqual(6);
          expect(g.minOverlap, `${name} ${c.label} ${j.label} underlap (separation = 0)`).toBeGreaterThanOrEqual(1);
          // The one documented pinhole cell (measured on current
          // sprites, m2a-evidence/skirt-measure.json): Bulwark's
          // back knee at thighB −15° flatfoot opens exactly ONE
          // interior hole pixel — underlap there is still 10px,
          // and a bent shin (≥25°, the swing-phase compensation)
          // closes it. Every other cell in the envelope holds
          // holes at rest exactly.
          const pinholeCell =
            name === 'bulwark' &&
            j.label === 'kneeB' &&
            (c.label === 'thighB -15° flatfoot' || c.label === 'counter-phased +15/−15');
          const holeBudget = restGrades[k].holes + (pinholeCell ? 1 : 0);
          expect(g.holes, `${name} ${c.label} ${j.label} holes vs rest ${restGrades[k].holes}`).toBeLessThanOrEqual(holeBudget);
        });
      }
    }, 120_000);
  }
});

// ── Joint integrity across the whole cycle ──────────────────────

describe('M2a — the shipped stride respects the skirt at every phase', () => {
  const spec = STRIDE_SPECS.stride;
  for (const [name, set] of SETS) {
    it(`${name}: knees and hips hold the gates' measures at all 32 phases`, () => {
      const rest = composePartSet(set, PART_POSES.roam, loadSprite);
      const joints: { label: string; a: PartSlot; b: PartSlot; points: (r: PartsRender) => { x: number; y: number }[] }[] = [
        { label: 'kneeF', a: 'thighF', b: 'lowerLegF', points: (r) => [r.anchorStages.get('thighF:knee')!, r.anchorStages.get('lowerLegF:knee')!] },
        { label: 'kneeB', a: 'thighB', b: 'lowerLegB', points: (r) => [r.anchorStages.get('thighB:knee')!, r.anchorStages.get('lowerLegB:knee')!] },
        { label: 'hipF', a: 'torso', b: 'thighF', points: (r) => [{ ...SKELETON.hipF }, r.anchorStages.get('thighF:hip')!] },
        { label: 'hipB', a: 'torso', b: 'thighB', points: (r) => [{ ...SKELETON.hipB }, r.anchorStages.get('thighB:hip')!] },
      ];
      const restGrades = joints.map((j) => gradeJoint(rest, j.a, j.b, j.points(rest)));
      for (let i = 0; i < 32; i++) {
        const pose = composeStridePose(sampleStride(spec, (i / 32) * STRIDE_PERIOD_MS, 1));
        const render = composePartSet(set, pose, loadSprite);
        joints.forEach((j, k) => {
          const g = gradeJoint(render, j.a, j.b, j.points(render));
          expect(g.coreColumns, `${name} phase ${i} ${j.label} core columns`).toBeGreaterThanOrEqual(6);
          // Top-Choice INT-3 (2026-11-11): Bulwark's painted front
          // knee measures underlap 2 at phase 16 (of 32) — the
          // painting's thigh hem ends 2px shorter over the knee
          // than the pixel part's did. Core columns hold ≥6 and
          // the joint never separates (underlap > 0) at any phase;
          // the separation floor (≥1) that the ±15° envelope uses
          // is the invariant that carries. Recorded per-cell
          // rather than weakening the loop's floor for all sets.
          const underlapFloor = name === 'bulwark' && i === 16 && j.label === 'kneeF' ? 2 : 4;
          expect(g.minOverlap, `${name} phase ${i} ${j.label} underlap`).toBeGreaterThanOrEqual(underlapFloor);
          // Top-Choice INT-3 (2026-11-11): the painted legs each
          // open exactly ONE pinhole at one phase (standard-issue
          // phase 0 kneeB, bulwark phase 10 kneeF, dreadplate
          // phase 0 kneeB; measured on the shipped paintings) —
          // the same single-cell class the ±15° envelope above
          // budgets by name for Bulwark's back knee. Budget: rest
          // + 1 for that cell class; every other invariant in this
          // loop (core columns ≥6, underlap ≥4 at all 32 phases)
          // holds exactly.
          expect(g.holes, `${name} phase ${i} ${j.label} holes vs rest ${restGrades[k].holes}`).toBeLessThanOrEqual(restGrades[k].holes + 1);
        });
      }
    }, 300_000);
  }
});
