/**
 * Parts compositor (character-parts-system SPEC, M1): renders a part
 * set over an EMPTY frame by anchor alignment.
 *
 * Placement is a mount graph, not a frame layout:
 *  - fixed ends from S-REF: pelvis, hips, soles (ground line pinned);
 *  - the torso places by its pelvisSeat on the pelvis;
 *  - head, near arm, far arm, pauldron and back hang off mounts the
 *    torso (or the skeleton's back mount, carried by the torso
 *    transform) declares — so they follow torso pose transforms;
 *  - the arm chain resolves from the PARTS' anchors: the forearm
 *    seats on the upper arm's own elbow anchor, and the weapon seats
 *    grip-to-grip on the forearm's gripHand anchor. Grip truth
 *    therefore holds for ANY part set (SPEC §6), not just this one.
 *
 * The frame is not a cage: the render buffer extends past the
 * 260×320 S-REF frame on every side and the returned `origin` maps
 * buffer pixels back to stage coordinates; rendering surfaces size
 * the actor's box to the union bbox with the ground line pinned.
 *
 * Every part renders into its own layer first; the returned layers
 * are the QC surface for the joint gates (SPEC §9) — underlap and
 * joint integrity are measured between layers, never eyeballed.
 *
 * M2 wired this into every live hunter surface: the DOM actor
 * (PixelPartsActor) positions part images by the layout below, and
 * the raster path here serves the golden scenes + QC gates.
 */
import type { RgbaImage } from './pngCodec';
import { blit, blitRotated, hexToRgb, newCanvas, type SpriteLoader } from './sceneRenderer';
import { composePixelWeapon, weaponGripFraction, type PixelWeaponInput } from './weaponCompositor';
import { remapPixelData, type PaletteSpec } from './paletteSwap';
import {
  PART_SLOTS,
  PRIMARY_ANCHOR,
  SKELETON,
  WEAPON_PAINT_ORDER,
  type PartDef,
  type PartPoint,
  type PartPose,
  type PartSetDef,
  type PartSlot,
} from './parts';

/** Buffer margin around the S-REF frame, in stage px. Oversized
 *  parts (a Bulwark helm, a Packmaster tank) live out here. */
export const PARTS_BUFFER_PAD = 72;

export type PartsWeapon =
  | { kind: 'compositor'; input: PixelWeaponInput }
  | {
      kind: 'bespoke';
      spriteId: string;
      width?: number;
      /** Normalized grip/muzzle anchors (callers read them from the
       *  pixel manifest; this module stays manifest-free like
       *  sceneRenderer, so scripts and tests can drive it without a
       *  Vite glob context). When omitted, pixel-key's own heuristics
       *  are recomputed from the raster. */
      grip?: PartPoint;
      muzzle?: PartPoint;
    };

export interface PartPlacement {
  part: PartDef;
  /** Stage coordinates of the part's primary anchor after posing. */
  anchorStage: PartPoint;
  rotationDeg: number;
}

export interface PartsRender {
  /** Composited image (buffer space; see `origin`). */
  image: RgbaImage;
  /** Stage coordinates of the buffer's top-left pixel. */
  origin: PartPoint;
  /** Per-slot layers in buffer space; the weapon layer is 'weapon'. */
  layers: Map<string, RgbaImage>;
  placements: Partial<Record<PartSlot, PartPlacement>>;
  /** Every declared anchor/mount of every placed part, resolved to
   *  stage coordinates, keyed `${slot}:${name}` for anchors and
   *  `${slot}:mount:${name}` for mounts. The QC gates locate joints
   *  from here. */
  anchorStages: Map<string, PartPoint>;
  /** Resolved joint positions in stage coordinates. */
  joints: {
    grip: PartPoint;
    supportHand: PartPoint;
    elbow: PartPoint;
    neck: PartPoint;
    /** Weapon muzzle in stage coordinates (FX chain, SPEC §6). */
    muzzle?: PartPoint;
  };
}

