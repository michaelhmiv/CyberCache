import { Element, Rarity } from '@/types/game';
import type { GearItem } from '@/types/items';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { getElementVisual } from '@/constants/visualAssets';
import { hashString } from '@/lib/utils/rng';
import { seededRandom } from '@/lib/weaponArt/decalSpec';
import { hexLerp, hueLerp } from './weaponCardCompositor';

/**
 * gearCardCompositor — the shared gear plate engine (gear marriage,
 * slice 0). The weapon marriage gave weapons one compositor per
 * density (weaponCompositor 120×44 stage, weaponCardCompositor
 * 240×88 card); this module generalizes those conventions into the
 * plate engine every non-weapon gear kind renders through:
 * shields, relics, class mods, ordnance.
 *
 * THE PIXEL DENSITY LAW (owner-ruled 2026-11-03, DESIGN.md §8) binds
 * everything here: texel = 4; fixed texel grids per density; art is
 * authored AT the grid — no oversampling, no sub-texel features,
 * minimum feature 1 texel; five-tone ramp per hue, shade toward
 * black, highlight toward white, warm near-black outline; identity
 * from silhouette + saturated colorway; detail is silhouette
 * breaks, panel blocks, and single-texel rivets / vents / stripes.
 * Two rejected prototypes define the failure modes: too flat reads
 * as rasterized SVG; too fine misses the game's aesthetic entirely.
 * If a choice trades register-match for richness, register wins.
 *
 * What the core owns (kind grammars consume, never re-implement):
 *  - the plate grid + paint primitives at any plate size;
 *  - the density set: card (the kind's logical plate) and thumb
 *    (quarter grid, DETAIL LEVEL 0 — the detail kit physically
 *    cannot paint at thumb, so a thumb is a composed bold
 *    silhouette + core + colorway, never a raw downscale);
 *  - colorways: a five-tone ramp from one base hue, element ramps
 *    from ELEMENT_VISUALS (Kinetic resolves to the metallic, the
 *    honest absence, exactly as weapons pin it);
 *  - the rarity frame system (RARITY_FRAME_STYLES colors, finish
 *    escalates with rarity, form never changes);
 *  - the shared micro-detail kit (rivets, seams, vents, stripes,
 *    sockets/pips, wear chips — all single-texel);
 *  - the broken-edge toolkit (sweep S3-2, modeled on the relic
 *    SALVAGE pass): jittered tone-boundary fills, broken-tone
 *    region shading, cluster wear — core-owned so the grammars
 *    share one implementation, never three private copies;
 *  - protected zones: grammars declare their data surfaces
 *    (node deck, socket rails, plaques) and every wear operation
 *    refuses to land on them;
 *  - the manufactured-gear wear ladder (S3, grill ruling 2) for
 *    grammars that opt in — rarity-scaled, card density only;
 *  - the outline finish — SELECTIVE since S3-1 (a silhouette
 *    cell takes the shade two ramp steps darker than the form
 *    cell it borders; ink remains against dark faces) —
 *    deterministic signatures, and the render cache, in the
 *    weapon system's pattern;
 *  - bespoke-resolves-first: named gear art, if any is ever
 *    produced, outranks grammar through BESPOKE_GEAR_SPRITES —
 *    the slot exists from slice 0 so it cannot be forgotten
 *    (no bespoke gear art exists today; the registry is empty).
 *
 * Runtime-composed: zero sprite payload.
 */

export type GearKindId = 'shield' | 'relic' | 'classMod' | 'ordnance';
export type GearDensity = 'thumb' | 'card';

/** Card plate grids — the kinds' incumbent aspects (audit §7). */
export const GEAR_CARD_PLATES: Record<GearKindId, { width: number; height: number }> = {
  shield: { width: 240, height: 140 },
  relic: { width: 240, height: 140 },
  classMod: { width: 240, height: 120 },
  ordnance: { width: 240, height: 120 },
};

/** Thumb renders on the plate grid divided by this (detail level 0). */
export const GEAR_THUMB_DIVISOR = 4;

export type GearShade =
  | 'K' | 'k' | 'D' | 'd' | 'P' | 'p' | 'L' | 'W' | 'T' | 'E' | 'e' | 'c' | 'F' | 'f'
  // '.' is the empty/erase cell (grids initialize to it; set(x, y, '.')
  // punches a cell back out — edge chips bite silhouettes with it).
  | '.';

export interface GearRender {
  width: number;
  height: number;
  rows: string[];
  colors: Partial<Record<GearShade, string>>;
  signature: string;
  rarityColor: string;
  density: GearDensity;
  kind: GearKindId;
}

