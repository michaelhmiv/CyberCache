import { Manufacturer, WeaponType } from '@/types/game';

/**
 * Weapon grammar data — the shape layer of the card compositor
 * (src/lib/pixel/weaponCardCompositor.ts), and the ONLY place weapon
 * silhouette data lives.
 *
 * The marriage (owner decision 2026-11-03): FORGE's per-manufacturer
 * FORM GRAMMARS ride as data inside the parts compositor. A grammar is
 * not code — it is rows in these tables:
 *
 *   - MAKER_SHAPE_SETS      — which stock/grip/forend templates a
 *                             maker wears (the furniture silhouettes).
 *   - FORGE_BODY_PROFILES   — how a maker's receiver silhouette is
 *                             shaped (the Wedge, the Longbow, the
 *                             Anvil, the Prism, the Kit, the Coil).
 *   - BARREL_PROFILES       — [frac, radius] keyframes per type; the
 *                             taper IS the barrel's shape.
 *   - WEAPON_THEMES         — skins: shape-set overrides + palette
 *                             overrides + detail flags. A theme row
 *                             touches NO engine code.
 *
 * Adding a manufacturer = one row in MAKER_SHAPE_SETS + one row in
 * FORGE_BODY_PROFILES + its palette row in
 * constants/weaponVisuals.ts. Adding a weapon type = one row in
 * CARD_LAYOUTS + one in BARREL_PROFILES. Adding a skin = one row in
 * WEAPON_THEMES. The engine never changes.
 *
 * Template point spaces:
 *   - Stock outlines: [xPerMille, yOffFromSpine] — x runs 0 (butt) →
 *     1000 (receiver joint) across the stock length; curves are
 *     pre-sampled Bézier points, authored into the list.
 *   - Grip outlines: [xPx, yPerMille] — x is absolute px in a 15px
 *     grip box, y runs 0 (top) → 1000 (bottom) of grip height.
 *   - Forend outlines: [xPerMille, yOffFromBarrelBottom].
 */

export interface CardLayout {
  bodyX: number; bodyLen: number; bodyH: number;
  barrelLen: number; barrelThick: number;
  magLen: number; gripH: number; stockLen: number;
}

/** Type proportion table at card density (240×88). */
export const CARD_LAYOUTS: Record<WeaponType, CardLayout> = {
  [WeaponType.Pistol]: { bodyX: 74, bodyLen: 56, bodyH: 20, barrelLen: 30, barrelThick: 8, magLen: 22, gripH: 26, stockLen: 0 },
  [WeaponType.SMG]: { bodyX: 58, bodyLen: 72, bodyH: 22, barrelLen: 44, barrelThick: 10, magLen: 38, gripH: 24, stockLen: 20 },
  [WeaponType.Shotgun]: { bodyX: 54, bodyLen: 68, bodyH: 22, barrelLen: 68, barrelThick: 14, magLen: 10, gripH: 24, stockLen: 24 },
  [WeaponType.Launcher]: { bodyX: 58, bodyLen: 76, bodyH: 26, barrelLen: 64, barrelThick: 22, magLen: 0, gripH: 24, stockLen: 16 },
  [WeaponType.Sniper]: { bodyX: 62, bodyLen: 64, bodyH: 18, barrelLen: 92, barrelThick: 6, magLen: 16, gripH: 22, stockLen: 28 },
  [WeaponType.Beam]: { bodyX: 62, bodyLen: 72, bodyH: 20, barrelLen: 56, barrelThick: 8, magLen: 18, gripH: 24, stockLen: 20 },
};

