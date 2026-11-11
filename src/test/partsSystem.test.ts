/**
 * Parts-system QC gates (character-parts-system SPEC §9, M1).
 *
 *  G1  composition accounting: every pixel in the composite is
 *      accounted for by a declared part layer — there is no base
 *      sprite and no fallback — and an overridden slot contributes
 *      ZERO pixels of the stock part it replaced.
 *  G2  underlap (J3/J7): per-column overlap of the two parts at each
 *      joint ≥ 4 px across the joint's core width, in every QC pose;
 *      the back part overlaps the torso by ≥ 200 px² at rest (J7).
 *  G3  joint integrity: interior-hole counts at each joint (see
 *      interiorHoles — the count restricted to pixels the joint's
 *      mass actually encloses) never exceed the legacy baseline
 *      counts under identical measurement (baseline-relative).
 *  G4  ground truth (J5): sole anchors and boot bottoms stay on the
 *      ground line in every QC pose.
 *  G5  grip coincidence: the forearm's gripHand anchor and the
 *      weapon's grip point coincide at the resolved grip joint, for
 *      a short weapon (pistol) and a long one (sniper).
 *  G6  is the human read of the proof render — an agent duty, not a
 *      test (SPEC §9); the render-composition smoke test below keeps
 *      the set honest between reads.
 *
 * The legacy baseline was the shipped HUNTER_RIG built as a part
 * set (each segment crop a part, anchors from frame/pivot geometry).
 * M2 deleted the rig and its art, so the baseline is FROZEN:
 * FROZEN_LEGACY_HOLES / FROZEN_LEGACY_IDLE_OPAQUE below were measured
 * with this file's own measurement code against the pre-deletion
 * tree (2026-11-02, master 09149f6 + the M2 pose set), and the gates
 * now assert the live set never exceeds the frozen counts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sprites from '@/assets/pixel/manifest.json';
import { decodePng, type RgbaImage } from '@/lib/pixel/pngCodec';
import { newCanvas, type SpriteLoader } from '@/lib/pixel/sceneRenderer';
import {
  PART_POSES,
  QC_POSES,
  SKELETON,
  lintPartSet,
  type PartDef,
  type PartPoint,
  type PartSetDef,
  type PartSlot,
  type PartsPoseName,
} from '@/lib/pixel/parts';
import { composePartSet, type PartsRender } from '@/lib/pixel/partsCompositor';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';

const cache = new Map<string, RgbaImage | undefined>();
const loadSprite: SpriteLoader = (id) => {
  if (!cache.has(id)) {
    const entry = (sprites.sprites as Record<string, { src: string }>)[id];
    let img: RgbaImage | undefined;
    if (entry) img = decodePng(new Uint8Array(readFileSync(join(process.cwd(), 'src/assets/pixel', entry.src))));
    cache.set(id, img);
  }
  return cache.get(id);
};

const PISTOL: PixelWeaponInput = {
  id: 'parts-pistol',
  name: 'Common Kinetic Pistol',
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Ironwood,
  element: Element.Kinetic,
  rarity: Rarity.Common,
  pixelSeed: 1234,
  affixes: [],
  rollQuality: 50,
};

const SNIPER: PixelWeaponInput = {
  id: 'parts-sniper',
  name: 'Epic Shock Sniper',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Prismatek,
  element: Element.Shock,
  rarity: Rarity.Epic,
  pixelSeed: 4242,
  affixes: [],
  rollQuality: 82,
};

/** FROZEN legacy baseline (see header): per-pose, per-joint
 *  interior-hole counts of the deleted segment rig, plus its idle
 *  composite coverage. Measured pre-deletion with this file's own
 *  helpers; the 'relaxed' row was measured with the M2 pose applied
 *  to the stand-in set. */
