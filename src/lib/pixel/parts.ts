/**
 * Parts-based character model (character-parts-system SPEC, M1).
 *
 * The hunter is no longer a baked sprite with segment crops. A hunter
 * is a SET OF PARTS — one part per slot — composited over an EMPTY
 * frame: there is no base sprite underneath, so a replaced slot is
 * replaced totally (the Stomper lesson: a skin boot painted over the
 * stock boot is a defect of the old model, not a style choice).
 *
 * Parts are rigid sprites placed by their OWN anchors onto a mount
 * graph: fixed skeleton ends (pelvis, hips, soles, back mount) come
 * from S-REF below; everything above the pelvis hangs off mounts the
 * torso part declares (neck seat, shoulder seats), and the arm chain
 * resolves from the parts' own joint anchors (shoulder → elbow →
 * grip). A part with undeclared anchors does not load (lintPartSet).
 *
 * This module is the model + validation only. Rendering lives in
 * partsCompositor.ts; the Standard Issue catalog set lives in
 * standardIssue.ts. NOTHING in the live render path consumes this yet
 * — M2 performs the atomic swap.
 */

export type PartSlot =
  | 'back'
  | 'lowerLegB'
  | 'thighB'
  | 'torso'
  | 'armFar'
  | 'thighF'
  | 'lowerLegF'
  | 'head'
  | 'shoulderExtraN'
  | 'armUpperN'
  | 'armForeN';

export interface PartPoint {
  x: number;
  y: number;
}

/**
 * One part. Anchors and mounts are in the part's own pixel space.
 * `anchors` are the points the compositor places BY (the slot's
 * primary placement anchor first); `mounts` are points the part
 * OFFERS to other parts (the torso's shoulder/chest mounts, a leg's
 * knee). `skirts` records joint-cover depth in px past the named
 * joint anchor (SPEC J4: full-width cover art, never a tapered point).
 */
export interface PartDef {
  id: string;
  slot: PartSlot;
  /** Manifest sprite id (src/assets/pixel/manifest.json). */
  spriteId: string;
  width: number;
  height: number;
  anchors: Record<string, PartPoint>;
  skirts?: Record<string, number>;
  mounts?: Record<string, PartPoint>;
  /** Palette family for the palette-remap tier (same silhouette). */
  paletteFamily?: string;
}

/** A part set: at most one part per slot. Sets are a merchandising
 *  bundle, not a data type — parts equip individually (SPEC §8). */
export interface PartSetDef {
  id: string;
  label: string;
  parts: Partial<Record<PartSlot, PartDef>>;
}

interface SlotDef {
  slot: PartSlot;
  required: boolean;
  /** Paint order across the whole set (low = behind). The weapon
   *  renders at WEAPON_PAINT_ORDER, between armUpperN and armForeN,
   *  so the gripping hand wraps over the weapon's grip. */
  paintOrder: number;
}

export const PART_SLOTS: SlotDef[] = [
  { slot: 'back', required: true, paintOrder: 0 },
  { slot: 'thighB', required: true, paintOrder: 1 },
  { slot: 'lowerLegB', required: true, paintOrder: 2 },
  { slot: 'torso', required: true, paintOrder: 3 },
  { slot: 'armFar', required: true, paintOrder: 4 },
  { slot: 'thighF', required: true, paintOrder: 5 },
  { slot: 'lowerLegF', required: true, paintOrder: 6 },
  { slot: 'head', required: true, paintOrder: 7 },
  { slot: 'shoulderExtraN', required: false, paintOrder: 8 },
  { slot: 'armUpperN', required: true, paintOrder: 9 },
  { slot: 'armForeN', required: true, paintOrder: 11 },
];

export const WEAPON_PAINT_ORDER = 10;

export const REQUIRED_SLOTS: PartSlot[] = PART_SLOTS.filter((s) => s.required).map((s) => s.slot);