/**
 * The layout of a part set in a pose, WITHOUT rasterization: where
 * every part sits, where every anchor lands, and where the joints
 * resolve. This is the single placement truth — composePartSet
 * rasterizes exactly this layout, the live DOM actor positions its
 * part images by it, and the stages read the grip/muzzle/mass
 * points for FX from it. (M2: the stages used to read the deleted
 * whole-hunter sprite's manifest anchors for those points.)
 */
export interface PartSetLayout {
  placements: Partial<Record<PartSlot, PartPlacement>>;
  anchorStages: Map<string, PartPoint>;
  joints: {
    grip: PartPoint;
    supportHand: PartPoint;
    elbow: PartPoint;
    neck: PartPoint;
    muzzle?: PartPoint;
  };
  /** The held weapon's stage geometry, when a weapon layout was
   *  supplied: the box the weapon render occupies, grip-anchored. */
  weapon?: {
    gripStage: PartPoint;
    targetW: number;
    targetH: number;
    gripFrac: PartPoint;
    muzzleFrac: PartPoint;
  };
}

/** Precomputed held-weapon geometry in normalized fractions: the
 *  grip/muzzle positions inside the weapon render, and its aspect
 *  (height / width). Callers derive it from the render itself —
 *  compositorWeaponFractions for kit weapons, the manifest anchors
 *  for bespoke sprites. */
export interface PartsWeaponFractions {
  gripFrac: PartPoint;
  muzzleFrac: PartPoint;
  aspect: number;
}

/** Held weapons render at this stage width (the stages' §4.2 box:
 *  78% of the 260px frame). */
export const PARTS_WEAPON_TARGET_W = Math.round(0.78 * SKELETON.frameWidth);

