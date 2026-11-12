/**
 * Skin part catalog — the render-side part definitions (M4).
 *
 * Every cosmetic part a player can craft, buy, and wear is a PartDef
 * here: a standalone sprite with its own anchors, authored to the
 * S-REF skeleton exactly like Standard Issue (parts.ts). A skin part
 * REPLACES the stock part in its slot over the empty frame — never
 * an overlay (SPEC §1, the Stomper law).
 *
 * Sets:
 *  - BULWARK (T3 shaped): heavy plate set. Head/back/lower-legs are
 *    the spec proof pieces (PR #288-era proof art, productionized);
 *    torso, arms, and thighs were generated for this slice against
 *    the shipped Standard Issue render as the style reference and
 *    keyed through scripts/pixel-key.py at texel = 4. Anchors were
 *    measured from the keyed art's alpha geometry.
 *  - DREADPLATE (T2 repaint): the Standard Issue silhouettes,
 *    repainted at the file level (bone plate, crimson trim, red glow)
 *    — identical geometry, so the Standard Issue anchors carry over
 *    verbatim (the anchor lint verifies them unchanged).
 *  - Manufacturer heads (T3 head parts): the six standing head
 *    variants re-registered as craftable head parts on the shared
 *    visor geometry (headParts.ts) — same sprites, possession-based
 *    acquisition (skins brief §0.6).
 *
 * The gameplay-side catalog (recipes, costs, tiers, sets as
 * merchandising bundles) lives in src/content/skins.ts and refers
 * to these part ids.
 */
import type { PartDef, PartSetDef } from './parts';
import { STANDARD_ISSUE } from './standardIssue';
import { HUNTER_HEAD_VARIANTS } from './headParts';

// ─── Bulwark (T3 shaped) ─────────────────────────────────────────

export const BULWARK_PARTS: Record<string, PartDef> = {
  'bulwark-head': {
    id: 'bulwark-head',
    slot: 'head',
    spriteId: 'part-bulwark-head',
    width: 109,
    height: 150,
    anchors: { neckSeat: { x: 54, y: 134 } },
    skirts: { neck: 16 },
    paletteFamily: 'bulwark',
  },
  'bulwark-torso': {
    id: 'bulwark-torso',
    slot: 'torso',
    spriteId: 'part-bulwark-torso',
    width: 94,
    height: 154,
    anchors: {
      pelvisSeat: { x: 48, y: 129 },
      neckSeat: { x: 47, y: 20 },
      shoulderSeatN: { x: 76, y: 34 },
      shoulderSeatF: { x: 58, y: 48 },
    },
    mounts: {
      shoulderMount: { x: 76, y: 26 },
      chestMount: { x: 52, y: 66 },
      beltMount: { x: 50, y: 110 },
      // The shield's combat remount (owner ruling, 2026-11-11):
      // the Standard Issue mount's pelvis-relative offset
      // (+26, −42) carried onto this torso, so the shield sits
      // held across the body in aim/recoil on every rig.
      shieldTorsoMount: { x: 74, y: 87 },
    },
    paletteFamily: 'bulwark',
  },
  'bulwark-arm-upper-n': {
    id: 'bulwark-arm-upper-n',
    slot: 'armUpperN',
    spriteId: 'part-bulwark-arm-upper-n',
    width: 92,
    height: 42,
    anchors: { shoulder: { x: 18, y: 20 }, elbow: { x: 84, y: 22 } },
    paletteFamily: 'bulwark',
  },
  'bulwark-arm-fore-n': {
    id: 'bulwark-arm-fore-n',
    slot: 'armForeN',
    spriteId: 'part-bulwark-arm-fore-n',
    width: 68,
    height: 34,
    anchors: { elbow: { x: 8, y: 16 }, gripHand: { x: 56, y: 18 } },
    skirts: { elbow: 10 },
    paletteFamily: 'bulwark',
  },
  'bulwark-arm-far': {
    id: 'bulwark-arm-far',
    slot: 'armFar',
    spriteId: 'part-bulwark-arm-far',
    width: 33,
    height: 68,
    anchors: { shoulder: { x: 14, y: 8 }, supportHand: { x: 24, y: 58 } },
    mounts: { shieldMount: { x: 18, y: 44 } },
    paletteFamily: 'bulwark',
  },
  'bulwark-thigh-f': {
    id: 'bulwark-thigh-f',
    slot: 'thighF',
    spriteId: 'part-bulwark-thigh-f',
    width: 48,
    height: 96,
    anchors: { hip: { x: 24, y: 8 }, knee: { x: 26, y: 84 } },
    skirts: { knee: 12 },
    paletteFamily: 'bulwark',
  },
  'bulwark-thigh-b': {
    id: 'bulwark-thigh-b',
    slot: 'thighB',
    spriteId: 'part-bulwark-thigh-b',
    width: 46,
    height: 92,
    anchors: { hip: { x: 22, y: 8 }, knee: { x: 24, y: 80 } },
    skirts: { knee: 12 },
    paletteFamily: 'bulwark',
  },
  'bulwark-lower-leg-f': {
    id: 'bulwark-lower-leg-f',
    slot: 'lowerLegF',
    spriteId: 'part-bulwark-lower-leg-f',
    width: 63,
    height: 104,
    anchors: { sole: { x: 30, y: 103 }, knee: { x: 30, y: 24 } },
    paletteFamily: 'bulwark',
  },
  'bulwark-lower-leg-b': {
    id: 'bulwark-lower-leg-b',
    slot: 'lowerLegB',
    spriteId: 'part-bulwark-lower-leg-b',
    width: 62,
    height: 104,
    anchors: { sole: { x: 29, y: 103 }, knee: { x: 29, y: 24 } },
    paletteFamily: 'bulwark',
  },
  'bulwark-back': {
    id: 'bulwark-back',
    slot: 'back',
    spriteId: 'part-bulwark-back',
    width: 63,
    height: 138,
    anchors: { mountFace: { x: 44, y: 52 }, topExtent: { x: 28, y: 2 } },
    paletteFamily: 'bulwark',
  },
};

