import { DropSource, Rarity } from '@/types/game';
import type { GearItem, Relic } from '@/types/items';
import { hashString } from '@/lib/utils/rng';
import {
  GEAR_CARD_PLATES,
  type GearCanvas,
  type GearComposeInput,
  type GearGrammar,
  type GearShade,
} from './gearCardCompositor';

/**
 * relicGrammar — gear marriage, slice 4: RELICS on the pixel plate
 * engine (gearCardCompositor, slice 0); SALVAGE adoption
 * (owner-approved 2026-11-03, grammar id relic-salvage-v2).
 *
 * The marriage (audit §4.4): a relic's form is its NAME. Relic
 * names are a closed pool of twelve (RELIC_NAMES in the server
 * generator — every relic in existence was minted there), so each
 * name gets one silhouette row: a Vault Chip is a chip, a Neural
 * Key is a key, a Void Prism is a prism. What the old SVG keyed
 * on — sourceTag, where the relic came from — demotes to a BASE
 * TREATMENT, never the form.
 *
 * The SALVAGE pass (the owner's ruling after slice 4 shipped:
 * the v1 plates read "too perfect" — pristine, symmetric,
 * airbrushed, centered on museum plinths — against the weapons'
 * standard, "the perfect blend of detail yet pixelated"). The
 * approved exploration (cybercache-prep/relic-rework-samples)
 * kept each name's object and subjected it to the procedures the
 * weapon grammars run on every gun, plus the one a found object
 * needs:
 *   MADE — panel-block shading with broken tone edges instead of
 *     smooth bands; cores seated in worn sockets, off-axis;
 *     fasteners, seams that stop short, solder blobs, a stenciled
 *     data-plate, one dead node among lit ones.
 *   USED — a rarity-scaled wear budget (the weapon ladder's
 *     move): silhouette-biting edge chips, scratch runs,
 *     bottom-weighted grime, patina. Common is beat up; Legendary
 *     carries one character scar — a relic was dug up, not minted.
 *   DROPPED — the six plinths are gone. The object sits over a
 *     rubble cluster under its own footprint with a contact
 *     shadow, and the drop-source treatment survives as a small
 *     marker IN the dirt (boss horn-spikes, cache cradle stubs,
 *     an event banner stub, the crafted plank edge, the market
 *     price tag). Affix pips ride the rubble front.
 *
 * Owner's note on the approval: three gem forms — Echo Stone,
 * Void Prism, Glitched Token — got a real RE-FORMING in this
 * adoption, not just the finish: an irregular river-worn lump
 * with a bitten notch, a leaning crystal with a growth step in
 * its edge, a struck token blank clipped along a chord with a
 * rim bite. An oval with grime is still a polished pebble; the
 * weapons' trick is irregular FORM, and the gems now carry it in
 * the silhouette layer, so the thumbs inherit it.
 *
 * Relics are element-less, so the colorway decision is per-name:
 * each row carries one saturated baseColor and the core builds
 * its five-tone ramp from it. Per-instance seed drives etches,
 * jitter, rubble and the wear draws — never the form itself.
 *
 * An unmapped name is a BUILD failure, not a render fallback:
 * inputFromItem throws, and the coverage test (relicGrammar.test)
 * pins the grammar rows to RELIC_NAMES so the suite goes red the
 * day the pool grows without a row.
 */

/* ------------------------------------------------------------------ */
/* Geometry — resolution-relative, so one paint serves card + thumb    */
/* ------------------------------------------------------------------ */

interface RelicCtx {
  c: GearCanvas;
  x0: number;
  y0: number;
  w: number;
  h: number;
  cx: number;
}

function makeCtx(canvas: GearCanvas): RelicCtx {
  const b = canvas.body;
  return { c: canvas, x0: b.x, y0: b.y, w: b.w, h: b.h, cx: b.x + Math.floor(b.w / 2) };
}

const X = (ctx: RelicCtx, f: number) => ctx.x0 + Math.round(f * ctx.w);
const Y = (ctx: RelicCtx, f: number) => ctx.y0 + Math.round(f * ctx.h);
/** A radius as a fraction of body height (texel-true at both densities). */
const R = (ctx: RelicCtx, f: number) => Math.max(1, Math.round(f * ctx.h));

type Pt = [number, number];

/* ------------------------------------------------------------------ */
/* MADE — panel shading, sockets, marks                                */
/* ------------------------------------------------------------------ */

/**
 * Panel-block fill for a rect region: flat base tone with a light
 * mass at the top and a dark mass at the foot, the boundaries
 * BROKEN by per-column seeded jitter (±1 texel) and stray tone
 * texels — the anti-`banded()`. Five tones, single texels, lawful.
 */
function panelRect(ctx: RelicCtx, x0f: number, y0f: number, x1f: number, y1f: number) {
  const c = ctx.c;
  const x0 = X(ctx, x0f); const x1 = X(ctx, x1f);
  const y0 = Y(ctx, y0f); const y1 = Y(ctx, y1f);
  const jit: number[] = [];
  for (let i = 0; i < 64; i++) jit.push(c.pick(3) - 1);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const rel = (y - y0) / Math.max(1, y1 - y0);
      const j = jit[Math.abs(x) % jit.length] * 0.045;
      let s: GearShade = 'P';
      if (rel < 0.16 + j) s = 'p';
      else if (rel > 0.80 + j) s = 'd';
      if (rel > 0.94) s = 'D';
      c.set(x, y, s);
    }
  }
  // Stray tone texels — the dither that keeps masses from reading
  // as airbrushed planes.
  const strays = Math.round((x1 - x0) * (y1 - y0) * 0.012);
  for (let i = 0; i < strays; i++) {
    const x = x0 + c.pick(Math.max(1, x1 - x0));
    const y = y0 + c.pick(Math.max(1, y1 - y0));
    c.set(x, y, c.pick(2) ? 'd' : 'p');
  }
}

/**
 * Broken-tone shading over a region's base-tone cells: brightness
 * falls off toward the lower-right, but the falloff is JITTERED
 * per column and per cell, so masses break into patches instead
 * of resolving into smooth bands or two graphic-design triangles.
 * (A per-column constant reads as wood-grain striping; per-cell
 * jitter is what breaks it.)
 */
function brokenTone(ctx: RelicCtx, x0f: number, y0f: number, x1f: number, y1f: number) {
  const c = ctx.c;
  const g = c.plate;
  const x0 = X(ctx, x0f); const x1 = X(ctx, x1f);
  const y0 = Y(ctx, y0f); const y1 = Y(ctx, y1f);
  const jit: number[] = [];
  for (let i = 0; i < 64; i++) jit.push((c.pick(3) - 1) * 0.02);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (g.get(x, y) !== 'P') continue;
      const relX = (x - x0) / Math.max(1, x1 - x0);
      const relY = (y - y0) / Math.max(1, y1 - y0);
      let b = (1 - relY) * 0.62 + (1 - relX) * 0.38
        + jit[Math.abs(x) % jit.length] + (c.next() - 0.5) * 0.09;
      if (c.next() < 0.015) b += c.pick(2) ? 0.14 : -0.14; // stray texel
      g.set(x, y, b > 0.74 ? 'p' : b > 0.44 ? 'P' : b > 0.22 ? 'd' : 'D');
    }
  }
}

/** Chamfered casing with broken-tone shading. */
function casing(ctx: RelicCtx, x0f: number, y0f: number, x1f: number, y1f: number, chamF = 0.035) {
  const x0 = X(ctx, x0f); const x1 = X(ctx, x1f);
  const y0 = Y(ctx, y0f); const y1 = Y(ctx, y1f);
  const ch = Math.max(1, Math.round(chamF * ctx.w));
  const pts: Pt[] = [
    [x0 + ch, y0], [x1 - ch, y0], [x1, y0 + ch], [x1, y1 - ch],
    [x1 - ch, y1], [x0 + ch, y1], [x0, y1 - ch], [x0, y0 + ch],
  ];
  ctx.c.poly(pts, 'P');
  brokenTone(ctx, x0f, y0f, x1f, y1f);
  for (let x = x0 + ch; x < x1 - ch; x += 2) ctx.c.set(x, y1 - 1, 'D');
}

