import { EssenceType, MaterialType } from '@/types/game';
import { getMaterialVisual, getResourceVisual } from '@/constants/visualAssets';
import { hashString } from '@/lib/utils/rng';
import { seededRandom } from '@/lib/weaponArt/decalSpec';
import { hexLerp } from './weaponCardCompositor';

/**
 * materialArt — STUFF: the pixel-native material renderer (owner
 * direction approved 2026-11-03, impeccable exploration
 * `materials-pixel-samples/`; retires census item C-2, the
 * ResourceIcon SVG system and every letter-mark improvisation).
 *
 * A material is a physical thing a hunter dug out of the wastes —
 * a pile of dust, a stack of ingots, a coil of wire, a jar of gel —
 * so STUFF draws the stuff itself: each material is a small formed
 * object on a 24×24 texel grid, built by one of eight parameterized
 * grammars for its physical nature, colored by its registry
 * colorway (visualAssets.ts stays the color source of truth),
 * finished by its processing band. THE LETTER MARK IS DEAD: form +
 * saturated colorway is the identity (§8 identity law); the name
 * text that already sits beside every material row does the rest.
 *
 * THE PIXEL DENSITY LAW (DESIGN.md §8) binds everything here:
 * texel = 4; authored AT the grid — no oversampling, no sub-texel
 * features; five-tone ramp per hue, shade toward black, highlight
 * toward white, warm near-black outline; wear at texel scale;
 * glow is hard-edged texel shapes, never gradients. The thumb is
 * DETAIL LEVEL 0: composed per family on its own 12×12 grid —
 * bold silhouette + core + colorway — never a downscale of the
 * object render.
 *
 * The finish axis is the processing BAND (materials carry no
 * rarity — verified in the exploration): raw/signature wear,
 * refined alignment, the composite lamination seam, the essence
 * glow heart. Lineage survives refinement: the five refined forms
 * keep their base material's family, so Refined Alloy reads as
 * Scrap, cleaned, before the name is read.
 *
 * Runtime-composed: zero sprite payload, same as the gear
 * marriage. Compose-then-cache mirrors gearCardCompositor.
 */

export type MaterialFamilyId =
  | 'plates' | 'cluster' | 'pile' | 'shard'
  | 'swatch' | 'vessel' | 'coil' | 'chunk';
export type MaterialBandId = 'raw' | 'signature' | 'refined' | 'composite' | 'essence';
export type MaterialDensity = 'object' | 'thumb';

export interface MaterialArtRow {
  family: MaterialFamilyId;
  variant: string;
  band: MaterialBandId;
}

/**
 * The STUFF data table: one row per registry good — family,
 * variant, band. Colors are NOT here; they resolve from
 * visualAssets at compose time. A new material = one row in an
 * existing family (+ its registry entry); a genuinely new
 * physical nature = one new family.
 */
export const MATERIAL_ART: Readonly<Record<string, MaterialArtRow>> = {
  // — raw base five —
  // (Scrap's row sits at the bottom of this table: pre-merge it was
  // the currency row keyed 'Scrap'; Econ 5 merged the stocks and the
  // row is the one stock's row now — see the note there.)
  [MaterialType.BallisticParts]: { family: 'cluster', variant: 'parts', band: 'raw' },
  [MaterialType.ReactiveComponents]: { family: 'cluster', variant: 'cans', band: 'raw' },
  [MaterialType.TechFragments]: { family: 'chunk', variant: 'tech', band: 'raw' },
  [MaterialType.VoidDust]: { family: 'pile', variant: 'dust', band: 'raw' },
  // — signature tier-2 —
  [MaterialType.Siltglass]: { family: 'shard', variant: 'silt', band: 'signature' },
  [MaterialType.NitrocellGel]: { family: 'vessel', variant: 'jar', band: 'signature' },
  [MaterialType.HeartwoodResin]: { family: 'chunk', variant: 'resin', band: 'signature' },
  [MaterialType.ForgeheartIngots]: { family: 'plates', variant: 'ingot', band: 'signature' },
  [MaterialType.PrismShards]: { family: 'shard', variant: 'prism', band: 'signature' },
  [MaterialType.MagnetiteCores]: { family: 'coil', variant: 'rings', band: 'signature' },
  [MaterialType.MycoSteelFiber]: { family: 'swatch', variant: 'fiber', band: 'signature' },
  // — refined (lineage: family follows the base material) —
  [MaterialType.RefinedAlloy]: { family: 'plates', variant: 'neat', band: 'refined' },
  [MaterialType.TemperedParts]: { family: 'cluster', variant: 'parts', band: 'refined' },
  [MaterialType.StabilizedCells]: { family: 'cluster', variant: 'cells', band: 'refined' },
  [MaterialType.WovenCircuits]: { family: 'swatch', variant: 'circuit', band: 'refined' },
  [MaterialType.CondensedVoid]: { family: 'pile', variant: 'brick', band: 'refined' },
  // — Lab composites —
  [MaterialType.CompositePlating]: { family: 'plates', variant: 'laminate', band: 'composite' },
  [MaterialType.CircuitLattice]: { family: 'swatch', variant: 'lattice', band: 'composite' },
  [MaterialType.Voidweave]: { family: 'swatch', variant: 'weave', band: 'composite' },
  [MaterialType.Chromaweave]: { family: 'swatch', variant: 'chroma', band: 'composite' },
  // — essences —
  [EssenceType.IgnitionFluid]: { family: 'vessel', variant: 'jerry', band: 'essence' },
  [EssenceType.ConduitWire]: { family: 'coil', variant: 'wire', band: 'essence' },
  [EssenceType.AcidCompound]: { family: 'vessel', variant: 'flask', band: 'essence' },
  [EssenceType.CryoGel]: { family: 'vessel', variant: 'jar', band: 'essence' },
  [EssenceType.VoidEssence]: { family: 'vessel', variant: 'orb', band: 'essence' },
  // — the merged Scrap stock (Econ 5, 0069): one stock, one row.
  // Pre-merge this key was the profile currency's row and the
  // material lived under 'ScrapAlloy' (plates/junk); the merge kept
  // the currency's rust-pile form for the unified stock — refining
  // it into RefinedAlloy (clean silver plates) is a transformation,
  // the authored lineage exception in materialArt.test.ts.
  [MaterialType.Scrap]: { family: 'pile', variant: 'junk', band: 'raw' },
};