export interface GearComposeInput {
  kind: GearKindId;
  rarity: Rarity;
  /** Element colorway source; null for kinds without an element. */
  element?: Element | null;
  /** Deterministic per-instance seed (the record's pixelSeed / hash). */
  seed: number;
  /** Affix count — the socket/pip rows read this. */
  pips?: number;
  /** Colorway base hue override (tree color, crystal hue, ...). */
  baseColor?: string;
  /** Grammar row / variant discriminator, part of the signature. */
  variant?: string;
}

/**
 * A kind grammar: one data row per silhouette family lives in the
 * kind's own module; the grammar object is the bundle the core
 * needs — its plate, its paint, and (optionally) how an item
 * record becomes a compose input.
 */
export interface GearGrammar {
  id: string;
  kind: GearKindId;
  plate: { width: number; height: number };
  paint: (canvas: GearCanvas, input: GearComposeInput) => void;
  inputFromItem?: (item: GearItem) => GearComposeInput;
  /**
   * Manufactured-gear wear ladder (sweep S3, grill ruling 2):
   * when true, the core applies GEAR_WEAR_BUDGET after the
   * grammar paints — rarity-scaled chips / scratches / grime /
   * patina at card density only, so thumbs stay rarity-identical.
   * Relics do NOT opt in: the relic grammar runs its own SALVAGE
   * wear budget internally. Fixtures stay unworn.
   */
  wearLadder?: boolean;
}

export function gearGridFor(grammar: GearGrammar, density: GearDensity): { width: number; height: number } {
  if (density === 'card') return { width: grammar.plate.width, height: grammar.plate.height };
  return {
    width: Math.round(grammar.plate.width / GEAR_THUMB_DIVISOR),
    height: Math.round(grammar.plate.height / GEAR_THUMB_DIVISOR),
  };
}

/* ------------------------------------------------------------------ */
/* Five-tone ramp (DESIGN.md §8: hue-shifted steps off the base hex)   */
/* ------------------------------------------------------------------ */

export interface FiveToneRamp {
  deep: string;
  dark: string;
  base: string;
  light: string;
  pale: string;
}

/**
 * Ramp derivation mode. 'hue' (the default, sweep S1) derives each
 * step through hueLerp — same lightness path as the old straight
 * lerp, with pxl-style hue/saturation movement (shadows cool,
 * highlights warm). 'straight' is the legacy black/white lerp,
 * retained for the one consumer whose register is flat by law:
 * the loot FX kit (PixelFx), whose beams/rays are owner-approved
 * hard flat tones and must not drift with the item-art training.
 */
export type RampMode = 'hue' | 'straight';

export function fiveToneRamp(base: string, mode: RampMode = 'hue'): FiveToneRamp {
  const derive = mode === 'hue' ? hueLerp : hexLerp;
  return {
    deep: derive(base, '#000000', 0.58),
    dark: derive(base, '#000000', 0.30),
    base,
    light: derive(base, '#FFFFFF', 0.36),
    pale: derive(base, '#FFFFFF', 0.66),
  };
}

/** Neutral gunmetal base for kinds with no element and no override. */
export const GEAR_NEUTRAL_BASE = '#5A6270';
/** What Kinetic resolves to on the element shades — honest absence. */
export const GEAR_KINETIC_METALLIC = '#B8B0A8';

export function gearColorsFor(input: GearComposeInput): Partial<Record<GearShade, string>> {
  const elVisual = input.element ? getElementVisual(input.element) : null;
  const base = input.baseColor ?? elVisual?.color ?? GEAR_NEUTRAL_BASE;
  const ramp = fiveToneRamp(base);
  const frame = RARITY_FRAME_STYLES[input.rarity];
  return {
    K: '#0B0B0E',
    k: '#3A3F4A',
    D: ramp.deep,
    d: ramp.dark,
    P: ramp.base,
    p: ramp.light,
    L: ramp.pale,
    W: '#FFFFFF',
    T: '#9AA3B2',
    E: elVisual ? elVisual.color : ramp.base,
    e: elVisual ? elVisual.accentColor : ramp.light,
    c: elVisual ? hueLerp(elVisual.color, '#0B0B0E', 0.55) : ramp.deep,
    F: frame.color,
    f: hueLerp(frame.color, '#FFFFFF', 0.45),
  };
}

/* ------------------------------------------------------------------ */
/* Plate grid                                                          */
/* ------------------------------------------------------------------ */

type Pt = [number, number];

