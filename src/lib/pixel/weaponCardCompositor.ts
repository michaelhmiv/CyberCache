import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import { MANUFACTURER_WEAPON_STYLES, RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { getElementVisual } from '@/constants/visualAssets';
import { hashString } from '@/lib/utils/rng';
import {
  buildDecals,
  conditionFromRoll,
  seededRandom,
  weaponVisualSeed,
  type WeaponCondition,
  type WeaponVisualDecal,
} from '@/lib/weaponArt/decalSpec';
import { partVariant, type PixelPartSlot, type PixelWeaponInput } from './weaponCompositor';
import {
  BARREL_PROFILES,
  CARD_LAYOUTS,
  FOREND_TEMPLATES,
  FORGE_BODY_PROFILES,
  FORGE_DETAIL_OPTIONS,
  GRIP_TEMPLATES,
  MAKER_MARKS,
  MAKER_SHAPE_SETS,
  MARK_FONT,
  STOCK_RAILS,
  STOCK_TEMPLATES,
  WEAPON_THEMES,
  type CardLayout,
  type ShapeSet,
  type WeaponTheme,
} from './weaponGrammarData';

/**
 * weaponCardCompositor — the CARD-density weapon renderer (240×88),
 * slice 1 of the weapon pixel program: THE MARRIAGE (owner decision
 * 2026-11-03).
 *
 * FORGE's per-manufacturer form grammars (Redline the Wedge ·
 * Ironwood the Longbow · BlastForge the Anvil · Prismatek the Prism
 * · ThrowTech the Kit · HelixWorks the Coil) live as DATA in
 * weaponGrammarData.ts and shape the silhouette here; the incumbent
 * parts machinery — seeded part variants, affix decals, roll-quality
 * condition — survives untouched, so per-item variety within a
 * maker×type survives with it. Element is a lit current traced along
 * the form's spine (FORGE's finish); Kinetic is honest absence.
 * Rarity escalates finish on the edges only and never changes form.
 *
 * This is the same composition as the stage compositor
 * (weaponCompositor.ts, 120×44) at card density: 240×88 is exactly
 * 2× the grid at the same aspect, and both engines read the same
 * sources of truth — partVariant() part rolls, the manufacturer /
 * rarity / element palettes, buildDecals(), conditionFromRoll().
 * The stage engine stays the in-scene held-weapon renderer; every
 * weapon CARD (inventory, gear detail, market, loot) renders here.
 *
 * Runtime-composed: zero sprite payload.
 */

export const CARD_WEAPON_WIDTH = 240;
export const CARD_WEAPON_HEIGHT = 88;
/** Render-pixel scale for anchors — matches the stage compositor. */
const TEXEL = 4;
const W = CARD_WEAPON_WIDTH;
const H = CARD_WEAPON_HEIGHT;
/** Spine (barrel centerline) row at card density. */
const SPINE = 30;

export type CardShade =
  | 'K' | 'k' | 'D' | 'd' | 'P' | 'p' | 'L' | 'W' | 'T' | 'G' | 'E' | 'e' | 'c'
  | 'v' | 'w' | 'u' | 'b' | 'g';

export interface CardAnchor { x: number; y: number }

export interface WeaponCardRender {
  width: number;
  height: number;
  rows: string[];
  colors: Partial<Record<CardShade, string>>;
  signature: string;
  decals: WeaponVisualDecal[];
  condition: WeaponCondition;
  anchors: { muzzle: CardAnchor; grip: CardAnchor; centerMass: CardAnchor; lootPoint: CardAnchor };
  partAnchors: Partial<Record<'Stock' | 'Magazine' | 'Chamber' | 'Sight', CardAnchor>>;
  rarityColor: string;
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

type Pt = [number, number];

class Grid {
  cells: CardShade[][]; // [y][x]
  constructor() {
    this.cells = Array.from({ length: H }, () => new Array<CardShade | '.'>(W).fill('.')) as unknown as CardShade[][];
  }
  in(x: number, y: number) { return x >= 0 && x < W && y >= 0 && y < H; }
  get(x: number, y: number): string { return this.in(x, y) ? this.cells[y][x] as unknown as string : '.'; }
  set(x: number, y: number, s: CardShade) { if (this.in(x, y)) this.cells[y][x] = s; }
  /** Set only over already-filled cells (seams, bands, finishes). */
  over(x: number, y: number, s: CardShade) { if (this.get(x, y) !== '.') this.set(x, y, s); }
  filled(x: number, y: number) { return this.get(x, y) !== '.'; }
  rows(): string[] { return this.cells.map((r) => (r as unknown as string[]).join('')); }

  /** Scanline polygon fill with a shade function per texel. */
  poly(pts: Pt[], shade: CardShade | ((x: number, y: number) => CardShade)) {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
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

  /** Thick line between two points (square brush of radius r). */
  thickLine(x0: number, y0: number, x1: number, y1: number, r: number, shade: CardShade) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const cx = Math.round(x0 + ((x1 - x0) * i) / steps);
      const cy = Math.round(y0 + ((y1 - y0) * i) / steps);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) this.set(cx + dx, cy + dy, shade);
    }
  }

  /** Tube along x with a [frac, radius] profile (the barrel primitive). */
  tube(x0: number, x1: number, cy: number, profile: [number, number][], shadeFn: (x: number, y: number, r: number) => CardShade) {
    for (let x = x0; x <= x1; x++) {
      const r = profileAt(profile, (x - x0) / Math.max(1, x1 - x0));
      for (let y = Math.round(cy - r); y <= Math.round(cy + r); y++) this.set(x, y, shadeFn(x, y, r));
    }
  }

  disc(cx: number, cy: number, r: number, shade: CardShade) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.4) this.set(x, y, shade);
    }
  }
  ring(cx: number, cy: number, rIn: number, rOut: number, shade: CardShade, over = false) {
    for (let y = Math.floor(cy - rOut - 1); y <= Math.ceil(cy + rOut + 1); y++) for (let x = Math.floor(cx - rOut - 1); x <= Math.ceil(cx + rOut + 1); x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.15);
      if (d >= rIn && d <= rOut) { if (over) this.over(x, y, shade); else this.set(x, y, shade); }
    }
  }
  slope(x0: number, y0: number, x1: number, y1: number, shade: CardShade, over = false) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      if (over) this.over(x, y, shade); else this.set(x, y, shade);
    }
  }
}

function profileAt(profile: [number, number][], frac: number): number {
  for (let i = 1; i < profile.length; i++) {
    if (frac <= profile[i][0]) {
      const [f0, r0] = profile[i - 1];
      const [f1, r1] = profile[i];
      return r0 + (r1 - r0) * ((frac - f0) / Math.max(0.0001, f1 - f0));
    }
  }
  return profile[profile.length - 1][1];
}

/* ------------------------------------------------------------------ */
/* Compose context                                                     */
/* ------------------------------------------------------------------ */

interface Ctx {
  g: Grid;
  input: PixelWeaponInput;
  L: CardLayout;
  shapes: ShapeSet;
  theme?: WeaponTheme;
  seed: number;
  bodyTop: number; bodyBot: number; bodyFront: number;
  gripX: number; gripTop: number;
  muzzleX: number;
  /** Bottom inner row of the barrel tube per column (spine current). */
  tubeBottom: Map<number, number>;
  anchors: Partial<Record<string, CardAnchor>>;
  variant: (slot: PixelPartSlot, variants?: number) => number;
}

const isWood = (m: Manufacturer) => m === Manufacturer.Ironwood;
const mainShade = (m: Manufacturer): CardShade => (isWood(m) ? 'w' : 'P');
const darkShade = (m: Manufacturer): CardShade => (isWood(m) ? 'v' : 'D');

/** Small bolt/rivet head: dark ring, light core. */
function boltHead(g: Grid, x: number, y: number) {
  g.set(x, y, 'K'); g.set(x + 1, y, 'K'); g.set(x, y + 1, 'K'); g.set(x + 1, y + 1, 'L');
}