/** Resolve every part's placement for a pose (no rasterization). */
export function resolvePartPlacements(
  set: PartSetDef,
  pose: PartPose,
): {
  placements: Partial<Record<PartSlot, PartPlacement>>;
  grip: PartPoint;
  supportHand: PartPoint;
  elbow: PartPoint;
  neck: PartPoint;
} {
  const placements: Partial<Record<PartSlot, PartPlacement>> = {};

  const torsoPose = pose.torso ?? {};
  const torsoRot = torsoPose.rotate ?? 0;
  const pelvisPosed = {
    x: SKELETON.pelvis.x + (torsoPose.x ?? 0),
    y: SKELETON.pelvis.y + (torsoPose.y ?? 0),
  };

  const torso = set.parts.torso;
  const place = (slot: PartSlot, anchorStage: PartPoint, rotationDeg: number): void => {
    const part = set.parts[slot];
    if (!part) return;
    placements[slot] = { part, anchorStage, rotationDeg };
  };

  // --- Torso first: every upper-body mount derives from it. ---
  let torsoThrough: (local: PartPoint) => PartPoint = (p) => p;
  if (torso) {
    place('torso', pelvisPosed, torsoRot);
    torsoThrough = (local) => through(pelvisPosed, torsoRot, torso.anchors.pelvisSeat, local);
  }

  // --- Legs: fixed ends. Thighs seat by hip; lower legs seat by
  // sole on the ground line (the chain resolves ground-up, J5). ---
  if (set.parts.thighF) {
    const p = pose.thighF ?? {};
    place('thighF', { x: SKELETON.hipF.x + (p.x ?? 0), y: SKELETON.hipF.y + (p.y ?? 0) }, p.rotate ?? 0);
  }
  if (set.parts.thighB) {
    const p = pose.thighB ?? {};
    place('thighB', { x: SKELETON.hipB.x + (p.x ?? 0), y: SKELETON.hipB.y + (p.y ?? 0) }, p.rotate ?? 0);
  }
  if (set.parts.lowerLegF) place('lowerLegF', { ...SKELETON.soleF }, pose.lowerLegF?.rotate ?? 0);
  if (set.parts.lowerLegB) place('lowerLegB', { ...SKELETON.soleB }, pose.lowerLegB?.rotate ?? 0);

  // --- Back: the skeleton's back mount, carried by the torso
  // transform (it is strapped to the torso, not to the room). ---
  if (set.parts.back) {
    const mountPosed = through(pelvisPosed, torsoRot, { ...SKELETON.pelvis }, { ...SKELETON.backMount });
    place('back', mountPosed, torsoRot);
  }

  // --- Head: seats on the torso's neck seat. ---
  let neckStage: PartPoint = { ...SKELETON.neck };
  if (torso && set.parts.head) {
    const p = pose.head ?? {};
    neckStage = torsoThrough(torso.anchors.neckSeat);
    place('head', { x: neckStage.x + (p.x ?? 0), y: neckStage.y + (p.y ?? 0) }, torsoRot + (p.rotate ?? 0));
  }

  // --- Near arm chain: shoulder seat → the upper arm's own elbow
  // anchor → the forearm's gripHand. Resolved from the parts. ---
  let elbowStage: PartPoint = { ...SKELETON.elbowN };
  let gripStage: PartPoint = { ...SKELETON.grip };
  const upper = set.parts.armUpperN;
  const fore = set.parts.armForeN;
  if (torso && upper) {
    const p = pose.armUpperN ?? {};
    const shoulderStage = torsoThrough(torso.anchors.shoulderSeatN);
    const upperRot = torsoRot + (p.rotate ?? 0);
    const shoulderPosed = { x: shoulderStage.x + (p.x ?? 0), y: shoulderStage.y + (p.y ?? 0) };
    place('armUpperN', shoulderPosed, upperRot);
    elbowStage = through(shoulderPosed, upperRot, upper.anchors.shoulder, upper.anchors.elbow);
    if (fore) {
      const fp = pose.armForeN ?? {};
      const foreRot = upperRot + (fp.rotate ?? 0);
      const elbowPosed = { x: elbowStage.x + (fp.x ?? 0), y: elbowStage.y + (fp.y ?? 0) };
      place('armForeN', elbowPosed, foreRot);
      gripStage = through(elbowPosed, foreRot, fore.anchors.elbow, fore.anchors.gripHand);
      elbowStage = elbowPosed;
    }
  }

  // --- Far arm: seats on the torso's far shoulder seat; its
  // support hand resolves from its own anchors. ---
  let supportHandStage: PartPoint = { ...SKELETON.supportHand };
  const far = set.parts.armFar;
  if (torso && far) {
    const p = pose.armFar ?? {};
    const shoulderStage = torsoThrough(torso.anchors.shoulderSeatF);
    const farRot = torsoRot + (p.rotate ?? 0);
    const shoulderPosed = { x: shoulderStage.x + (p.x ?? 0), y: shoulderStage.y + (p.y ?? 0) };
    place('armFar', shoulderPosed, farRot);
    supportHandStage = through(shoulderPosed, farRot, far.anchors.shoulder, far.anchors.supportHand);
  }

  // --- Pauldron (optional): the torso's declared shoulder mount. ---
  if (torso && set.parts.shoulderExtraN && torso.mounts?.shoulderMount) {
    place('shoulderExtraN', torsoThrough(torso.mounts.shoulderMount), torsoRot);
  }

  return { placements, grip: gripStage, supportHand: supportHandStage, elbow: elbowStage, neck: neckStage };
}

/** Resolve every declared anchor/mount of placed parts to stage
 *  coordinates, keyed `${slot}:${name}` / `${slot}:mount:${name}`. */