export class GearPlate {
  readonly width: number;
  readonly height: number;
  cells: GearShade[][]; // [y][x]

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: height }, () => new Array<GearShade | '.'>(width).fill('.')) as unknown as GearShade[][];
  }

  in(x: number, y: number) { return x >= 0 && x < this.width && y >= 0 && y < this.height; }
  get(x: number, y: number): string { return this.in(x, y) ? this.cells[y][x] as unknown as string : '.'; }
  set(x: number, y: number, s: GearShade) { if (this.in(x, y)) this.cells[y][x] = s; }
  /** Set only over already-filled cells (seams, bands, finishes). */
  over(x: number, y: number, s: GearShade) { if (this.get(x, y) !== '.') this.set(x, y, s); }
  filled(x: number, y: number) { return this.get(x, y) !== '.'; }
  rows(): string[] { return this.cells.map((r) => (r as unknown as string[]).join('')); }

  rect(x: number, y: number, w: number, h: number, shade: GearShade) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, shade);
  }

  /** Scanline polygon fill with a shade function per texel. */
  poly(pts: Pt[], shade: GearShade | ((x: number, y: number) => GearShade)) {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) {
          this.set(x, y, typeof shade === 'function' ? shade(x, y) : shade);
        }
      }
    }
  }

  thickLine(x0: number, y0: number, x1: number, y1: number, r: number, shade: GearShade) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const cx = Math.round(x0 + ((x1 - x0) * i) / steps);
      const cy = Math.round(y0 + ((y1 - y0) * i) / steps);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) this.set(cx + dx, cy + dy, shade);
    }
  }

  disc(cx: number, cy: number, r: number, shade: GearShade) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.4) this.set(x, y, shade);
    }
  }

  ring(cx: number, cy: number, rIn: number, rOut: number, shade: GearShade, over = false) {
    for (let y = Math.floor(cy - rOut - 1); y <= Math.ceil(cy + rOut + 1); y++) for (let x = Math.floor(cx - rOut - 1); x <= Math.ceil(cx + rOut + 1); x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.15);
      if (d >= rIn && d <= rOut) { if (over) this.over(x, y, shade); else this.set(x, y, shade); }
    }
  }

  slope(x0: number, y0: number, x1: number, y1: number, shade: GearShade, over = false) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      if (over) this.over(x, y, shade); else this.set(x, y, shade);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Canvas — silhouette layer + the shared micro-detail kit             */
/* ------------------------------------------------------------------ */

/**
 * What a grammar paints with. The direct plate primitives
 * (rect/disc/ring/poly/line) are the SILHOUETTE layer and work at
 * every density. The detail kit — rivet, seam, vent, stripe,
 * socket, pipRow, chip — is single-texel micro-detail and is
 * structurally suppressed at detail level 0 (thumb): the methods
 * exist on the canvas but paint nothing, so no grammar can leak
 * card detail into a thumb by accident.
 */
export class GearCanvas {
  readonly plate: GearPlate;
  readonly density: GearDensity;
  readonly detailLevel: 0 | 1;
  /** The rect inside the frame zone — grammars compose within it. */
  readonly body: { x: number; y: number; w: number; h: number };
  private readonly rng: () => number;
  /**
   * Protected zones (sweep S3): rects a grammar declares as DATA
   * surfaces — the class-mod node deck, the shield footer rail,
   * the ordnance plaque — where wear, jitter, and grime may never
   * land (floor 7: a stray texel on a data surface is a lie about
   * the item). Wear operations consult isProtected cell by cell.
   */
  private readonly protectedZones: { x: number; y: number; w: number; h: number }[] = [];

  constructor(plate: GearPlate, density: GearDensity, seed: number) {
    this.plate = plate;
    this.density = density;
    this.detailLevel = density === 'thumb' ? 0 : 1;
    const margin = density === 'thumb' ? 2 : 4;
    this.body = {
      x: margin,
      y: margin,
      w: Math.max(1, plate.width - margin * 2),
      h: Math.max(1, plate.height - margin * 2),
    };
    this.rng = seededRandom(seed);
  }

  get width() { return this.plate.width; }
  get height() { return this.plate.height; }

  /** Deterministic per-instance variation stream for the grammar. */
  next(): number { return this.rng(); }
  /** Seeded pick in [0, n). */
  pick(n: number): number { return Math.floor(this.rng() * Math.max(1, n)); }

  /** Declare a data surface wear may never touch (see above). */
  protect(x: number, y: number, w: number, h: number) {
    this.protectedZones.push({ x, y, w, h });
  }

