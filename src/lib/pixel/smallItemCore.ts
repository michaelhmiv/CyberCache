import { hueLerp } from './weaponCardCompositor';

/**
 * smallItemCore — the ONE small-item art core (Pxl Craft Sweep S4,
 * 2026-11-07). consumableArt and materialArt were one system written
 * twice: the same five-tone ramp, the same plate class, the same
 * shade alphabet, the same seeded helpers, the same finish pass,
 * the same thumb ground-row, the same run-length painter — ~400
 * lines of machinery duplicated block by block. This module is the
 * single home for all of it; the two systems keep only what is
 * genuinely theirs (art tables, painters, motif/frame/band
 * treatments, colorway resolution).
 *
 * The unification is render-identical by construction and by proof:
 * every function here is the two files' code merged line for line,
 * and the S4 signature manifest (all 69 icons × both densities)
 * matched byte-for-byte across the move.
 *
 * Two real divergences were parameterized, not unified away:
 *   - toneNoise density: consumables key it by frame, materials by
 *     band — both resolve to a plain number before calling in.
 *   - the finish wear profile { chipP, scratches }: same shape in
 *     both systems already.
 * And one real defect was fixed by the move: the cache helper is
 * INPUT-keyed (the material form). consumableArt's old cache was
 * signature-keyed — it composed in full before every lookup and
 * never hit.
 */

/* ------------------------------------------------------------------ */
/* Ramps                                                               */
/* ------------------------------------------------------------------ */

export interface FiveToneRamp { deep: string; shade: string; base: string; lite: string; hot: string }

/** The five-tone ramp both systems build (S1's hueLerp at the root):
 *  deep 0.52→black, shade 0.26→black, lite 0.34→white, hot 0.60→white. */
export function fiveToneRamp(base: string): FiveToneRamp {
  return {
    deep: hueLerp(base, '#000000', 0.52),
    shade: hueLerp(base, '#000000', 0.26),
    base,
    lite: hueLerp(base, '#FFFFFF', 0.34),
    hot: hueLerp(base, '#FFFFFF', 0.60),
  };
}

/** Shade alphabet anchors: D/d/P/p/L = body ramp deep→hot,
 *  A/a/E = contents/accent ramp base/dark/hot. */
export const RAMP_SHADES = { deep: 'D', shade: 'd', base: 'P', lite: 'p', hot: 'L' } as const;
export const ACCENT_SHADES = { base: 'A', dark: 'a', hot: 'E' } as const;
export type RampShades = typeof RAMP_SHADES;
export type AccentShades = typeof ACCENT_SHADES;

/** The literals both systems paint with: warm near-black outline,
 *  translucent ground shadow, hard white. */
export const OUTLINE_HEX = '#1A110A';
export const GROUND_SHADOW_HEX = '#0805026E';
export const HARD_WHITE_HEX = '#FFFFFF';

/** The contents/accent dark step (both systems: hueLerp 0.30→black). */
export function accentDark(hex: string): string {
  return hueLerp(hex, '#000000', 0.30);
}

/** Objects sit on this row of the 24 grid; the ground shadow is
 *  drawn against it. */
export const GROUND_Y = 21;

/* ------------------------------------------------------------------ */
/* Plate                                                               */
/* ------------------------------------------------------------------ */

export type Pt = [number, number];

/**
 * The shared texel plate. '.' is the empty/erase cell: grids
 * initialize to it, filled() means !== '.', and set(x, y, '.')
 * punches a cell back out. Shade keys are plain strings here —
 * each system keeps its own shade union at its render interface.
 */
export class SmallItemPlate {
  readonly n: number;
  cells: string[][];

  constructor(n: number) {
    this.n = n;
    this.cells = Array.from({ length: n }, () => new Array<string>(n).fill('.'));
  }

  in(x: number, y: number) { return x >= 0 && x < this.n && y >= 0 && y < this.n; }
  get(x: number, y: number): string { return this.in(x, y) ? this.cells[y][x] : '.'; }
  set(x: number, y: number, s: string) { if (this.in(x, y)) this.cells[y][x] = s; }
  /** Set only over already-filled cells. */
  over(x: number, y: number, s: string) { if (this.get(x, y) !== '.') this.set(x, y, s); }
  filled(x: number, y: number) { return this.get(x, y) !== '.'; }
  rows(): string[] { return this.cells.map((r) => r.join('')); }