function stampMark(g: Grid, word: string, x0: number, y0: number, shade: CardShade) {
  let cx = x0;
  for (const ch of word) {
    const glyph = MARK_FONT[ch];
    if (glyph) {
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy][gx] === '#') g.over(cx + gx, y0 + gy, shade);
      }
    }
    cx += 4;
  }
}

/* ------------------------------------------------------------------ */
/* Pass 1 — stock + grip (furniture silhouettes from data)             */
/* ------------------------------------------------------------------ */

function stockAndGrip(ctx: Ctx) {
  const { g, input, L } = ctx;
  const mfr = input.manufacturer;
  const shapes = ctx.shapes;
  const main = mainShade(mfr);
  const dark = darkShade(mfr);
  const v = ctx.variant('Stock');

  if (L.stockLen > 0) {
    const tpl = STOCK_TEMPLATES[shapes.stock];
    const x0 = L.bodyX - L.stockLen;
    if (tpl.kind === 'skeleton') {
      // Redline: swept rails + diagonal brace (FORGE Wedge furniture).
      for (const [rx0, ry0, rx1, ry1, thick] of STOCK_RAILS[shapes.stock]) {
        const ax = x0 + (rx0 / 1000) * L.stockLen;
        const bx = x0 + (rx1 / 1000) * L.stockLen;
        g.thickLine(Math.round(ax), SPINE + ry0, Math.round(bx), SPINE + ry1, Math.floor(thick / 2), 'P');
      }
      // Brace shadow: one row of dark under the diagonal.
      g.thickLine(x0 + 4, SPINE + 3, L.bodyX - 6, SPINE - 4, 0, 'D');
    } else if (tpl.kind === 'twinTube') {
      // HelixWorks: twin round rails + collars (the Coil, extended).
      for (const [rx0, ry0, rx1, ry1] of STOCK_RAILS[shapes.stock]) {
        g.tube(Math.round(x0 + (rx0 / 1000) * L.stockLen), Math.round(x0 + (rx1 / 1000) * L.stockLen), SPINE + ry0,
          [[0, 1.6], [1, 1.6]], (x, y) => (y <= SPINE + ry0 ? 'P' : 'D'));
      }
      for (const pm of [180, 500, 820]) {
        const cx = Math.round(x0 + (pm / 1000) * L.stockLen);
        for (let y = SPINE - 7; y <= SPINE + 7; y++) { g.set(cx, y, 'b'); g.set(cx + 1, y, 'D'); }
      }
    } else {
      // Solid stock: interpolate the outline across the stock length.
      const outline = tpl.outline!;
      for (let x = x0; x < L.bodyX; x++) {
        const pm = ((x - x0) / L.stockLen) * 1000;
        let top: number | null = null; let bot: number | null = null;
        for (let i = 0; i < outline.length; i++) {
          const [ax, ay] = outline[i];
          const [bx, by] = outline[(i + 1) % outline.length];
          if ((ax <= pm && bx > pm) || (bx <= pm && ax > pm)) {
            const yy = ay + ((pm - ax) / (bx - ax)) * (by - ay);
            if (ay <= 0 && by <= 4) top = top === null ? yy : Math.min(top, yy);
            else bot = bot === null ? yy : Math.max(bot, yy);
          }
        }
        if (top === null || bot === null) continue;
        const yTop = Math.round(SPINE + top);
        const yBot = Math.round(SPINE + bot);
        for (let y = yTop; y <= yBot; y++) {
          let s: CardShade;
          if (isWood(mfr)) s = y === yTop ? 'u' : y >= yBot - 1 ? 'v' : 'w';
          else s = y === yTop ? 'p' : y >= yBot - 2 ? 'D' : 'P';
          if (input.weaponType === WeaponType.Sniper && isWood(mfr) && y >= SPINE - 3 && y <= SPINE + 3 && x % 17 === 0) s = 'v';
          g.set(x, y, s);
        }
      }
      // Cheek rest shadow line + butt pad.
      if (isWood(mfr)) g.slope(x0 + 4, SPINE + 4, L.bodyX - 8, SPINE + 5, 'v', true);
      for (let y = SPINE - 2; y <= SPINE + 4; y++) g.set(x0, y, 'K');
    }
    ctx.anchors.Stock = { x: Math.round((x0 + 4) * TEXEL), y: SPINE * TEXEL };
    void v;
  }

  // Grip — its own outline data, rotated slightly by the rake.
  const outline = GRIP_TEMPLATES[shapes.grip];
  const gripW = 15;
  const gx = ctx.gripX;
  const gy = ctx.gripTop;
  const gh = L.gripH;
  const pts: Pt[] = outline.map(([ox, oy]) => [gx + ox + (mfr === Manufacturer.Redline ? Math.round((oy / 1000) * 3) : 0), gy + Math.round((oy / 1000) * (gh - 1))]);
  g.poly(pts, (x, y) => {
    if (isWood(mfr)) return y >= gy + gh - 3 ? 'v' : 'w';
    return x <= gx + 2 ? 'D' : 'P';
  });
  // Finger grooves / facet shadow.
  for (const fy of [0.3, 0.52, 0.74]) {
    const y = Math.round(gy + gh * fy);
    for (let x = gx + 1; x < gx + gripW - 1; x++) g.over(x, y, isWood(mfr) ? 'v' : 'D');
  }
  if (mfr === Manufacturer.Prismatek) {
    g.slope(gx + 2, gy + 3, gx + gripW - 3, gy + gh - 4, 'L', true);
  }
}

/* ------------------------------------------------------------------ */
/* Pass 2 — magazine (per-type forms)                                  */
/* ------------------------------------------------------------------ */

function magazine(ctx: Ctx) {
  const { g, input, L } = ctx;
  const mfr = input.manufacturer;
  const main = mainShade(mfr);
  const dark = darkShade(mfr);
  const v = ctx.variant('Magazine');
  const mx = L.bodyX + Math.round(L.bodyLen * 0.52);
  const my = ctx.bodyBot - 2;

  if (input.weaponType === WeaponType.Shotgun) {
    // Tube magazine under the barrel + pump grip (forend template).
    const fx = ctx.bodyFront;
    const fe = FOREND_TEMPLATES[ctx.shapes.forend];
    const pumpLen = 34;
    for (let x = fx; x < fx + pumpLen; x++) {
      const pm = ((x - fx) / pumpLen) * 1000;
      let depth = 7;
      for (let i = 0; i < fe.length; i++) {
        const [ax, ay] = fe[i];
        const [bx, by] = fe[(i + 1) % fe.length];
        if ((ax <= pm && bx > pm) || (bx <= pm && ax > pm)) depth = Math.max(depth, ay + ((pm - ax) / (bx - ax)) * (by - ay));
      }
      for (let y = SPINE + 5; y <= SPINE + 5 + Math.round(depth); y++) {
        g.set(x, y, y >= SPINE + 5 + Math.round(depth) - 1 ? dark : main);
      }
      if ((x - fx) % 6 === 3) for (let y = SPINE + 6; y <= SPINE + 5 + Math.round(depth) - 1; y++) g.set(x, y, dark);
    }
    for (let x = fx; x < fx + L.barrelLen; x++) g.set(x, SPINE + 4, x % 9 === 0 ? 'K' : dark);
    return;
  }
  if (input.weaponType === WeaponType.Launcher) {
    // Warhead lives in the barrel pass; here: feed drum (variant 0/2)
    // or box (variant 1).
    if (v === 1) {
      for (let y = my; y < my + 16; y++) for (let x = mx - 4; x < mx + 16; x++) {
        g.set(x, y, y === my + 15 || x === mx + 15 ? dark : main);
      }
      for (let i = 0; i < 3; i++) for (let x = mx - 2; x < mx + 14; x++) g.set(x, my + 4 + i * 4, dark);
    } else {
      g.disc(mx + 6, my + 9, 11, main);
      g.ring(mx + 6, my + 9, 7.5, 8.6, dark);
      g.disc(mx + 6, my + 9, 3, 'b');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.set(mx + 6 + Math.round(Math.cos(a) * 5), my + 9 + Math.round(Math.sin(a) * 5), dark);
      }
    }
    ctx.anchors.Magazine = { x: (mx + 6) * TEXEL, y: (my + 9) * TEXEL };
    return;
  }
  if (input.weaponType === WeaponType.Beam) {
    // Power cell slab slung under the receiver.
    const cw = 22; const chh = 12;
    for (let y = my; y < my + chh; y++) for (let x = mx - 2; x < mx - 2 + cw; x++) {
      let s: CardShade = x === mx - 2 || y === my + chh - 1 ? dark : main;
      if (y === my + 5 && x > mx + 1 && x < mx + cw - 5) s = 'E';
      g.set(x, y, s);
    }
    for (let i = 0; i < 3; i++) g.set(mx + 3 + i * 6, my + 2, 'b');
    ctx.anchors.Magazine = { x: (mx + 8) * TEXEL, y: (my + 6) * TEXEL };
    return;
  }
  if (L.magLen <= 0) return;

  if (mfr === Manufacturer.ThrowTech) {
    // Canister magazine — ThrowTech feeds from a drum cell.
    g.disc(mx + 4, my + 11, 12, main);
    g.ring(mx + 4, my + 11, 8.5, 9.6, dark);
    g.disc(mx + 4, my + 11, 3, dark);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      g.disc(mx + 4 + Math.round(Math.cos(a) * 6), my + 11 + Math.round(Math.sin(a) * 6), 1, dark);
    }
    ctx.anchors.Magazine = { x: (mx + 4) * TEXEL, y: (my + 11) * TEXEL };
    return;
  }
  // Curved box magazine — the arc is swept column by column.
  const curve = v === 1 ? 0.22 : v === 2 ? 0.05 : 0.13;
  const magW = input.weaponType === WeaponType.Pistol ? 9 : 12;
  for (let t = 0; t < L.magLen; t++) {
    const shift = Math.round(curve * t * 0.55);
    const wNow = magW - (t > L.magLen - 5 ? 1 : 0);
    for (let dx = 0; dx < wNow; dx++) {
      const x = mx + shift + dx;
      const y = my + t;
      let s: CardShade = dx === 0 || dx === wNow - 1 ? dark : main;
      if (t % 7 === 6) s = dark;
      g.set(x, y, s);
    }
  }
  for (let dx = 0; dx < magW - 1; dx++) g.set(mx + Math.round(curve * L.magLen * 0.55) + dx, my + L.magLen, dark);
  ctx.anchors.Magazine = { x: (mx + 5) * TEXEL, y: (my + Math.round(L.magLen / 2)) * TEXEL };
}