  isProtected(x: number, y: number): boolean {
    return this.protectedZones.some(
      (z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h,
    );
  }

  set(x: number, y: number, s: GearShade) { this.plate.set(x, y, s); }
  over(x: number, y: number, s: GearShade) { this.plate.over(x, y, s); }
  filled(x: number, y: number) { return this.plate.filled(x, y); }
  rect(x: number, y: number, w: number, h: number, s: GearShade) { this.plate.rect(x, y, w, h, s); }
  disc(cx: number, cy: number, r: number, s: GearShade) { this.plate.disc(cx, cy, r, s); }
  ring(cx: number, cy: number, rIn: number, rOut: number, s: GearShade, over = false) { this.plate.ring(cx, cy, rIn, rOut, s, over); }
  poly(pts: Pt[], s: GearShade | ((x: number, y: number) => GearShade)) { this.plate.poly(pts, s); }
  thickLine(x0: number, y0: number, x1: number, y1: number, r: number, s: GearShade) { this.plate.thickLine(x0, y0, x1, y1, r, s); }
  slope(x0: number, y0: number, x1: number, y1: number, s: GearShade, over = false) { this.plate.slope(x0, y0, x1, y1, s, over); }

  /* ---- detail kit (detail level 1 only) ---- */

  private get detailOn() { return this.detailLevel > 0; }

  /** Bolt/rivet head: steel core texel, dark seat texel. */
  rivet(x: number, y: number) {
    if (!this.detailOn) return;
    this.plate.set(x, y, 'T');
    this.plate.set(x + 1, y, 'k');
  }

  /** Panel seam: a dark line laid over filled cells only. */
  seam(x0: number, y0: number, x1: number, y1: number) {
    if (!this.detailOn) return;
    this.plate.slope(x0, y0, x1, y1, 'k', true);
  }

  /** Vent slit run: dark slits with a steel rim texel above. */
  vents(x: number, y: number, count: number) {
    if (!this.detailOn) return;
    for (let i = 0; i < count; i++) {
      this.plate.over(x + i * 3, y - 1, 'T');
      this.plate.over(x + i * 3, y, 'K');
      this.plate.over(x + i * 3 + 1, y, 'K');
    }
  }

  /** Hard-edged stripe run (glow at texel scale, never a gradient). */
  stripe(x: number, y: number, len: number, shade: GearShade = 'F') {
    if (!this.detailOn) return;
    for (let i = 0; i < len; i++) this.plate.over(x + i, y, shade);
  }

  /** Affix socket: 3×3 dark seat, lit core when the affix is present. */
  socket(x: number, y: number, lit: boolean) {
    if (!this.detailOn) return;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) this.plate.over(x + dx, y + dy, 'k');
    this.plate.over(x + 1, y + 1, lit ? 'E' : 'K');
  }

  /** A row of affix sockets; `lit` of `total` burn element color. */
  pipRow(x: number, y: number, lit: number, total: number) {
    if (!this.detailOn) return;
    for (let i = 0; i < total; i++) this.socket(x + i * 5, y, i < lit);
  }

  /** Wear chip: erase one filled texel (wear at texel scale). */
  chip(x: number, y: number) {
    if (!this.detailOn) return;
    if (this.plate.filled(x, y)) this.plate.cells[y][x] = '.' as unknown as GearShade;
  }

  /* ---- broken-edge toolkit (sweep S3-2, modeled on relic SALVAGE) ---- */

  /** Per-column jitter table from the canvas stream (SALVAGE's move). */
  private jitterTable(): number[] {
    const t: number[] = [];
    for (let i = 0; i < 64; i++) t.push(this.pick(3) - 1);
    return t;
  }