/** The art row for any material / essence / resource id. */
export function materialArtRow(id: string): MaterialArtRow {
  return MATERIAL_ART[id] ?? { family: 'chunk', variant: 'tech', band: 'raw' };
}

/* ------------------------------------------------------------------ */
/* Ramps (the STUFF five-tone factors, from the approved exploration) */
/* ------------------------------------------------------------------ */

interface StuffRamp { deep: string; shade: string; base: string; lite: string; hot: string }

function stuffRamp(base: string): StuffRamp {
  return {
    deep: hexLerp(base, '#000000', 0.52),
    shade: hexLerp(base, '#000000', 0.26),
    base,
    lite: hexLerp(base, '#FFFFFF', 0.34),
    hot: hexLerp(base, '#FFFFFF', 0.60),
  };
}

/** Shade alphabet: D/d/P/p/L = base ramp deep→hot, A/a/E = accent
 *  base / dark / lite, K = warm near-black outline, S = ground
 *  shadow, W = hard white (cryo frost). */
export type StuffShade = 'K' | 'S' | 'W' | 'D' | 'd' | 'P' | 'p' | 'L' | 'A' | 'a' | 'E';

const RAMP_SHADES = { deep: 'D', shade: 'd', base: 'P', lite: 'p', hot: 'L' } as const;
const ACCENT_SHADES = { base: 'A', dark: 'a', hot: 'E' } as const;
type R = typeof RAMP_SHADES;
type A = typeof ACCENT_SHADES;

/* ------------------------------------------------------------------ */
/* Plate                                                               */
/* ------------------------------------------------------------------ */

const GROUND_Y = 21; // objects sit on this row of the 24 grid

type Pt = [number, number];

class StuffPlate {
  readonly n: number;
  cells: string[][];

  constructor(n: number) {
    this.n = n;
    this.cells = Array.from({ length: n }, () => new Array<string>(n).fill('.'));
  }

  in(x: number, y: number) { return x >= 0 && x < this.n && y >= 0 && y < this.n; }
  get(x: number, y: number): string { return this.in(x, y) ? this.cells[y][x] : '.'; }
  set(x: number, y: number, s: StuffShade) { if (this.in(x, y)) this.cells[y][x] = s; }
  /** Set only over already-filled cells. */
  over(x: number, y: number, s: StuffShade) { if (this.get(x, y) !== '.') this.set(x, y, s); }
  filled(x: number, y: number) { return this.get(x, y) !== '.'; }
  rows(): string[] { return this.cells.map((r) => r.join('')); }

  rect(x: number, y: number, w: number, h: number, s: StuffShade) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, s);
  }

  /** Scanline polygon fill (the gear plate engine's approach). */
  poly(pts: Pt[], s: StuffShade) {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.n - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) this.set(x, y, s);
      }
    }
  }

  /** Filled ellipse by texel-center test (bbox = center ± radii). */
  ellipse(cx: number, cy: number, rx: number, ry: number, s: StuffShade) {
    const x0 = Math.floor(cx - rx - 1); const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1); const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / (rx + 0.5); const dy = (y - cy) / (ry + 0.5);
      if (dx * dx + dy * dy <= 1) this.set(x, y, s);
    }
  }

  /** Ellipse ring: inside the outer ellipse, outside the shrunk one. */
  ellipseRing(cx: number, cy: number, rx: number, ry: number, thickness: number, s: StuffShade) {
    const x0 = Math.floor(cx - rx - 1); const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1); const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dxo = (x - cx) / (rx + 0.5); const dyo = (y - cy) / (ry + 0.5);
      if (dxo * dxo + dyo * dyo > 1) continue;
      const irx = rx - thickness; const iry = ry - thickness;
      if (irx > 0 && iry > 0) {
        const dxi = (x - cx) / (irx + 0.5); const dyi = (y - cy) / (iry + 0.5);
        if (dxi * dxi + dyi * dyi <= 1) continue;
      }
      this.set(x, y, s);
    }
  }

  bodyMask(): boolean[][] {
    return this.cells.map((row) => row.map((c) => c !== '.'));
  }
}

/* ------------------------------------------------------------------ */
/* Seeded helpers (mulberry stream via the decal spec's rng)           */
/* ------------------------------------------------------------------ */

type Rng = () => number;
const rint = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
function choice<T>(rng: Rng, arr: readonly T[]): T { return arr[Math.floor(rng() * arr.length)]; }

/* ------------------------------------------------------------------ */
/* Finish pass — wear + outline, shared by every family                */
/* ------------------------------------------------------------------ */

const WEAR: Record<MaterialBandId, { chipP: number; scratches: number }> = {
  raw: { chipP: 0.13, scratches: 2 },
  signature: { chipP: 0.07, scratches: 1 },
  refined: { chipP: 0.015, scratches: 0 },
  composite: { chipP: 0.015, scratches: 0 },
  essence: { chipP: 0.05, scratches: 0 },
};

