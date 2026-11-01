/**
 * Segmented rigs (visual overhaul brief §4) — skeletons and poses for
 * the layered-sprite actors. Segments are crops of the SHIPPED sprites
 * (scripts/pixel-segments.py), so a rig at rest is pixel-identical to
 * the whole sprite it replaces; motion is code (transforms), never
 * frame sequences.
 *
 * Frame coordinates are the source sprite's own pixel frame; the actor
 * component scales the frame into its placement box. Pivots come from
 * the manifest `pivot` anchors written by the production script.
 */

export interface RigSegmentDef {
  id: string;
  /** Segment sprite id in the pixel manifest. */
  spriteId: string;
  /** Top-left of the segment in the source frame. */
  frameX: number;
  frameY: number;
  width: number;
  height: number;
  /** Paint order (low = behind). */
  z: number;
}

export interface RigDef {
  id: string;
  frameWidth: number;
  frameHeight: number;
  segments: RigSegmentDef[];
}

export interface SegmentPose {
  rotate?: number;
  x?: number;
  y?: number;
  opacity?: number;
}

export type RigPose = Record<string, SegmentPose>;

/** The hunter frame is the shipped hunter.png frame: 260×320. Segment
 *  boxes mirror scripts/pixel-segments.py HUNTER_SEGMENTS exactly. */
export const HUNTER_RIG: RigDef = {
  id: 'hunter',
  frameWidth: 260,
  frameHeight: 320,
  segments: [
    { id: 'back', spriteId: 'rig-hunter-back', frameX: 0, frameY: 44, width: 62, height: 108, z: 0 },
    { id: 'thighB', spriteId: 'rig-hunter-thigh-b', frameX: 20, frameY: 178, width: 54, height: 74, z: 1 },
    { id: 'shinB', spriteId: 'rig-hunter-shin-b', frameX: 16, frameY: 240, width: 58, height: 80, z: 1 },
    { id: 'torso', spriteId: 'rig-hunter-torso', frameX: 24, frameY: 76, width: 124, height: 122, z: 2 },
    { id: 'armOff', spriteId: 'rig-hunter-arm-off', frameX: 142, frameY: 112, width: 72, height: 44, z: 3 },
    { id: 'thighF', spriteId: 'rig-hunter-thigh-f', frameX: 62, frameY: 178, width: 58, height: 74, z: 3 },
    { id: 'shinF', spriteId: 'rig-hunter-shin-f', frameX: 62, frameY: 240, width: 70, height: 80, z: 3 },
    { id: 'head', spriteId: 'rig-hunter-head', frameX: 34, frameY: 0, width: 86, height: 88, z: 4 },
    { id: 'armUpper', spriteId: 'rig-hunter-arm-upper', frameX: 84, frameY: 88, width: 68, height: 52, z: 5 },
    { id: 'armFore', spriteId: 'rig-hunter-arm-fore', frameX: 130, frameY: 92, width: 92, height: 56, z: 6 },
  ],
};

/**
 * Unarmed hunter rig (real-item invariant): the shipped hunter art
 * holds a rifle, so HUNTER_RIG's arm/torso segments carry a baked-in
 * gun — an unequipped hunter rendered a phantom weapon. This variant
 * swaps ONLY the four weapon-bearing segments for gun-free variants
 * (scripts/pixel-segments.py `unarmed` section: gun patch erased from
 * the torso, arms hanging at the sides). Same frame, same segment ids,
 * so every pose applies unchanged; the seven untouched segments are
 * shared with HUNTER_RIG and the equipped path stays bit-identical.
 */
export const HUNTER_RIG_UNARMED: RigDef = {
  id: 'hunter-unarmed',
  frameWidth: 260,
  frameHeight: 320,
  segments: [
    { id: 'back', spriteId: 'rig-hunter-back', frameX: 0, frameY: 44, width: 62, height: 108, z: 0 },
    { id: 'thighB', spriteId: 'rig-hunter-thigh-b', frameX: 20, frameY: 178, width: 54, height: 74, z: 1 },
    { id: 'shinB', spriteId: 'rig-hunter-shin-b', frameX: 16, frameY: 240, width: 58, height: 80, z: 1 },
    { id: 'armOff', spriteId: 'rig-hunter-arm-off-unarmed', frameX: 44, frameY: 150, width: 36, height: 74, z: 1 },
    { id: 'torso', spriteId: 'rig-hunter-torso-unarmed', frameX: 24, frameY: 76, width: 124, height: 122, z: 2 },
    { id: 'thighF', spriteId: 'rig-hunter-thigh-f', frameX: 62, frameY: 178, width: 58, height: 74, z: 3 },
    { id: 'shinF', spriteId: 'rig-hunter-shin-f', frameX: 62, frameY: 240, width: 70, height: 80, z: 3 },
    { id: 'head', spriteId: 'rig-hunter-head', frameX: 34, frameY: 0, width: 86, height: 88, z: 4 },
    { id: 'armUpper', spriteId: 'rig-hunter-arm-upper-unarmed', frameX: 92, frameY: 86, width: 52, height: 70, z: 5 },
    { id: 'armFore', spriteId: 'rig-hunter-arm-fore-unarmed', frameX: 94, frameY: 148, width: 48, height: 76, z: 6 },
  ],
};