export const STOCK_TEMPLATES: Record<string, { kind: 'poly' | 'skeleton' | 'twinTube'; outline?: [number, number][] }> = {
  // Ironwood — organic: comb rises in a curve, belly sweeps down to a
  // rounded toe, butt is a soft arc. (Bézier-sampled control shape:
  // comb control (350,-13), belly control (450,13).)
  'wood-curved': {
    kind: 'poly',
    outline: [
      [0, -2], [60, -6], [140, -9], [240, -11], [360, -11], [480, -10], [620, -8], [780, -7], [1000, -6],
      [1000, 6], [880, 7], [740, 9], [580, 10], [420, 10], [280, 9], [160, 7], [70, 5], [0, 3],
    ],
  },
  // Wasteland Bone (theme) — same organic family, knobbled: vertebra
  // bulges along the comb and belly, a hooked toe.
  'bone-knobbed': {
    kind: 'poly',
    outline: [
      [0, -1], [70, -7], [150, -6], [230, -10], [320, -8], [410, -11], [500, -8], [600, -10], [720, -8], [860, -7], [1000, -6],
      [1000, 6], [880, 8], [760, 7], [640, 10], [520, 8], [400, 10], [280, 8], [170, 9], [80, 6], [30, 6], [0, 4],
    ],
  },
  // Redline — swept skeleton frame: two rails + a diagonal brace
  // (kind 'skeleton'; outline unused, rails are data below).
  'redline-skeleton': { kind: 'skeleton' },
  // Prismatek — kite: sharp diagonal planes, no horizontal run longer
  // than a third of the stock; the point IS the silhouette.
  'prism-kite': {
    kind: 'poly',
    outline: [
      [0, -4], [300, -9], [620, -3], [1000, -7], [1000, 2], [560, 8], [240, 5], [0, 7],
    ],
  },
  // ThrowTech — chamfered slab: 45° cuts at both rear corners.
  'throwtech-slab': {
    kind: 'poly',
    outline: [
      [90, -6], [1000, -6], [1000, 7], [90, 7], [0, 3], [0, -2],
    ],
  },
  // BlastForge — forge slab: square by design, chamfered toe + heel.
  'blastforge-slab': {
    kind: 'poly',
    outline: [
      [70, -7], [1000, -7], [1000, 8], [140, 8], [0, 4], [0, -3],
    ],
  },
  // HelixWorks — twin round rails joined by ring collars (kind
  // 'twinTube'; outline unused).
  'helix-rails': { kind: 'twinTube' },
};

/** Skeleton/twin-tube stock rail data: [x0pm, y0, x1pm, y1, thick]. */
export const STOCK_RAILS: Record<string, [number, number, number, number, number][]> = {
  'redline-skeleton': [
    [0, -6, 1000, -7, 3], // top rail, raked
    [0, 6, 1000, 5, 3], // bottom rail
    [120, 5, 760, -6, 3], // diagonal brace — the maker's signature sweep
    [30, -6, 30, 6, 4], // butt post
  ],
  'helix-rails': [
    [0, -5, 1000, -5, 3],
    [0, 5, 1000, 5, 3],
  ],
};

export const GRIP_TEMPLATES: Record<string, [number, number][]> = {
  // Wood: palm swell — front edge bulges at 40% height, back edge
  // curves gently (S-curve sampled into the list).
  'wood-swell': [
    [1, 0], [11, 0], [14, 220], [14, 430], [12, 680], [9, 1000], [3, 1000], [0, 720], [0, 380], [0, 120],
  ],
  'bone-grip': [
    [1, 0], [11, 0], [13, 200], [14, 380], [12, 560], [13, 760], [9, 1000], [3, 1000], [1, 740], [0, 420], [1, 140],
  ],
  // Redline: steep rake — the whole outline leans; front edge nearly
  // straight diagonal, back edge stepped.
  'redline-rake': [
    [3, 0], [13, 0], [11, 300], [9, 620], [6, 1000], [0, 1000], [0, 560], [1, 240],
  ],
  // Prismatek: faceted — three hard planes per edge.
  'prism-facet': [
    [1, 0], [12, 0], [14, 360], [10, 700], [8, 1000], [2, 1000], [0, 620], [2, 260],
  ],
  // Standard polymer: mild swell, mild rake.
  'poly-grip': [
    [1, 0], [12, 0], [13, 260], [13, 520], [11, 800], [8, 1000], [2, 1000], [0, 640], [0, 300],
  ],
};