function toneNoise(cv: StuffPlate, band: MaterialBandId, rng: Rng) {
  const density = band === 'raw' || band === 'signature' ? 0.16 : 0.07;
  for (let y = 0; y < cv.n; y++) for (let x = 0; x < cv.n; x++) {
    if (cv.get(x, y) === 'P' && rng() < density) cv.set(x, y, choice(rng, ['d', 'p'] as const));
  }
}

function finishPass(cv: StuffPlate, band: MaterialBandId, rng: Rng) {
  const { chipP, scratches } = WEAR[band];
  const n = cv.n;
  let mask = cv.bodyMask();
  // Chips: knock out or darken silhouette-edge texels.
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!mask[y][x]) continue;
    const edge = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(
      ([dx, dy]) => !(x + dx >= 0 && x + dx < n && y + dy >= 0 && y + dy < n && mask[y + dy][x + dx]),
    );
    if (edge && rng() < chipP) {
      if (rng() < 0.45) cv.cells[y][x] = '.';
      else cv.set(x, y, 'D');
    }
  }
  // Scratches: short dark runs across the body.
  const body: Pt[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cv.filled(x, y)) body.push([x, y]);
  for (let i = 0; i < scratches && body.length > 0; i++) {
    const [sx, sy] = body[Math.floor(rng() * body.length)];
    const len = rint(rng, 2, 4);
    for (let k = 0; k < len; k++) if (cv.filled(sx + k, sy)) cv.set(sx + k, sy, 'D');
  }
  // Outline: warm near-black ring on empty texels adjacent to body.
  mask = cv.bodyMask();
  const ring: Pt[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (mask[y][x]) continue;
    const near = ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const).some(
      ([dx, dy]) => x + dx >= 0 && x + dx < n && y + dy >= 0 && y + dy < n && mask[y + dy][x + dx],
    );
    if (near) ring.push([x, y]);
  }
  for (const [x, y] of ring) cv.set(x, y, 'K');
  // Ground shadow: a hard dark smudge under the object's footprint,
  // visible only where the object is not (the exploration's
  // composite order: shadow first, object over it).
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (cv.filled(x, y)) continue;
    const dx = (x - 12) / 8.5; const dy = (y - (GROUND_Y + 1)) / 1.5;
    if (dx * dx + dy * dy <= 1) cv.set(x, y, 'S');
  }
}

/* ------------------------------------------------------------------ */
/* Families — object density (24 grid)                                 */
/* ------------------------------------------------------------------ */

function paintPlates(cv: StuffPlate, R: R, A: A, variant: string, band: MaterialBandId, rng: Rng) {
  const neat = band === 'refined' || band === 'composite';
  const slabs = variant === 'laminate' ? 4 : 3;
  const h = variant === 'laminate' ? 3 : 4;
  let y = GROUND_Y - slabs * h + (variant === 'laminate' ? 1 : 0);
  for (let i = 0; i < slabs; i++) {
    const w = neat ? 16 : choice(rng, [14, 15, 16, 17]);
    const x = 4 + (neat ? 0 : rint(rng, -1, 2));
    if (variant === 'ingot') {
      cv.poly([[x + 2, y], [x + w - 3, y], [x + w - 1, y + h - 1], [x, y + h - 1]], 'P');
    } else {
      cv.rect(x, y, w, h, 'P');
    }
    cv.rect(x, y, w, 1, 'p'); // top face light
    cv.rect(x, y + h - 1, w, 1, 'd'); // bottom shade
    if (variant === 'laminate') cv.rect(x, y + h - 1, w, 1, A.dark); // lamination seam
    if (band === 'refined') cv.rect(x, y, w, 1, 'L'); // machined top edge
    y += h;
  }
  if (variant === 'junk' || variant === 'neat') {
    // Lineage motif: one bolt rides the top plate in both forms.
    const bx = neat ? 10 : 8;
    const by = GROUND_Y - slabs * h;
    cv.rect(bx, by + 1, 2, 2, 'D');
    cv.set(bx, by + 1, 'L');
  }
}

function paintCluster(cv: StuffPlate, R: R, A: A, variant: string, band: MaterialBandId, rng: Rng) {
  const neat = band === 'refined' || band === 'composite';
  const baseY = GROUND_Y;
  if (variant === 'parts') {
    // Three shell rounds standing + one barrel laid across the top.
    // PRODUCTION FIX (exploration head-to-head): the barrel SEATS on
    // the tallest shell — its bottom row touches the shell tops,
    // with the chamber block as the mount — never floats.
    const heights = [5, 10, 15].map(() => (neat ? 8 : choice(rng, [7, 8, 9])));
    const maxH = Math.max(...heights);
    [5, 10, 15].forEach((x, i) => {
      const hgt = heights[i];
      cv.rect(x, baseY - hgt, 3, hgt, 'P');
      cv.rect(x, baseY - hgt, 3, 2, A.base); // shell tip
      cv.rect(x, baseY - 2, 3, 2, 'd');
    });
    const by = baseY - maxH - 3; // barrel rows by..by+2, bottom = tallest shell top - 1
    cv.rect(4, by, 17, 3, 'd'); // barrel
    cv.rect(4, by, 17, 1, 'p');
    cv.rect(19, by, 2, 3, 'D'); // muzzle
    cv.rect(6, by + 3, 4, 2, 'D'); // chamber block — the seat
  } else if (variant === 'cans') {
    for (const x of [4, 10, 16]) {
      const hgt = choice(rng, [9, 10, 11]);
      cv.rect(x, baseY - hgt, 4, hgt, 'P');
      cv.rect(x, baseY - hgt, 4, 2, 'p'); // cap band
      cv.set(x + 1, baseY - hgt - 1, 'L'); // terminal nub
      cv.set(x + 2, baseY - hgt + 4, A.hot); // charge node
      cv.rect(x, baseY - 3, 4, 3, 'd');
    }
  } else { // cells — uniform capped cells; refinement reads as alignment
    for (const x of [4, 10, 16]) {
      cv.rect(x, baseY - 10, 4, 10, 'P');
      cv.rect(x, baseY - 10, 4, 1, A.base); // cap band
      cv.set(x + 1, baseY - 11, 'L');
      cv.rect(x + 1, baseY - 7, 2, 1, 'L'); // level ticks
      cv.rect(x + 1, baseY - 5, 2, 1, 'p');
      cv.rect(x, baseY - 2, 4, 2, 'd');
    }
  }
}