  /**
   * (a) Jittered tone-boundary fill — the SALVAGE `panelRect` move
   * as a reusable region fill: three tone masses (top / mid / foot)
   * whose boundaries break per column (±1 texel of jitter) with
   * ~1.2% stray tone texels, so a banded rect reads as a made
   * panel instead of three marching strips. Silhouette layer:
   * paints at every density, so thumbs inherit the broken edges.
   */
  brokenBands(
    x: number, y: number, w: number, h: number,
    top: GearShade, mid: GearShade, foot: GearShade,
    topFrac = 0.16, footFrom = 0.80,
  ) {
    const jit = this.jitterTable();
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const rel = (yy - y) / Math.max(1, h);
        const j = jit[Math.abs(xx) % jit.length] * 0.045;
        let s = mid;
        if (rel < topFrac + j) s = top;
        else if (rel > footFrom + j) s = foot;
        this.plate.set(xx, yy, s);
      }
    }
    const strays = Math.round(w * h * 0.012);
    for (let i = 0; i < strays; i++) {
      const xx = x + this.pick(Math.max(1, w));
      const yy = y + this.pick(Math.max(1, h));
      this.plate.set(xx, yy, this.pick(2) ? foot : top);
    }
  }

  /**
   * (b) Broken-tone region shading — the SALVAGE `brokenTone`
   * move: brightness falls off toward the lower-right over the
   * region's 'P' cells, jittered per column AND per cell, so the
   * mass resolves into patches, never bands or graphic triangles.
   * Only 'P' cells are re-toned; every other shade (data, detail,
   * element) is left exactly as painted. Silhouette layer.
   */
  brokenToneRegion(x: number, y: number, w: number, h: number) {
    const g = this.plate;
    const jit: number[] = [];
    for (let i = 0; i < 64; i++) jit.push((this.pick(3) - 1) * 0.02);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (g.get(xx, yy) !== 'P') continue;
        const relX = (xx - x) / Math.max(1, w);
        const relY = (yy - y) / Math.max(1, h);
        let b = (1 - relY) * 0.62 + (1 - relX) * 0.38
          + jit[Math.abs(xx) % jit.length] + (this.next() - 0.5) * 0.09;
        if (this.next() < 0.015) b += this.pick(2) ? 0.14 : -0.14; // stray texel
        g.set(xx, yy, b > 0.74 ? 'p' : b > 0.44 ? 'P' : b > 0.22 ? 'd' : 'D');
      }
    }
  }

  /**
   * A band rect whose top and bottom edges jitter per column —
   * the column-wise form of (a) for bands painted OVER a body
   * (canister bands, console bands): each column's span shifts by
   * ±1 texel from the stream, and the cells a column vacates keep
   * the body tone beneath. Paints over filled cells only.
   */
  bandJittered(x: number, y: number, w: number, h: number, shade: GearShade) {
    for (let xx = x; xx < x + w; xx++) {
      const o = this.pick(3) - 1;
      for (let yy = y + o; yy < y + h + o; yy++) this.plate.over(xx, yy, shade);
    }
  }

  /**
   * (c) Cluster wear — the SALVAGE `ground`/patina move: marks
   * land as a seeded CLUSTER of named cause (a scorch, a scrape
   * patch, a rubble kiss), never as uniform scatter and never
   * full-width. The walk darkens cell by cell through GEAR_DARKEN;
   * with `bite`, the cluster's heart loses one texel and a dark
   * scar texel lands beside the bite (chipped paint over dark
   * metal). Detail level 1 only — wear never reaches thumbs —
   * and protected (data) cells are never touched.
   */
  clusterWear(cx: number, cy: number, cells = 4, opts?: { bite?: boolean }) {
    if (!this.detailOn) return;
    let x = cx;
    let y = cy;
    const n = Math.max(1, cells);
    for (let i = 0; i < n; i++) {
      if (this.plate.filled(x, y) && !this.isProtected(x, y)) {
        const darker = GEAR_DARKEN[this.plate.get(x, y) as GearShade];
        if (darker) this.plate.set(x, y, darker);
      }
      x += this.pick(3) - 1;
      y += this.pick(3) - 1;
    }
    if (opts?.bite && this.plate.filled(cx, cy) && !this.isProtected(cx, cy)) {
      this.plate.set(cx, cy, '.');
      const scars: [number, number][] = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      const [sx, sy] = scars[this.pick(4)];
      if (this.plate.filled(sx, sy) && !this.isProtected(sx, sy)) this.plate.set(sx, sy, 'k');
    }
  }

  /**
   * Vent run with cluster spacing (detail): slits land at varied
   * gaps from the stream instead of the metronome `i * 3`, and
   * one slit per run is DEAD — unlit, unrimmed — the SALVAGE
   * one-dead-node move. Same slit anatomy as `vents` (steel rim
   * texel above, two dark texels).
   */
  ventsBroken(x: number, y: number, count: number) {
    if (!this.detailOn) return;
    const dead = this.pick(Math.max(1, count));
    let cx = x;
    for (let i = 0; i < count; i++) {
      if (i !== dead) {
        this.plate.over(cx, y - 1, 'T');
        this.plate.over(cx, y, 'K');
        this.plate.over(cx + 1, y, 'K');
      }
      cx += 3 + this.pick(2); // slit pair + a 1–2 texel gap
    }
  }
}