/* ------------------------------------------------------------------ */
/* Pass 3 — receiver (the FORGE grammar shapes this silhouette)        */
/* ------------------------------------------------------------------ */

function receiver(ctx: Ctx) {
  const { g, input, L } = ctx;
  const mfr = input.manufacturer;
  const prof = FORGE_BODY_PROFILES[mfr];
  const main = mainShade(mfr);
  const dark = darkShade(mfr);
  const bodyH = L.bodyH + (prof.belly ?? 0);
  const bx = L.bodyX;
  const front = ctx.bodyFront;

  for (let i = 0; i < L.bodyLen; i++) {
    let t = ctx.bodyTop;
    let b = ctx.bodyTop + bodyH - 1;
    let colMain: CardShade = main;
    if (prof.topRakeEvery) t += Math.floor(i / prof.topRakeEvery);
    if (prof.undersideRakeLast && i >= L.bodyLen - prof.undersideRakeLast) {
      b -= Math.floor((i - (L.bodyLen - prof.undersideRakeLast)) / (prof.undersideRakeEvery ?? 4));
    }
    if (prof.facetSteps && prof.facetShades) {
      const segLen = Math.ceil(L.bodyLen / prof.facetSteps.length);
      const seg = Math.min(prof.facetSteps.length - 1, Math.floor(i / segLen));
      t += prof.facetSteps[seg];
      colMain = prof.facetShades[seg] as CardShade;
    }
    if (prof.heelRound && i < prof.heelRound) t += Math.floor((prof.heelRound - i) / 3);
    if (prof.frontChamfer && i >= L.bodyLen - prof.frontChamfer) {
      t += Math.floor((i - (L.bodyLen - prof.frontChamfer)) / 2);
    }
    if (prof.rearChamfer && i < prof.rearChamfer) t += Math.floor((prof.rearChamfer - i) / 2);
    if (prof.noseClip && i >= L.bodyLen - prof.noseClip) t += i - (L.bodyLen - prof.noseClip - 1);
    if (prof.capsule) {
      const c = prof.capsule;
      if (i < c) { const k = (c - i) / c; t += Math.round(3 * k * k); b -= Math.round(3 * k * k); }
      if (i >= L.bodyLen - c) { const k = (i - (L.bodyLen - c) + 1) / c; t += Math.round(3 * k * k); b -= Math.round(3 * k * k); }
    }
    // Pre-narrow the front columns where the barrel shroud takes over.
    if (mfr === Manufacturer.BlastForge && input.weaponType !== WeaponType.Launcher && i >= L.bodyLen - 6) {
      t += 2; b -= 2;
    }
    for (let y = t; y <= b; y++) {
      let s: CardShade = colMain;
      if (y === t) s = isWood(mfr) ? 'u' : 'L';
      else if (y >= b - 1) s = dark;
      else if (y === t + 1) s = isWood(mfr) ? main : 'p';
      g.set(bx + i, y, s);
    }
    if (prof.facetSteps && i > 0 && i % Math.ceil(L.bodyLen / prof.facetSteps.length) === 0) {
      for (let y = t; y <= b; y++) g.set(bx + i, y, 'L'); // facet seam catches light
    }
  }

  // Receiver detail: ejection port, takedown seam, grip frame line.
  const portY = ctx.bodyTop + 4;
  for (let x = front - 16; x < front - 4; x++) { g.set(x, portY, 'K'); g.set(x, portY + 3, 'K'); }
  for (let y = portY; y <= portY + 3; y++) { g.set(front - 16, y, 'K'); g.set(front - 5, y, 'K'); }
  const seamX = bx + Math.round(L.bodyLen * 0.4);
  for (let y = ctx.bodyTop + 1; y < ctx.bodyTop + bodyH - 1; y++) g.over(seamX, y, 'K');
  if (prof.moduleSeam) {
    // The Kit: a horizontal seam splits the receiver into stacked
    // bolted modules.
    const seamY = ctx.bodyTop + Math.round(bodyH * 0.55);
    for (let x = bx + 2; x < front - 2; x++) g.over(x, seamY, 'K');
    boltHead(g, bx + 4, ctx.bodyTop + 3);
    boltHead(g, front - 8, ctx.bodyTop + 3);
    boltHead(g, bx + 4, ctx.bodyTop + bodyH - 6);
    boltHead(g, front - 8, ctx.bodyTop + bodyH - 6);
  }
  if (prof.rivetCorners) {
    // The Anvil: bolt heads at the receiver corners.
    boltHead(g, bx + 3, ctx.bodyTop + 2);
    boltHead(g, front - 7, ctx.bodyTop + 2);
    boltHead(g, bx + 3, ctx.bodyTop + bodyH - 5);
    boltHead(g, front - 7, ctx.bodyTop + bodyH - 5);
  }
  // Maker mark, stamped in the receiver's dark tone.
  stampMark(g, MAKER_MARKS[mfr], bx + 6, ctx.bodyTop + bodyH - 9, isWood(mfr) ? 'v' : 'D');
}

/* ------------------------------------------------------------------ */
/* Pass 4 — chamber (the element core)                                 */
/* ------------------------------------------------------------------ */