const FROZEN_LEGACY_HOLES: Record<PartsPoseName, Record<string, number>> = {
  idle: { kneeF: 0, kneeB: 0, elbowN: 0, neck: 0, hipF: 0, hipB: 0, shoulderN: 0 },
  roam: { kneeF: 0, kneeB: 0, elbowN: 0, neck: 0, hipF: 0, hipB: 0, shoulderN: 0 },
  aim: { kneeF: 0, kneeB: 0, elbowN: 4, neck: 0, hipF: 0, hipB: 0, shoulderN: 0 },
  recoil: { kneeF: 0, kneeB: 0, elbowN: 0, neck: 0, hipF: 0, hipB: 0, shoulderN: 0 },
  hit: { kneeF: 0, kneeB: 0, elbowN: 0, neck: 0, hipF: 0, hipB: 0, shoulderN: 0 },
  celebrate: { kneeF: 0, kneeB: 0, elbowN: 14, neck: 0, hipF: 0, hipB: 0, shoulderN: 0 },
  work: { kneeF: 0, kneeB: 0, elbowN: 1, neck: 0, hipF: 0, hipB: 2, shoulderN: 0 },
  relaxed: { kneeF: 0, kneeB: 0, elbowN: 0, neck: 0, hipF: 0, hipB: 0, shoulderN: 0 },
};
const FROZEN_LEGACY_IDLE_OPAQUE = 28303;

// ---------- pixel helpers (buffer space) ----------

const alpha = (img: RgbaImage, x: number, y: number): number =>
  x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.data[(y * img.width + x) * 4 + 3];

function opaqueCount(img: RgbaImage): number {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) n++;
  return n;
}

interface Window {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function jointWindow(render: PartsRender, points: PartPoint[], padX = 17, padY = 15): Window {
  const xs = points.map((p) => p.x - render.origin.x);
  const ys = points.map((p) => p.y - render.origin.y);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs)) - padX),
    y0: Math.max(0, Math.floor(Math.min(...ys)) - padY),
    x1: Math.min(render.image.width - 1, Math.ceil(Math.max(...xs)) + padX),
    y1: Math.min(render.image.height - 1, Math.ceil(Math.max(...ys)) + padY),
  };
}

/** Per-column overlap depth between two layers inside a window.
 *  A column belongs to the joint's CORE WIDTH (J3) when it lies
 *  across the joint's anchor line (±8 px of the anchors' x-extent —
 *  the face where the two parts actually meet) and both parts are
 *  genuinely engaged in it (each presents a span ≥ 8 px inside the
 *  window). Silhouette taper columns beyond the anchor line — a
 *  hem's dangling pouch edge, a collar's outer flare — are the
 *  joint's fringe, not its core; J3's floor is a statement about
 *  the core. */
function underlap(
  a: RgbaImage,
  b: RgbaImage,
  win: Window,
  coreX: { min: number; max: number },
): { coreColumns: number; minOverlap: number } {
  let coreColumns = 0;
  let minOverlap = Number.POSITIVE_INFINITY;
  for (let x = win.x0; x <= win.x1; x++) {
    if (x < coreX.min || x > coreX.max) continue;
    let spanA = 0;
    let spanB = 0;
    let overlap = 0;
    let minYA = Number.POSITIVE_INFINITY;
    let maxYA = -1;
    let minYB = Number.POSITIVE_INFINITY;
    let maxYB = -1;
    for (let y = win.y0; y <= win.y1; y++) {
      if (alpha(a, x, y) > 0) {
        minYA = Math.min(minYA, y);
        maxYA = y;
      }
      if (alpha(b, x, y) > 0) {
        minYB = Math.min(minYB, y);
        maxYB = y;
      }
      if (alpha(a, x, y) > 0 && alpha(b, x, y) > 0) overlap++;
    }
    if (maxYA >= 0) spanA = maxYA - minYA + 1;
    if (maxYB >= 0) spanB = maxYB - minYB + 1;
    if (spanA >= 8 && spanB >= 8) {
      coreColumns++;
      minOverlap = Math.min(minOverlap, overlap);
    }
  }
  return { coreColumns, minOverlap: coreColumns === 0 ? 0 : minOverlap };
}