function paintPile(cv: StuffPlate, R: R, A: A, variant: string, band: MaterialBandId, rng: Rng) {
  const cx = 12;
  if (variant === 'brick') {
    // Condensed Void: the same heap compressed — squarer, denser,
    // a bright seam where the charge packs down the center.
    const rows: Array<[number, number]> = [[6, 13], [7, 15], [8, 17], [9, 18], [10, 19], [11, 20]];
    const top = GROUND_Y - rows.length * 2 + 2;
    let y = top;
    for (const [, w] of rows) {
      const x0 = cx - Math.floor(w / 2);
      cv.rect(x0, y, w, 2, 'P');
      cv.rect(x0, y, w, 1, 'p');
      y += 2;
    }
    for (let yy = top + 2; yy < GROUND_Y; yy++) cv.set(cx + (yy % 3 === 0 ? 1 : 0), yy, A.hot);
    return;
  }
  // Terraced mound: rows widen toward the ground.
  const top = variant === 'dust' ? 11 : 12;
  for (let i = 0, y = top; y <= GROUND_Y; i++, y++) {
    const half = 2 + i * 1.35;
    const x0 = Math.floor(cx - half);
    const x1 = Math.floor(cx + half);
    for (let x = x0; x <= x1; x++) {
      let tone: StuffShade = y === top || x === x0 ? 'p' : 'P';
      if (rng() < 0.22) tone = choice(rng, ['d', 'P', 'p'] as const);
      cv.set(x, y, tone);
    }
  }
  // Scattered bits at the base.
  const bits = variant === 'dust' ? 5 : 7;
  for (let i = 0; i < bits; i++) {
    cv.rect(rint(rng, 2, 21), GROUND_Y, choice(rng, [1, 2]), 1, choice(rng, ['P', 'd'] as const));
  }
  if (variant === 'dust') {
    for (let i = 0; i < 5; i++) cv.set(rint(rng, 6, 18), rint(rng, 12, 19), A.base); // accent flecks
    for (let i = 0; i < 3; i++) cv.set(rint(rng, 7, 17), rint(rng, 7, 10), A.hot); // motes lifting off
  }
  if (variant === 'junk') {
    // Scrap: junk bits stab out of the heap.
    cv.rect(6, 12, 4, 2, 'd');
    cv.poly([[16, 10], [19, 13], [15, 14]], 'd');
    cv.rect(10, 13, 2, 2, 'D');
    cv.set(10, 13, A.hot);
  }
}

function paintShard(cv: StuffPlate, R: R, A: A, variant: string, band: MaterialBandId, rng: Rng) {
  // PRODUCTION FIX: Siltglass leaned flame-ward as a tall spire —
  // the silt form is squatter (storm-fused, half-buried) and banks
  // a dust drift against its bases; the prism keeps the tall read.
  const silt = variant === 'silt';
  const shard = (xBase: number, w: number, hgt: number, lean: number) => {
    const topX = xBase + lean;
    cv.poly([[topX, GROUND_Y - hgt], [xBase + w, GROUND_Y], [xBase, GROUND_Y]], 'P');
    // Facet split: one hard vertical plane change, not a teardrop.
    const fx = xBase + Math.max(1, Math.floor(w / 3));
    cv.poly([[topX, GROUND_Y - hgt], [fx + 1, GROUND_Y - Math.floor(hgt / 3)], [fx, GROUND_Y], [xBase, GROUND_Y]], 'p');
    cv.poly([[topX, GROUND_Y - hgt], [xBase + w, GROUND_Y], [fx, GROUND_Y]], 'd');
    cv.set(topX, GROUND_Y - hgt, A.hot);
  };
  if (silt) {
    shard(4, 6, 8, 1);
    shard(9, 7, 12, 1);
    shard(16, 5, 7, 1);
  } else {
    shard(4, 5, 11, 1);
    shard(9, 6, 16, 1); // the tall one
    shard(16, 4, 9, 1);
  }
  for (let i = 0; i < 4; i++) cv.rect(rint(rng, 3, 20), GROUND_Y, 2, 1, 'd'); // small bits at the base
  if (silt) {
    // Dust drift banked against the bases + dust settled over the body.
    cv.rect(rint(rng, 2, 5), GROUND_Y - 1, 4, 1, A.base);
    cv.rect(rint(rng, 15, 18), GROUND_Y - 1, 4, 1, A.base);
    for (let i = 0; i < 16; i++) {
      const x = rint(rng, 3, 21); const y = rint(rng, 8, GROUND_Y);
      if (cv.filled(x, y)) cv.set(x, y, A.base);
    }
  }
}