/** The anchor each slot is placed BY (its primary anchor). */
export const PRIMARY_ANCHOR: Record<PartSlot, string> = {
  back: 'mountFace',
  lowerLegB: 'sole',
  thighB: 'hip',
  torso: 'pelvisSeat',
  armFar: 'shoulder',
  thighF: 'hip',
  lowerLegF: 'sole',
  head: 'neckSeat',
  shoulderExtraN: 'mountFace',
  armUpperN: 'shoulder',
  armForeN: 'elbow',
};

/** Anchors a part MUST declare to load, per slot (SPEC §4/§7 lint). */
export const REQUIRED_ANCHORS: Record<PartSlot, string[]> = {
  back: ['mountFace', 'topExtent'],
  lowerLegB: ['sole', 'knee'],
  thighB: ['hip', 'knee'],
  torso: ['pelvisSeat', 'neckSeat', 'shoulderSeatN', 'shoulderSeatF'],
  armFar: ['shoulder', 'supportHand'],
  thighF: ['hip', 'knee'],
  lowerLegF: ['sole', 'knee'],
  head: ['neckSeat'],
  shoulderExtraN: ['mountFace'],
  armUpperN: ['shoulder', 'elbow'],
  armForeN: ['elbow', 'gripHand'],
};

/** Mounts a part must offer, per slot. The torso carries the gear
 *  mounts (SPEC §6): a torso without declared mounts fails the lint,
 *  because a gear part is never hidden and never floats at a stock
 *  default — the swallow rule is enforced here, at the data layer.
 *  The far arm carries the shield mount (§6: the shield emitter is
 *  an arm part, declared by armFar/armForeN — Standard Issue
 *  declares it on the support arm). */
export const REQUIRED_MOUNTS: Partial<Record<PartSlot, string[]>> = {
  torso: ['shoulderMount', 'chestMount', 'beltMount'],
  armFar: ['shieldMount'],
};

/**
 * S-REF: the reference skeleton, in the shipped hunter's 260×320
 * frame (texel = 4, the manifest law shared by every sprite). Poses
 * are skeleton poses; parts are rigid and are placed by aligning
 * their own anchors to these joints/mounts. The frame is NOT a cage:
 * parts may extend beyond it and the compositor sizes the actor's
 * buffer to the equipped set's union bbox with the ground line
 * pinned (SPEC §3).
 */
export const SKELETON = {
  frameWidth: 260,
  frameHeight: 320,
  groundLine: 320,
  soleF: { x: 102, y: 320 },
  soleB: { x: 44, y: 320 },
  /** The knee is a BAND, not a point (SPEC J5): the lower leg seats
   *  by its sole on the ground line and its knee end must land inside
   *  the band; the band absorbs ±6 px of part-length variance. */
  kneeBand: { min: 240, max: 252 },
  hipF: { x: 91, y: 182 },
  hipB: { x: 47, y: 182 },
  pelvis: { x: 74, y: 190 },
  chest: { x: 88, y: 128 },
  neck: { x: 81, y: 79 },
  shoulderN: { x: 95, y: 101 },
  elbowN: { x: 137, y: 112 },
  grip: { x: 143, y: 118 },
  shoulderF: { x: 149, y: 125 },
  supportHand: { x: 175, y: 124 },
  backMount: { x: 50, y: 87 },
  backHighMount: { x: 38, y: 64 },
} as const;

/** Stage x of the parts actor's feet anchor — the midpoint of the
 *  two soles — as a fraction of the frame width. Every stage places
 *  the actor by this point; it is the successor to the deleted whole
 *  hunter sprite's `feet` manifest anchor. */
export const PARTS_FEET_X = (SKELETON.soleB.x + SKELETON.soleF.x) / 2 / SKELETON.frameWidth;

/** Animated-node accounting for the perf gate (§4.9): one animated
 *  node per part in the set (plus the weapon node when armed, which
 *  the budget counts with the FX nodes). */
export function countPartNodes(set: PartSetDef): number {
  return Object.values(set.parts).filter(Boolean).length;
}

export interface PartPoseTransform {
  rotate?: number;
  x?: number;
  y?: number;
}

export type PartPose = Partial<Record<PartSlot, PartPoseTransform>>;