  rect(x: number, y: number, w: number, h: number, s: string) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, s);
  }

  /** Scanline polygon fill (the gear plate engine's approach). */
  poly(pts: Pt[], s: string) {
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
  ellipse(cx: number, cy: number, rx: number, ry: number, s: string) {
    const x0 = Math.floor(cx - rx - 1); const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1); const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / (rx + 0.5); const dy = (y - cy) / (ry + 0.5);
      if (dx * dx + dy * dy <= 1) this.set(x, y, s);
    }
  }

  /** Ellipse ring: inside the outer ellipse, outside the shrunk one. */
  ellipseRing(cx: number, cy: number, rx: number, ry: number, thickness: number, s: string) {
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

export type Rng = () => number;
export const rint = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
export function choice<T>(rng: Rng, arr: readonly T[]): T { return arr[Math.floor(rng() * arr.length)]; }

/* ------------------------------------------------------------------ */
/* Finish — tone noise + wear/outline/shadow, shared by both systems   */
/* ------------------------------------------------------------------ */

export interface SmallItemWear { chipP: number; scratches: number; noise: number }

/** Tone noise over the body's base cells. The density arrives as a
 *  plain number: consumables resolve it from the frame's wear
 *  profile, materials from the band — the loop itself is one loop. */
export function toneNoise(cv: SmallItemPlate, noise: number, rng: Rng) {
  for (let y = 0; y < cv.n; y++) for (let x = 0; x < cv.n; x++) {
    if (cv.get(x, y) === 'P' && rng() < noise) cv.set(x, y, choice(rng, ['d', 'p'] as const));
  }
}

/** Wear + outline + ground shadow. Draw order and rng consumption
 *  are part of the render contract (seed stability): chips first,
 *  then scratches, then the outline ring, then the shadow. */
export function finishPass(cv: SmallItemPlate, wear: { chipP: number; scratches: number }, rng: Rng) {
  const { chipP, scratches } = wear;
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
  // visible only where the object is not.
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (cv.filled(x, y)) continue;
    const dx = (x - 12) / 8.5; const dy = (y - (GROUND_Y + 1)) / 1.5;
    if (dx * dx + dy * dy <= 1) cv.set(x, y, 'S');
  }
}

/** Thumb discipline: a single dark ground row under each filled
 *  column (bold silhouette read), no micro-detail. Both systems'
 *  thumb composes end with exactly this pass. */
export function thumbGroundRow(cv: SmallItemPlate) {
  const mask = cv.bodyMask();
  for (let x = 0; x < cv.n; x++) {
    let lowest = -1;
    for (let y = 0; y < cv.n; y++) if (mask[y][x]) lowest = y;
    if (lowest >= 0) cv.set(x, Math.min(lowest + 1, cv.n - 1), 'K');
  }
}

/* ------------------------------------------------------------------ */
/* Cache + paint                                                       */
/* ------------------------------------------------------------------ */

/**
 * Input-keyed cached compose — the material form, now shared.
 * The compose is a pure function of its input, so the input key is
 * exact and the compose runs only on a miss. (consumableArt's old
 * signature-keyed cache composed in full before every lookup, so
 * it never hit; this helper is the fix, unit-pinned in
 * compositorCache.test.ts with a compose counter.)
 */
export function smallItemCached<V>(cache: Map<string, V>, key: string, compose: () => V): V {
  const cached = cache.get(key);
  if (cached) return cached;
  const composed = compose();
  if (cache.size > 400) cache.clear();
  cache.set(key, composed);
  return composed;
}

/** The run-length painter both systems paint with. */
export function paintSmallItemRows(
  ctx2d: CanvasRenderingContext2D,
  rows: string[],
  colors: Partial<Record<string, string>>,
  width: number,
  height: number,
  scale: number,
): void {
  for (let y = 0; y < height; y++) {
    const rowStr = rows[y];
    let runShade = '';
    let runStart = 0;
    const flush = (endX: number) => {
      if (!runShade || runShade === '.') return;
      const color = colors[runShade];
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