/** One ramp step darker, per shade — the wear darkening ladder. */
export const GEAR_DARKEN: Partial<Record<GearShade, GearShade>> = {
  L: 'p', p: 'P', P: 'd', d: 'D', E: 'c', e: 'E',
};

/* ------------------------------------------------------------------ */
/* Frame + outline finishes (core-owned)                               */
/* ------------------------------------------------------------------ */

function paintGearFrame(canvas: GearCanvas, rarity: Rarity) {
  const g = canvas.plate;
  const W = g.width;
  const H = g.height;
  const ring = (inset: number, shade: GearShade) => {
    for (let x = inset; x < W - inset; x++) { g.set(x, inset, shade); g.set(x, H - 1 - inset, shade); }
    for (let y = inset; y < H - inset; y++) { g.set(inset, y, shade); g.set(W - 1 - inset, y, shade); }
  };
  const cornerBlock = (cx: number, cy: number, size: number) => {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) g.set(cx + dx, cy + dy, 'F');
    g.set(cx + Math.floor(size / 2), cy + Math.floor(size / 2), 'f');
  };

  ring(0, 'F');
  if (canvas.density === 'thumb') return; // detail level 0: the frame is the colorway read

  switch (rarity) {
    case Rarity.Common:
      break;
    case Rarity.Uncommon:
      // Corner ticks in the shine tone.
      for (const [cx, cy] of [[3, 3], [W - 6, 3], [3, H - 4], [W - 6, H - 4]] as const) {
        for (let i = 0; i < 3; i++) { g.set(cx + i, cy, 'f'); }
      }
      break;
    case Rarity.Rare:
      cornerBlock(0, 0, 4); cornerBlock(W - 4, 0, 4); cornerBlock(0, H - 4, 4); cornerBlock(W - 4, H - 4, 4);
      break;
    case Rarity.Epic:
      cornerBlock(0, 0, 4); cornerBlock(W - 4, 0, 4); cornerBlock(0, H - 4, 4); cornerBlock(W - 4, H - 4, 4);
      // Inner accent lines, top and bottom, over the middle span.
      for (let x = Math.floor(W * 0.3); x < Math.floor(W * 0.7); x++) { g.over(x, 2, 'F'); g.over(x, H - 3, 'F'); }
      break;
    case Rarity.Legendary:
      ring(2, 'F');
      cornerBlock(0, 0, 5); cornerBlock(W - 5, 0, 5); cornerBlock(0, H - 5, 5); cornerBlock(W - 5, H - 5, 5);
      // Shine studs along the top edge.
      for (let x = 12; x < W - 12; x += 16) g.set(x, 1, 'f');
      break;
  }
}

/**
 * Selective outline map (pxl craft sweep S3-1): the silhouette
 * cell takes the shade TWO ramp steps darker than the form cell
 * it borders — L→P, p→d, P→D, d→D on the body ramp
 * (D<d<P<p<L), e→c and E→c on the element ramp (c<E<e) — the
 * §8.1 weapon rule, ported to the gear core. Anything else (ink
 * details, steel, frame gold, ramp floors) falls back to the
 * flat ink 'K', so dark faces keep the hard silhouette they
 * always had. Exported for the S3 craft tests.
 */
export const GEAR_SELOUT_DARKER: Partial<Record<GearShade, GearShade>> = {
  L: 'P',
  p: 'd',
  P: 'D',
  d: 'D',
  e: 'c',
  E: 'c',
};

function outlinePass(canvas: GearCanvas) {
  const g = canvas.plate;
  // Adjacency is read from the pre-outline grid: marks are
  // collected before any outline cell is painted, so the live
  // grid IS the snapshot (the weapon pass's discipline).
  const marks: { x: number; y: number; shade: GearShade }[] = [];
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    if (g.filled(x, y)) continue;
    // Selout: the outline cell is shaded from the form cell it
    // borders, in pxl's neighbor preference (below, above,
    // right, left).
    let bordered: string | null = null;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      if (g.filled(x + dx, y + dy)) { bordered = g.get(x + dx, y + dy); break; }
    }
    if (bordered !== null) {
      marks.push({ x, y, shade: GEAR_SELOUT_DARKER[bordered as GearShade] ?? 'K' });
    }
  }
  for (const m of marks) g.set(m.x, m.y, m.shade);
}

/* ------------------------------------------------------------------ */
/* Manufactured-gear wear ladder (sweep S3, grill ruling 2)            */
/* ------------------------------------------------------------------ */