export const FOREND_TEMPLATES: Record<string, [number, number][]> = {
  // Wood: deep at the root, curving up to a slim rounded tip.
  'wood-taper': [
    [0, 0], [1000, 0], [1000, 2], [860, 4], [640, 6], [380, 8], [140, 9], [0, 8],
  ],
  'bone-ribbed': [
    [0, 0], [1000, 0], [1000, 2], [850, 5], [700, 4], [560, 6], [420, 5], [260, 7], [120, 6], [0, 8],
  ],
  // Polymer handguard: wedge taper, nearly straight.
  'poly-wedge': [
    [0, 0], [1000, 0], [920, 3], [500, 5], [0, 7],
  ],
};

/** Barrel radius profiles: [frac, radiusPx] keyframes per type.
 *  The taper IS the shape — a barrel is a tube, not a bar. */
export const BARREL_PROFILES: Record<WeaponType, [number, number][]> = {
  [WeaponType.Pistol]: [[0, 4], [0.7, 3.6], [1, 3]],
  [WeaponType.SMG]: [[0, 5], [0.5, 4.4], [1, 3.8]],
  [WeaponType.Shotgun]: [[0, 7], [0.6, 6.2], [1, 5.4]],
  [WeaponType.Sniper]: [[0, 5.2], [0.15, 4.8], [0.55, 3.4], [1, 2.6]],
  [WeaponType.Launcher]: [[0, 9], [0.7, 9.6], [0.88, 11], [1, 12.5]],
  [WeaponType.Beam]: [[0, 4.5], [1, 3.6]],
};

/** A maker's shape set: template ids per furniture slot. */
export interface ShapeSet {
  stock: string; grip: string; forend: string;
}
export const MAKER_SHAPE_SETS: Record<Manufacturer, ShapeSet> = {
  [Manufacturer.Ironwood]: { stock: 'wood-curved', grip: 'wood-swell', forend: 'wood-taper' },
  [Manufacturer.Redline]: { stock: 'redline-skeleton', grip: 'redline-rake', forend: 'poly-wedge' },
  [Manufacturer.Prismatek]: { stock: 'prism-kite', grip: 'prism-facet', forend: 'poly-wedge' },
  [Manufacturer.ThrowTech]: { stock: 'throwtech-slab', grip: 'poly-grip', forend: 'poly-wedge' },
  [Manufacturer.BlastForge]: { stock: 'blastforge-slab', grip: 'poly-grip', forend: 'poly-wedge' },
  [Manufacturer.HelixWorks]: { stock: 'helix-rails', grip: 'poly-grip', forend: 'poly-wedge' },
};

/**
 * FORGE body profiles — how each maker's RECEIVER silhouette is
 * shaped, as data. The engine's receiver pass applies these moves
 * generically; no maker is named in engine code.
 *
 *   grammar          — the FORGE form grammar's name (documentation).
 *   topRakeEvery     — Wedge: the top edge steps down one texel every
 *                      N columns toward the nose (one inclined plane).
 *   undersideRake*   — Wedge: the bottom edge rises over the last N
 *                      columns, one texel every M columns.
 *   heelRound        — Longbow: the receiver heel rounds off over the
 *                      first N columns.
 *   belly            — Anvil: the body drops N texels deeper overall.
 *   frontChamfer     — Anvil: the nose corner is cut over the last N
 *                      columns.
 *   rearChamfer      — Anvil: the heel shoulder is cut over the
 *                      first N columns.
 *   rivetCorners     — Anvil: bolt heads at the receiver corners.
 *   facetSteps       — Prism: top-edge offset per equal segment.
 *   facetShades      — Prism: main shade per segment (hard planes).
 *   noseClip         — Kit: the module nose clips down over the
 *                      last N columns.
 *   moduleSeam       — Kit: a horizontal seam splits the receiver
 *                      into stacked bolted modules.
 *   capsule          — Coil: the receiver ends round off as a
 *                      capsule over N columns at each end.
 */