function paintSwatch(cv: StuffPlate, R: R, A: A, variant: string, band: MaterialBandId, rng: Rng) {
  if (variant === 'fiber') {
    // PRODUCTION FIX: the first pass hung as an even mop. The fiber
    // now hangs in three bundles with gaps between them, tie rows
    // binding the bundles, tips uneven.
    cv.rect(5, 5, 14, 3, 'P'); // woven header band
    for (let x = 5; x < 19; x += 2) cv.set(x, 6, 'd');
    const bundleCols = [5, 6, 7, 10, 11, 12, 15, 16, 17];
    for (const x of bundleCols) {
      const ln = rint(rng, 8, 13);
      const tone: StuffShade = x % 2 ? 'P' : 'd';
      for (let y = 8; y < 8 + ln; y++) {
        const wob = (Math.floor(y / 3) + x) % 4 === 0 ? 1 : 0;
        cv.set(x + wob, y, tone);
      }
    }
    for (const ty of [12, 17]) { // woven tie rows
      for (let x = 5; x < 19; x++) if (cv.filled(x, ty)) cv.set(x, ty, x % 2 ? 'p' : 'D');
    }
    for (let x = 5; x < 19; x++) if (cv.filled(x, 20)) cv.set(x, 20, 'd'); // tip tie
    for (let i = 0; i < 4; i++) cv.set(rint(rng, 5, 18), rint(rng, 10, 19), A.hot); // spore dots
    return;
  }
  const x0 = 5; const y0 = 6; const w = 14; const h = 13;
  if (variant === 'lattice') {
    cv.rect(x0, y0, w, h, 'D');
    for (let gx = x0; gx < x0 + w; gx += 3) cv.rect(gx, y0, 1, h, 'P');
    for (let gy = y0; gy < y0 + h; gy += 3) cv.rect(x0, gy, w, 1, 'P');
    for (let gx = x0; gx < x0 + w; gx += 3) for (let gy = y0; gy < y0 + h; gy += 3) cv.set(gx, gy, 'L');
  } else {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const over = (Math.floor(xx / 2) + Math.floor(yy / 2)) % 2 === 0;
      let tone: StuffShade;
      if (variant === 'chroma' && yy >= 8) tone = over ? A.base : A.dark; // pigment bands
      else tone = over ? 'p' : 'd';
      cv.set(x0 + xx, y0 + yy, tone);
    }
    if (variant === 'circuit') {
      for (let gx = x0 + 2; gx < x0 + w; gx += 4) for (let gy = y0 + 2; gy < y0 + h; gy += 4) cv.set(gx, gy, A.hot); // node dots
      cv.rect(x0 + 2, y0 + 6, 9, 1, A.dark); // one trace
    }
    if (variant === 'weave') { // Voidweave: sparse accent flecks in deep cloth
      for (let i = 0; i < 7; i++) cv.set(rint(rng, x0, x0 + w - 1), rint(rng, y0, y0 + h - 1), A.base);
    }
  }
  cv.poly([[x0 + w - 3, y0], [x0 + w - 1, y0], [x0 + w - 1, y0 + 2]], 'D'); // folded corner
  for (let x = x0; x < x0 + w; x += 2) { // fringe
    cv.set(x, y0 + h, 'd');
    if (rng() < 0.5) cv.set(x, y0 + h + 1, 'd');
  }
}

function paintVessel(cv: StuffPlate, R: R, A: A, variant: string, band: MaterialBandId, rng: Rng) {
  if (variant === 'jerry') {
    cv.rect(8, 6, 9, 2, 'd'); // handle bar
    cv.rect(8, 6, 2, 4, 'd');
    cv.rect(15, 6, 2, 4, 'd');
    cv.rect(6, 9, 13, 12, 'P');
    cv.rect(16, 7, 3, 3, 'D'); // cap
    const fillTop = choice(rng, [14, 15]);
    cv.rect(7, fillTop, 11, GROUND_Y - fillTop, A.dark); // the fuel
    cv.rect(7, fillTop, 11, 1, A.hot); // surface line
    cv.rect(7, 10, 1, 10, 'p'); // highlight stripe
  } else if (variant === 'flask') {
    cv.rect(10, 5, 4, 2, 'D'); // cap
    cv.rect(10, 7, 4, 4, 'd'); // neck
    cv.ellipse(12, 15.5, 7, 5.5, 'P');
    cv.rect(5, 16, 15, 6, A.dark); // reagent fill (lower body)
    cv.ellipse(12, 16, 7, 2, A.dark); // meniscus
    cv.set(9, 18, A.hot); // bubbles
    cv.set(13, 19, A.hot);
    cv.set(8, 12, 'L'); // glass light
  } else if (variant === 'jar') {
    cv.rect(5, 8, 15, 3, 'd'); // lid
    for (let x = 6; x < 19; x += 3) cv.set(x, 9, 'D'); // lid ridges
    cv.rect(5, 11, 15, 10, 'P'); // the gel itself
    cv.rect(5, 11, 15, 2, A.base); // gel surface tone
    cv.rect(5, 18, 15, 3, 'd');
    cv.rect(6, 12, 1, 8, 'L'); // jar light
    if (band === 'essence') { // Cryo frost
      for (const x of [7, 11, 15, 18]) cv.set(x, 8, 'W');
    } else { // Nitro warning band
      cv.rect(5, 15, 15, 1, 'D');
    }
  } else { // orb — Void Essence: the charge, seated in a clamp ring
    cv.poly([[8, 20], [16, 20], [14, 17], [10, 17]], 'd'); // stand
    cv.ellipse(12, 12, 6, 6, 'P');
    cv.ellipse(12, 12, 4, 4, 'd');
    cv.rect(11, 11, 3, 3, A.hot); // the charge, lit
    cv.set(10, 10, A.base);
    cv.rect(4, 10, 2, 4, 'D'); // clamp brackets
    cv.rect(18, 10, 2, 4, 'D');
    cv.set(8, 8, 'L');
  }
}