function chamber(ctx: Ctx) {
  const { g, input, L } = ctx;
  const v = ctx.variant('Chamber');
  const cx = L.bodyX + Math.round(L.bodyLen * 0.60);
  const cy = SPINE - 4;
  const cw = [16, 20, 13][v] ?? 16;
  const chh = [9, 7, 11][v] ?? 9;
  const kinetic = !input.element || input.element === Element.Kinetic;
  ctx.anchors.Chamber = { x: (cx + cw / 2) * TEXEL, y: (cy + chh / 2) * TEXEL };

  if (input.manufacturer === Manufacturer.Prismatek && input.weaponType !== WeaponType.Launcher) {
    // Exposed crystal: a cut gem standing proud of the receiver is
    // the maker's form signature. Kinetic included — the crystal is
    // FORM, the current inside it is the element finish.
    const gx = cx + 2; const gw = cw - 2;
    for (let x = gx; x < gx + gw; x++) {
      const f = (x - gx) / gw;
      const top = cy - 3 + Math.round(Math.abs(f - 0.42) * 5);
      const bot = cy + chh + 1 - Math.round(Math.abs(f - 0.58) * 4);
      for (let y = top; y <= bot; y++) {
        let s: CardShade = 'P';
        if (y === top) s = 'L';
        else if (x < gx + 3) s = 'p';
        else if (!kinetic && y >= cy + 2 && y <= cy + chh - 2) s = 'E';
        g.set(x, y, s);
      }
    }
    g.slope(gx + 2, cy - 1, gx + Math.round(gw * 0.45), cy + chh - 1, 'L');
    if (!kinetic) {
      g.disc(gx + Math.round(gw * 0.45), cy + Math.round(chh / 2), 2, 'E');
      g.set(gx + Math.round(gw * 0.45), cy + Math.round(chh / 2), 'W');
    }
    return;
  }
  if (input.weaponType === WeaponType.Beam) {
    // The beam core IS the spine: exposed element channel.
    const fx = L.bodyX + 8;
    for (let x = fx; x < ctx.bodyFront + 10; x++) {
      for (let y = SPINE - 2; y <= SPINE + 2; y++) {
        if (!g.filled(x, y)) g.set(x, y, y === SPINE ? 'E' : 'D');
        else if (y === SPINE && !kinetic) g.set(x, y, 'E');
      }
      if (x % 8 === 4) for (let y = SPINE - 3; y <= SPINE + 3; y += 6) g.set(x, y, 'b');
    }
  }
  // Layered core box: frame, element fill, white-hot heart.
  for (let y = cy; y < cy + chh; y++) for (let x = cx; x < cx + cw; x++) {
    let s: CardShade = 'D';
    if (y > cy && y < cy + chh - 1 && x > cx && x < cx + cw - 1) s = kinetic ? 'p' : 'E';
    if (!kinetic && y >= cy + Math.floor(chh / 2) - 1 && y <= cy + Math.floor(chh / 2) + 1
      && x >= cx + Math.floor(cw / 2) - 2 && x <= cx + Math.floor(cw / 2) + 2) s = 'e';
    g.set(x, y, s);
  }
  if (!kinetic) g.set(cx + Math.floor(cw / 2), cy + Math.floor(chh / 2), 'W');
  // Housing bolts (skip on Beam — its frame carries brass already).
  if (input.weaponType !== WeaponType.Beam) {
    boltHead(g, cx - 4, cy + 1);
    boltHead(g, cx + cw + 1, cy + chh - 3);
  }
}

/* ------------------------------------------------------------------ */
/* Pass 5 — sight (carries part-variant silhouette weight)             */
/* ------------------------------------------------------------------ */

