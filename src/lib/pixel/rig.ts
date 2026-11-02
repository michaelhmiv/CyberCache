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
 *
 * Since the parts-system swap (M2) this module carries the ENEMY
 * rigs only. The hunter is a part set now — parts.ts (skeleton +
 * poses), standardIssue.ts (the stock set), headParts.ts (head
 * variants), partsCompositor.ts (layout + raster) — and the old
 * hunter rigs/poses/head-variant block were deleted with it.
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