function paintCoil(cv: StuffPlate, R: R, A: A, variant: string, _band: MaterialBandId, _rng: Rng) {
  if (variant === 'wire') {
    for (const cy of [9, 13, 17]) cv.ellipseRing(12, cy, 7, 3, 2, 'P');
    cv.set(12, 6, A.hot); // charge flecks
    cv.set(8, 13, A.hot);
    cv.set(15, 17, A.hot);
    // Free end curling off the top ring.
    for (const [x, y] of [[19, 7], [20, 6], [21, 6], [21, 7], [20, 8]] as const) cv.set(x, y, 'p');
  } else { // Magnetite square rings: deep-filled so each torus reads
    const rings: Array<[number, number, number, number]> = [[6, 6, 13, 4], [5, 11, 14, 4], [7, 16, 12, 4]];
    for (const [x, y, w, h] of rings) {
      cv.rect(x, y, w, h, 'D'); // the hole, shadowed
      for (let xx = x; xx < x + w; xx++) { cv.set(xx, y, 'P'); cv.set(xx, y + 1, 'P'); cv.set(xx, y + h - 2, 'P'); cv.set(xx, y + h - 1, 'P'); }
      for (let yy = y; yy < y + h; yy++) { cv.set(x, yy, 'P'); cv.set(x + 1, yy, 'P'); cv.set(x + w - 2, yy, 'P'); cv.set(x + w - 1, yy, 'P'); }
      cv.rect(x, y, w, 1, 'p');
      cv.rect(x, y, 3, 2, A.base); // pole face
      cv.rect(x + w - 3, y + h - 2, 3, 2, 'L');
    }
  }
}

function paintChunk(cv: StuffPlate, R: R, A: A, variant: string, band: MaterialBandId, rng: Rng) {
  // Tech: a JAGGED broken housing, flat facets and hard corners —
  // never a round gem.
  const pts: Pt[] = variant === 'resin'
    ? [[10, 4], [14, 5], [16, 10], [15, 16], [13, 20], [9, 20], [7, 14], [7, 8]]
    : [[7, 8], [11, 5], [17, 6], [20, 10], [17, 13], [19, 17], [15, 20], [8, 20], [4, 16], [6, 12], [4, 10]];
  cv.poly(pts, 'P');
  // Facet: lit plane upper-left of a jagged split.
  cv.poly([[8, 7], [14, 5], [12, 12], [9, 13]], 'p');
  cv.poly([[12, 12], [18, 9], [19, 15], [16, 20], [11, 17]], 'd');
  // Seeded crack: dark path from the top edge inward.
  let x = choice(rng, [10, 12, 13]);
  let y = 6;
  for (let i = 0; i < 6; i++) {
    cv.set(x, y, 'D');
    x += choice(rng, [-1, 0, 1]);
    y += 1;
  }
  if (variant === 'tech') {
    cv.rect(13, 12, 5, 4, 'D'); // the intact chip
    cv.rect(14, 13, 3, 2, A.dark);
    for (const px of [13, 15, 17]) cv.set(px, 16, A.base); // pins
    cv.rect(7, 14, 5, 1, A.dark); // traces
    cv.set(8, 11, A.hot);
  } else { // resin: lit core + drip nub
    cv.rect(10, 12, 3, 3, A.base);
    cv.set(11, 13, A.hot);
    cv.rect(10, 20, 2, 1, 'P');
  }
}

const OBJECT_PAINTERS: Record<MaterialFamilyId, (cv: StuffPlate, R: R, A: A, variant: string, band: MaterialBandId, rng: Rng) => void> = {
  plates: paintPlates,
  cluster: paintCluster,
  pile: paintPile,
  shard: paintShard,
  swatch: paintSwatch,
  vessel: paintVessel,
  coil: paintCoil,
  chunk: paintChunk,
};

/* ------------------------------------------------------------------ */
/* Families — thumb density (12 grid, detail level 0)                  */
/*                                                                     */
/* Composed per family on the small grid — bold silhouette + core +    */
/* colorway, never a downscale. PRODUCTION FIX (exploration            */
/* head-to-head): the swatch thumbs separated on colorway alone and    */
/* Tech's thumb lost its story; thumbs are now variant-composed so     */
/* structure, not just hue, differs inside a family.                   */
/* ------------------------------------------------------------------ */

function thumbPlates(cv: StuffPlate, R: R, A: A, variant: string) {
  [9, 10, 9].forEach((w, i) => {
    const y = 8 - i * 3;
    cv.rect(6 - Math.floor(w / 2), y, w, 3, 'P');
    cv.rect(6 - Math.floor(w / 2), y, w, 1, 'p');
  });
  if (variant === 'junk' || variant === 'neat') cv.set(5, 3, 'D'); // the lineage bolt
}

function thumbCluster(cv: StuffPlate, R: R, A: A, variant: string) {
  for (const x of [2, 5, 8]) {
    cv.rect(x, 4, 2, 6, 'P');
    cv.rect(x, 4, 2, 1, variant === 'cells' ? A.base : A.hot);
    if (variant === 'cans') cv.set(x + 1, 3, 'L'); // terminal nubs
    if (variant === 'cells') cv.rect(x, 7, 2, 1, 'L'); // level ticks
  }
  if (variant === 'parts') { // the seated barrel rides the tops
    cv.rect(2, 3, 8, 1, 'd');
    cv.set(9, 3, 'D');
  }
  cv.rect(2, 10, 8, 1, 'd');
}