export const BULWARK_SET: PartSetDef = {
  id: 'bulwark',
  label: 'Bulwark',
  parts: {
    back: BULWARK_PARTS['bulwark-back'],
    thighB: BULWARK_PARTS['bulwark-thigh-b'],
    lowerLegB: BULWARK_PARTS['bulwark-lower-leg-b'],
    torso: BULWARK_PARTS['bulwark-torso'],
    armFar: BULWARK_PARTS['bulwark-arm-far'],
    thighF: BULWARK_PARTS['bulwark-thigh-f'],
    lowerLegF: BULWARK_PARTS['bulwark-lower-leg-f'],
    head: BULWARK_PARTS['bulwark-head'],
    armUpperN: BULWARK_PARTS['bulwark-arm-upper-n'],
    armForeN: BULWARK_PARTS['bulwark-arm-fore-n'],
  },
};

// ─── Dreadplate (T2 repaint — Standard Issue geometry) ───────────

function dreadplatePart(siPart: PartDef, spriteId: string): PartDef {
  return {
    ...siPart,
    id: `dread-${siPart.id.replace(/^si-/, '')}`,
    spriteId,
    paletteFamily: 'dreadplate',
  };
}

export const DREADPLATE_PARTS: Record<string, PartDef> = Object.fromEntries(
  Object.values(STANDARD_ISSUE.parts)
    .filter((p): p is PartDef => !!p)
    .map((p) => {
      const spriteId = `part-dread-${p.id === 'si-head-visor' ? 'head' : p.id.replace(/^si-/, '')}`;
      const def = dreadplatePart(p, spriteId);
      return [def.id, def];
    }),
);

export const DREADPLATE_SET: PartSetDef = {
  id: 'dreadplate',
  label: 'Dreadplate',
  parts: Object.fromEntries(
    Object.entries(STANDARD_ISSUE.parts).map(([slot, p]) => [
      slot,
      p ? DREADPLATE_PARTS[`dread-${p.id.replace(/^si-/, '')}`] : p,
    ]),
  ),
};

// ─── Manufacturer heads (craftable head parts) ───────────────────

/** The six manufacturer head variants as craftable PARTS. Geometry
 *  is the shared visor seat (headParts.ts): only the sprite differs. */
export const MANUFACTURER_HEAD_PARTS: Record<string, PartDef> = Object.fromEntries(
  HUNTER_HEAD_VARIANTS.filter((v) => v.standingManufacturer).map((v) => {
    const base = STANDARD_ISSUE.parts.head!;
    const def: PartDef = {
      ...base,
      id: `mfr-head-${v.id.replace(/^mfr-/, '')}`,
      spriteId: v.spriteId,
      paletteFamily: 'standard-issue',
    };
    return [def.id, def];
  }),
);

/** Every skin part definition by part id (render-side truth).
 *  The catalog names the Dreadplate head 'dread-head'; its def is
 *  keyed from the SI visor part ('dread-head-visor') — alias it so
 *  the catalog id resolves. */
export const SKIN_PART_DEFS: Record<string, PartDef> = {
  ...BULWARK_PARTS,
  ...DREADPLATE_PARTS,
  ...(DREADPLATE_PARTS['dread-head-visor']
    ? { 'dread-head': DREADPLATE_PARTS['dread-head-visor'] }
    : {}),
  ...MANUFACTURER_HEAD_PARTS,
};

export function skinPartDef(partId: string): PartDef | undefined {
  return SKIN_PART_DEFS[partId];
}