/**
 * The wear budget for manufactured gear — shields, ordnance,
 * class mods — at HALF the relic SALVAGE ladder (counts rounded
 * up so the ladder never fully vanishes): gear is manufactured,
 * not excavated, so the wear reads as battle damage with a
 * lighter hand. Card density only; the pass returns at detail
 * level 0, so thumbs are rarity-identical silhouettes.
 */
export const GEAR_WEAR_BUDGET: Record<Rarity, { chips: number; scratches: number; grime: number; patina: number }> = {
  [Rarity.Common]: { chips: 7, scratches: 6, grime: 0.28, patina: 3 },
  [Rarity.Uncommon]: { chips: 5, scratches: 4, grime: 0.21, patina: 2 },
  [Rarity.Rare]: { chips: 3, scratches: 2, grime: 0.14, patina: 1 },
  [Rarity.Epic]: { chips: 2, scratches: 1, grime: 0.09, patina: 1 },
  [Rarity.Legendary]: { chips: 1, scratches: 1, grime: 0.05, patina: 1 },
};

/** Shades a wear bite may take: body + element ramp tones only —
 *  never frame gold, steel, glints, or ink structure. */
const WEARABLE: ReadonlySet<string> = new Set(['D', 'd', 'P', 'p', 'L', 'E', 'e', 'c']);

function gearWearPass(canvas: GearCanvas, rarity: Rarity) {
  if (canvas.detailLevel < 1) return;
  const budget = GEAR_WEAR_BUDGET[rarity];
  const g = canvas.plate;
  const b = canvas.body;
  const inZone = (x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  const wearable = (x: number, y: number) =>
    inZone(x, y) && g.filled(x, y) && WEARABLE.has(g.get(x, y)) && !canvas.isProtected(x, y);

  // Edge chips — bite the silhouette inside the body zone; half
  // leave a dark scar texel inboard (chipped paint, dark metal).
  const edge: [number, number][] = [];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    if (!wearable(x, y)) continue;
    if (!g.filled(x + 1, y) || !g.filled(x - 1, y) || !g.filled(x, y + 1) || !g.filled(x, y - 1)) edge.push([x, y]);
  }
  for (let i = 0; i < budget.chips && edge.length > 0; i++) {
    const [x, y] = edge[canvas.pick(edge.length)];
    g.set(x, y, '.');
    if (canvas.pick(2)) {
      const inb: [number, number][] = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      const [ix, iy] = inb[canvas.pick(4)];
      if (wearable(ix, iy)) g.set(ix, iy, 'k');
    }
  }

  // Scratch runs — short scores across filled body.
  for (let i = 0; i < budget.scratches; i++) {
    const x = b.x + canvas.pick(Math.max(1, Math.round(b.w * 0.8)));
    const y = b.y + canvas.pick(Math.max(1, Math.round(b.h * 0.8)));
    const len = 2 + canvas.pick(4);
    const shade: GearShade = canvas.pick(3) === 0 ? 'T' : 'k';
    for (let s = 0; s < len; s++) if (wearable(x + s, y)) g.set(x + s, y, shade);
  }

  // Grime — bottom-weighted darkening over the body's lower half.
  const grimeTop = b.y + Math.round(b.h * 0.55);
  for (let y = grimeTop; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!wearable(x, y)) continue;
      const depth = (y - grimeTop) / Math.max(1, b.y + b.h - grimeTop);
      if (canvas.next() < budget.grime * depth * 0.40) {
        const darker = GEAR_DARKEN[g.get(x, y) as GearShade];
        if (darker) g.set(x, y, darker);
      }
    }
  }

  // Patina blotches — seeded clusters one tone off (the toolkit).
  for (let i = 0; i < budget.patina; i++) {
    const x = b.x + Math.round(b.w * (0.2 + canvas.next() * 0.6));
    const y = b.y + Math.round(b.h * (0.2 + canvas.next() * 0.55));
    canvas.clusterWear(x, y, 2 + canvas.pick(4));
  }
}

/* ------------------------------------------------------------------ */
/* Bespoke resolution — named art outranks grammar, from slice 0       */
/* ------------------------------------------------------------------ */

/**
 * Bespoke gear sprites, keyed `${kind}:${normalized name}`. EMPTY
 * today — no named gear art exists — but the resolution slot is
 * part of the core contract: a kind slice can never "forget" to
 * check bespoke first, because PixelGear checks it for every item
 * before composing. When named gear art is produced it registers
 * here (and pays the sprite-payload accounting the manifest law
 * demands) without touching a single grammar.
 */
export const BESPOKE_GEAR_SPRITES: Readonly<Record<string, string>> = {};

