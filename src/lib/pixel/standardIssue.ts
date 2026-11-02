/**
 * Standard Issue — the stock hunter as a part set (M1).
 *
 * Fresh per-part art in the shipped hunter's style (generated with
 * the locked pixel-art style block against hunter.png as the style
 * reference, keyed through scripts/pixel-key.py at texel = 4),
 * authored as COMPLETE parts with joint skirts — never crops of a
 * baked whole. Two slots re-register shipped sprites that already
 * ARE complete standalone parts (SPEC M1): the visor head and the
 * back piece.
 *
 * Anchors were authored from the keyed art's measured alpha
 * geometry (2026-11-02 measurements in the M1 work notes), against
 * the S-REF skeleton in parts.ts:
 *  - the leg chain seats ground-up: lower-leg sole→knee deltas are
 *    79 px, landing the knee at y=241, inside the 240–252 band (J5);
 *  - thigh knee skirts run 12 px past the knee anchor (J4);
 *  - the head's collar runs 9 px below its neck seat (J6);
 *  - the torso's declared seats coincide with the skeleton joints
 *    when the torso seats on the pelvis (neck seat lands at stage
 *    (81, 81) vs S-REF neck (81, 79) — inside the head's skirt).
 *
 * One recorded deviation from S-REF proportions: the forearm chain.
 * S-REF's stock forearm is foreshortened (elbow→grip ≈ 8 px, the
 * hand buried in the baked rifle); the Standard Issue forearm is a
 * full extended piece (elbow→gripHand = 58 px), so the resolved grip
 * lands forward of the S-REF grip point. The chain resolves from the
 * parts' anchors by design (partsCompositor), so grip truth holds —
 * the weapon seats on the hand, wherever the hand is.
 */
import type { PartSetDef } from './parts';

export const STANDARD_ISSUE: PartSetDef = {
  id: 'standard-issue',
  label: 'Standard Issue',
  parts: {
    back: {
      id: 'si-back',
      slot: 'back',
      spriteId: 'rig-hunter-back',
      width: 62,
      height: 108,
      anchors: {
        // Frame (0,44) in the shipped sprite: the S-REF back mount
        // (50,87) in part-local coords.
        mountFace: { x: 50, y: 43 },
        topExtent: { x: 47, y: 0 },
      },
      paletteFamily: 'standard-issue',
    },
    thighB: {
      id: 'si-thigh-b',
      slot: 'thighB',
      spriteId: 'part-si-thigh-b',
      width: 30,
      height: 88,
      anchors: {
        hip: { x: 14, y: 6 },
        knee: { x: 13, y: 76 },
      },
      skirts: { knee: 12 },
      paletteFamily: 'standard-issue',
    },
    lowerLegB: {
      id: 'si-lower-leg-b',
      slot: 'lowerLegB',
      spriteId: 'part-si-lower-leg-b',
      width: 36,
      height: 90,
      anchors: {
        sole: { x: 18, y: 89 },
        knee: { x: 16, y: 10 },
      },
      paletteFamily: 'standard-issue',
    },
    torso: {
      id: 'si-torso',
      slot: 'torso',
      spriteId: 'part-si-torso',
      width: 88,
      height: 148,
      anchors: {
        pelvisSeat: { x: 48, y: 124 },
        // Seated deep of the S-REF neck line (seat stage (81, 93)
        // vs S-REF neck (81, 79)): the generated torso's collar is
        // a narrow ring where the legacy crop had a wide neck
        // shelf, so the head seats deep enough that its collar
        // overlaps the ring through every QC pose rotation — the
        // shallowest seat with zero interior holes at the neck
        // across the pose set (measured sweep 19→28, M1 work notes).
        neckSeat: { x: 55, y: 27 },
        shoulderSeatN: { x: 69, y: 35 },
        shoulderSeatF: { x: 84, y: 56 },
      },
      mounts: {
        shoulderMount: { x: 69, y: 28 },
        chestMount: { x: 58, y: 64 },
        // The waist band (M3): belt consumables hang from here,
        // fanned along the band. Stage (88, 178) at rest — the
        // band the overlay-era belt row hung at (top y≈179).
        beltMount: { x: 62, y: 112 },
      },
      paletteFamily: 'standard-issue',
    },
    armFar: {
      id: 'si-arm-far',
      slot: 'armFar',
      spriteId: 'part-si-arm-far',
      width: 30,
      height: 56,
      anchors: {
        shoulder: { x: 8, y: 8 },
        supportHand: { x: 24, y: 50 },
      },
      mounts: {
        // The shield emitter mount (SPEC §6, M3): mid-forearm of
        // the support arm — stage (119, 144) at rest. The equipped
        // shield's behavior glyph projects from here and follows
        // the arm through every pose.
        shieldMount: { x: 17, y: 30 },
      },
      paletteFamily: 'standard-issue',
    },
    thighF: {
      id: 'si-thigh-f',
      slot: 'thighF',
      spriteId: 'part-si-thigh-f',
      width: 38,
      height: 88,
      anchors: {
        hip: { x: 16, y: 6 },
        knee: { x: 16, y: 76 },
      },
      skirts: { knee: 12 },
      paletteFamily: 'standard-issue',
    },
    lowerLegF: {
      id: 'si-lower-leg-f',
      slot: 'lowerLegF',
      spriteId: 'part-si-lower-leg-f',
      width: 51,
      height: 90,
      anchors: {
        sole: { x: 26, y: 89 },
        knee: { x: 28, y: 10 },
      },
      paletteFamily: 'standard-issue',
    },
    head: {
      id: 'si-head-visor',
      slot: 'head',
      spriteId: 'rig-hunter-head',
      width: 86,
      height: 88,
      anchors: {
        // The shipped head segment rotates about its manifest pivot
        // (0.55, 0.90) ≈ the S-REF neck joint; the seat is that
        // pivot in part-local coords.
        neckSeat: { x: 47, y: 79 },
      },
      skirts: { neck: 9 },
      paletteFamily: 'standard-issue',
    },
    armUpperN: {
      id: 'si-arm-upper-n',
      slot: 'armUpperN',
      spriteId: 'part-si-arm-upper-n',
      width: 76,
      height: 38,
      anchors: {
        shoulder: { x: 14, y: 16 },
        elbow: { x: 66, y: 29 },
      },
      paletteFamily: 'standard-issue',
    },
    armForeN: {
      id: 'si-arm-fore-n',
      slot: 'armForeN',
      spriteId: 'part-si-arm-fore-n',
      width: 84,
      height: 24,
      anchors: {
        elbow: { x: 12, y: 12 },
        gripHand: { x: 70, y: 14 },
      },
      skirts: { elbow: 12 },
      paletteFamily: 'standard-issue',
    },
  },
};