/**
 * A core SEATED, not displayed: an irregular dark socket (rim
 * texels knocked to worn steel), the stepped core a touch smaller
 * than a set gem's, its white heart off-center by a texel. The
 * gem stops being a product shot and becomes a component in a
 * housing. Keep rf ≥ ~0.08: below that the step layers collapse
 * onto the same texels at thumb scale and the core loses its
 * body tone (the thumb pins in relicGrammar.test enforce it).
 */
function socketCore(ctx: RelicCtx, cxf: number, cyf: number, rf: number) {
  const c = ctx.c;
  const cx = X(ctx, cxf); const cy = Y(ctx, cyf);
  const rs = R(ctx, rf * 1.16);
  c.disc(cx, cy, rs, 'D');
  // Worn rim: three steel texels at seeded rim points.
  for (let i = 0; i < 3; i++) {
    const a = c.next() * Math.PI * 2;
    c.set(cx + Math.round(Math.cos(a) * rs), cy + Math.round(Math.sin(a) * rs * 0.8), 'k');
  }
  const r = R(ctx, rf);
  c.disc(cx, cy, r, 'c');
  c.disc(cx, cy, Math.max(1, Math.round(r * 0.72)), 'E');
  c.disc(cx, cy, Math.max(1, Math.round(r * 0.5)), 'e');
  c.set(cx + 1, cy, 'W');
  if (r >= 4) c.set(cx + 1, cy - 1, 'W');
}

/** Stencil data-plate: three short bars + one steel tick (detail). */
function stencil(ctx: RelicCtx, xf: number, yf: number) {
  const c = ctx.c;
  if (c.detailLevel < 1) return;
  const x = X(ctx, xf); const y = Y(ctx, yf);
  c.stripe(x, y, Math.round(ctx.w * 0.055), 'c');
  c.stripe(x, y + 3, Math.round(ctx.w * 0.04), 'c');
  c.stripe(x, y + 6, Math.round(ctx.w * 0.05), 'c');
  c.set(x + Math.round(ctx.w * 0.06), y + 3, 'T');
}

/** Solder blob: a steel texel with a dark seat beside it (detail). */
function solder(ctx: RelicCtx, xf: number, yf: number) {
  const c = ctx.c;
  if (c.detailLevel < 1) return;
  c.set(X(ctx, xf), Y(ctx, yf), 'T');
  c.set(X(ctx, xf) + 1, Y(ctx, yf), 'k');
}

/* ------------------------------------------------------------------ */
/* USED — the wear passes (rarity budget, weapon-ladder style)         */
/* ------------------------------------------------------------------ */

const WEAR_BUDGET: Record<Rarity, { chips: number; scratches: number; grime: number; patina: number }> = {
  [Rarity.Common]: { chips: 13, scratches: 11, grime: 0.55, patina: 5 },
  [Rarity.Uncommon]: { chips: 9, scratches: 7, grime: 0.42, patina: 3 },
  [Rarity.Rare]: { chips: 5, scratches: 4, grime: 0.27, patina: 2 },
  [Rarity.Epic]: { chips: 3, scratches: 2, grime: 0.17, patina: 2 },
  [Rarity.Legendary]: { chips: 2, scratches: 1, grime: 0.09, patina: 1 },
};

const DARKEN: Partial<Record<GearShade, GearShade>> = { L: 'p', p: 'P', P: 'd', d: 'D', E: 'c', e: 'E' };

function boundaryCells(ctx: RelicCtx, maxY: number): Pt[] {
  const g = ctx.c.plate;
  const out: Pt[] = [];
  for (let y = 0; y < maxY; y++) for (let x = 0; x < g.width; x++) {
    if (!g.filled(x, y)) continue;
    if (!g.filled(x + 1, y) || !g.filled(x - 1, y) || !g.filled(x, y + 1) || !g.filled(x, y - 1)) out.push([x, y]);
  }
  return out;
}

/**
 * The wear budget, card density only (the pass returns at detail
 * level 0, so thumbs are rarity-identical silhouettes — pinned).
 * Runs after the ground so its draws never depend on the form,
 * and bounded above the ground line so it never chews the dirt.
 */
function wearPass(ctx: RelicCtx, rarity: Rarity) {
  const c = ctx.c;
  if (c.detailLevel < 1) return;
  const budget = WEAR_BUDGET[rarity];
  const g = c.plate;
  const groundTop = Y(ctx, 0.85);

  // Edge chips — bite the silhouette; half leave a dark scar texel
  // inboard (chipped paint over dark metal). The first two chips
  // on a low rarity are DOUBLE bites — damage you can see across
  // the ladder, not just count in a budget table.
  const edge = boundaryCells(ctx, groundTop);
  for (let i = 0; i < budget.chips && edge.length > 0; i++) {
    const [x, y] = edge[c.pick(edge.length)];
    g.set(x, y, '.');
    if (i < 2 && (rarity === Rarity.Common || rarity === Rarity.Uncommon)) {
      if (g.filled(x + 1, y) && x + 1 < ctx.c.plate.width) g.set(x + 1, y, '.');
    }
    if (c.pick(2)) {
      const inb: Pt[] = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      const [ix, iy] = inb[c.pick(4)];
      if (g.filled(ix, iy)) g.set(ix, iy, 'k');
    }
  }

  // Scratch runs — short bright/dark scores across filled body.
  for (let i = 0; i < budget.scratches; i++) {
    const x = X(ctx, 0.16 + c.next() * 0.64);
    const y = Y(ctx, 0.14 + c.next() * 0.62);
    const len = 2 + c.pick(4);
    const shade: GearShade = c.pick(3) === 0 ? 'T' : 'k';
    for (let s = 0; s < len; s++) if (g.filled(x + s, y)) g.set(x + s, y, shade);
  }

  // Grime — bottom-weighted: the lower body darkens unevenly,
  // dust settles on the form's lowest texels.
  for (let y = Y(ctx, 0.58); y < groundTop; y++) {
    for (let x = 0; x < g.width; x++) {
      if (!g.filled(x, y)) continue;
      const depth = (y - Y(ctx, 0.58)) / Math.max(1, groundTop - Y(ctx, 0.58));
      if (c.next() < budget.grime * depth * 0.40) {
        const cur = g.get(x, y) as GearShade;
        const darker = DARKEN[cur];
        if (darker) g.set(x, y, darker);
      }
    }
  }

  // Patina blotches — seeded clusters one tone off.
  for (let i = 0; i < budget.patina; i++) {
    let x = X(ctx, 0.2 + c.next() * 0.6);
    let y = Y(ctx, 0.2 + c.next() * 0.55);
    const n = 2 + c.pick(4);
    for (let s = 0; s < n; s++) {
      if (g.filled(x, y)) {
        const cur = g.get(x, y) as GearShade;
        const darker = DARKEN[cur];
        if (darker) g.set(x, y, darker);
      }
      x += c.pick(3) - 1; y += c.pick(3) - 1;
    }
  }
}