export interface ForgeBodyProfile {
  grammar: string;
  topRakeEvery?: number;
  undersideRakeLast?: number;
  undersideRakeEvery?: number;
  heelRound?: number;
  belly?: number;
  frontChamfer?: number;
  rearChamfer?: number;
  rivetCorners?: boolean;
  facetSteps?: number[];
  facetShades?: string[];
  noseClip?: number;
  moduleSeam?: boolean;
  capsule?: number;
}

export const FORGE_BODY_PROFILES: Record<Manufacturer, ForgeBodyProfile> = {
  [Manufacturer.Redline]: {
    grammar: 'the Wedge',
    topRakeEvery: 8,
    undersideRakeLast: 14,
    undersideRakeEvery: 3,
  },
  [Manufacturer.Ironwood]: {
    grammar: 'the Longbow',
    heelRound: 8,
  },
  [Manufacturer.BlastForge]: {
    grammar: 'the Anvil',
    belly: 2,
    frontChamfer: 5,
    rearChamfer: 4,
    rivetCorners: true,
  },
  [Manufacturer.Prismatek]: {
    grammar: 'the Prism',
    facetSteps: [0, 3, -2, 2, 0],
    facetShades: ['P', 'p', 'd', 'P', 'p'],
  },
  [Manufacturer.ThrowTech]: {
    grammar: 'the Kit',
    noseClip: 2,
    moduleSeam: true,
  },
  [Manufacturer.HelixWorks]: {
    grammar: 'the Coil',
    capsule: 6,
  },
};

/**
 * FORGE detail options — presentation knobs the owner can veto
 * without engine work. `blastForgeBrushSpeckle` is the brushed-metal
 * speckle streak pass on BlastForge faces: shipped ON (it was in the
 * approved pass-3 samples), but the owner's veto on it is still open —
 * flipping this one boolean removes it everywhere.
 */
export const FORGE_DETAIL_OPTIONS = {
  blastForgeBrushSpeckle: true,
};

/** A theme (skin): shape-set overrides + palette overrides + detail
 *  flags. Applying a theme touches NO engine code — that is the
 *  long-term contract the shape-data layer exists to prove. Palette
 *  keys are CardShade keys from the card compositor. */
export interface WeaponTheme {
  id: string;
  name: string;
  shapes?: Partial<ShapeSet>;
  palette?: Partial<Record<string, string>>;
  cracks?: boolean;
}
export const WEAPON_THEMES: Record<string, WeaponTheme> = {
  // Wasteland Bone: the Ironwood sniper's furniture becomes carved
  // bone — knobbled stock/grip/forend stamps, bone palette over the
  // wood shades, hairline cracks. Metal, maker identity, and every
  // finish layer are untouched.
  'wasteland-bone': {
    id: 'wasteland-bone',
    name: 'Wasteland Bone',
    shapes: { stock: 'bone-knobbed', grip: 'bone-grip', forend: 'bone-ribbed' },
    palette: { w: '#D8CCAF', v: '#9C8C6C', u: '#EFE6CC', b: '#8A6D3B' },
    cracks: true,
  },
};

/** 3×5 micro font for the maker mark stamped on the receiver. */
export const MARK_FONT: Record<string, string[]> = {
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  W: ['#.#', '#.#', '#.#', '###', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  F: ['###', '#..', '##.', '#..', '#..'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
};
export const MAKER_MARKS: Record<Manufacturer, string> = {
  [Manufacturer.Redline]: 'RL',
  [Manufacturer.Ironwood]: 'IW',
  [Manufacturer.BlastForge]: 'BF',
  [Manufacturer.Prismatek]: 'PX',
  [Manufacturer.ThrowTech]: 'TT',
  [Manufacturer.HelixWorks]: 'HX',
};