function thumbPile(cv: StuffPlate, R: R, A: A, variant: string) {
  if (variant === 'brick') {
    [[3, 6], [2, 8], [2, 9]].forEach(([x, w], i) => {
      const y = 8 - i * 2;
      cv.rect(x, y, w, 2, 'P');
      cv.rect(x, y, w, 1, 'p');
    });
    cv.set(6, 5, A.hot); // the packed seam
    cv.set(6, 7, A.hot);
    return;
  }
  for (let i = 0; i < 6; i++) {
    const y = 5 + i;
    const wdt = 3 + i * 2;
    cv.rect(6 - Math.floor(wdt / 2), y, wdt, 1, i === 0 ? 'p' : 'P');
  }
  cv.set(3, 10, 'd');
  cv.set(9, 10, 'd');
  if (variant === 'dust') cv.set(6, 3, A.hot); // one mote lifting off
  if (variant === 'junk') { // junk bits stab out of the heap
    cv.set(4, 4, 'd');
    cv.set(8, 3, 'd');
    cv.set(6, 4, 'D');
  }
}

function thumbShard(cv: StuffPlate, R: R, A: A, variant: string) {
  const silt = variant === 'silt';
  const topY = silt ? 4 : 2;
  cv.poly([[6, topY], [8, 10], [4, 10]], 'P');
  cv.poly([[6, topY], [8, 10], [6, 10]], 'd');
  cv.poly([[3, 5], [4, 10], [2, 10]], 'd');
  cv.set(6, topY, A.hot);
  if (silt) { // dust banked at the base reads even at thumb size
    cv.set(5, 10, A.base);
    cv.set(7, 10, A.base);
  }
}

function thumbSwatch(cv: StuffPlate, R: R, A: A, variant: string, rng: Rng) {
  if (variant === 'fiber') {
    cv.rect(3, 3, 7, 2, 'P'); // header band
    for (const x of [3, 4, 6, 7, 9]) { // bundled strands, gaps between
      for (let y = 5; y <= 10; y++) cv.set(x, y, x % 2 ? 'P' : 'd');
    }
    for (let x = 3; x < 10; x++) if (cv.filled(x, 8)) cv.set(x, 8, 'p'); // tie row
    return;
  }
  if (variant === 'lattice') {
    cv.rect(3, 3, 7, 7, 'D');
    for (const gx of [3, 6, 9]) cv.rect(gx, 3, 1, 7, 'P');
    for (const gy of [3, 6, 9]) cv.rect(3, gy, 7, 1, 'P');
    for (const gx of [3, 6, 9]) for (const gy of [3, 6, 9]) cv.set(gx, gy, 'L');
    return;
  }
  for (let yy = 3; yy < 10; yy++) for (let xx = 3; xx < 10; xx++) {
    const over = (Math.floor((xx - 3) / 2) + Math.floor((yy - 3) / 2)) % 2 === 0;
    let tone: StuffShade;
    if (variant === 'chroma') tone = yy >= 7 ? (over ? A.base : A.dark) : (over ? 'p' : 'd'); // pigment split
    else if (variant === 'weave') tone = over ? 'D' : 'd'; // deep cloth, not bright checker
    else tone = over ? 'p' : 'd';
    cv.set(xx, yy, tone);
  }
  if (variant === 'circuit') { // node dots at the crossings
    for (const [nx, ny] of [[4, 4], [8, 4], [4, 8], [8, 8]] as const) cv.set(nx, ny, A.hot);
  }
  if (variant === 'weave') { // sparse flecks in the deep cloth
    for (let i = 0; i < 3; i++) cv.set(rint(rng, 3, 9), rint(rng, 3, 9), A.base);
  }
  cv.set(3, 10, 'd'); // fringe
  cv.set(7, 10, 'd');
}

function thumbVessel(cv: StuffPlate, R: R, A: A, variant: string) {
  if (variant === 'orb') {
    cv.ellipse(6.5, 6.5, 3.5, 3.5, 'P');
    cv.rect(5, 9, 3, 1, 'd'); // stand
    cv.set(6, 6, A.hot); // the charge
    return;
  }
  if (variant === 'jerry') {
    cv.rect(4, 3, 5, 1, 'd'); // handle
    cv.rect(3, 4, 7, 7, 'P');
    cv.rect(3, 8, 7, 3, A.dark); // the fuel
    cv.rect(3, 8, 7, 1, A.hot);
    cv.set(4, 5, 'L');
    return;
  }
  if (variant === 'flask') {
    cv.rect(5, 2, 3, 2, 'd'); // neck
    cv.rect(4, 4, 5, 2, 'P');
    cv.rect(3, 6, 7, 5, 'P');
    cv.rect(3, 9, 7, 2, A.dark); // reagent fill
    cv.set(5, 7, 'L');
    return;
  }
  // jar
  cv.rect(4, 4, 5, 2, 'd'); // cap/lid
  cv.rect(3, 6, 7, 5, 'P');
  cv.rect(3, 8, 7, 3, A.base); // fill
  cv.set(4, 6, 'L');
}

function thumbCoil(cv: StuffPlate, R: R, A: A, variant: string) {
  if (variant === 'rings') {
    // Square rings — a different silhouette from the wire's loops.
    for (const y of [3, 7]) {
      cv.rect(3, y, 7, 1, 'P');
      cv.rect(3, y + 2, 7, 1, 'P');
      cv.rect(3, y, 1, 3, 'P');
      cv.rect(9, y, 1, 3, 'P');
    }
    cv.set(3, 3, A.base); // pole face
    return;
  }
  for (const cy of [4, 7, 10]) cv.ellipseRing(6.5, cy, 3.5, 1.5, 1, 'P');
  cv.set(9, 3, A.hot);
}