/** A crack with optional repair staples (detail; stone/crystal rows). */
function crack(ctx: RelicCtx, x0f: number, y0f: number, x1f: number, y1f: number, staples = 0) {
  const c = ctx.c;
  if (c.detailLevel < 1) return;
  const g = c.plate;
  const steps = 14;
  let px = 0; let py = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(X(ctx, x0f) + (X(ctx, x1f) - X(ctx, x0f)) * t) + (i % 3 === 1 ? 1 : 0);
    const y = Math.round(Y(ctx, y0f) + (Y(ctx, y1f) - Y(ctx, y0f)) * t);
    if (g.filled(x, y)) g.set(x, y, 'K');
    if (i === Math.floor(steps / 2)) { px = x; py = y; }
    if (staples > 0 && i === Math.floor(steps * 0.3)) {
      if (g.filled(x, y - 1)) g.set(x, y - 1, 'T');
      if (g.filled(x, y + 1)) g.set(x, y + 1, 'T');
    }
    if (staples > 1 && i === Math.floor(steps * 0.75)) {
      if (g.filled(px, py - 1)) g.set(px, py - 1, 'T');
      if (g.filled(px, py + 1)) g.set(px, py + 1, 'T');
    }
  }
}

/* ------------------------------------------------------------------ */
/* DROPPED — the rubble ground (treatment = a marker in the dirt)      */
/* ------------------------------------------------------------------ */

export type RelicTreatmentId = 'world' | 'boss' | 'cache' | 'event' | 'crafted' | 'market';

/** Where a relic came from chooses only what marks its dirt. */
export const RELIC_TREATMENTS: Readonly<Record<string, RelicTreatmentId>> = {
  [DropSource.WorldDrop]: 'world',
  [DropSource.BossDrop]: 'boss',
  [DropSource.CacheForged]: 'cache',
  [DropSource.Event]: 'event',
  [DropSource.Crafted]: 'crafted',
  [DropSource.Marketplace]: 'market',
};

function ground(ctx: RelicCtx, treatment: RelicTreatmentId) {
  const c = ctx.c;
  const base = Y(ctx, 0.955);

  // Contact shadow — short, directly under the object's footprint.
  const shX0 = X(ctx, 0.30); const shX1 = X(ctx, 0.70);
  for (let x = shX0; x < shX1; x++) {
    if (c.pick(6) === 0) continue; // broken shadow, not a printed bar
    c.set(x, Y(ctx, 0.855), 'K');
    if (c.pick(4)) c.set(x, Y(ctx, 0.868), 'K');
  }

  // Rubble — a CLUSTER under the footprint, not a full-width rule
  // (a uniform strip read as a designed dotted line; the weapons
  // float on dark, and the dirt should look incidental, like the
  // thing was dropped and left). Uneven baseline, mostly deep
  // tones, a rare mid-tone lift.
  let x = X(ctx, 0.27 + c.next() * 0.03);
  const end = X(ctx, 0.73);
  while (x < end) {
    const wdt = 3 + c.pick(8);
    const hgt = 1 + c.pick(3);
    const lift = c.pick(2);
    const roll = c.pick(8);
    const shade: GearShade = roll === 0 ? 'P' : roll < 4 ? 'D' : roll < 7 ? 'd' : 'k';
    for (let dy = 0; dy < hgt; dy++) c.rect(x, base - lift - dy, wdt, 1, shade);
    if (c.pick(3) === 0) c.set(x + c.pick(Math.max(1, wdt)), base - lift - hgt, 'k');
    x += wdt + 1 + c.pick(3);
  }
  // Three lone strays outside the cluster; one glint.
  for (let i = 0; i < 3; i++) {
    c.set(X(ctx, 0.06 + c.next() * 0.88), Y(ctx, 0.905 + c.next() * 0.04), c.pick(3) ? 'k' : 'D');
  }
  c.set(X(ctx, 0.14 + c.next() * 0.7), Y(ctx, 0.91), 'T');

  // The treatment marker — small, in the dirt, never a stand.
  switch (treatment) {
    case 'boss': {
      // Two horn-spikes of the thing it was torn from, left side.
      const bx = X(ctx, 0.085);
      for (let i = 0; i < 4; i++) c.rect(bx + (i > 1 ? 1 : 0), base - i, 2, 1, 'D');
      for (let i = 0; i < 3; i++) c.rect(bx + 7, base - i, 2, 1, 'd');
      break;
    }
    case 'cache': {
      // Cradle stubs — the forge's brackets, half-buried.
      c.rect(X(ctx, 0.30), Y(ctx, 0.885), Math.round(ctx.w * 0.025), base - Y(ctx, 0.885), 'k');
      c.rect(X(ctx, 0.685), Y(ctx, 0.885), Math.round(ctx.w * 0.025), base - Y(ctx, 0.885), 'k');
      break;
    }
    case 'event': {
      // A banner stub planted in the rubble, right side.
      const bx = X(ctx, 0.885);
      c.rect(bx, Y(ctx, 0.845), 2, base - Y(ctx, 0.845), 'd');
      c.rect(bx + 2, Y(ctx, 0.845), Math.round(ctx.w * 0.03), Math.round(ctx.h * 0.035), 'F');
      break;
    }
    case 'crafted': {
      // The workbench edge — one straight plank line under the mess.
      c.rect(X(ctx, 0.10), base + 1, X(ctx, 0.90) - X(ctx, 0.10), 1, 'd');
      if (c.detailLevel > 0) { c.rivet(X(ctx, 0.13), base + 1); c.rivet(X(ctx, 0.85), base + 1); }
      break;
    }
    case 'market': {
      // The price tag — it reads instantly.
      c.rect(X(ctx, 0.775), Y(ctx, 0.915), Math.round(ctx.w * 0.045), Math.round(ctx.h * 0.05), 'E');
      c.set(X(ctx, 0.795), Y(ctx, 0.935), 'K');
      break;
    }
    case 'world':
    default:
      break; // plain dirt — the world leaves things where they fall
  }
}

/* ------------------------------------------------------------------ */
/* The twelve name-form rows                                           */
/* ------------------------------------------------------------------ */

export interface RelicFormRow {
  /** The exact generator name this row answers to. */
  name: string;
  formId: string;
  baseColor: string;
  paint: (ctx: RelicCtx) => void;
}