function sight(ctx: Ctx) {
  const { g, input, L } = ctx;
  const v = ctx.variant('Sight');
  const front = ctx.bodyFront;
  const top = ctx.bodyTop;

  if (input.weaponType === WeaponType.Sniper) {
    const sx = L.bodyX + 14;
    const railTop = top - 3;
    for (let x = sx - 2; x < sx + 32; x++) g.set(x, railTop + 2, 'D');
    for (let x = sx; x < sx + 28; x++) for (let y = railTop - 6; y <= railTop; y++) {
      let s: CardShade = 'P';
      if (y === railTop - 6) s = 'L';
      if (x >= sx + 21 && x <= sx + 26 && y >= railTop - 5 && y <= railTop - 1) s = 'e';
      if (x < sx + 3 || x > sx + 24) s = 'D';
      g.set(x, y, s);
    }
    g.ring(sx + 24, railTop - 3, 1.2, 2.2, 'T');
    return;
  }
  if (input.weaponType === WeaponType.Launcher) return; // carry handle in barrel pass
  if (v === 0) {
    // Iron posts.
    for (let x = front - 20; x < front - 16; x++) for (let y = top - 5; y < top; y++) g.set(x, y, 'D');
    g.set(front - 18, top - 6, 'K');
    for (let x = L.bodyX + 8; x < L.bodyX + 12; x++) for (let y = top - 4; y < top; y++) g.set(x, y, 'D');
  } else if (v === 1) {
    // Reflex box with an element-tinted lens.
    const sx = L.bodyX + Math.round(L.bodyLen * 0.3);
    for (let x = sx; x < sx + 14; x++) for (let y = top - 9; y < top; y++) {
      let s: CardShade = 'P';
      if (y === top - 9) s = 'L';
      if (x >= sx + 4 && x <= sx + 9 && y >= top - 7 && y <= top - 3) s = 'e';
      if (x === sx || x === sx + 13 || y === top - 1) s = 'D';
      g.set(x, y, s);
    }
    g.set(sx + 6, top - 5, 'W');
  } else {
    // Tall aperture tower.
    const sx = front - 22;
    for (let x = sx; x < sx + 8; x++) for (let y = top - 12; y < top; y++) {
      let s: CardShade = 'P';
      if (x === sx || x === sx + 7) s = 'D';
      if (y >= top - 10 && y <= top - 6 && x >= sx + 3 && x <= sx + 4) s = 'K';
      g.set(x, y, s);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pass 6 — barrel (tube by profile; type furniture)                   */
/* ------------------------------------------------------------------ */

function barrel(ctx: Ctx) {
  const { g, input, L } = ctx;
  const mfr = input.manufacturer;
  const fx = ctx.bodyFront;
  const profile = BARREL_PROFILES[input.weaponType];
  const vSupp = ctx.variant('Barrel');
  const suppressed = vSupp === 2 && (input.weaponType === WeaponType.Sniper || input.weaponType === WeaponType.SMG || input.weaponType === WeaponType.Pistol);

  if (input.weaponType === WeaponType.Beam) {
    // Twin prongs converging on the emitter tip.
    for (let x = fx; x < fx + L.barrelLen; x++) {
      const f = (x - fx) / L.barrelLen;
      const gap = Math.round(5 - f * 3);
      for (const sgn of [-1, 1]) {
        const cy = SPINE + sgn * gap;
        g.set(x, cy - 1, 'D'); g.set(x, cy, 'P'); g.set(x, cy + 1, 'D');
      }
      if (x % 10 === 5) for (let y = SPINE - gap - 2; y <= SPINE + gap + 2; y++) g.set(x, y, 'b');
      ctx.tubeBottom.set(x, SPINE + gap + 1);
    }
    const tipX = fx + L.barrelLen;
    g.disc(tipX, SPINE, 3, 'T');
    g.set(tipX, SPINE, 'W');
    ctx.muzzleX = tipX + 3;
    // Forend under the prongs.
    const fe = FOREND_TEMPLATES[ctx.shapes.forend];
    for (let x = fx; x < fx + 30; x++) {
      const pm = ((x - fx) / 30) * 1000;
      let depth = 5;
      for (let i = 0; i < fe.length; i++) {
        const [ax, ay] = fe[i];
        const [bx, by] = fe[(i + 1) % fe.length];
        if ((ax <= pm && bx > pm) || (bx <= pm && ax > pm)) depth = Math.max(depth, ay + ((pm - ax) / (bx - ax)) * (by - ay));
      }
      for (let y = SPINE + 6; y <= SPINE + 6 + Math.round(depth) - 2; y++) g.set(x, y, y > SPINE + 9 ? 'D' : 'P');
    }
    return;
  }

  // Shroud (BlastForge): a chamfered box over the barrel root.
  let tubeStart = fx;
  if (mfr === Manufacturer.BlastForge && input.weaponType !== WeaponType.Launcher) {
    const sw = 30;
    for (let x = fx - 2; x < fx + sw; x++) {
      const chamfer = x < fx + 4 ? (fx + 4 - x) : x > fx + sw - 5 ? (x - (fx + sw - 5)) * 2 : 0;
      const r = Math.round(L.barrelThick / 2) + 3 - chamfer;
      for (let y = SPINE - r; y <= SPINE + r; y++) {
        let s: CardShade = y === SPINE - r ? 'L' : y >= SPINE + r - 1 ? 'D' : 'P';
        if ((x - fx) % 8 === 7) s = 'D';
        g.set(x, y, s);
      }
      ctx.tubeBottom.set(x, SPINE + r - 1);
    }
    boltHead(g, fx + 3, SPINE - Math.round(L.barrelThick / 2));
    boltHead(g, fx + 3, SPINE + Math.round(L.barrelThick / 2) - 2);
    tubeStart = fx + sw - 4;
  }

  const tubeEnd = fx + L.barrelLen - (suppressed ? Math.round(L.barrelLen * 0.26) : 0);
  g.tube(tubeStart, tubeEnd, SPINE, profile, (x, y, r) => {
    if (y === Math.round(SPINE + r)) return 'D';
    if (y === Math.round(SPINE - r)) return 'L';
    if (y > SPINE + r - 2) return 'd';
    if (y < SPINE - r + 2) return 'p';
    return 'P';
  });
  // Record the tube's bottom inner row per column (the spine
  // current rides it), using the same span the tube was drawn on.
  for (let x = tubeStart; x <= tubeEnd; x++) {
    const r = profileAt(profile, (x - tubeStart) / Math.max(1, tubeEnd - tubeStart));
    ctx.tubeBottom.set(x, Math.round(SPINE + r) - 1);
  }
  ctx.muzzleX = tubeEnd;

  if (suppressed) {
    const sx = tubeEnd;
    const ex = fx + L.barrelLen;
    const r = Math.round(L.barrelThick / 2) + 1;
    for (let x = sx; x <= ex; x++) for (let y = SPINE - r; y <= SPINE + r; y++) {
      let s: CardShade = y === SPINE - r ? 'L' : y >= SPINE + r - 1 ? 'D' : 'd';
      if ((x - sx) % 7 === 6) s = 'K';
      g.set(x, y, s);
    }
    ctx.muzzleX = ex;
  }

  if (input.weaponType === WeaponType.Launcher) {
    // Warhead cone + fins at the muzzle; carry handle over the body.
    const wx = fx + L.barrelLen - 8;
    for (let dx = 0; dx < 18; dx++) {
      const r = Math.max(1, Math.round(7 * (1 - dx / 20)));
      for (let y = SPINE - r; y <= SPINE + r; y++) g.set(wx + dx, y, dx > 13 ? 'G' : y === SPINE - r ? 'L' : 'T');
    }
    g.thickLine(wx - 2, SPINE - 8, wx - 8, SPINE - 14, 1, 'T');
    g.thickLine(wx - 2, SPINE + 8, wx - 8, SPINE + 14, 1, 'T');
    ctx.muzzleX = wx + 17;
    const hx = L.bodyX + 10;
    for (let x = hx; x < hx + 34; x++) { g.set(x, ctx.bodyTop - 6, 'D'); g.set(x, ctx.bodyTop - 5, 'P'); }
    for (const px of [hx, hx + 31]) for (let y = ctx.bodyTop - 5; y < ctx.bodyTop; y++) g.set(px, y, 'D');
    // Re-assert the receiver top the handle posts may have crossed.
  }
  if (input.weaponType === WeaponType.Sniper) {
    // Bipod: two legs splayed from the barrel underside.
    const bx2 = fx + Math.round(L.barrelLen * 0.62);
    g.thickLine(bx2, SPINE + 2, bx2 - 7, SPINE + 13, 1, 'D');
    g.thickLine(bx2 + 3, SPINE + 2, bx2 + 10, SPINE + 13, 1, 'D');
    g.set(bx2 - 8, SPINE + 13, 'K'); g.set(bx2 + 11, SPINE + 13, 'K');
    // Muzzle brake slots.
    for (let i = 0; i < 3; i++) {
      const mx = tubeEnd - 6 + i * 3;
      for (let y = SPINE - 2; y <= SPINE + 2; y++) g.set(mx, y, 'K');
    }
  }
  if (input.weaponType === WeaponType.Shotgun) {
    // Bead sight + heat holes along the top rib.
    g.set(fx + L.barrelLen - 3, SPINE - 8, 'G');
    for (let x = fx + 8; x < fx + L.barrelLen - 8; x += 9) g.set(x, SPINE - 5, 'K');
  }
}

/* ------------------------------------------------------------------ */
/* Pass 7 — manufacturer hand (details that ride the grammar)          */
/* ------------------------------------------------------------------ */

function manufacturerPass(ctx: Ctx) {
  const { g, input, L } = ctx;
  const mfr = input.manufacturer;
  const fx = ctx.bodyFront;

  if (mfr === Manufacturer.Redline) {
    // Swept cooling fins behind the muzzle + a fin under the receiver.
    for (let i = 0; i < 3; i++) {
      const bx = fx + Math.round(L.barrelLen * 0.55) + i * 5;
      g.thickLine(bx, SPINE - 6, bx + 7, SPINE - 10, 1, 'P');
      g.thickLine(bx, SPINE - 5, bx + 7, SPINE - 9, 0, 'L');
    }
    g.thickLine(L.bodyX + 8, ctx.bodyBot - 1, L.bodyX + 26, ctx.bodyBot + 4, 1, 'D');
  }
  if (mfr === Manufacturer.Ironwood) {
    // Brass barrel bands following the taper + grain on the receiver.
    for (const f of [0.3, 0.62, 0.88]) {
      const bx = fx + Math.round(L.barrelLen * f);
      const r = profileAt(BARREL_PROFILES[input.weaponType], f);
      for (let y = Math.round(SPINE - r) - 1; y <= Math.round(SPINE + r) + 1; y++) { g.set(bx, y, 'b'); g.set(bx + 1, y, 'b'); }
    }
    for (let i = 0; i < 7; i++) {
      const y = ctx.bodyTop + 3 + ((ctx.seed >> (i * 2)) % Math.max(2, L.bodyH - 6));
      const x0 = L.bodyX + 4 + ((ctx.seed >> (i * 3 + 1)) % Math.max(2, L.bodyLen - 22));
      for (let x = x0; x < x0 + 8 && x < fx - 4; x++) g.over(x, y, 'v');
    }
    // Brass butt plate screws.
    g.set(L.bodyX - L.stockLen + 1, SPINE - 1, 'b');
    g.set(L.bodyX - L.stockLen + 1, SPINE + 3, 'b');
  }
  if (mfr === Manufacturer.BlastForge) {
    // Rivet line along the receiver + scorch at the muzzle + the
    // brushed-speckle streaks (owner-veto knob: FORGE_DETAIL_OPTIONS).
    for (let x = L.bodyX + 6; x < fx - 6; x += 9) g.set(x, ctx.bodyTop + 2, 'K');
    const mx = fx + L.barrelLen;
    for (let dx = 0; dx < 8; dx++) for (let y = SPINE - 4; y <= SPINE + 4; y++) {
      if ((dx * 7 + y) % 3 === 0) g.set(mx - 10 + dx, y, 'K');
    }
    if (FORGE_DETAIL_OPTIONS.blastForgeBrushSpeckle) {
      for (let i = 0; i < 26; i++) {
        const x = L.bodyX + 2 + ((ctx.seed >> (i % 12)) + i * 7) % Math.max(2, L.bodyLen - 4);
        const y = ctx.bodyTop + 2 + ((ctx.seed >> (i % 9)) + i * 3) % Math.max(2, L.bodyH - 4);
        const len = 3 + (i % 4);
        for (let dx = 0; dx < len; dx++) g.over(x + dx, y, i % 3 === 0 ? 'p' : 'd');
      }
    }
  }
  if (mfr === Manufacturer.Prismatek) {
    // Shard slopes: diagonal light planes riding the facets.
    g.slope(L.bodyX + 6, ctx.bodyTop + 10, L.bodyX + 22, ctx.bodyTop + 3, 'L', true);
    g.slope(fx - 24, ctx.bodyBot - 4, fx - 8, ctx.bodyTop + 5, 'p', true);
    // Floating shard sight fin.
    g.poly([[fx - 30, ctx.bodyTop - 8], [fx - 22, ctx.bodyTop - 13], [fx - 18, ctx.bodyTop - 8]], 'T');
  }
  if (mfr === Manufacturer.ThrowTech) {
    // Module seams + a curved carry handle (kit-built, bolted on).
    for (const f of [0.33, 0.66]) {
      const sx = L.bodyX + Math.round(L.bodyLen * f);
      for (let y = ctx.bodyTop + 1; y < ctx.bodyBot - 1; y++) g.over(sx, y, 'K');
    }
    const hx = L.bodyX + Math.round(L.bodyLen * 0.22);
    for (let i = 0; i <= 16; i++) {
      const x = hx + i;
      const y = ctx.bodyTop - 4 - Math.round(Math.sin((i / 16) * Math.PI) * 4);
      g.set(x, y, 'P'); g.set(x, y + 1, 'D');
    }
    for (const px of [hx, hx + 16]) for (let y = ctx.bodyTop - 4; y < ctx.bodyTop; y++) g.set(px, y, 'D');
    boltHead(g, L.bodyX + 4, ctx.bodyTop + 3);
    boltHead(g, fx - 8, ctx.bodyBot - 6);
  }
  if (mfr === Manufacturer.HelixWorks) {
    // Coil rings following the barrel taper + calibration dial.
    for (let i = 0; i < 5; i++) {
      const f = 0.16 + i * 0.17;
      const bx = fx + Math.round(L.barrelLen * f);
      const r = profileAt(BARREL_PROFILES[input.weaponType], f) + 1.5;
      for (let y = Math.round(SPINE - r); y <= Math.round(SPINE + r); y++) { g.set(bx, y, 'b'); g.set(bx + 1, y, y === Math.round(SPINE - r) ? 'L' : 'b'); }
    }
    const dx = L.bodyX + Math.round(L.bodyLen * 0.78);
    const dy = ctx.bodyTop + Math.round(L.bodyH * 0.45);
    g.ring(dx, dy, 2.4, 3.6, 'b');
    g.set(dx, dy, 'T');
    g.set(dx, dy - 3, 'W');
  }
}

/* ------------------------------------------------------------------ */
/* Pass 8 — element current (FORGE finish: lit current on the spine)   */
/* ------------------------------------------------------------------ */

/**
 * The element finish as FORGE specified it: a lit current traced
 * along the form's spine — dark bed, bright line, hot nodes — from
 * the chamber core to the muzzle. Kinetic = honest absence (no bed,
 * no line, no nodes); the Prismatek crystal and the Beam core are
 * FORM, not current, and stay lit at Kinetic too (they are already
 * drawn by their passes). This pass is what the broken SVG element
 * layer never did: the element provably reaches the muzzle.
 */
function elementCurrent(ctx: Ctx) {
  const { g, input } = ctx;
  if (!input.element || input.element === Element.Kinetic) return;
  if (input.weaponType === WeaponType.Beam) return; // the core is the current
  const chamberAnchor = ctx.anchors.Chamber;
  if (!chamberAnchor) return;
  const startX = Math.round(chamberAnchor.x / TEXEL) + 4;
  const endX = ctx.muzzleX - 2;
  let prevY = SPINE + 4;
  const pathY = (x: number): number => {
    const tube = ctx.tubeBottom.get(x);
    const target = x >= ctx.bodyFront && tube !== undefined ? tube - 1 : SPINE + 4;
    prevY = Math.max(prevY - 1, Math.min(prevY + 1, target));
    return prevY;
  };
  // Bed (dark element tint, 3 tall, only over the form).
  for (let x = startX; x <= endX; x++) {
    const y = pathY(x);
    for (const dy of [-1, 0, 1]) g.over(x, y + dy, 'c');
  }
  // Bright line down the middle of the bed.
  prevY = SPINE + 4;
  for (let x = startX; x <= endX; x++) {
    const y = pathY(x);
    g.over(x, y, 'e');
  }
  // Hot nodes: base-color beads with a white heart, every ~16px.
  prevY = SPINE + 4;
  let sinceNode = 99;
  for (let x = startX; x <= endX; x++) {
    const y = pathY(x);
    sinceNode++;
    if (sinceNode >= 16 && x < endX - 4) {
      sinceNode = 0;
      g.disc(x, y, 2, 'E');
      g.set(x, y, 'W');
    }
  }
  // Muzzle node: the current arrives.
  g.disc(ctx.muzzleX + 1, SPINE, 1, 'e');
  g.set(ctx.muzzleX + 1, SPINE, 'W');
}

/* ------------------------------------------------------------------ */
/* Pass 9 — element accents (speckle/drips/streaks per element)        */
/* ------------------------------------------------------------------ */

function elementFinish(ctx: Ctx) {
  const { g, input, L } = ctx;
  if (!input.element) return;
  const rng = seededRandom(ctx.seed ^ 0xE1E9);
  const front = ctx.bodyFront;
  const speckle = (n: number, shade: CardShade, zone: 'body' | 'barrel') => {
    for (let i = 0; i < n; i++) {
      const x = zone === 'body'
        ? L.bodyX + 2 + Math.floor(rng() * (L.bodyLen - 4))
        : front + 2 + Math.floor(rng() * Math.max(2, L.barrelLen - 4));
      const y = zone === 'body'
        ? ctx.bodyTop + 2 + Math.floor(rng() * (L.bodyH - 4))
        : SPINE - 4 + Math.floor(rng() * 9);
      g.over(x, y, shade);
    }
  };
  switch (input.element) {
    case Element.Kinetic:
      // Honest metal: three machined ring bands, no glow anywhere.
      for (const f of [0.25, 0.5, 0.75]) {
        const bx = front + Math.round(L.barrelLen * f);
        const r = profileAt(BARREL_PROFILES[input.weaponType], f);
        for (let y = Math.round(SPINE - r); y <= Math.round(SPINE + r); y++) g.set(bx, y, 'T');
      }
      break;
    case Element.Fire:
      speckle(10, 'E', 'body'); speckle(6, 'e', 'barrel');
      break;
    case Element.Shock:
      for (let i = 0; i < 3; i++) {
        const x0 = L.bodyX + 8 + Math.floor(rng() * (L.bodyLen - 16));
        let x = x0; let y = ctx.bodyTop + 3;
        for (let s = 0; s < 5; s++) { g.over(x, y, 'e'); x += s % 2 === 0 ? 2 : -1; y += 2; }
      }
      speckle(5, 'E', 'barrel');
      break;
    case Element.Corrosive:
      speckle(8, 'E', 'body');
      for (let i = 0; i < 3; i++) {
        const x = front - 6 - i * 9;
        for (let y = ctx.bodyBot; y < ctx.bodyBot + 4 && g.filled(x, y - 1); y++) g.set(x, y, 'E');
      }
      break;
    case Element.Cryo:
      speckle(7, 'e', 'body'); speckle(5, 'W', 'barrel');
      break;
    case Element.Void:
      speckle(8, 'E', 'body');
      for (let i = 0; i < 2; i++) {
        const x = L.bodyX + 10 + Math.floor(rng() * (L.bodyLen - 20));
        for (let dx = 0; dx < 4; dx++) g.over(x + dx, ctx.bodyTop + 5 + (dx % 2), 'K');
      }
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Pass 10 — theme (cracks; palette/shape overrides apply in compose)  */
/* ------------------------------------------------------------------ */

function themePass(ctx: Ctx) {
  const { g, input, L } = ctx;
  if (!ctx.theme?.cracks) return;
  const rng = seededRandom(ctx.seed ^ 0xC2AC5);
  void input;
  for (let i = 0; i < 9; i++) {
    let x = L.bodyX - L.stockLen + 2 + Math.floor(rng() * (L.stockLen + 20));
    let y = SPINE - 5 + Math.floor(rng() * 11);
    const steps = 3 + Math.floor(rng() * 4);
    for (let s = 0; s < steps; s++) {
      if (g.get(x, y) === 'w' || g.get(x, y) === 'u') g.set(x, y, 'K');
      x += 1; y += rng() > 0.5 ? 1 : 0;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pass 11 — wear (rarity-driven seeded scratches, form untouched)     */
/* ------------------------------------------------------------------ */

function wearPass(ctx: Ctx) {
  const { g, input, L } = ctx;
  const scratches = input.rarity === Rarity.Common ? 14 : input.rarity === Rarity.Uncommon ? 7 : 0;
  if (!scratches) return;
  const rng = seededRandom(ctx.seed ^ 0xBEA5);
  for (let i = 0; i < scratches; i++) {
    const x = L.bodyX - L.stockLen + Math.floor(rng() * (L.bodyLen + L.barrelLen + L.stockLen - 8));
    const y = 12 + Math.floor(rng() * 46);
    const len = 2 + Math.floor(rng() * 5);
    for (let dx = 0; dx < len; dx++) {
      const cur = g.get(x + dx, y);
      if (cur === 'P' || cur === 'w') g.set(x + dx, y, 'T');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pass 12 — rarity finish (edges only; form never changes)            */
/* ------------------------------------------------------------------ */

function rarityFinish(ctx: Ctx) {
  const { g, input, L } = ctx;
  const bodyCells: [number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.filled(x, y)) bodyCells.push([x, y]);

  if (input.rarity === Rarity.Uncommon || input.rarity === Rarity.Rare) {
    // Trim: recolor topmost per column in the body's span.
    const trim: CardShade = input.rarity === Rarity.Uncommon ? 'g' : 'T';
    for (let x = L.bodyX - L.stockLen; x < ctx.bodyFront + L.barrelLen; x++) {
      for (let y = 0; y < H; y++) if (g.filled(x, y)) { g.set(x, y, trim); break; }
    }
  }
  if (input.rarity === Rarity.Epic) {
    // Epic edge glow: purple shade on the silhouette's outer ring.
    for (const [x, y] of bodyCells) {
      const edge = !g.filled(x + 1, y) || !g.filled(x - 1, y) || !g.filled(x, y + 1) || !g.filled(x, y - 1);
      if (edge && g.get(x, y) === 'P') g.set(x, y, 'e');
    }
  }
  if (input.rarity === Rarity.Legendary) {
    // Halo: gold outline one ring out from the form, pooled glow
    // beneath, sparkles. Components < 40 cells are trim, not form.
    const compId = new Int16Array(W * H).fill(-1);
    const comps: [number, number][][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!g.filled(x, y) || compId[y * W + x] >= 0) continue;
      const id = comps.length;
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      compId[y * W + x] = id;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx; const ny = cy + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && g.filled(nx, ny) && compId[ny * W + nx] < 0) {
            compId[ny * W + nx] = id; stack.push([nx, ny]);
          }
        }
      }
      comps.push(cells);
    }
    const dist = new Float32Array(W * H).fill(99);
    const queue: [number, number][] = [];
    comps.forEach((cells, id) => {
      if (cells.length < 40) return;
      for (const [x, y] of cells) { dist[y * W + x] = 0; queue.push([x, y]); }
      void id;
    });
    for (let qi = 0; qi < queue.length; qi++) {
      const [x, y] = queue[qi];
      const d = dist[y * W + x];
      if (d >= 3) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (dist[ny * W + nx] > d + 1) { dist[ny * W + nx] = d + 1; queue.push([nx, ny]); }
      }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g.filled(x, y)) continue;
      const d = dist[y * W + x];
      if (d === 2) g.set(x, y, 'G');
    }
    // Pooled glow under the form.
    let maxY = 0;
    for (const [, y] of bodyCells) maxY = Math.max(maxY, y);
    const glowY = Math.min(H - 2, maxY + 4);
    for (let x = 30; x < W - 30; x++) {
      let anyNear = false;
      for (const [bx] of bodyCells) if (Math.abs(bx - x) <= 26) { anyNear = true; break; }
      if (anyNear) { g.set(x, glowY, 'G'); if (x % 3 !== 0) g.set(x, glowY + 1, 'G'); }
    }
    // Sparkles.
    const rng = seededRandom(ctx.seed ^ 0x59A2C);
    for (let i = 0; i < 7; i++) {
      const x = 16 + Math.floor(rng() * (W - 32));
      const y = 6 + Math.floor(rng() * (H - 14));
      if (!g.filled(x, y) && dist[y * W + x] >= 3) {
        g.set(x, y, 'G'); g.set(x - 1, y, 'G'); g.set(x + 1, y, 'G'); g.set(x, y - 1, 'G'); g.set(x, y + 1, 'G');
      }
    }
  }
  if (input.rarity === Rarity.Common) {
    // Matte speckle: the finish ladder's bottom rung.
    const rng = seededRandom(ctx.seed ^ 0xAA77E);
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(rng() * W); const y = Math.floor(rng() * H);
      if (g.get(x, y) === 'P') g.set(x, y, 'D');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pass 13 — outline (crisp silhouette + step shading)                 */
/* ------------------------------------------------------------------ */

function outlinePass(ctx: Ctx) {
  const { g } = ctx;
  // Adjacency is tested against a SNAPSHOT of the pre-outline form —
  // testing the live grid would let each placed outline cell seed
  // the next, flooding open space with a marching staircase.
  const snap = g.rows();
  const wasFilled = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && snap[y][x] !== '.';
  const wasShade = (x: number, y: number) => (x >= 0 && x < W && y >= 0 && y < H ? snap[y][x] : '.');
  // Anti-step shading: diagonal neighbors of the outline get the
  // half-tone 'k' so long slopes read smooth at card size.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (wasFilled(x, y)) continue;
    const diag = (wasFilled(x + 1, y + 1) && wasShade(x + 1, y + 1) !== 'G') || (wasFilled(x - 1, y + 1) && wasShade(x - 1, y + 1) !== 'G')
      || (wasFilled(x + 1, y - 1) && wasShade(x + 1, y - 1) !== 'G') || (wasFilled(x - 1, y - 1) && wasShade(x - 1, y - 1) !== 'G');
    const ortho = wasFilled(x + 1, y) || wasFilled(x - 1, y) || wasFilled(x, y + 1) || wasFilled(x, y - 1);
    if (ortho) g.set(x, y, 'K');
    else if (diag) g.set(x, y, 'k');
  }
  // Top light line: first form cell per column catches light.
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (wasFilled(x, y)) { if (wasShade(x, y) === 'P') g.set(x, y, 'L'); break; }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pass 14 — decals + condition (production parity with the stage)     */
/* ------------------------------------------------------------------ */

function decalsAndCondition(ctx: Ctx, render: { decals: WeaponVisualDecal[]; condition: WeaponCondition }) {
  const { g, input } = ctx;
  // Affix decals: the SAME derivation the stage compositor uses
  // (buildDecals over the instance's affixes + the shared visual
  // seed), stamped from the 200×80 decal view space onto the card
  // grid over body cells only. Shape offsets scale ×2 with the
  // grid so a decal keeps its stage visual weight.
  const decals = buildDecals(input.affixes, ctx.seed, input.legendaryEffectId);
  const OS = 2;
  const stampCell = (x: number, y: number, shade: CardShade) => {
    if (g.in(x, y) && g.filled(x, y)) g.set(x, y, shade);
  };
  for (const decal of decals) {
    const gx = Math.round((decal.x / 200) * W);
    const gy = Math.round((decal.y / 80) * H);
    const shade: CardShade = decal.label === '★' ? 'G' : 'T';
    stampCell(gx, gy, shade);
    if (decal.shape === 'slash') {
      stampCell(gx + OS, gy - OS, shade);
      stampCell(gx - OS, gy + OS, shade);
      stampCell(gx + 1, gy - 1, shade);
      stampCell(gx - 1, gy + 1, shade);
    } else if (decal.shape === 'diamond') {
      stampCell(gx, gy - OS, shade);
      stampCell(gx, gy + OS, shade);
      stampCell(gx - OS, gy, shade);
      stampCell(gx + OS, gy, shade);
    } else if (decal.shape === 'triangle') {
      stampCell(gx - OS, gy + OS, shade);
      stampCell(gx + OS, gy + OS, shade);
    } else if (decal.shape === 'tag') {
      stampCell(gx + OS, gy, shade);
      stampCell(gx, gy + OS, shade);
      stampCell(gx + OS, gy + OS, shade);
    }
  }
  render.decals = decals;

  // Roll-quality condition: the same grade the stage derives
  // (conditionFromRoll) with the stage's wear/sheen behavior —
  // wear erases a seeded speckle of main/dark body cells (the
  // card alphabet adds the wood shades w/v to the stage's P/D),
  // mint/godroll lift the top edge and godroll sparkles.
  const condition = conditionFromRoll(typeof input.rollQuality === 'number' ? input.rollQuality : 50);
  render.condition = condition;
  if (condition === 'beat-up' || condition === 'field-used') {
    const wearRate = condition === 'beat-up' ? 0.06 : 0.025;
    const wearRng = seededRandom(ctx.seed ^ 0x51ab3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = g.get(x, y);
      if ((c === 'P' || c === 'D' || c === 'w' || c === 'v') && wearRng() < wearRate) g.set(x, y, '.' as CardShade);
    }
  } else if (condition === 'mint' || condition === 'godroll') {
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const c = g.get(x, y);
        if (c === 'P') { g.set(x, y, 'L'); break; }
        if (c === 'w') { g.set(x, y, 'u'); break; }
        if (g.filled(x, y)) break;
      }
    }
    if (condition === 'godroll') {
      const sparkleRng = seededRandom(ctx.seed ^ 0x90d15);
      let placed = 0;
      for (let y = 0; y < H && placed < 10; y++) for (let x = 0; x < W && placed < 10; x++) {
        const c = g.get(x, y);
        if ((c === 'P' || c === 'w') && sparkleRng() < 0.05) { g.set(x, y, 'G'); placed++; }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Compose                                                             */
/* ------------------------------------------------------------------ */

const cardCache = new Map<string, WeaponCardRender>();

export function composeWeaponCard(input: PixelWeaponInput, themeId?: string): WeaponCardRender {
  const theme = themeId ? WEAPON_THEMES[themeId] : undefined;
  const L = CARD_LAYOUTS[input.weaponType];
  const mfrStyle = MANUFACTURER_WEAPON_STYLES[input.manufacturer];
  const elVisual = input.element ? getElementVisual(input.element) : null;
  const frame = RARITY_FRAME_STYLES[input.rarity];

  const colors: Partial<Record<CardShade, string>> = {
    K: '#0B0B0E',
    k: '#3A3F4A',
    D: mfrStyle.dark,
    d: hexLerp(mfrStyle.dark, mfrStyle.primary, 0.45),
    P: mfrStyle.primary,
    p: mfrStyle.light,
    L: hexLerp(mfrStyle.light, '#FFFFFF', 0.55),
    W: '#FFFFFF',
    T: '#9AA3B2',
    G: '#FFEA3A',
    E: elVisual ? elVisual.color : frame.color,
    e: elVisual ? elVisual.accentColor : frame.accentColor,
    c: elVisual ? hexLerp(elVisual.color, '#0B0B0E', 0.55) : mfrStyle.dark,
    v: '#5A4028',
    w: '#8A6136',
    u: '#C89B62',
    b: '#C9A227',
    g: frame.color,
  };
  if (input.rarity === Rarity.Epic) colors.e = frame.accentColor;
  if (input.rarity === Rarity.Uncommon) colors.g = '#7CFC00';

  // Theme palette overrides (bone over wood, etc.).
  if (theme?.palette) {
    for (const [k, val] of Object.entries(theme.palette)) colors[k as CardShade] = val;
  }

  const shapes: ShapeSet = { ...MAKER_SHAPE_SETS[input.manufacturer], ...(theme?.shapes ?? {}) };
  const g = new Grid();
  const bodyTop = SPINE - Math.floor(L.bodyH / 2);
  const ctx: Ctx = {
    g, input, L, shapes, theme,
    seed: weaponVisualSeed(input),
    bodyTop,
    bodyBot: bodyTop + L.bodyH - 1,
    bodyFront: L.bodyX + L.bodyLen,
    gripX: L.bodyX + Math.round(L.bodyLen * 0.30),
    gripTop: bodyTop + L.bodyH - 2,
    muzzleX: L.bodyX + L.bodyLen + L.barrelLen,
    tubeBottom: new Map(),
    anchors: {},
    variant: (slot, variants) => partVariant(input, slot, variants),
  };

  stockAndGrip(ctx);
  magazine(ctx);
  receiver(ctx);
  chamber(ctx);
  sight(ctx);
  barrel(ctx);
  manufacturerPass(ctx);
  elementCurrent(ctx);
  elementFinish(ctx);
  themePass(ctx);
  wearPass(ctx);
  rarityFinish(ctx);
  outlinePass(ctx);
  const finish: { decals: WeaponVisualDecal[]; condition: WeaponCondition } = { decals: [], condition: 'clean' };
  decalsAndCondition(ctx, finish);

  // Anchors: centroid + topmost filled cell at its column, the
  // same derivation as the stage compositor.
  let cxSum = 0; let cySum = 0; let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!g.filled(x, y)) continue;
    cxSum += x; cySum += y; n++;
  }
  const centerMass = n > 0
    ? { x: Math.round((cxSum / n) * TEXEL), y: Math.round((cySum / n) * TEXEL) }
    : { x: W * 2, y: H * 2 };
  let lootY = 0;
  for (let y = 0; y < H; y++) {
    if (g.filled(Math.round(cxSum / Math.max(1, n)), y)) { lootY = y; break; }
  }
  const rows = g.rows();
  // Signature: render-derived, like the stage compositor's — two
  // surfaces agree on a weapon iff they agree on this string. The
  // density marker keeps card signatures disjoint from stage ones;
  // the colors hash keeps palette-only theme variants distinct.
  const signature = hashString(
    `card2x|${input.weaponType}|${input.manufacturer}|${input.rarity}|${input.element ?? ''}|${themeId ?? ''}|${rows.join('/')}|${hashString(JSON.stringify(colors)).toString(16)}`,
  ).toString(16);
  const render: WeaponCardRender = {
    width: W, height: H,
    rows,
    colors,
    signature,
    decals: finish.decals,
    condition: finish.condition,
    anchors: {
      muzzle: { x: ctx.muzzleX * TEXEL, y: SPINE * TEXEL },
      grip: { x: (ctx.gripX + 7) * TEXEL, y: (ctx.gripTop + L.gripH) * TEXEL },
      centerMass,
      lootPoint: { x: centerMass.x, y: lootY * TEXEL },
    },
    partAnchors: {
      ...(ctx.anchors.Stock ? { Stock: ctx.anchors.Stock } : {}),
      ...(ctx.anchors.Magazine ? { Magazine: ctx.anchors.Magazine } : {}),
      ...(ctx.anchors.Chamber ? { Chamber: ctx.anchors.Chamber } : {}),
      ...(ctx.anchors.Sight ? { Sight: ctx.anchors.Sight } : {}),
    },
    rarityColor: frame.color,
  };
  return render;
}

/**
 * Cached compose, mirroring the stage compositor: identical input
 * returns the identical render object, so lists never recompose a
 * weapon they have already drawn.
 */
export function composeWeaponCardCached(input: PixelWeaponInput, themeId?: string): WeaponCardRender {
  const composed = composeWeaponCard(input, themeId);
  const cached = cardCache.get(composed.signature);
  if (cached) return cached;
  if (cardCache.size > 400) cardCache.clear();
  cardCache.set(composed.signature, composed);
  return composed;
}

/** Paint a card render into a 2D context at integer scale. */
export function paintWeaponCard(
  ctx2d: CanvasRenderingContext2D,
  render: WeaponCardRender,
  scale: number,
): void {
  const { rows, colors, width, height } = render;
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    let runShade = '';
    let runStart = 0;
    const flush = (endX: number) => {
      if (!runShade || runShade === '.') return;
      const color = colors[runShade as CardShade];
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

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function hexLerp(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const gg = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bb = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `#${((r << 16) | (gg << 8) | bb).toString(16).padStart(6, '0')}`;
}