export function resolveAnchorStages(placements: Partial<Record<PartSlot, PartPlacement>>): Map<string, PartPoint> {
  const anchorStages = new Map<string, PartPoint>();
  for (const { slot } of PART_SLOTS) {
    const placement = placements[slot];
    if (!placement) continue;
    const { part, anchorStage, rotationDeg } = placement;
    const primaryLocal = part.anchors[PRIMARY_ANCHOR[slot]];
    for (const [name, local] of Object.entries(part.anchors)) {
      anchorStages.set(`${slot}:${name}`, through(anchorStage, rotationDeg, primaryLocal, local));
    }
    for (const [name, local] of Object.entries(part.mounts ?? {})) {
      anchorStages.set(`${slot}:mount:${name}`, through(anchorStage, rotationDeg, primaryLocal, local));
    }
  }
  return anchorStages;
}

/** The full layout: placements + anchors + joints (+ the weapon's
 *  stage box and muzzle when its fractions are supplied). */
export function layoutPartSet(set: PartSetDef, pose: PartPose, weapon?: PartsWeaponFractions): PartSetLayout {
  const { placements, grip, supportHand, elbow, neck } = resolvePartPlacements(set, pose);
  const anchorStages = resolveAnchorStages(placements);
  let weaponBox: PartSetLayout['weapon'];
  let muzzle: PartPoint | undefined;
  if (weapon) {
    const targetW = PARTS_WEAPON_TARGET_W;
    const targetH = targetW * weapon.aspect;
    weaponBox = { gripStage: grip, targetW, targetH, gripFrac: weapon.gripFrac, muzzleFrac: weapon.muzzleFrac };
    muzzle = {
      x: grip.x + (weapon.muzzleFrac.x - weapon.gripFrac.x) * targetW,
      y: grip.y + (weapon.muzzleFrac.y - weapon.gripFrac.y) * targetH,
    };
  }
  return {
    placements,
    anchorStages,
    joints: { grip, supportHand, elbow, neck, muzzle },
    weapon: weaponBox,
  };
}

/** Fractions for a compositor (kit) weapon, from its own render:
 *  the grip is the type's grip fraction; the muzzle is the render's
 *  rightmost opaque cell — the same measurement composePartSet
 *  applies to the rasterized render. */
export function compositorWeaponFractions(input: PixelWeaponInput): PartsWeaponFractions {
  const render = composePixelWeapon(input);
  let bestX = -1;
  let bestY = 0;
  for (let y = 0; y < render.height; y++) {
    const row = render.rows[y];
    for (let x = 0; x < render.width; x++) {
      if (row[x] !== '.' && x > bestX) {
        bestX = x;
        bestY = y;
      }
    }
  }
  return {
    gripFrac: weaponGripFraction(input.weaponType),
    muzzleFrac: bestX < 0 ? { x: 1, y: 0.5 } : { x: (bestX + 0.5) / render.width, y: (bestY + 0.5) / render.height },
    aspect: render.height / render.width,
  };
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Rotate a vector by `deg` (screen coords, y down, clockwise
 *  positive — the same convention as sceneRenderer's blitRotated). */
function rot(v: PartPoint, deg: number): PartPoint {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
}

/** Map a part-local point to stage space through a placement:
 *  the placement pins `anchorLocal` at `anchorStage` and rotates
 *  the part by `rotationDeg` about that anchor. */
function through(anchorStage: PartPoint, rotationDeg: number, anchorLocal: PartPoint, local: PartPoint): PartPoint {
  const d = rot({ x: local.x - anchorLocal.x, y: local.y - anchorLocal.y }, rotationDeg);
  return { x: anchorStage.x + d.x, y: anchorStage.y + d.y };
}

function blank(w: number, h: number): RgbaImage {
  return newCanvas(w, h);
}

/** Alpha-over, byte-identical to sceneRenderer's blendPixel math. */
function blendOver(dst: RgbaImage, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= dst.width || y >= dst.height || a <= 0) return;
  const i = (y * dst.width + x) * 4;
  const dstA = dst.data[i + 3] / 255;
  const srcA = a / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  dst.data[i] = Math.round((r * srcA + dst.data[i] * dstA * (1 - srcA)) / outA);
  dst.data[i + 1] = Math.round((g * srcA + dst.data[i + 1] * dstA * (1 - srcA)) / outA);
  dst.data[i + 2] = Math.round((b * srcA + dst.data[i + 2] * dstA * (1 - srcA)) / outA);
  dst.data[i + 3] = Math.round(outA * 255);
}

/**
 * Composite one same-size layer over the image, pixel-exact.
 * sceneRenderer's blit is a RESAMPLER — at identity size its
 * (x/dw)*src.width sampling drops a column on some widths through
 * float error — so identity transfers go through this loop instead:
 * what a layer holds is exactly what the composite shows (G1's
 * accounting depends on it).
 */
function compositeLayerOver(image: RgbaImage, layer: RgbaImage): void {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const a = layer.data[i + 3];
      if (a > 0) blendOver(image, x, y, layer.data[i], layer.data[i + 1], layer.data[i + 2], a);
    }
  }
}