export const RELIC_FORM_ROWS: RelicFormRow[] = [
  {
    name: 'Vault Chip',
    formId: 'vault-chip',
    baseColor: '#C9932B',
    paint(ctx) {
      const c = ctx.c;
      // One clamp prong (left); the right one's mount is a solder
      // blob and a seam — it was torn off before you found it.
      c.rect(X(ctx, 0.28), Y(ctx, 0.13), X(ctx, 0.385) - X(ctx, 0.28), Y(ctx, 0.205) - Y(ctx, 0.13), 'D');
      c.rect(X(ctx, 0.28), Y(ctx, 0.13), X(ctx, 0.385) - X(ctx, 0.28), 1, 'p');
      solder(ctx, 0.665, 0.165);
      c.seam(X(ctx, 0.60), Y(ctx, 0.15), X(ctx, 0.72), Y(ctx, 0.15));
      // Casing, panel-shaded.
      casing(ctx, 0.125, 0.20, 0.875, 0.72, 0.045);
      // Die window — shifted LEFT in the casing; core seated in it.
      c.rect(X(ctx, 0.225), Y(ctx, 0.325), X(ctx, 0.575) - X(ctx, 0.225), Y(ctx, 0.60) - Y(ctx, 0.325), 'D');
      c.rect(X(ctx, 0.25), Y(ctx, 0.355), X(ctx, 0.55) - X(ctx, 0.25), Y(ctx, 0.57) - Y(ctx, 0.355), 'd');
      socketCore(ctx, 0.40, 0.462, 0.080);
      // Right flank: stencil data-plate where v1 etched twin runes.
      stencil(ctx, 0.655, 0.36);
      // Left flank keeps a single trace run, cut short.
      c.stripe(X(ctx, 0.155), Y(ctx, 0.40), Math.round(ctx.w * 0.045), 'c');
      // Contact pins — five, the fourth bent short with a dark tip.
      for (let i = 0; i < 5; i++) {
        const px = X(ctx, 0.20 + i * 0.115);
        const len = i === 3 ? Y(ctx, 0.765) : Y(ctx, 0.795);
        c.rect(px, Y(ctx, 0.72), Math.max(2, Math.round(ctx.w * 0.045)), len - Y(ctx, 0.72), i % 2 ? 'd' : 'D');
        if (i === 3) c.set(px + 1, len, 'k');
      }
    },
  },
  {
    name: 'Data Shard',
    formId: 'data-shard',
    baseColor: '#25B2C9',
    paint(ctx) {
      const c = ctx.c;
      // The shard, leaning — apex off-axis, base planted lower.
      const pts: Pt[] = [
        [X(ctx, 0.465), Y(ctx, 0.055)], [X(ctx, 0.625), Y(ctx, 0.30)], [X(ctx, 0.585), Y(ctx, 0.47)],
        [X(ctx, 0.655), Y(ctx, 0.815)], [X(ctx, 0.565), Y(ctx, 0.86)], [X(ctx, 0.415), Y(ctx, 0.86)],
        [X(ctx, 0.325), Y(ctx, 0.80)], [X(ctx, 0.385), Y(ctx, 0.47)], [X(ctx, 0.345), Y(ctx, 0.30)],
      ];
      c.poly(pts, 'P');
      // Facet masses with stepped seams — no smooth bands.
      c.poly([[X(ctx, 0.465), Y(ctx, 0.055)], [X(ctx, 0.345), Y(ctx, 0.30)], [X(ctx, 0.385), Y(ctx, 0.47)], [X(ctx, 0.46), Y(ctx, 0.40)]], 'p');
      c.poly([[X(ctx, 0.585), Y(ctx, 0.47)], [X(ctx, 0.655), Y(ctx, 0.815)], [X(ctx, 0.565), Y(ctx, 0.86)], [X(ctx, 0.50), Y(ctx, 0.55)]], 'd');
      c.seam(X(ctx, 0.465), Y(ctx, 0.11), X(ctx, 0.44), Y(ctx, 0.80));
      c.seam(X(ctx, 0.375), Y(ctx, 0.44), X(ctx, 0.615), Y(ctx, 0.455));
      // The core is an INCLUSION: a jagged lit fault inside the
      // crystal — a dark groove with the glow seated in it, heart
      // where the fault kinks — not a set gem.
      c.slope(X(ctx, 0.385), Y(ctx, 0.565), X(ctx, 0.455), Y(ctx, 0.48), 'c', true);
      c.slope(X(ctx, 0.455), Y(ctx, 0.48), X(ctx, 0.475), Y(ctx, 0.405), 'c', true);
      c.slope(X(ctx, 0.385), Y(ctx, 0.555), X(ctx, 0.455), Y(ctx, 0.47), 'L', true);
      c.slope(X(ctx, 0.455), Y(ctx, 0.47), X(ctx, 0.475), Y(ctx, 0.395), 'L', true);
      c.disc(X(ctx, 0.462), Y(ctx, 0.462), R(ctx, 0.034), 'E');
      c.set(X(ctx, 0.462), Y(ctx, 0.462), 'W');
      c.set(X(ctx, 0.462), Y(ctx, 0.452), 'W');
      // A crack running out of the fault toward the top edge.
      crack(ctx, 0.455, 0.44, 0.475, 0.17, 0);
      // Satellites, unbalanced: one real companion, one chip.
      const sat = (cxF: number, cyF: number, sF: number, shade: GearShade) => {
        const cxp = X(ctx, cxF); const tipp = Y(ctx, cyF - sF); const botp = Y(ctx, cyF + sF);
        c.poly([[cxp, tipp], [X(ctx, cxF + sF * 0.55), Y(ctx, cyF)], [cxp, botp], [X(ctx, cxF - sF * 0.55), Y(ctx, cyF)]], shade);
        c.set(cxp, Y(ctx, cyF), 'e');
      };
      sat(0.185, 0.60, 0.105, 'P');
      sat(0.795, 0.76, 0.05, 'd');
    },
  },
  {
    name: 'Neural Key',
    formId: 'neural-key',
    baseColor: '#7B5CD6',
    paint(ctx) {
      const c = ctx.c;
      const cy = Y(ctx, 0.47);
      // The bow.
      c.ring(X(ctx, 0.225), cy, R(ctx, 0.062), R(ctx, 0.128), 'P');
      c.slope(X(ctx, 0.165), Y(ctx, 0.375), X(ctx, 0.225), Y(ctx, 0.345), 'p', true);
      // Collar, with a wrapped-wire segment (made, not minted).
      c.rect(X(ctx, 0.305), Y(ctx, 0.40), X(ctx, 0.355) - X(ctx, 0.305), Y(ctx, 0.54) - Y(ctx, 0.40), 'D');
      if (c.detailLevel > 0) {
        for (let i = 0; i < 4; i++) c.set(X(ctx, 0.312) + i * 3, Y(ctx, 0.415) + i, i % 2 ? 'p' : 'd');
      }
      // The shaft, lit along its top edge.
      c.rect(X(ctx, 0.345), Y(ctx, 0.435), X(ctx, 0.855) - X(ctx, 0.345), Y(ctx, 0.505) - Y(ctx, 0.435), 'P');
      c.rect(X(ctx, 0.345), Y(ctx, 0.435), X(ctx, 0.855) - X(ctx, 0.345), Math.max(1, Math.round(ctx.h * 0.02)), 'p');
      // Teeth — three, uneven: this key was cut by hand.
      c.rect(X(ctx, 0.645), Y(ctx, 0.505), Math.round(ctx.w * 0.032), Y(ctx, 0.615) - Y(ctx, 0.505), 'P');
      c.rect(X(ctx, 0.735), Y(ctx, 0.505), Math.round(ctx.w * 0.032), Y(ctx, 0.665) - Y(ctx, 0.505), 'P');
      c.rect(X(ctx, 0.735), Y(ctx, 0.64), Math.round(ctx.w * 0.032), Y(ctx, 0.665) - Y(ctx, 0.64), 'D');
      c.rect(X(ctx, 0.825), Y(ctx, 0.505), Math.round(ctx.w * 0.032), Y(ctx, 0.715) - Y(ctx, 0.505), 'P');
      c.rect(X(ctx, 0.825), Y(ctx, 0.69), Math.round(ctx.w * 0.032), Y(ctx, 0.715) - Y(ctx, 0.69), 'D');
      c.rect(X(ctx, 0.855), Y(ctx, 0.42), Math.round(ctx.w * 0.02), Y(ctx, 0.52) - Y(ctx, 0.42), 'D');
      // Neural nodes: two lit — and one DEAD (dark seat, no heart).
      for (const f of [0.44, 0.65]) {
        const nx = X(ctx, f);
        c.disc(nx, cy, R(ctx, 0.03), 'E');
        c.set(nx, cy, 'W');
      }
      c.disc(X(ctx, 0.545), cy, R(ctx, 0.03), 'k');
      c.set(X(ctx, 0.545), cy, 'K');
      c.stripe(X(ctx, 0.38), Y(ctx, 0.545), Math.round(ctx.w * 0.30), 'c');
    },
  },
  {
    name: 'Cache Relic',
    formId: 'cache-relic',
    baseColor: '#D06018',
    paint(ctx) {
      const c = ctx.c;
      // The domed lid — steps uneven, wider on the left.
      c.rect(X(ctx, 0.255), Y(ctx, 0.155), X(ctx, 0.735) - X(ctx, 0.255), Y(ctx, 0.225) - Y(ctx, 0.155), 'p');
      c.rect(X(ctx, 0.205), Y(ctx, 0.225), X(ctx, 0.775) - X(ctx, 0.205), Y(ctx, 0.295) - Y(ctx, 0.225), 'p');
      c.rect(X(ctx, 0.16), Y(ctx, 0.295), X(ctx, 0.825) - X(ctx, 0.16), Y(ctx, 0.36) - Y(ctx, 0.295), 'P');
      // The casket body.
      casing(ctx, 0.145, 0.36, 0.855, 0.80, 0.04);
      c.rect(X(ctx, 0.145), Y(ctx, 0.36), X(ctx, 0.855) - X(ctx, 0.145), Y(ctx, 0.415) - Y(ctx, 0.36), 'D');
      // The lock clasp — right of center, core seated inside it.
      c.rect(X(ctx, 0.505), Y(ctx, 0.33), X(ctx, 0.615) - X(ctx, 0.505), Y(ctx, 0.60) - Y(ctx, 0.33), 'D');
      socketCore(ctx, 0.56, 0.465, 0.082);
      // ONE corner bracket (left). The right corner took a hit:
      // a dent cluster instead of hardware.
      const bx = X(ctx, 0.16);
      c.rect(bx, Y(ctx, 0.44), Math.round(ctx.w * 0.03), Y(ctx, 0.60) - Y(ctx, 0.44), 'K');
      c.rect(bx, Y(ctx, 0.66), Math.round(ctx.w * 0.03), Y(ctx, 0.775) - Y(ctx, 0.66), 'K');
      c.rivet(bx + 1, Y(ctx, 0.45));
      if (c.detailLevel > 0) {
        const dx = X(ctx, 0.80); const dy = Y(ctx, 0.55);
        c.set(dx, dy, 'D'); c.set(dx + 1, dy, 'D'); c.set(dx, dy + 1, 'D'); c.set(dx + 2, dy + 1, 'k'); c.set(dx + 1, dy + 2, 'D');
      }
      // Etched runes on the left flank only.
      c.stripe(X(ctx, 0.205), Y(ctx, 0.52), Math.round(ctx.w * 0.10), 'c');
    },
  },
  {
    name: 'Echo Stone',
    formId: 'echo-stone',
    baseColor: '#35A06B',
    paint(ctx) {
      const c = ctx.c;
      // RE-FORMED (adoption pass): the stone is a river-worn lump,
      // not a cut octagon — apex knocked off-axis, a bulge on the
      // right, a flattened seat at the bottom-right where it lay
      // in the dirt, and a true BITE out of the left edge: one
      // vertex turns inward, so the silhouette is concave there
      // and the outer echo ring breaks against the notch for free.
      const pts: Pt[] = [
        [X(ctx, 0.47), Y(ctx, 0.065)], [X(ctx, 0.64), Y(ctx, 0.11)], [X(ctx, 0.775), Y(ctx, 0.26)],
        [X(ctx, 0.82), Y(ctx, 0.47)], [X(ctx, 0.745), Y(ctx, 0.70)], [X(ctx, 0.60), Y(ctx, 0.815)],
        [X(ctx, 0.44), Y(ctx, 0.83)], [X(ctx, 0.315), Y(ctx, 0.76)], [X(ctx, 0.235), Y(ctx, 0.60)],
        [X(ctx, 0.295), Y(ctx, 0.545)], [X(ctx, 0.225), Y(ctx, 0.44)], [X(ctx, 0.26), Y(ctx, 0.24)],
        [X(ctx, 0.36), Y(ctx, 0.115)],
      ];
      c.poly(pts, 'P');
      brokenTone(ctx, 0.205, 0.065, 0.82, 0.83);
      // A flake that came off it, lying at the lower-left — the
      // stone's own chip, in the form's vocabulary.
      c.poly([
        [X(ctx, 0.175), Y(ctx, 0.665)], [X(ctx, 0.20), Y(ctx, 0.72)],
        [X(ctx, 0.165), Y(ctx, 0.765)], [X(ctx, 0.13), Y(ctx, 0.745)], [X(ctx, 0.135), Y(ctx, 0.70)],
      ], 'd');
      c.set(X(ctx, 0.165), Y(ctx, 0.715), 'P');
      // Echo rings from an off-center heart — echoes are round
      // even when the stone isn't; the contrast is the read. The
      // outer ring is BROKEN in two arcs: a wide gap low-left
      // (repainted in stone tone), a shorter one high-right.
      const cx = X(ctx, 0.475); const cy = Y(ctx, 0.45);
      c.ring(cx, cy, R(ctx, 0.235), R(ctx, 0.255), 'c', true);
      c.ring(cx, cy, R(ctx, 0.155), R(ctx, 0.178), 'e', true);
      const breakArc = (a0: number, a1: number, steps: number) => {
        const rr = R(ctx, 0.245);
        for (let a = 0; a <= steps; a++) {
          const ang = a0 + (a1 - a0) * (a / steps);
          const gx = cx + Math.round(Math.cos(ang) * rr);
          const gy = cy + Math.round(Math.sin(ang) * rr * 0.87);
          if (c.plate.filled(gx, gy)) c.plate.set(gx, gy, 'd');
        }
      };
      breakArc(Math.PI * 0.58, Math.PI * 0.88, 22);
      breakArc(Math.PI * -0.38, Math.PI * -0.16, 10);
      socketCore(ctx, 0.475, 0.45, 0.082);
      // The repaired crack — it broke once; someone stapled it.
      crack(ctx, 0.66, 0.16, 0.52, 0.39, 2);
      // Two rune pips, uneven.
      c.stripe(X(ctx, 0.325), Y(ctx, 0.315), 2, 'e');
      c.stripe(X(ctx, 0.655), Y(ctx, 0.615), 2, 'e');
    },
  },
  {
    name: 'Void Prism',
    formId: 'void-prism',
    baseColor: '#9B4DFF',
    paint(ctx) {
      const c = ctx.c;
      // RE-FORMED (adoption pass): the prism grew LEANING — apex
      // knocked left, the right edge stepping IN mid-length where
      // the crystal hit something and kept growing (a growth
      // step, jogged back out below it), the base corners at
      // uneven heights and the tip off-axis. Facet split follows
      // the lean: wide lit face, narrow bright spine, dark right.
      const cxL = X(ctx, 0.43); const cxR = X(ctx, 0.515); const yBot = Y(ctx, 0.72);
      const pts: Pt[] = [
        [X(ctx, 0.44), Y(ctx, 0.04)], [X(ctx, 0.635), Y(ctx, 0.22)], [X(ctx, 0.645), Y(ctx, 0.44)],
        [X(ctx, 0.575), Y(ctx, 0.505)], [X(ctx, 0.595), Y(ctx, 0.57)], [X(ctx, 0.575), Y(ctx, 0.70)],
        [X(ctx, 0.465), Y(ctx, 0.865)], [X(ctx, 0.345), Y(ctx, 0.66)], [X(ctx, 0.325), Y(ctx, 0.40)],
        [X(ctx, 0.335), Y(ctx, 0.21)],
      ];
      c.poly(pts, (x, y) => (y > yBot ? 'D' : x < cxL ? 'p' : x > cxR ? 'd' : 'P'));
      // The spine seam follows the lean; a facet seam runs out of
      // the growth step.
      c.seam(X(ctx, 0.44), Y(ctx, 0.09), X(ctx, 0.455), Y(ctx, 0.80));
      c.seam(X(ctx, 0.575), Y(ctx, 0.505), X(ctx, 0.515), Y(ctx, 0.64));
      // The void heart, seated high and off-axis.
      socketCore(ctx, 0.455, 0.40, 0.082);
      // A crack splitting off the step's inner corner.
      crack(ctx, 0.565, 0.52, 0.51, 0.635, 0);
      // Levitating shards — two left (big + small), and on the
      // right not a shard but a broken FLAKE: a triangle of the
      // prism's own face, snapped off at the step's height.
      const shard = (cxF: number, cyF: number, sF: number, shade: GearShade) => {
        const cxp = X(ctx, cxF);
        c.poly([
          [cxp, Y(ctx, cyF - sF)], [X(ctx, cxF + sF * 0.5), Y(ctx, cyF)],
          [cxp, Y(ctx, cyF + sF)], [X(ctx, cxF - sF * 0.5), Y(ctx, cyF)],
        ], shade);
        c.set(cxp, Y(ctx, cyF), 'e');
      };
      shard(0.185, 0.40, 0.145, 'P');
      shard(0.225, 0.71, 0.08, 'P');
      c.poly([
        [X(ctx, 0.815), Y(ctx, 0.20)], [X(ctx, 0.86), Y(ctx, 0.325)], [X(ctx, 0.77), Y(ctx, 0.335)],
      ], 'd');
      c.set(X(ctx, 0.815), Y(ctx, 0.28), 'e');
    },
  },
  {
    name: 'Circuit Totem',
    formId: 'circuit-totem',
    baseColor: '#3E9B4F',
    paint(ctx) {
      const c = ctx.c;
      // Antennae — left tall, right bent short (tip knocked over).
      c.rect(X(ctx, 0.415), Y(ctx, 0.075), Math.max(1, Math.round(ctx.w * 0.014)), Y(ctx, 0.20) - Y(ctx, 0.075), 'D');
      c.disc(X(ctx, 0.415) + 1, Y(ctx, 0.065), R(ctx, 0.02), 'e');
      c.rect(X(ctx, 0.575), Y(ctx, 0.115), Math.max(1, Math.round(ctx.w * 0.014)), Y(ctx, 0.20) - Y(ctx, 0.115), 'D');
      c.disc(X(ctx, 0.575) + 3, Y(ctx, 0.105), R(ctx, 0.018), 'e');
      // Three stacked segments — each tier offset a touch, the
      // way things actually stack by hand.
      panelRect(ctx, 0.365, 0.20, 0.615, 0.40);
      socketCore(ctx, 0.49, 0.30, 0.088);
      solder(ctx, 0.615, 0.375);
      c.rect(X(ctx, 0.325), Y(ctx, 0.40), X(ctx, 0.695) - X(ctx, 0.325), Y(ctx, 0.615) - Y(ctx, 0.40), 'd');
      c.rect(X(ctx, 0.325), Y(ctx, 0.40), X(ctx, 0.695) - X(ctx, 0.325), Math.max(1, Math.round(ctx.h * 0.025)), 'P');
      // Arms — the left one longer.
      c.rect(X(ctx, 0.265), Y(ctx, 0.44), X(ctx, 0.325) - X(ctx, 0.265), Y(ctx, 0.575) - Y(ctx, 0.44), 'D');
      c.rect(X(ctx, 0.695), Y(ctx, 0.44), X(ctx, 0.73) - X(ctx, 0.695), Y(ctx, 0.545) - Y(ctx, 0.44), 'D');
      // The face: two lit eyes, one a texel lower than the other.
      c.disc(X(ctx, 0.435), Y(ctx, 0.49), R(ctx, 0.032), 'e');
      c.set(X(ctx, 0.435), Y(ctx, 0.49), 'W');
      c.disc(X(ctx, 0.575), Y(ctx, 0.50), R(ctx, 0.032), 'e');
      c.set(X(ctx, 0.575), Y(ctx, 0.50), 'W');
      solder(ctx, 0.33, 0.60);
      // Bottom segment — darkest, traces on the left half only.
      c.rect(X(ctx, 0.255), Y(ctx, 0.615), X(ctx, 0.745) - X(ctx, 0.255), Y(ctx, 0.85) - Y(ctx, 0.615), 'D');
      c.rect(X(ctx, 0.255), Y(ctx, 0.615), X(ctx, 0.745) - X(ctx, 0.255), Math.max(1, Math.round(ctx.h * 0.03)), 'd');
      const t = c.pick(3);
      c.stripe(X(ctx, 0.295), Y(ctx, 0.70) + t, Math.round(ctx.w * 0.17), 'c');
      c.stripe(X(ctx, 0.295), Y(ctx, 0.775) + t, Math.round(ctx.w * 0.13), 'c');
      c.seam(X(ctx, 0.52), Y(ctx, 0.63), X(ctx, 0.515), Y(ctx, 0.70) + t);
    },
  },
  {
    name: 'Ancient Module',
    formId: 'ancient-module',
    baseColor: '#A67C33',
    paint(ctx) {
      const c = ctx.c;
      casing(ctx, 0.13, 0.235, 0.87, 0.79, 0.04);
      c.vents(X(ctx, 0.20), Y(ctx, 0.325), 5);
      c.vents(X(ctx, 0.66), Y(ctx, 0.325), 4);
      // Card slots: the first is EMPTY (dark), the second still
      // holds its card — pale edge proud of the slot.
      c.rect(X(ctx, 0.185), Y(ctx, 0.40), Math.round(ctx.w * 0.032), Y(ctx, 0.68) - Y(ctx, 0.40), 'K');
      c.rect(X(ctx, 0.245), Y(ctx, 0.40), Math.round(ctx.w * 0.032), Y(ctx, 0.68) - Y(ctx, 0.40), 'K');
      c.rect(X(ctx, 0.245), Y(ctx, 0.375), Math.round(ctx.w * 0.032), Y(ctx, 0.44) - Y(ctx, 0.375), 'p');
      c.set(X(ctx, 0.245) + 1, Y(ctx, 0.385), 'L');
      // ONE side handle (right). The left mount is a bare seam.
      c.rect(X(ctx, 0.83), Y(ctx, 0.42), X(ctx, 0.85) - X(ctx, 0.83), Y(ctx, 0.67) - Y(ctx, 0.42), 'D');
      c.seam(X(ctx, 0.155), Y(ctx, 0.44), X(ctx, 0.155), Y(ctx, 0.65));
      solder(ctx, 0.155, 0.44);
      // The great dial, seated left of center.
      const dx = X(ctx, 0.44); const dy = Y(ctx, 0.55);
      c.disc(dx, dy, R(ctx, 0.125), 'D');
      c.disc(dx, dy, R(ctx, 0.115), 'c');
      c.disc(dx, dy, R(ctx, 0.082), 'E');
      c.disc(dx, dy, R(ctx, 0.045), 'e');
      c.slope(dx, dy, dx + R(ctx, 0.06), dy - R(ctx, 0.06), 'W', true);
      c.set(dx, dy, 'W');
      // A rune column right of the dial — two etches, third faded.
      const t = c.pick(3);
      c.stripe(X(ctx, 0.645), Y(ctx, 0.45) + t, Math.round(ctx.w * 0.09), 'c');
      c.stripe(X(ctx, 0.645), Y(ctx, 0.625) + t, Math.round(ctx.w * 0.09), 'c');
      // Stencil data-plate, bottom right.
      stencil(ctx, 0.70, 0.665);
      // Etched band along the foot — broken into two runs.
      c.stripe(X(ctx, 0.185), Y(ctx, 0.725), Math.round(ctx.w * 0.30), 'c');
      c.stripe(X(ctx, 0.545), Y(ctx, 0.725), Math.round(ctx.w * 0.24), 'c');
    },
  },
  {
    name: 'Scrap Core',
    formId: 'scrap-core',
    baseColor: '#9C4A2F',
    paint(ctx) {
      const c = ctx.c;
      // Junk housing — honest asymmetric blocks around the core.
      c.rect(X(ctx, 0.35), Y(ctx, 0.155), X(ctx, 0.545) - X(ctx, 0.35), Y(ctx, 0.30) - Y(ctx, 0.155), 'd');
      c.rect(X(ctx, 0.35), Y(ctx, 0.275), X(ctx, 0.545) - X(ctx, 0.35), Y(ctx, 0.30) - Y(ctx, 0.275), 'D');
      c.rect(X(ctx, 0.275), Y(ctx, 0.30), X(ctx, 0.665) - X(ctx, 0.275), Y(ctx, 0.385) - Y(ctx, 0.30), 'P');
      c.rect(X(ctx, 0.275), Y(ctx, 0.385), X(ctx, 0.665) - X(ctx, 0.275), Y(ctx, 0.66) - Y(ctx, 0.385), 'd');
      c.rect(X(ctx, 0.275), Y(ctx, 0.66), X(ctx, 0.665) - X(ctx, 0.275), Y(ctx, 0.79) - Y(ctx, 0.66), 'D');
      c.rect(X(ctx, 0.665), Y(ctx, 0.47), X(ctx, 0.80) - X(ctx, 0.665), Y(ctx, 0.79) - Y(ctx, 0.47), 'P');
      c.rect(X(ctx, 0.215), Y(ctx, 0.62), X(ctx, 0.275) - X(ctx, 0.215), Y(ctx, 0.79) - Y(ctx, 0.62), 'D');
      // Exhaust pipe + flange, with DRIP STAINS running off it.
      c.thickLine(X(ctx, 0.73), Y(ctx, 0.47), X(ctx, 0.78), Y(ctx, 0.30), 1, 'D');
      c.rect(X(ctx, 0.755), Y(ctx, 0.255), X(ctx, 0.81) - X(ctx, 0.755), Y(ctx, 0.30) - Y(ctx, 0.255), 'd');
      if (c.detailLevel > 0) {
        c.set(X(ctx, 0.775), Y(ctx, 0.315), 'K'); c.set(X(ctx, 0.775), Y(ctx, 0.345), 'K');
        c.set(X(ctx, 0.79), Y(ctx, 0.315), 'k'); c.set(X(ctx, 0.79), Y(ctx, 0.33), 'k');
      }
      // The core — the biggest heart in the pool, in a rough socket.
      socketCore(ctx, 0.45, 0.545, 0.112);
      // Bolts — three fitted, one MISSING (bare hole).
      c.rivet(X(ctx, 0.295), Y(ctx, 0.315));
      c.rivet(X(ctx, 0.63), Y(ctx, 0.315));
      c.rivet(X(ctx, 0.295), Y(ctx, 0.75));
      c.set(X(ctx, 0.76), Y(ctx, 0.75), 'K');
      solder(ctx, 0.665, 0.50);
      c.seam(X(ctx, 0.56), Y(ctx, 0.40), X(ctx, 0.64), Y(ctx, 0.60));
      c.seam(X(ctx, 0.30), Y(ctx, 0.42), X(ctx, 0.345), Y(ctx, 0.60));
    },
  },
  {
    name: 'Glitched Token',
    formId: 'glitched-token',
    baseColor: '#C93BAA',
    paint(ctx) {
      const c = ctx.c;
      // RE-FORMED (adoption pass): the blank was never a perfect
      // disc — it is a STRUCK token: the radius breathes with the
      // strike (two low harmonics, fixed phase — the blank is the
      // same struck shape for every instance), one corner is
      // clipped flat along a chord (a sheared flan edge), and the
      // upper-right rim carries a bite. The struck rings paint
      // over filled cells only, so they break at the clip and the
      // bite on their own.
      const cx = X(ctx, 0.485); const cy = Y(ctx, 0.46); const r = R(ctx, 0.295);
      const jit: number[] = [];
      for (let i = 0; i < 32; i++) jit.push(c.pick(3) - 1);
      const reach = r + Math.ceil(r * 0.12) + 1;
      for (let y = cy - reach; y <= cy + reach; y++) {
        for (let x = cx - reach; x <= cx + reach; x++) {
          const dx = x - cx; const dy = y - cy;
          const dist = Math.hypot(dx, dy);
          const ang = Math.atan2(dy, dx);
          const rEff = r * (1 + 0.045 * Math.sin(3 * ang + 0.7) + 0.035 * Math.sin(6 * ang + 2.1));
          if (dist > rEff + 0.5) continue;
          // The rim bite, upper-right.
          if (ang > -1.0 && ang < -0.5 && dist > r * 0.84) continue;
          // The chord clip, lower-right: a flat sheared edge.
          if (dx > 0 && dy > 0 && dx + dy > r * 1.08) continue;
          const rel = (y - (cy - r)) / (2 * r) + jit[Math.abs(x) % jit.length] * 0.015;
          c.set(x, y, rel < 0.28 ? 'p' : rel < 0.64 ? 'P' : rel < 0.86 ? 'd' : 'D');
        }
      }
      // Rings struck into the face — the inner one broken.
      c.ring(cx, cy, R(ctx, 0.185), R(ctx, 0.20), 'c', true);
      c.ring(cx, cy, R(ctx, 0.115), R(ctx, 0.135), 'E', true);
      c.set(cx + R(ctx, 0.125), cy - R(ctx, 0.045), 'P');
      c.set(cx + R(ctx, 0.125) + 1, cy - R(ctx, 0.03), 'P');
      // The glyph notch.
      c.rect(X(ctx, 0.47), Y(ctx, 0.395), X(ctx, 0.50) - X(ctx, 0.47), Y(ctx, 0.525) - Y(ctx, 0.395), 'K');
      // THE GLITCH (the pool's one native tear): two horizontal
      // slices of the struck coin shear sideways by a few texels —
      // whole rows of the finished form, shifted, the way a
      // corrupted frame tears. (Silhouette layer: the tear is
      // part of the form, so the thumb tears too, at its scale.)
      const cells = c.plate.cells as unknown as string[][];
      const shear = (y0: number, y1: number, dx: number) => {
        for (let y = y0; y <= y1; y++) {
          const row = [...cells[y]];
          for (let x = 0; x < cells[y].length; x++) {
            cells[y][x] = row[x - dx] ?? '.';
          }
        }
      };
      const tear = Math.max(1, Math.round(ctx.w * 0.013));
      shear(cy - R(ctx, 0.10), cy - R(ctx, 0.035), tear);
      shear(cy + R(ctx, 0.045), cy + R(ctx, 0.115), -tear);
      // A bright tear highlight where the top slice broke (detail).
      c.stripe(cx + R(ctx, 0.10), cy - R(ctx, 0.115), Math.round(ctx.w * 0.06), 'W');
      // Stray blocks the glitch threw off — uneven.
      c.rect(X(ctx, 0.745), Y(ctx, 0.29), Math.round(ctx.w * 0.05), Math.round(ctx.h * 0.045), 'P');
      c.rect(X(ctx, 0.79), Y(ctx, 0.53), Math.round(ctx.w * 0.035), Math.round(ctx.h * 0.04), 'P');
      c.rect(X(ctx, 0.175), Y(ctx, 0.60), Math.round(ctx.w * 0.04), Math.round(ctx.h * 0.04), 'd');
    },
  },
  {
    name: 'Ethereal Drive',
    formId: 'ethereal-drive',
    baseColor: '#6FB3C9',
    paint(ctx) {
      const c = ctx.c;
      // The slab, sitting LOWER than v1's float.
      casing(ctx, 0.205, 0.30, 0.795, 0.70, 0.05);
      // A corner torn open — dark inside, one wire poking out.
      if (c.detailLevel > 0) {
        const kx = X(ctx, 0.765); const ky = Y(ctx, 0.315);
        c.set(kx, ky, 'K'); c.set(kx - 1, ky, 'k'); c.set(kx, ky + 1, 'k');
        c.slope(kx + 1, ky - 1, kx + 5, ky - 4, 'T', false);
      }
      // The window; the ghost-wave dies across it (e → c).
      c.rect(X(ctx, 0.305), Y(ctx, 0.385), X(ctx, 0.695) - X(ctx, 0.305), Y(ctx, 0.605) - Y(ctx, 0.385), 'c');
      c.slope(X(ctx, 0.325), Y(ctx, 0.53), X(ctx, 0.44), Y(ctx, 0.45), 'e', true);
      c.slope(X(ctx, 0.44), Y(ctx, 0.45), X(ctx, 0.55), Y(ctx, 0.53), 'e', true);
      c.slope(X(ctx, 0.55), Y(ctx, 0.53), X(ctx, 0.675), Y(ctx, 0.47), 'k', true);
      c.disc(X(ctx, 0.475), Y(ctx, 0.49), R(ctx, 0.018), 'W');
      // Hover glow — two segments with a dead gap between them.
      c.rect(X(ctx, 0.29), Y(ctx, 0.725), X(ctx, 0.475) - X(ctx, 0.29), Y(ctx, 0.75) - Y(ctx, 0.725), 'E');
      c.rect(X(ctx, 0.545), Y(ctx, 0.725), X(ctx, 0.705) - X(ctx, 0.545), Y(ctx, 0.75) - Y(ctx, 0.725), 'E');
      // Wisps — two low-left, one mid-right: nothing mirrors.
      c.disc(X(ctx, 0.285), Y(ctx, 0.815), R(ctx, 0.028), 'p');
      c.disc(X(ctx, 0.36), Y(ctx, 0.845), R(ctx, 0.018), 'p');
      c.disc(X(ctx, 0.715), Y(ctx, 0.80), R(ctx, 0.02), 'p');
      c.disc(X(ctx, 0.52), Y(ctx, 0.175), R(ctx, 0.02), 'p');
      // A lit accent down the left edge.
      if (c.detailLevel > 0) {
        for (let i = 0; i < 5; i++) c.set(X(ctx, 0.225), Y(ctx, 0.36) + i * 2, 'e');
      }
    },
  },
  {
    name: 'Quantum Fragment',
    formId: 'quantum-fragment',
    baseColor: '#4F6BD8',
    paint(ctx) {
      const c = ctx.c;
      // The main fragment, leaning left, planted into the ground.
      const pts: Pt[] = [
        [X(ctx, 0.47), Y(ctx, 0.125)], [X(ctx, 0.605), Y(ctx, 0.335)], [X(ctx, 0.57), Y(ctx, 0.865)],
        [X(ctx, 0.425), Y(ctx, 0.865)], [X(ctx, 0.38), Y(ctx, 0.55)], [X(ctx, 0.40), Y(ctx, 0.315)],
      ];
      c.poly(pts, 'P');
      c.poly([[X(ctx, 0.47), Y(ctx, 0.125)], [X(ctx, 0.40), Y(ctx, 0.315)], [X(ctx, 0.38), Y(ctx, 0.55)], [X(ctx, 0.455), Y(ctx, 0.42)]], 'p');
      c.poly([[X(ctx, 0.605), Y(ctx, 0.335)], [X(ctx, 0.57), Y(ctx, 0.865)], [X(ctx, 0.50), Y(ctx, 0.60)]], 'd');
      // One seam is a crack, stapled once.
      crack(ctx, 0.415, 0.45, 0.585, 0.425, 1);
      c.seam(X(ctx, 0.475), Y(ctx, 0.18), X(ctx, 0.455), Y(ctx, 0.79));
      socketCore(ctx, 0.487, 0.50, 0.088);
      // Orbiting fragments — two left, uneven; one right, tiny.
      const frag = (ptsF: [number, number][], shade: GearShade) => {
        c.poly(ptsF.map(([fx, fy]) => [X(ctx, fx), Y(ctx, fy)] as Pt), shade);
      };
      frag([[0.215, 0.22], [0.285, 0.35], [0.255, 0.52], [0.17, 0.43], [0.175, 0.29]], 'P');
      c.set(X(ctx, 0.225), Y(ctx, 0.37), 'e');
      frag([[0.245, 0.60], [0.29, 0.66], [0.27, 0.76], [0.215, 0.70]], 'd');
      frag([[0.765, 0.55], [0.805, 0.615], [0.785, 0.70], [0.735, 0.65]], 'd');
      c.set(X(ctx, 0.765), Y(ctx, 0.625), 'e');
    },
  },
];