export type PartsPoseName = 'idle' | 'roam' | 'aim' | 'recoil' | 'hit' | 'celebrate' | 'work' | 'relaxed';

/**
 * The QC pose set (SPEC §7 reserves the enumeration to M1). Values
 * carry the old rig poses' shapes for the shared slots — Sample-B
 * movement timings in movement.ts are untouched law; these are the
 * static pose shapes the beats interpolate between.
 *
 * The death pose is EXCLUDED from the joint gates, deliberately: it
 * is a whole-actor stage transform (the body leaves the ground line
 * and the legs fold), so J5's ground truth and the underlap rules do
 * not apply to it by design. It joins the gate set only if a future
 * pose system gives it its own joint rules.
 *
 * 'roam' is idle plus a 2 px upper-body bob (the pelvis/torso chain
 * rises; the soles stay planted) — the roaming diorama's breathing
 * frame.
 */
export const PART_POSES: Record<PartsPoseName, PartPose> = {
  idle: {},
  roam: {
    torso: { y: -2 },
  },
  aim: {
    torso: { rotate: 1 },
    armUpperN: { rotate: -7, y: -1 },
    armForeN: { rotate: -4 },
    // The far (support) arm rotates fully forward so it braces
    // under the gun arm, hand ending at the grip's underside. At
    // the old -28 the single-piece arm dangled in the gap between
    // the gun arm and the torso — shoulder hidden behind the
    // torso, it read as a small extra arm growing from the armpit
    // (owner flag, 2026-11-11). A true foregrip seat is out of
    // the part's reach (shoulder→supportHand ≈ 45px vs ≈ 64px+ to
    // the foregrip), so the brace-under-grip read is the shipped
    // shape; recoil carries the matching -51 so the support arm
    // stays on the gun through the kick.
    armFar: { rotate: -52 },
    head: { rotate: 3 },
  },
  recoil: {
    armUpperN: { rotate: 5, x: -2 },
    armForeN: { rotate: 7, x: -3 },
    armFar: { rotate: -51 },
    head: { rotate: -2 },
  },
  hit: {
    torso: { rotate: -4, x: -3 },
    head: { rotate: -7, y: 1 },
    armUpperN: { rotate: 9 },
    armForeN: { rotate: 11 },
    armFar: { rotate: 6 },
  },
  celebrate: {
    armUpperN: { rotate: -24, y: -2 },
    armForeN: { rotate: -18 },
    head: { rotate: -4, y: -2 },
    torso: { y: -3 },
  },
  work: {
    armUpperN: { rotate: 14, y: 2 },
    armForeN: { rotate: 20 },
    armFar: { rotate: 10 },
    head: { rotate: 6, y: 1 },
    torso: { rotate: 3 },
  },
  /**
   * The unarmed stance (M2): the near arm chain swings DOWN off the
   * shoulder seat — upper arm rotated to hang along the torso, the
   * forearm near-straight with it, the (empty) hand ending beside
   * the thigh. This replaces the old rig's separate hanging-arm
   * segment set: same parts, a pose whose whole point is that the
   * hands hold nothing. Any surface rendering an unequipped hunter
   * at rest uses this pose (and renders no weapon layer).
   */
  relaxed: {
    armUpperN: { rotate: 62 },
    armForeN: { rotate: -6 },
    armFar: { rotate: 6 },
    head: { rotate: 2 },
  },
};

export const QC_POSES: PartsPoseName[] = ['idle', 'roam', 'aim', 'recoil', 'hit', 'celebrate', 'work', 'relaxed'];

export interface PartLintResult {
  errors: string[];
  warnings: string[];
}

const inBounds = (part: PartDef, p: PartPoint): boolean =>
  p.x >= 0 && p.x <= part.width && p.y >= 0 && p.y <= part.height;

/**
 * The anchor lint (SPEC §4/§5): a part set loads only if every
 * required slot holds exactly one part, every part declares its
 * slot's required anchors (in bounds), joint skirts meet the J3/J4/J6
 * minimums, and the leg chain seats inside the knee band at rest.
 * Replacement purity (J1) is structural here — a set is a map from
 * slot to ONE part — and is proven at the pixel level by the G1 gate.
 */