/** Place a part sprite into its layer at 1:1 (rotation 0). Same
 *  float-error concern as compositeLayerOver: a direct copy, not a
 *  resample. */
function placePartExact(layer: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const a = src.data[i + 3];
      if (a > 0) blendOver(layer, ox + x, oy + y, src.data[i], src.data[i + 1], src.data[i + 2], a);
    }
  }
}

/** The kit weapon's render as a plain raster (texel = 1 px) — the
 *  exact image composePartSet blits into the composite. Exported
 *  for the loadout-truth tests, which rebuild the armed render from
 *  its two declared sources (parts + weapon raster) and diff. */
export function rasterizeWeaponRaster(render: ReturnType<typeof composePixelWeapon>): RgbaImage {
  const img = newCanvas(render.width, render.height);
  for (let y = 0; y < render.height; y++) {
    const row = render.rows[y];
    for (let x = 0; x < render.width; x++) {
      const shade = row[x];
      if (shade === '.') continue;
      const [r, g, b] = hexToRgb(render.colors[shade as keyof typeof render.colors] ?? '#FFFFFF');
      const i = (y * render.width + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

/** Alpha centroid of the lower-left quadrant, normalized —
 *  pixel-key's grip heuristic, recomputed for bespoke sprites whose
 *  caller did not supply the manifest anchor. */
function gripHeuristic(img: RgbaImage): PartPoint {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = Math.floor(img.height / 2); y < img.height; y++) {
    for (let x = 0; x < Math.floor(img.width / 2); x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n === 0) return { x: 0.27, y: 0.66 };
  return { x: (sx / n + 0.5) / img.width, y: (sy / n + 0.5) / img.height };
}

/** Rightmost opaque pixel center of a raster, normalized — the
 *  muzzle, by the manifest's own anchor convention. */
function muzzleFraction(img: RgbaImage): PartPoint {
  let bestX = -1;
  let bestY = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0 && x > bestX) {
        bestX = x;
        bestY = y;
      }
    }
  }
  if (bestX < 0) return { x: 1, y: 0.5 };
  return { x: (bestX + 0.5) / img.width, y: (bestY + 0.5) / img.height };
}

export function composePartSet(
  set: PartSetDef,
  pose: PartPose,
  load: SpriteLoader,
  opts: { weapon?: PartsWeapon; palette?: PaletteSpec } = {},
): PartsRender {
  const W = SKELETON.frameWidth + PARTS_BUFFER_PAD * 2;
  const H = SKELETON.frameHeight + PARTS_BUFFER_PAD * 2;
  const origin = { x: -PARTS_BUFFER_PAD, y: -PARTS_BUFFER_PAD };
  const layers = new Map<string, RgbaImage>();
  // Placement is the layout resolver's — one placement truth for the
  // raster compositor, the DOM actor, and the stages' FX points.
  const {
    placements,
    grip: gripStage,
    supportHand: supportHandStage,
    elbow: elbowStage,
    neck: neckStage,
  } = resolvePartPlacements(set, pose);

  // --- Rasterize parts into per-slot layers (buffer space). ---
  const renderPart = (slot: PartSlot): void => {
    const placement = placements[slot];
    if (!placement) return;
    const { part, anchorStage, rotationDeg } = placement;
    const src = load(part.spriteId);
    if (!src) return;
    let pixels = src;
    if (opts.palette) {
      pixels = { width: src.width, height: src.height, data: new Uint8Array(src.data) };
      remapPixelData(pixels.data as unknown as Uint8ClampedArray, opts.palette);
    }
    const anchorLocal = part.anchors[PRIMARY_ANCHOR[slot]];
    const layer = blank(W, H);
    const dx = anchorStage.x - anchorLocal.x - origin.x;
    const dy = anchorStage.y - anchorLocal.y - origin.y;
    if (rotationDeg === 0) {
      placePartExact(layer, pixels, dx, dy);
    } else {
      blitRotated(layer, pixels, dx, dy, part.width, part.height, anchorLocal.x / part.width, anchorLocal.y / part.height, rotationDeg);
    }
    layers.set(slot, layer);
  };

  // --- Weapon: seated grip-to-grip on the resolved grip joint,
  // unrotated (the stages' current law), painted between the upper
  // arm and the forearm so the hand wraps the grip. ---
  let muzzleStage: PartPoint | undefined;
  if (opts.weapon) {
    let raster: RgbaImage;
    let gripFrac: PartPoint;
    let muzzleFrac: PartPoint;
    if (opts.weapon.kind === 'compositor') {
      const render = composePixelWeapon(opts.weapon.input);
      raster = rasterizeWeaponRaster(render);
      gripFrac = weaponGripFraction(opts.weapon.input.weaponType);
      muzzleFrac = muzzleFraction(raster);
    } else {
      const sprite = load(opts.weapon.spriteId);
      if (sprite) {
        raster = sprite;
        gripFrac = opts.weapon.grip ?? gripHeuristic(sprite);
        muzzleFrac = opts.weapon.muzzle ?? muzzleFraction(sprite);
      } else {
        raster = blank(1, 1);
        gripFrac = { x: 0, y: 0 };
        muzzleFrac = { x: 1, y: 0.5 };
      }
    }
    if (raster.width > 1) {
      const targetW = opts.weapon.kind === 'bespoke' && opts.weapon.width ? opts.weapon.width : Math.round(0.78 * SKELETON.frameWidth);
      const targetH = Math.round((targetW * raster.height) / raster.width);
      const gripPx = { x: gripFrac.x * targetW, y: gripFrac.y * targetH };
      const layer = blank(W, H);
      blit(layer, raster, gripStage.x - gripPx.x - origin.x, gripStage.y - gripPx.y - origin.y, targetW, targetH);
      layers.set('weapon', layer);
      muzzleStage = {
        x: gripStage.x + (muzzleFrac.x - gripFrac.x) * targetW,
        y: gripStage.y + (muzzleFrac.y - gripFrac.y) * targetH,
      };
    }
  }

  for (const { slot } of PART_SLOTS) renderPart(slot);

  // --- Composite in paint order over the empty frame. ---
  const image = blank(W, H);
  const ordered: { key: string; order: number }[] = [
    ...PART_SLOTS.filter((s) => layers.has(s.slot)).map((s) => ({ key: s.slot as string, order: s.paintOrder })),
    ...(layers.has('weapon') ? [{ key: 'weapon', order: WEAPON_PAINT_ORDER }] : []),
  ].sort((a, b) => a.order - b.order);
  for (const { key } of ordered) {
    const layer = layers.get(key);
    if (layer) compositeLayerOver(image, layer);
  }

  // --- Resolve every declared anchor/mount to stage space. ---
  const anchorStages = resolveAnchorStages(placements);

  return {
    image,
    origin,
    layers,
    placements,
    anchorStages,
    joints: { grip: gripStage, supportHand: supportHandStage, elbow: elbowStage, neck: neckStage, muzzle: muzzleStage },
  };
}