export const RELIC_FORM_BY_NAME: ReadonlyMap<string, RelicFormRow> = new Map(
  RELIC_FORM_ROWS.map((row) => [row.name, row]),
);
const RELIC_FORM_BY_ID: ReadonlyMap<string, RelicFormRow> = new Map(
  RELIC_FORM_ROWS.map((row) => [row.formId, row]),
);

export function relicFormRowForName(name: string): RelicFormRow | undefined {
  return RELIC_FORM_BY_NAME.get(name);
}

/* ------------------------------------------------------------------ */
/* The grammar                                                         */
/* ------------------------------------------------------------------ */

/**
 * The record → compose input derivation for relics. Name chooses
 * the form row (and its colorway); sourceTag chooses only the base
 * treatment; the seed follows the core's default pattern
 * (hash of id|name) since relics carry no pixelSeed.
 */
export function relicInputFromItem(item: GearItem): GearComposeInput {
  const relic = item as Relic;
  const row = RELIC_FORM_BY_NAME.get(relic.name);
  if (!row) {
    throw new Error(
      `relicGrammar: no form row for relic name "${relic.name}" — the name pool `
      + '(RELIC_NAMES) and the grammar rows grow together, or not at all.',
    );
  }
  const treatment = RELIC_TREATMENTS[relic.sourceTag] ?? 'world';
  return {
    kind: 'relic',
    rarity: relic.rarity,
    element: null,
    seed: hashString(`${relic.id}|${relic.name}`),
    pips: relic.affixes?.length ?? 0,
    baseColor: row.baseColor,
    variant: `${row.formId}/${treatment}`,
  };
}