/** Selectable hunter head variants (Q6 ruling). 'visor' is the shipped
 *  head segment; the others are repaints produced by the same script. */
export const HUNTER_HEAD_VARIANTS = [
  { id: 'visor', label: 'Visor', spriteId: 'rig-hunter-head' },
  { id: 'optic', label: 'Optic', spriteId: 'hunter-head-optic' },
  { id: 'hood', label: 'Hood', spriteId: 'hunter-head-hood' },
  { id: 'fin', label: 'Fin', spriteId: 'hunter-head-fin' },
] as const;

export type HunterHeadVariantId = (typeof HUNTER_HEAD_VARIANTS)[number]['id'];

export function hunterRigWithHead(variant: HunterHeadVariantId, unarmed = false): RigDef {
  const head = HUNTER_HEAD_VARIANTS.find((v) => v.id === variant) ?? HUNTER_HEAD_VARIANTS[0];
  const base = unarmed ? HUNTER_RIG_UNARMED : HUNTER_RIG;
  return {
    ...base,
    segments: base.segments.map((s) => (s.id === 'head' ? { ...s, spriteId: head.spriteId } : s)),
  };
}

const ENEMY_FRAME: Record<string, { w: number; h: number }> = {
  fodder: { w: 223, h: 384 },
  runner: { w: 406, h: 384 },
  brute: { w: 171, h: 384 },
  sniper: { w: 272, h: 384 },
  elite: { w: 197, h: 384 },
};

/** Enemy kits: band segments per archetype (mirrors ENEMY_BANDS in the
 *  production script). */
export function enemyRig(archetype: string): RigDef {
  const frame = ENEMY_FRAME[archetype] ?? ENEMY_FRAME.brute;
  const seg = (id: string, band: [number, number, number, number], z: number): RigSegmentDef => ({
    id,
    spriteId: `rig-${archetype}-${id}`,
    frameX: Math.round(band[0] * frame.w),
    frameY: Math.round(band[1] * frame.h),
    width: Math.round((band[2] - band[0]) * frame.w),
    height: Math.round((band[3] - band[1]) * frame.h),
    z,
  });
  return {
    id: `enemy-${archetype}`,
    frameWidth: frame.w,
    frameHeight: frame.h,
    segments: [
      seg('base', [0, 0.6, 1, 1], 0),
      seg('body', [0, 0.2, 1, 0.66], 1),
      seg('arm', [0.34, 0.3, 1, 0.62], 2),
      seg('head', [0, 0, 1, 0.26], 3),
    ],
  };
}

/** Hunter poses. Rotations stay inside the ±25° collar envelope. */
export const HUNTER_POSES: Record<'idle' | 'aim' | 'recoil' | 'hit' | 'celebrate' | 'work' | 'death', RigPose> = {
  idle: {},
  aim: {
    armUpper: { rotate: -7, y: -1 },
    armFore: { rotate: -4 },
    head: { rotate: 3 },
    torso: { rotate: 1 },
  },
  recoil: {
    armUpper: { rotate: 5, x: -2 },
    armFore: { rotate: 7, x: -3 },
    head: { rotate: -2 },
  },
  hit: {
    torso: { rotate: -4, x: -3 },
    head: { rotate: -7, y: 1 },
    armUpper: { rotate: 9 },
    armFore: { rotate: 11 },
  },
  celebrate: {
    armUpper: { rotate: -24, y: -2 },
    armFore: { rotate: -18 },
    head: { rotate: -4, y: -2 },
    torso: { y: -3 },
  },
  work: {
    armUpper: { rotate: 14, y: 2 },
    armFore: { rotate: 20 },
    armOff: { rotate: 10 },
    head: { rotate: 6, y: 1 },
    torso: { rotate: 3 },
  },
  death: {
    torso: { rotate: -68, y: 26 },
    head: { rotate: -52, y: 22 },
    armUpper: { rotate: -30, y: 18 },
    armFore: { rotate: -22, y: 16 },
    armOff: { rotate: -18, y: 14 },
    thighF: { rotate: -38, y: 10 },
    thighB: { rotate: -20, y: 8 },
  },
};

export const ENEMY_POSES: Record<'idle' | 'lunge' | 'hit' | 'death', RigPose> = {
  idle: {},
  lunge: {
    body: { rotate: -5, x: -6 },
    head: { rotate: -6, x: -4 },
    arm: { rotate: -16, x: -5 },
    base: { x: -3 },
  },
  hit: {
    body: { rotate: 3, x: 3 },
    head: { rotate: 6, x: 2 },
    arm: { rotate: 9 },
  },
  death: {
    body: { rotate: -62, y: 30 },
    head: { rotate: -48, y: 26 },
    arm: { rotate: -26, y: 18 },
    base: { rotate: -70, y: 34 },
  },
};

/** Animated-node accounting for the perf gate (§4.9): rig segments +
 *  stage layers + props + FX nodes in a scene must stay ≤ budget. */
export function countRigNodes(rig: RigDef): number {
  return rig.segments.length;
}