export function lintPartSet(set: PartSetDef): PartLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const known = new Set(PART_SLOTS.map((s) => s.slot));

  for (const key of Object.keys(set.parts)) {
    if (!known.has(key as PartSlot)) errors.push(`unknown slot '${key}' in set ${set.id}`);
  }

  for (const { slot, required } of PART_SLOTS) {
    const part = set.parts[slot];
    if (!part) {
      if (required) errors.push(`set ${set.id} is missing required slot '${slot}'`);
      continue;
    }
    if (part.slot !== slot) errors.push(`part ${part.id} declares slot '${part.slot}' but sits in '${slot}'`);
    for (const name of REQUIRED_ANCHORS[slot]) {
      const anchor = part.anchors[name];
      if (!anchor) errors.push(`part ${part.id} (${slot}) does not declare required anchor '${name}'`);
      else if (!inBounds(part, anchor)) errors.push(`part ${part.id} anchor '${name}' (${anchor.x},${anchor.y}) is outside the part (${part.width}×${part.height})`);
    }
    for (const name of REQUIRED_MOUNTS[slot] ?? []) {
      const mount = part.mounts?.[name];
      if (!mount) errors.push(`part ${part.id} (${slot}) does not declare required mount '${name}'`);
      else if (!inBounds(part, mount)) errors.push(`part ${part.id} mount '${name}' (${mount.x},${mount.y}) is outside the part (${part.width}×${part.height})`);
    }
    // Skirt minimums: J3 underlap floor is 4 px; J6 raises the neck
    // seat to 6 px. Skirts are declared as art depth past the joint.
    if (slot === 'thighF' || slot === 'thighB') {
      const skirt = part.skirts?.knee;
      if (skirt === undefined) errors.push(`part ${part.id} does not declare its knee skirt`);
      else if (skirt < 4) errors.push(`part ${part.id} knee skirt ${skirt}px < 4px minimum (J3)`);
    }
    if (slot === 'head') {
      const skirt = part.skirts?.neck;
      if (skirt === undefined) errors.push(`part ${part.id} does not declare its neck skirt`);
      else if (skirt < 6) errors.push(`part ${part.id} neck skirt ${skirt}px < 6px minimum (J6)`);
    }
    if (slot === 'armForeN') {
      const skirt = part.skirts?.elbow;
      if (skirt === undefined) errors.push(`part ${part.id} does not declare its elbow skirt`);
      else if (skirt < 4) errors.push(`part ${part.id} elbow skirt ${skirt}px < 4px minimum (J3)`);
    }
  }

  // Leg chain at rest (J5): the lower leg seats by its sole on the
  // ground line; its knee end must land inside the knee band.
  for (const slot of ['lowerLegF', 'lowerLegB'] as const) {
    const part = set.parts[slot];
    if (!part?.anchors.sole || !part?.anchors.knee) continue;
    const kneeStageY = SKELETON.groundLine - (part.anchors.sole.y - part.anchors.knee.y);
    if (kneeStageY < SKELETON.kneeBand.min || kneeStageY > SKELETON.kneeBand.max) {
      errors.push(
        `part ${part.id} knee lands at y=${kneeStageY} at rest, outside the knee band ${SKELETON.kneeBand.min}–${SKELETON.kneeBand.max} (J5)`,
      );
    }
  }

  // Back mount overlap feasibility (J7): the back part must be able
  // to overlap the torso silhouette by ≥ 200 px² at rest — checked
  // geometrically by the G2 gate; here we only require the declared
  // mount face to sit inside the part (done above) and warn when the
  // part is implausibly small to ever reach the threshold.
  const back = set.parts.back;
  if (back && back.width * back.height < 2000) {
    warnings.push(`back part ${back.id} is very small (${back.width}×${back.height}); J7's 200px² torso overlap may be unreachable`);
  }

  return { errors, warnings };
}