export const relicGrammar: GearGrammar = {
  id: 'relic-salvage-v2',
  kind: 'relic',
  plate: GEAR_CARD_PLATES.relic,
  inputFromItem: relicInputFromItem,
  paint(canvas, input) {
    const [formId, treatmentId] = (input.variant ?? '').split('/');
    const row = RELIC_FORM_BY_ID.get(formId) ?? RELIC_FORM_ROWS[0];
    const ctx = makeCtx(canvas);
    row.paint(ctx);
    ground(ctx, (treatmentId as RelicTreatmentId) || 'world');
    // The wear budget — form first, then a life lived on top of it.
    wearPass(ctx, input.rarity);
    // Affix pips ride the rubble front, where the plinths' faces
    // carried them before — the read survives the pedestal's death.
    // The core socket kit only overpaints FILLED cells, and the
    // dirt at the pip line is broken by design, so the grammar
    // first lays a rubble slab for the sockets to sit in: a flat
    // stone in the dirt, seeded and broken like the rest of the
    // ground. (Adoption fix: without the slab the sockets paint
    // over gaps and the affix read vanishes — verified against
    // the approved exploration cells, whose pip zone is empty.)
    const pips = Math.min(input.pips ?? 0, 5);
    if (pips > 0 && canvas.detailLevel > 0) {
      const pipX = ctx.cx - Math.floor((pips * 5 - 2) / 2);
      const pipY = Y(ctx, 0.895);
      for (let x = pipX - 3; x < pipX + pips * 5 + 2; x++) {
        for (let y = pipY - 1; y <= pipY + 3; y++) {
          if (canvas.filled(x, y)) continue;
          if (canvas.pick(7) === 0) continue; // broken edge
          canvas.set(x, y, canvas.pick(3) === 0 ? 'd' : 'D');
        }
      }
      // The seats themselves are never broken: every socket's 3×3
      // is guaranteed purchase, so the lit-core count always equals
      // the affix count, whatever the slab's breaks rolled.
      for (let i = 0; i < pips; i++) {
        for (let dx = 0; dx < 3; dx++) {
          for (let dy = 0; dy < 3; dy++) {
            if (!canvas.filled(pipX + i * 5 + dx, pipY + dy)) {
              canvas.set(pipX + i * 5 + dx, pipY + dy, 'D');
            }
          }
        }
      }
      canvas.pipRow(pipX, pipY, pips, pips);
    }
  },
};