/**
 * Interior holes at a joint: transparent pixels inside the window
 * that the union of the two parts encloses on BOTH axes — opaque
 * union pixels to the left and right in the row AND above and
 * below in the column. This is what a player perceives as a hole
 * in the character at the joint.
 *
 * Why not the plainer transparent-in-row-span count: that scan
 * also counts silhouette CONCAVITIES — the notch between the
 * helmet and the shoulder, the V at the outside of the elbow —
 * which are outline, not holes (the SPEC §11.6 caveat: absolute
 * hole counts mislead). The legacy crops backfill several such
 * notches with fat crop rectangles, so the plain scan grades
 * crop fatness, not joint integrity. The interior-hole count is
 * the same comparison — fresh vs legacy, identical measurement,
 * baseline-relative — restricted to pixels that are actually
 * enclosed by the joint's mass.
 */
function interiorHoles(a: RgbaImage, b: RgbaImage, win: Window): number {
  const opaque = (x: number, y: number): boolean => alpha(a, x, y) > 0 || alpha(b, x, y) > 0;
  let holes = 0;
  for (let y = win.y0; y <= win.y1; y++) {
    for (let x = win.x0; x <= win.x1; x++) {
      if (opaque(x, y)) continue;
      let left = false;
      let right = false;
      let above = false;
      let below = false;
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

function overlapArea(a: RgbaImage, b: RgbaImage): number {
  let n = 0;
  for (let i = 3; i < a.data.length; i += 4) if (a.data[i] > 0 && b.data[i] > 0) n++;
  return n;
}

// ---------- gates ----------

describe('parts system — lint & registration', () => {
  it('Standard Issue passes the anchor lint with no errors', () => {
    const { errors } = lintPartSet(STANDARD_ISSUE);
    expect(errors).toEqual([]);
  });

  it('every Standard Issue sprite is registered in the manifest at the declared size', () => {
    const entries = sprites.sprites as Record<string, { width: number; height: number; kind: string }>;
    for (const part of Object.values(STANDARD_ISSUE.parts)) {
      if (!part) continue;
      const entry = entries[part.spriteId];
      expect(entry, `manifest entry for ${part.spriteId}`).toBeDefined();
      // Rig parts ship at the design frame itself: partsCompositor
      // places part sources 1:1 (source px == design px).
      expect(entry.width).toBe(part.width);
      expect(entry.height).toBe(part.height);
    }
  });
});

describe('G1 — empty-frame composition & replacement purity', () => {
  it('every composite pixel is accounted for by a declared part layer (no base, no fallback)', () => {
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite);
    const { image, layers } = render;
    const layerList = [...layers.values()];
    let unaccounted = 0;
    let singleCoverageMismatch = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const ci = (y * image.width + x) * 4;
        if (image.data[ci + 3] === 0) continue;
        const covering = layerList.filter((l) => l.data[ci + 3] > 0);
        if (covering.length === 0) unaccounted++;
        else if (covering.length === 1 && covering[0].data[ci + 3] === 255) {
          // A single fully-opaque covering layer must reproduce
          // exactly in the composite — anything else is foreign paint.
          if (
            image.data[ci] !== covering[0].data[ci] ||
            image.data[ci + 1] !== covering[0].data[ci + 1] ||
            image.data[ci + 2] !== covering[0].data[ci + 2]
          ) {
            singleCoverageMismatch++;
          }
        }
      }
    }
    expect(unaccounted).toBe(0);
    expect(singleCoverageMismatch).toBe(0);
  });

  it('an overridden slot contributes zero pixels of the stock part', () => {
    const flat = newCanvas(42, 88);
    for (let i = 0; i < flat.data.length; i += 4) {
      flat.data[i] = 255;
      flat.data[i + 1] = 0;
      flat.data[i + 2] = 255;
      flat.data[i + 3] = 255;
    }
    const flatPart: PartDef = {
      id: 'test-flat-thigh',
      slot: 'thighF',
      spriteId: 'test-flat-thigh',
      width: 42,
      height: 88,
      anchors: { hip: { x: 21, y: 6 }, knee: { x: 21, y: 74 } },
      skirts: { knee: 14 },
    };
    const load: SpriteLoader = (id) => (id === 'test-flat-thigh' ? flat : loadSprite(id));
    const variant: PartSetDef = {
      ...STANDARD_ISSUE,
      id: 'standard-issue-variant',
      parts: { ...STANDARD_ISSUE.parts, thighF: flatPart },
    };
    const render = composePartSet(variant, PART_POSES.idle, load);
    expect(render.placements.thighF?.part.id).toBe('test-flat-thigh');
    let magenta = 0;
    for (let i = 0; i < render.image.data.length; i += 4) {
      if (
        render.image.data[i] === 255 &&
        render.image.data[i + 1] === 0 &&
        render.image.data[i + 2] === 255 &&
        render.image.data[i + 3] === 255
      ) {
        magenta++;
      }
    }
    // The flat part is fully visible somewhere (the thigh region is
    // not wholly covered by other parts) — and because composition
    // is accounting-exact (previous test), the stock thigh's pixels
    // cannot be hiding anywhere in this render.
    expect(magenta).toBeGreaterThan(200);
  });
});