export function bespokeGearKey(kind: GearKindId, name: string): string {
  return `${kind}:${name.trim().toLowerCase()}`;
}

export function bespokeSpriteIdForGear(
  kind: GearKindId,
  name: string | undefined,
  registry: Readonly<Record<string, string>> = BESPOKE_GEAR_SPRITES,
): string | undefined {
  if (!name) return undefined;
  return registry[bespokeGearKey(kind, name)];
}

/* ------------------------------------------------------------------ */
/* Input derivation                                                    */
/* ------------------------------------------------------------------ */

/**
 * The default compose input from a bare item record — the shared
 * axes every kind has (rarity, element where present, affixes).
 * Kind grammars override in their own inputFromItem for their
 * signature axes (shield behavior, ordnance effect, mod tree,
 * relic name-form); this default is what their overrides extend.
 */
export function defaultGearInput(item: GearItem, grammar: GearGrammar): GearComposeInput {
  const withElement = item as GearItem & { element?: Element };
  const withSeed = item as GearItem & { pixelSeed?: number };
  return {
    kind: grammar.kind,
    rarity: item.rarity,
    element: withElement.element ?? null,
    seed: typeof withSeed.pixelSeed === 'number'
      ? withSeed.pixelSeed
      : hashString(`${item.id}|${item.name}`),
    pips: item.affixes?.length ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Compose + cache + paint                                             */
/* ------------------------------------------------------------------ */

export function composeGear(input: GearComposeInput, grammar: GearGrammar, density: GearDensity = 'card'): GearRender {
  const { width, height } = gearGridFor(grammar, density);
  const colors = gearColorsFor(input);
  const plate = new GearPlate(width, height);
  const canvas = new GearCanvas(plate, density, input.seed);

  grammar.paint(canvas, input);
  if (grammar.wearLadder) gearWearPass(canvas, input.rarity);
  paintGearFrame(canvas, input.rarity);
  outlinePass(canvas);

  const rows = plate.rows();
  // Signature: render-derived, in the weapon pattern — two surfaces
  // agree on an item iff they agree on this string. The density
  // marker keeps thumb and card signature spaces disjoint.
  const signature = hashString(
    `gear-${density}|${input.kind}|${grammar.id}|${input.rarity}|${input.element ?? ''}|${input.seed}|${input.variant ?? ''}|${input.pips ?? 0}|${input.baseColor ?? ''}|${rows.join('/')}|${hashString(JSON.stringify(colors)).toString(16)}`,
  ).toString(16);
  return {
    width,
    height,
    rows,
    colors,
    signature,
    rarityColor: RARITY_FRAME_STYLES[input.rarity].color,
    density,
    kind: input.kind,
  };
}

const gearCache = new Map<string, GearRender>();

/**
 * Cached compose, mirroring the weapon compositors: identical
 * input returns the identical render object, so lists never
 * recompose gear they have already drawn.
 */
export function composeGearCached(input: GearComposeInput, grammar: GearGrammar, density: GearDensity = 'card'): GearRender {
  // Input-derived cache key (see composeWeaponCardCached): the
  // render signature hashes the composed rows, so a signature-keyed
  // lookup can only run AFTER a full compose and never hits. The
  // key enumerates the same determinant fields the signature itself
  // lists, plus grammar and density.
  const key = hashString(
    `gearkey-${density}|${input.kind}|${grammar.id}|${input.rarity}|${input.element ?? ''}|${input.seed}|${input.variant ?? ''}|${input.pips ?? 0}|${input.baseColor ?? ''}`,
  ).toString(16);
  const cached = gearCache.get(key);
  if (cached) return cached;
  const composed = composeGear(input, grammar, density);
  if (gearCache.size > 400) gearCache.clear();
  gearCache.set(key, composed);
  return composed;
}

/** Paint a gear render into a 2D context at integer scale. */
export function paintGear(
  ctx2d: CanvasRenderingContext2D,
  render: GearRender,
  scale: number,
): void {
  const { rows, colors, width, height } = render;
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    let runShade = '';
    let runStart = 0;
    const flush = (endX: number) => {
      if (!runShade || runShade === '.') return;
      const color = colors[runShade as GearShade];
      if (!color) return;
      ctx2d.fillStyle = color;
      ctx2d.fillRect(runStart * scale, y * scale, (endX - runStart) * scale, scale);
    };
    for (let x = 0; x < width; x++) {
      const shade = row[x];
      if (shade !== runShade) { flush(x); runShade = shade; runStart = x; }
    }
    flush(width);
  }
}