function thumbChunk(cv: StuffPlate, R: R, A: A, variant: string) {
  cv.poly([[4, 4], [8, 3], [10, 6], [9, 10], [5, 10], [3, 7]], 'P');
  cv.poly([[7, 4], [10, 6], [9, 10], [6, 8]], 'd');
  if (variant === 'tech') {
    // PRODUCTION FIX: the broken-housing story survives at 12 —
    // the intact chip block, its lit core, and the crack are the
    // thumb's whole composition, not a generic blob + fleck.
    cv.rect(6, 6, 3, 2, 'D'); // the intact chip
    cv.set(7, 6, A.dark);
    cv.set(5, 4, 'D'); // the crack, walking in from the top edge
    cv.set(5, 5, 'D');
    cv.set(4, 6, 'D');
    cv.set(8, 9, A.base); // one pin
  } else { // resin: lit core + drip
    cv.rect(5, 6, 2, 2, A.base);
    cv.set(5, 6, A.hot);
    cv.set(6, 10, 'P');
  }
}

const THUMB_PAINTERS: Record<MaterialFamilyId, (cv: StuffPlate, R: R, A: A, variant: string, rng: Rng) => void> = {
  plates: (cv, R, A, v) => thumbPlates(cv, R, A, v),
  cluster: (cv, R, A, v) => thumbCluster(cv, R, A, v),
  pile: (cv, R, A, v) => thumbPile(cv, R, A, v),
  shard: (cv, R, A, v) => thumbShard(cv, R, A, v),
  swatch: (cv, R, A, v, rng) => thumbSwatch(cv, R, A, v, rng),
  vessel: (cv, R, A, v) => thumbVessel(cv, R, A, v),
  coil: (cv, R, A, v) => thumbCoil(cv, R, A, v),
  chunk: (cv, R, A, v) => thumbChunk(cv, R, A, v),
};

/* ------------------------------------------------------------------ */
/* Compose + cache + paint                                             */
/* ------------------------------------------------------------------ */

export interface MaterialRender {
  width: number;
  height: number;
  rows: string[];
  colors: Partial<Record<StuffShade, string>>;
  signature: string;
  density: MaterialDensity;
  id: string;
}

export function composeMaterial(id: string, density: MaterialDensity = 'object'): MaterialRender {
  const row = materialArtRow(id);
  const visual = id === 'Scrap' ? getResourceVisual('scrap') : getMaterialVisual(id);
  const baseRamp = stuffRamp(visual.color);
  const accentRamp = stuffRamp(visual.accentColor);
  const colors: Partial<Record<StuffShade, string>> = {
    K: '#1A110A',
    S: '#0805026E',
    W: '#FFFFFF',
    D: baseRamp.deep,
    d: baseRamp.shade,
    P: baseRamp.base,
    p: baseRamp.lite,
    L: baseRamp.hot,
    A: accentRamp.base,
    a: hexLerp(visual.accentColor, '#000000', 0.30),
    E: accentRamp.lite,
  };

  const grid = density === 'object' ? 24 : 12;
  const plate = new StuffPlate(grid);
  const rng = seededRandom(hashString(density === 'object' ? id : `${id}:thumb`));
  if (density === 'object') {
    OBJECT_PAINTERS[row.family](plate, RAMP_SHADES, ACCENT_SHADES, row.variant, row.band, rng);
    toneNoise(plate, row.band, rng);
    finishPass(plate, row.band, rng);
  } else {
    THUMB_PAINTERS[row.family](plate, RAMP_SHADES, ACCENT_SHADES, row.variant, rng);
    // Thumb discipline: a single dark ground row under each column
    // (bold silhouette read), no micro-detail.
    const mask = plate.bodyMask();
    for (let x = 0; x < grid; x++) {
      let lowest = -1;
      for (let y = 0; y < grid; y++) if (mask[y][x]) lowest = y;
      if (lowest >= 0) plate.set(x, Math.min(lowest + 1, grid - 1), 'K');
    }
  }

  const rows = plate.rows();
  const signature = hashString(
    `material-${density}|${id}|${row.family}|${row.variant}|${row.band}|${rows.join('/')}`,
  ).toString(16);
  return { width: grid, height: grid, rows, colors, signature, density, id };
}

const materialCache = new Map<string, MaterialRender>();

/** Cached compose, mirroring the gear/weapon compositors. */
export function composeMaterialCached(id: string, density: MaterialDensity = 'object'): MaterialRender {
  const composed = composeMaterial(id, density);
  const cached = materialCache.get(composed.signature);
  if (cached) return cached;
  if (materialCache.size > 400) materialCache.clear();
  materialCache.set(composed.signature, composed);
  return composed;
}

/** Paint a material render into a 2D context at integer scale. */
export function paintMaterial(
  ctx2d: CanvasRenderingContext2D,
  render: MaterialRender,
  scale: number,
): void {
  const { rows, colors, width, height } = render;
  for (let y = 0; y < height; y++) {
    const rowStr = rows[y];
    let runShade = '';
    let runStart = 0;
    const flush = (endX: number) => {
      if (!runShade || runShade === '.') return;
      const color = colors[runShade as StuffShade];
      if (!color) return;
      ctx2d.fillStyle = color;
      ctx2d.fillRect(runStart * scale, y * scale, (endX - runStart) * scale, scale);
    };
    for (let x = 0; x < width; x++) {
      const shade = rowStr[x];
      if (shade !== runShade) { flush(x); runShade = shade; runStart = x; }
    }
    flush(width);
  }
}