const JOINTS: {
  name: string;
  a: PartSlot;
  b: PartSlot;
  points: (r: PartsRender) => PartPoint[];
}[] = [
  {
    name: 'kneeF',
    a: 'thighF',
    b: 'lowerLegF',
    points: (r) => [r.anchorStages.get('thighF:knee')!, r.anchorStages.get('lowerLegF:knee')!],
  },
  {
    name: 'kneeB',
    a: 'thighB',
    b: 'lowerLegB',
    points: (r) => [r.anchorStages.get('thighB:knee')!, r.anchorStages.get('lowerLegB:knee')!],
  },
  {
    name: 'elbowN',
    a: 'armUpperN',
    b: 'armForeN',
    points: (r) => [r.anchorStages.get('armUpperN:elbow')!, r.anchorStages.get('armForeN:elbow')!],
  },
  {
    name: 'neck',
    a: 'torso',
    b: 'head',
    points: (r) => [r.anchorStages.get('torso:neckSeat')!, r.anchorStages.get('head:neckSeat')!],
  },
  {
    name: 'hipF',
    a: 'torso',
    b: 'thighF',
    points: (r) => [{ ...SKELETON.hipF }, r.anchorStages.get('thighF:hip')!],
  },
  {
    name: 'hipB',
    a: 'torso',
    b: 'thighB',
    points: (r) => [{ ...SKELETON.hipB }, r.anchorStages.get('thighB:hip')!],
  },
  {
    name: 'shoulderN',
    a: 'torso',
    b: 'armUpperN',
    points: (r) => [r.anchorStages.get('torso:shoulderSeatN')!, r.anchorStages.get('armUpperN:shoulder')!],
  },
];

describe('G2 — joint underlap across the QC pose set (J3)', () => {
  for (const poseName of QC_POSES) {
    it(`pose ${poseName}: every joint holds ≥ 4px underlap across its core width`, () => {
      const render = composePartSet(STANDARD_ISSUE, PART_POSES[poseName], loadSprite);
      for (const joint of JOINTS) {
        const layerA = render.layers.get(joint.a)!;
        const layerB = render.layers.get(joint.b)!;
        const points = joint.points(render);
        const win = jointWindow(render, points);
        const coreX = {
          min: Math.floor(Math.min(...points.map((p) => p.x - render.origin.x))) - 8,
          max: Math.ceil(Math.max(...points.map((p) => p.x - render.origin.x))) + 8,
        };
        const { coreColumns, minOverlap } = underlap(layerA, layerB, win, coreX);
        expect(coreColumns, `${poseName}/${joint.name} core columns`).toBeGreaterThanOrEqual(6);
        expect(minOverlap, `${poseName}/${joint.name} min underlap`).toBeGreaterThanOrEqual(4);
      }
    });
  }

  it('J7: the back part overlaps the torso silhouette by ≥ 200 px² at rest', () => {
    for (const poseName of ['idle', 'roam'] as PartsPoseName[]) {
      const render = composePartSet(STANDARD_ISSUE, PART_POSES[poseName], loadSprite);
      const area = overlapArea(render.layers.get('back')!, render.layers.get('torso')!);
      expect(area, `${poseName} back×torso overlap`).toBeGreaterThanOrEqual(200);
    }
  });
});

describe('G3 — joint integrity vs the frozen legacy baseline', () => {
  for (const poseName of QC_POSES) {
    it(`pose ${poseName}: no joint has more interior holes than the legacy rig`, () => {
      const fresh = composePartSet(STANDARD_ISSUE, PART_POSES[poseName], loadSprite);
      for (const joint of JOINTS) {
        const win = jointWindow(fresh, joint.points(fresh), 17, 10);
        const freshHoles = interiorHoles(fresh.layers.get(joint.a)!, fresh.layers.get(joint.b)!, win);
        const legacyHoles = FROZEN_LEGACY_HOLES[poseName][joint.name];
        expect(
          freshHoles,
          `${poseName}/${joint.name} interior holes (fresh ${freshHoles} vs frozen legacy ${legacyHoles})`,
        ).toBeLessThanOrEqual(legacyHoles);
      }
    });
  }
});

describe('G4 — ground truth in every QC pose (J5)', () => {
  for (const poseName of QC_POSES) {
    it(`pose ${poseName}: soles and boot bottoms stay on the ground line`, () => {
      const render = composePartSet(STANDARD_ISSUE, PART_POSES[poseName], loadSprite);
      for (const slot of ['lowerLegF', 'lowerLegB'] as const) {
        const sole = render.anchorStages.get(`${slot}:sole`)!;
        expect(Math.abs(sole.y - SKELETON.groundLine), `${poseName}/${slot} sole y`).toBeLessThanOrEqual(1);
        const layer = render.layers.get(slot)!;
        let lowest = -1;
        for (let y = layer.height - 1; y >= 0; y--) {
          let any = false;
          for (let x = 0; x < layer.width; x++) {
            if (alpha(layer, x, y) > 0) {
              any = true;
              break;
            }
          }
          if (any) {
            lowest = y;
            break;
          }
        }
        const lowestStage = lowest + render.origin.y;
        expect(Math.abs(lowestStage - (SKELETON.groundLine - 1)), `${poseName}/${slot} boot bottom row`).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe('G5 — grip coincidence for short and long weapons', () => {
  for (const [label, weapon] of [
    ['pistol', PISTOL],
    ['sniper', SNIPER],
  ] as const) {
    it(`${label}: gripHand anchor and weapon grip coincide at the grip joint (aim pose)`, () => {
      const render = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
        weapon: { kind: 'compositor', input: weapon },
      });
      const gripHand = render.anchorStages.get('armForeN:gripHand')!;
      const dist = Math.hypot(gripHand.x - render.joints.grip.x, gripHand.y - render.joints.grip.y);
      expect(dist).toBeLessThanOrEqual(2);
      // Pixel sanity: the weapon layer actually paints at the grip.
      const weaponLayer = render.layers.get('weapon')!;
      const gx = Math.round(render.joints.grip.x - render.origin.x);
      const gy = Math.round(render.joints.grip.y - render.origin.y);
      let near = 0;
      for (let y = gy - 6; y <= gy + 6; y++) {
        for (let x = gx - 6; x <= gx + 6; x++) {
          if (alpha(weaponLayer, x, y) > 0) near++;
        }
      }
      expect(near).toBeGreaterThan(0);
      expect(render.joints.muzzle).toBeDefined();
    });
  }

  it('the sniper muzzle lands far forward of the grip; the pistol stays compact', () => {
    const sniper = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: SNIPER },
    });
    const pistol = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: PISTOL },
    });
    expect(sniper.joints.muzzle!.x - sniper.joints.grip.x).toBeGreaterThan(90);
    expect(pistol.joints.muzzle!.x - pistol.joints.grip.x).toBeLessThan(
      sniper.joints.muzzle!.x - sniper.joints.grip.x,
    );
  });

  it('unarmed: no weapon layer, and the grip chain still resolves', () => {
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite);
    expect(render.layers.has('weapon')).toBe(false);
    expect(render.joints.grip.x).toBeGreaterThan(0);
  });
});

describe('composition smoke — the set reads as one character', () => {
  it('composite coverage is in the same band as the legacy rig (not a sliver, not a blob)', () => {
    const fresh = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite);
    const freshCount = opaqueCount(fresh.image);
    expect(freshCount).toBeGreaterThan(FROZEN_LEGACY_IDLE_OPAQUE * 0.5);
    expect(freshCount).toBeLessThan(FROZEN_LEGACY_IDLE_OPAQUE * 1.7);
  });
});
