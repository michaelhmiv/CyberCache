import { DropSource } from '@/types/game';
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
 * engine (gearCardCompositor, slice 0).
 *
 * The marriage (audit §4.4): a relic's form is its NAME. Relic
 * names are a closed pool of twelve (RELIC_NAMES in the server
 * generator — every relic in existence was minted there), so each
 * name gets one silhouette row built from the shared parts
 * vocabulary the old SVG spec already decomposed relics into —
 * casing / crystal / prongs / base / ring / runes / stands —
 * re-authored AT the grid under the pixel density law (DESIGN.md
 * §8): a Vault Chip is a chip, a Neural Key is a key, a Void Prism
 * is a prism. What the old SVG keyed on — sourceTag, where the
 * relic came from — demotes to a BASE TREATMENT: the plinth the
 * object rests on (boss totem foot, cache-forge cradle, event
 * display stand…), never the form.
 *
 * Relics are element-less, so the colorway decision is per-name:
 * each row carries one saturated baseColor and the core builds its
 * five-tone ramp from it — the name's crystal/core reads in the
 * ramp's light tones against casing painted in its dark tones,
 * the same whole-body-colorway move the married weapons and the
 * owner-approved shield plates make. Rarity stays the core's
 * frame finish; affixes ride the core pip row on the plinth;
 * per-instance seed drives rune etches, satellite jitter, and
 * texel-scale wear — never the form itself.
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

/** Vertical five-tone banding for a region between two y fractions. */
function banded(ctx: RelicCtx, topF: number, botF: number): (x: number, y: number) => GearShade {
  const top = Y(ctx, topF);
  const span = Math.max(1, Y(ctx, botF) - top);
  return (_x, y) => {
    const rel = (y - top) / span;
    return rel < 0.3 ? 'p' : rel < 0.66 ? 'P' : rel < 0.88 ? 'd' : 'D';
  };
}

/** Chamfered box (the casing part) with banded ramp fill. */
function casing(ctx: RelicCtx, x0f: number, y0f: number, x1f: number, y1f: number, chamF = 0.035) {
  const x0 = X(ctx, x0f); const x1 = X(ctx, x1f);
  const y0 = Y(ctx, y0f); const y1 = Y(ctx, y1f);
  const ch = Math.max(1, Math.round(chamF * ctx.w));
  const pts: Pt[] = [
    [x0 + ch, y0], [x1 - ch, y0], [x1, y0 + ch], [x1, y1 - ch],
    [x1 - ch, y1], [x0 + ch, y1], [x0, y1 - ch], [x0, y0 + ch],
  ];
  ctx.c.poly(pts, banded(ctx, y0f, y1f));
}

/**
 * The crystal part: a stepped core — deep seat, body, light, white
 * heart. Keep rf ≥ ~0.085: below that the step layers collapse
 * onto the same texels at thumb scale and the core loses its body
 * tone (the thumb pins in relicGrammar.test enforce it).
 */
function steppedCore(ctx: RelicCtx, cxf: number, cyf: number, rf: number) {
  const cx = X(ctx, cxf); const cy = Y(ctx, cyf); const r = R(ctx, rf);
  ctx.c.disc(cx, cy, r, 'c');
  ctx.c.disc(cx, cy, Math.max(1, Math.round(r * 0.66)), 'E');
  ctx.c.disc(cx, cy, Math.max(1, Math.round(r * 0.4)), 'e');
  ctx.c.disc(cx, cy, Math.max(1, Math.round(r * 0.2)), 'W');
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
      // Prongs — the twin clamp arms over the casing.
      c.rect(X(ctx, 0.30), Y(ctx, 0.13), X(ctx, 0.40) - X(ctx, 0.30), Y(ctx, 0.205) - Y(ctx, 0.13), 'D');
      c.rect(X(ctx, 0.60), Y(ctx, 0.13), X(ctx, 0.70) - X(ctx, 0.60), Y(ctx, 0.205) - Y(ctx, 0.13), 'D');
      c.rect(X(ctx, 0.30), Y(ctx, 0.13), X(ctx, 0.40) - X(ctx, 0.30), 1, 'p');
      c.rect(X(ctx, 0.60), Y(ctx, 0.13), X(ctx, 0.70) - X(ctx, 0.60), 1, 'p');
      // Casing — a wide, low vault chip.
      casing(ctx, 0.135, 0.20, 0.865, 0.72, 0.045);
      // The die window and its core.
      c.rect(X(ctx, 0.335), Y(ctx, 0.33), X(ctx, 0.665) - X(ctx, 0.335), Y(ctx, 0.60) - Y(ctx, 0.33), 'D');
      c.rect(X(ctx, 0.365), Y(ctx, 0.365), X(ctx, 0.635) - X(ctx, 0.365), Y(ctx, 0.565) - Y(ctx, 0.365), 'd');
      steppedCore(ctx, 0.50, 0.465, 0.082);
      // Runes — circuit traces etched on the casing flanks.
      const t = c.pick(3);
      for (const s of [-1, 1] as const) {
        const bx = s < 0 ? X(ctx, 0.185) : X(ctx, 0.70);
        c.stripe(bx, Y(ctx, 0.38) + t, Math.round(ctx.w * 0.085), 'c');
        c.stripe(bx, Y(ctx, 0.47) + t, Math.round(ctx.w * 0.06), 'c');
        c.stripe(bx, Y(ctx, 0.56) + t, Math.round(ctx.w * 0.085), 'c');
      }
      // Contact pins hanging off the casing's lower edge.
      for (let i = 0; i < 6; i++) {
        const px = X(ctx, 0.19 + i * 0.105);
        c.rect(px, Y(ctx, 0.72), Math.max(2, Math.round(ctx.w * 0.045)), Y(ctx, 0.79) - Y(ctx, 0.72), i % 2 ? 'd' : 'D');
      }
    },
  },
  {
    name: 'Data Shard',
    formId: 'data-shard',
    baseColor: '#25B2C9',
    paint(ctx) {
      const c = ctx.c;
      // The shard — one tall jagged crystal, faceted by banding.
      const pts: Pt[] = [
        [X(ctx, 0.50), Y(ctx, 0.06)], [X(ctx, 0.635), Y(ctx, 0.30)], [X(ctx, 0.60), Y(ctx, 0.47)],
        [X(ctx, 0.665), Y(ctx, 0.80)], [X(ctx, 0.575), Y(ctx, 0.845)], [X(ctx, 0.425), Y(ctx, 0.845)],
        [X(ctx, 0.335), Y(ctx, 0.80)], [X(ctx, 0.40), Y(ctx, 0.47)], [X(ctx, 0.365), Y(ctx, 0.30)],
      ];
      c.poly(pts, banded(ctx, 0.06, 0.845));
      // Facet seams (detail kit).
      c.seam(X(ctx, 0.50), Y(ctx, 0.11), X(ctx, 0.445), Y(ctx, 0.80));
      c.seam(X(ctx, 0.50), Y(ctx, 0.11), X(ctx, 0.575), Y(ctx, 0.78));
      c.seam(X(ctx, 0.375), Y(ctx, 0.44), X(ctx, 0.63), Y(ctx, 0.44));
      // The core burns at the shard's heart.
      steppedCore(ctx, 0.50, 0.46, 0.095);
      // Satellite shards, seeded jitter — never a new form.
      const j = (c.next() - 0.5) * 0.02;
      const sat = (cxF: number, cyF: number, sF: number, shade: GearShade) => {
        const cxp = X(ctx, cxF + j); const tipp = Y(ctx, cyF - sF); const botp = Y(ctx, cyF + sF);
        c.poly([[cxp, tipp], [X(ctx, cxF + j + sF * 0.55), Y(ctx, cyF)], [cxp, botp], [X(ctx, cxF + j - sF * 0.55), Y(ctx, cyF)]], shade);
        c.set(cxp, Y(ctx, cyF), 'e');
      };
      sat(0.195, 0.62, 0.10, 'P');
      sat(0.805, 0.68, 0.085, 'd');
    },
  },
  {
    name: 'Neural Key',
    formId: 'neural-key',
    baseColor: '#7B5CD6',
    paint(ctx) {
      const c = ctx.c;
      const cy = Y(ctx, 0.47);
      // The bow — a ring you could grip.
      c.ring(X(ctx, 0.235), cy, R(ctx, 0.062), R(ctx, 0.128), 'P');
      c.slope(X(ctx, 0.175), Y(ctx, 0.375), X(ctx, 0.235), Y(ctx, 0.345), 'p', true);
      // Collar between bow and shaft.
      c.rect(X(ctx, 0.315), Y(ctx, 0.40), X(ctx, 0.36) - X(ctx, 0.315), Y(ctx, 0.54) - Y(ctx, 0.40), 'D');
      // The shaft, lit along its top edge.
      c.rect(X(ctx, 0.35), Y(ctx, 0.435), X(ctx, 0.86) - X(ctx, 0.35), Y(ctx, 0.505) - Y(ctx, 0.435), 'P');
      c.rect(X(ctx, 0.35), Y(ctx, 0.435), X(ctx, 0.86) - X(ctx, 0.35), Math.max(1, Math.round(ctx.h * 0.02)), 'p');
      // Teeth — two drops, the far one longer.
      c.rect(X(ctx, 0.68), Y(ctx, 0.505), Math.round(ctx.w * 0.035), Y(ctx, 0.66) - Y(ctx, 0.505), 'P');
      c.rect(X(ctx, 0.68), Y(ctx, 0.635), Math.round(ctx.w * 0.035), Y(ctx, 0.66) - Y(ctx, 0.635), 'D');
      c.rect(X(ctx, 0.795), Y(ctx, 0.505), Math.round(ctx.w * 0.035), Y(ctx, 0.72) - Y(ctx, 0.505), 'P');
      c.rect(X(ctx, 0.795), Y(ctx, 0.695), Math.round(ctx.w * 0.035), Y(ctx, 0.72) - Y(ctx, 0.695), 'D');
      // End cap.
      c.rect(X(ctx, 0.86), Y(ctx, 0.42), Math.round(ctx.w * 0.02), Y(ctx, 0.52) - Y(ctx, 0.42), 'D');
      // Neural nodes riding the shaft — lit cores, white hearts.
      for (const f of [0.44, 0.545, 0.65]) {
        const nx = X(ctx, f);
        c.disc(nx, cy, R(ctx, 0.03), 'E');
        c.set(nx, cy, 'W');
      }
      // A trace under the shaft (detail kit).
      c.stripe(X(ctx, 0.38), Y(ctx, 0.545), Math.round(ctx.w * 0.30), 'c');
    },
  },
  {
    name: 'Cache Relic',
    formId: 'cache-relic',
    baseColor: '#D06018',
    paint(ctx) {
      const c = ctx.c;
      // The domed lid — three stepped arch rows.
      c.rect(X(ctx, 0.28), Y(ctx, 0.155), X(ctx, 0.72) - X(ctx, 0.28), Y(ctx, 0.225) - Y(ctx, 0.155), 'p');
      c.rect(X(ctx, 0.225), Y(ctx, 0.225), X(ctx, 0.775) - X(ctx, 0.225), Y(ctx, 0.295) - Y(ctx, 0.225), 'p');
      c.rect(X(ctx, 0.175), Y(ctx, 0.295), X(ctx, 0.825) - X(ctx, 0.175), Y(ctx, 0.36) - Y(ctx, 0.295), 'P');
      // The casket body.
      casing(ctx, 0.15, 0.36, 0.85, 0.80, 0.04);
      // Lid band.
      c.rect(X(ctx, 0.15), Y(ctx, 0.36), X(ctx, 0.85) - X(ctx, 0.15), Y(ctx, 0.415) - Y(ctx, 0.36), 'D');
      // The lock clasp and the glow inside it.
      c.rect(X(ctx, 0.445), Y(ctx, 0.33), X(ctx, 0.555) - X(ctx, 0.445), Y(ctx, 0.60) - Y(ctx, 0.33), 'D');
      steppedCore(ctx, 0.50, 0.465, 0.085);
      // Corner brackets.
      for (const s of [-1, 1] as const) {
        const bx = s < 0 ? X(ctx, 0.165) : X(ctx, 0.805);
        c.rect(bx, Y(ctx, 0.44), Math.round(ctx.w * 0.03), Y(ctx, 0.60) - Y(ctx, 0.44), 'K');
        c.rect(bx, Y(ctx, 0.66), Math.round(ctx.w * 0.03), Y(ctx, 0.775) - Y(ctx, 0.66), 'K');
        c.rivet(bx + 1, Y(ctx, 0.45));
        c.rivet(bx + 1, Y(ctx, 0.67));
      }
      // Etched runes on the flanks.
      c.stripe(X(ctx, 0.21), Y(ctx, 0.52), Math.round(ctx.w * 0.10), 'c');
      c.stripe(X(ctx, 0.69), Y(ctx, 0.52), Math.round(ctx.w * 0.10), 'c');
    },
  },
  {
    name: 'Echo Stone',
    formId: 'echo-stone',
    baseColor: '#35A06B',
    paint(ctx) {
      const c = ctx.c;
      // The stone — a heavy rounded octagon.
      const pts: Pt[] = [
        [X(ctx, 0.50), Y(ctx, 0.08)], [X(ctx, 0.71), Y(ctx, 0.17)], [X(ctx, 0.80), Y(ctx, 0.44)],
        [X(ctx, 0.71), Y(ctx, 0.71)], [X(ctx, 0.50), Y(ctx, 0.80)], [X(ctx, 0.29), Y(ctx, 0.71)],
        [X(ctx, 0.20), Y(ctx, 0.44)], [X(ctx, 0.29), Y(ctx, 0.17)],
      ];
      c.poly(pts, banded(ctx, 0.08, 0.80));
      // Echo rings rippling out from the core (silhouette layer).
      const cx = X(ctx, 0.50); const cy = Y(ctx, 0.44);
      c.ring(cx, cy, R(ctx, 0.235), R(ctx, 0.255), 'c', true);
      c.ring(cx, cy, R(ctx, 0.155), R(ctx, 0.178), 'e', true);
      // The core the echoes come from.
      steppedCore(ctx, 0.50, 0.44, 0.085);
      // Rune pips on the stone's face (detail kit).
      const t = c.pick(4);
      for (const [fx, fy] of [[0.335, 0.30], [0.665, 0.30], [0.335, 0.60], [0.665, 0.60]] as const) {
        c.stripe(X(ctx, fx) + t, Y(ctx, fy), 2, 'e');
      }
    },
  },
  {
    name: 'Void Prism',
    formId: 'void-prism',
    baseColor: '#9B4DFF',
    paint(ctx) {
      const c = ctx.c;
      // The prism — a tall hex crystal, faceted left/center/right.
      const cxL = X(ctx, 0.455); const cxR = X(ctx, 0.545); const yBot = Y(ctx, 0.75);
      const pts: Pt[] = [
        [X(ctx, 0.50), Y(ctx, 0.045)], [X(ctx, 0.665), Y(ctx, 0.235)], [X(ctx, 0.665), Y(ctx, 0.645)],
        [X(ctx, 0.50), Y(ctx, 0.845)], [X(ctx, 0.335), Y(ctx, 0.645)], [X(ctx, 0.335), Y(ctx, 0.235)],
      ];
      c.poly(pts, (x, y) => (y > yBot ? 'D' : x < cxL ? 'p' : x > cxR ? 'd' : 'P'));
      c.seam(X(ctx, 0.50), Y(ctx, 0.10), X(ctx, 0.50), Y(ctx, 0.78));
      // The void heart.
      steppedCore(ctx, 0.50, 0.44, 0.085);
      // Levitating shards keep station beside it.
      const shard = (cxF: number, cyF: number, sF: number, shade: GearShade) => {
        const cxp = X(ctx, cxF);
        c.poly([
          [cxp, Y(ctx, cyF - sF)], [X(ctx, cxF + sF * 0.5), Y(ctx, cyF)],
          [cxp, Y(ctx, cyF + sF)], [X(ctx, cxF - sF * 0.5), Y(ctx, cyF)],
        ], shade);
        c.set(cxp, Y(ctx, cyF), 'e');
      };
      shard(0.195, 0.44, 0.14, 'P');
      shard(0.805, 0.44, 0.14, 'd');
      shard(0.225, 0.72, 0.085, 'P');
    },
  },
  {
    name: 'Circuit Totem',
    formId: 'circuit-totem',
    baseColor: '#3E9B4F',
    paint(ctx) {
      const c = ctx.c;
      // Antenna prongs with lit tips.
      for (const f of [0.415, 0.575]) {
        c.rect(X(ctx, f), Y(ctx, 0.075), Math.max(1, Math.round(ctx.w * 0.014)), Y(ctx, 0.20) - Y(ctx, 0.075), 'D');
        c.disc(X(ctx, f) + 1, Y(ctx, 0.065), R(ctx, 0.02), 'e');
      }
      // Three stacked segments, narrowing as they rise.
      c.rect(X(ctx, 0.375), Y(ctx, 0.20), X(ctx, 0.625) - X(ctx, 0.375), Y(ctx, 0.40) - Y(ctx, 0.20), 'P');
      c.rect(X(ctx, 0.375), Y(ctx, 0.20), X(ctx, 0.625) - X(ctx, 0.375), Math.max(1, Math.round(ctx.h * 0.025)), 'p');
      steppedCore(ctx, 0.50, 0.30, 0.09);
      c.rect(X(ctx, 0.315), Y(ctx, 0.40), X(ctx, 0.685) - X(ctx, 0.315), Y(ctx, 0.615) - Y(ctx, 0.40), 'd');
      c.rect(X(ctx, 0.315), Y(ctx, 0.40), X(ctx, 0.685) - X(ctx, 0.315), Math.max(1, Math.round(ctx.h * 0.025)), 'P');
      // Arms.
      c.rect(X(ctx, 0.275), Y(ctx, 0.44), X(ctx, 0.315) - X(ctx, 0.275), Y(ctx, 0.56) - Y(ctx, 0.44), 'D');
      c.rect(X(ctx, 0.685), Y(ctx, 0.44), X(ctx, 0.725) - X(ctx, 0.685), Y(ctx, 0.56) - Y(ctx, 0.44), 'D');
      // The face: two lit eyes on the middle segment.
      for (const f of [0.43, 0.57]) {
        c.disc(X(ctx, f), Y(ctx, 0.49), R(ctx, 0.032), 'e');
        c.set(X(ctx, f), Y(ctx, 0.49), 'W');
      }
      // Bottom segment — darkest, with circuit traces etched in.
      c.rect(X(ctx, 0.26), Y(ctx, 0.615), X(ctx, 0.74) - X(ctx, 0.26), Y(ctx, 0.845) - Y(ctx, 0.615), 'D');
      c.rect(X(ctx, 0.26), Y(ctx, 0.615), X(ctx, 0.74) - X(ctx, 0.26), Math.max(1, Math.round(ctx.h * 0.03)), 'd');
      const t = c.pick(3);
      c.stripe(X(ctx, 0.31), Y(ctx, 0.70) + t, Math.round(ctx.w * 0.16), 'c');
      c.stripe(X(ctx, 0.53), Y(ctx, 0.70) + t, Math.round(ctx.w * 0.16), 'c');
      c.stripe(X(ctx, 0.31), Y(ctx, 0.775) + t, Math.round(ctx.w * 0.38), 'c');
      c.seam(X(ctx, 0.50), Y(ctx, 0.63), X(ctx, 0.50), Y(ctx, 0.70) + t);
    },
  },
  {
    name: 'Ancient Module',
    formId: 'ancient-module',
    baseColor: '#A67C33',
    paint(ctx) {
      const c = ctx.c;
      // The rack casing.
      casing(ctx, 0.135, 0.235, 0.865, 0.79, 0.04);
      c.vents(X(ctx, 0.20), Y(ctx, 0.325), 7);
      // Card slots on the left flank.
      for (const f of [0.19, 0.25]) {
        c.rect(X(ctx, f), Y(ctx, 0.40), Math.round(ctx.w * 0.032), Y(ctx, 0.68) - Y(ctx, 0.40), 'K');
      }
      // Side handles.
      c.rect(X(ctx, 0.155), Y(ctx, 0.42), X(ctx, 0.175) - X(ctx, 0.155), Y(ctx, 0.67) - Y(ctx, 0.42), 'D');
      c.rect(X(ctx, 0.825), Y(ctx, 0.42), X(ctx, 0.845) - X(ctx, 0.825), Y(ctx, 0.67) - Y(ctx, 0.42), 'D');
      // The great dial.
      const dx = X(ctx, 0.47); const dy = Y(ctx, 0.545);
      c.disc(dx, dy, R(ctx, 0.115), 'c');
      c.disc(dx, dy, R(ctx, 0.082), 'E');
      c.disc(dx, dy, R(ctx, 0.045), 'e');
      c.slope(dx, dy, dx + R(ctx, 0.06), dy - R(ctx, 0.06), 'W', true);
      c.set(dx, dy, 'W');
      // A rune column right of the dial.
      const t = c.pick(3);
      c.stripe(X(ctx, 0.665), Y(ctx, 0.44) + t, Math.round(ctx.w * 0.09), 'c');
      c.stripe(X(ctx, 0.665), Y(ctx, 0.53) + t, Math.round(ctx.w * 0.09), 'c');
      c.stripe(X(ctx, 0.665), Y(ctx, 0.62) + t, Math.round(ctx.w * 0.09), 'c');
      // Etched band along the casing's foot.
      c.stripe(X(ctx, 0.19), Y(ctx, 0.725), Math.round(ctx.w * 0.62), 'c');
    },
  },
  {
    name: 'Scrap Core',
    formId: 'scrap-core',
    baseColor: '#9C4A2F',
    paint(ctx) {
      const c = ctx.c;
      // Junk housing — honest asymmetric blocks around the core.
      c.rect(X(ctx, 0.36), Y(ctx, 0.155), X(ctx, 0.545) - X(ctx, 0.36), Y(ctx, 0.30) - Y(ctx, 0.155), 'd');
      c.rect(X(ctx, 0.36), Y(ctx, 0.275), X(ctx, 0.545) - X(ctx, 0.36), Y(ctx, 0.30) - Y(ctx, 0.275), 'D');
      c.rect(X(ctx, 0.285), Y(ctx, 0.30), X(ctx, 0.66) - X(ctx, 0.285), Y(ctx, 0.385) - Y(ctx, 0.30), 'P');
      c.rect(X(ctx, 0.285), Y(ctx, 0.385), X(ctx, 0.66) - X(ctx, 0.285), Y(ctx, 0.66) - Y(ctx, 0.385), 'd');
      c.rect(X(ctx, 0.285), Y(ctx, 0.66), X(ctx, 0.66) - X(ctx, 0.285), Y(ctx, 0.79) - Y(ctx, 0.66), 'D');
      c.rect(X(ctx, 0.66), Y(ctx, 0.47), X(ctx, 0.795) - X(ctx, 0.66), Y(ctx, 0.79) - Y(ctx, 0.47), 'P');
      c.rect(X(ctx, 0.225), Y(ctx, 0.62), X(ctx, 0.285) - X(ctx, 0.225), Y(ctx, 0.79) - Y(ctx, 0.62), 'D');
      // An exhaust pipe off the side block, with its flange.
      c.thickLine(X(ctx, 0.725), Y(ctx, 0.47), X(ctx, 0.775), Y(ctx, 0.30), 1, 'D');
      c.rect(X(ctx, 0.75), Y(ctx, 0.255), X(ctx, 0.805) - X(ctx, 0.75), Y(ctx, 0.30) - Y(ctx, 0.255), 'd');
      // The core itself — the biggest, hottest heart in the pool.
      steppedCore(ctx, 0.455, 0.545, 0.115);
      // Bolts and a gash (detail kit).
      c.rivet(X(ctx, 0.30), Y(ctx, 0.315));
      c.rivet(X(ctx, 0.625), Y(ctx, 0.315));
      c.rivet(X(ctx, 0.30), Y(ctx, 0.75));
      c.rivet(X(ctx, 0.755), Y(ctx, 0.75));
      c.seam(X(ctx, 0.56), Y(ctx, 0.40), X(ctx, 0.635), Y(ctx, 0.60));
    },
  },
  {
    name: 'Glitched Token',
    formId: 'glitched-token',
    baseColor: '#C93BAA',
    paint(ctx) {
      const c = ctx.c;
      // The coin — one round struck token, banded like every body.
      const cx = X(ctx, 0.50); const cy = Y(ctx, 0.46); const r = R(ctx, 0.295);
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.4) {
            const rel = (y - (cy - r)) / (2 * r);
            c.set(x, y, rel < 0.3 ? 'p' : rel < 0.66 ? 'P' : rel < 0.88 ? 'd' : 'D');
          }
        }
      }
      // Rings struck into the face (silhouette layer).
      c.ring(cx, cy, R(ctx, 0.185), R(ctx, 0.20), 'c', true);
      c.ring(cx, cy, R(ctx, 0.115), R(ctx, 0.135), 'E', true);
      // The glyph notch at its center.
      c.rect(X(ctx, 0.485), Y(ctx, 0.395), X(ctx, 0.515) - X(ctx, 0.485), Y(ctx, 0.525) - Y(ctx, 0.395), 'K');
      // THE GLITCH: two horizontal slices of the struck coin shear
      // sideways by a few texels — whole rows of the finished form,
      // shifted, the way a corrupted frame tears. (Silhouette
      // layer: the tear is part of the form, so the thumb tears
      // too, at its own scale.)
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
      // Stray blocks the glitch threw off.
      c.rect(X(ctx, 0.735), Y(ctx, 0.30), Math.round(ctx.w * 0.05), Math.round(ctx.h * 0.045), 'P');
      c.rect(X(ctx, 0.775), Y(ctx, 0.52), Math.round(ctx.w * 0.035), Math.round(ctx.h * 0.04), 'P');
      c.rect(X(ctx, 0.185), Y(ctx, 0.44), Math.round(ctx.w * 0.04), Math.round(ctx.h * 0.04), 'd');
      c.rect(X(ctx, 0.71), Y(ctx, 0.66), Math.round(ctx.w * 0.03), Math.round(ctx.h * 0.035), 'e');
    },
  },
  {
    name: 'Ethereal Drive',
    formId: 'ethereal-drive',
    baseColor: '#6FB3C9',
    paint(ctx) {
      const c = ctx.c;
      // The slab — pale bands, a ghost of a drive.
      casing(ctx, 0.215, 0.26, 0.785, 0.66, 0.05);
      // The window, and the ghost-wave moving through it.
      c.rect(X(ctx, 0.315), Y(ctx, 0.345), X(ctx, 0.685) - X(ctx, 0.315), Y(ctx, 0.575) - Y(ctx, 0.345), 'c');
      c.slope(X(ctx, 0.335), Y(ctx, 0.50), X(ctx, 0.45), Y(ctx, 0.42), 'e', true);
      c.slope(X(ctx, 0.45), Y(ctx, 0.42), X(ctx, 0.56), Y(ctx, 0.50), 'e', true);
      c.slope(X(ctx, 0.56), Y(ctx, 0.50), X(ctx, 0.665), Y(ctx, 0.43), 'e', true);
      c.disc(X(ctx, 0.50), Y(ctx, 0.46), R(ctx, 0.018), 'W');
      // Hover glow under the slab (silhouette layer) — the drive's
      // core light, in the ramp's base tone.
      c.rect(X(ctx, 0.30), Y(ctx, 0.685), X(ctx, 0.70) - X(ctx, 0.30), Y(ctx, 0.715) - Y(ctx, 0.685), 'E');
      // Wisps — the drive is not entirely here.
      c.disc(X(ctx, 0.30), Y(ctx, 0.79), R(ctx, 0.028), 'p');
      c.disc(X(ctx, 0.70), Y(ctx, 0.80), R(ctx, 0.02), 'p');
      c.disc(X(ctx, 0.50), Y(ctx, 0.155), R(ctx, 0.022), 'p');
      c.disc(X(ctx, 0.565), Y(ctx, 0.10), R(ctx, 0.014), 'L');
      // A lit corner accent (detail kit).
      c.stripe(X(ctx, 0.245), Y(ctx, 0.295), Math.round(ctx.w * 0.05), 'e');
    },
  },
  {
    name: 'Quantum Fragment',
    formId: 'quantum-fragment',
    baseColor: '#4F6BD8',
    paint(ctx) {
      const c = ctx.c;
      // The main fragment — a tall jagged piece of something larger.
      const pts: Pt[] = [
        [X(ctx, 0.50), Y(ctx, 0.13)], [X(ctx, 0.62), Y(ctx, 0.34)], [X(ctx, 0.585), Y(ctx, 0.845)],
        [X(ctx, 0.44), Y(ctx, 0.845)], [X(ctx, 0.395), Y(ctx, 0.55)], [X(ctx, 0.415), Y(ctx, 0.32)],
      ];
      c.poly(pts, banded(ctx, 0.13, 0.845));
      c.seam(X(ctx, 0.50), Y(ctx, 0.18), X(ctx, 0.47), Y(ctx, 0.80));
      c.seam(X(ctx, 0.42), Y(ctx, 0.45), X(ctx, 0.60), Y(ctx, 0.42));
      steppedCore(ctx, 0.505, 0.50, 0.09);
      // Orbiting fragments, seeded jitter — same cluster, new roll.
      const j = (c.next() - 0.5) * 0.018;
      const frag = (ptsF: [number, number][], shade: GearShade) => {
        c.poly(ptsF.map(([fx, fy]) => [X(ctx, fx + j), Y(ctx, fy)] as Pt), shade);
      };
      frag([[0.235, 0.24], [0.30, 0.36], [0.27, 0.52], [0.185, 0.44], [0.19, 0.30]], 'P');
      c.set(X(ctx, 0.24 + j), Y(ctx, 0.38), 'e');
      frag([[0.755, 0.52], [0.815, 0.62], [0.79, 0.78], [0.715, 0.70], [0.71, 0.58]], 'd');
      c.set(X(ctx, 0.76 + j), Y(ctx, 0.65), 'e');
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
/* Base treatments — sourceTag demoted to the plinth                   */
/* ------------------------------------------------------------------ */

export type RelicTreatmentId = 'world' | 'boss' | 'cache' | 'event' | 'crafted' | 'market';

/** Where a relic came from chooses only what it rests on. */
export const RELIC_TREATMENTS: Readonly<Record<string, RelicTreatmentId>> = {
  [DropSource.WorldDrop]: 'world',
  [DropSource.BossDrop]: 'boss',
  [DropSource.CacheForged]: 'cache',
  [DropSource.Event]: 'event',
  [DropSource.Crafted]: 'crafted',
  [DropSource.Marketplace]: 'market',
};

const RELIC_TREATMENT_PAINTS: Record<RelicTreatmentId, (ctx: RelicCtx) => void> = {
  /** A plain field plinth — the world leaves things where they fall. */
  world(ctx) {
    const c = ctx.c;
    c.rect(X(ctx, 0.17), Y(ctx, 0.875), X(ctx, 0.83) - X(ctx, 0.17), Y(ctx, 0.94) - Y(ctx, 0.875), 'd');
    c.rect(X(ctx, 0.17), Y(ctx, 0.875), X(ctx, 0.83) - X(ctx, 0.17), Math.max(1, Math.round(ctx.h * 0.012)), 'p');
    c.rect(X(ctx, 0.24), Y(ctx, 0.94), X(ctx, 0.34) - X(ctx, 0.24), Y(ctx, 0.975) - Y(ctx, 0.94), 'D');
    c.rect(X(ctx, 0.66), Y(ctx, 0.94), X(ctx, 0.76) - X(ctx, 0.66), Y(ctx, 0.975) - Y(ctx, 0.94), 'D');
  },
  /** The totem foot — a heavy stepped trophy base. */
  boss(ctx) {
    const c = ctx.c;
    c.rect(X(ctx, 0.13), Y(ctx, 0.865), X(ctx, 0.87) - X(ctx, 0.13), Y(ctx, 0.915) - Y(ctx, 0.865), 'D');
    c.rect(X(ctx, 0.22), Y(ctx, 0.915), X(ctx, 0.78) - X(ctx, 0.22), Y(ctx, 0.965) - Y(ctx, 0.915), 'd');
    c.rect(X(ctx, 0.475), Y(ctx, 0.925), X(ctx, 0.525) - X(ctx, 0.475), Y(ctx, 0.955) - Y(ctx, 0.925), 'K');
    c.rect(X(ctx, 0.17), Y(ctx, 0.965), X(ctx, 0.27) - X(ctx, 0.17), Y(ctx, 0.985) - Y(ctx, 0.965), 'D');
    c.rect(X(ctx, 0.73), Y(ctx, 0.965), X(ctx, 0.83) - X(ctx, 0.73), Y(ctx, 0.985) - Y(ctx, 0.965), 'D');
  },
  /** The forge cradle — slotted housing with two upright posts. */
  cache(ctx) {
    const c = ctx.c;
    c.rect(X(ctx, 0.175), Y(ctx, 0.815), X(ctx, 0.205) - X(ctx, 0.175), Y(ctx, 0.95) - Y(ctx, 0.815), 'd');
    c.rect(X(ctx, 0.795), Y(ctx, 0.815), X(ctx, 0.825) - X(ctx, 0.795), Y(ctx, 0.95) - Y(ctx, 0.815), 'd');
    c.rect(X(ctx, 0.20), Y(ctx, 0.885), X(ctx, 0.80) - X(ctx, 0.20), Y(ctx, 0.95) - Y(ctx, 0.885), 'D');
    for (const f of [0.30, 0.475, 0.65]) {
      c.rect(X(ctx, f), Y(ctx, 0.90), Math.round(ctx.w * 0.05), Y(ctx, 0.935) - Y(ctx, 0.90), 'K');
    }
  },
  /** The display stand — a shelf on two angled struts. */
  event(ctx) {
    const c = ctx.c;
    c.rect(X(ctx, 0.16), Y(ctx, 0.865), X(ctx, 0.84) - X(ctx, 0.16), Y(ctx, 0.895) - Y(ctx, 0.865), 'P');
    c.rect(X(ctx, 0.16), Y(ctx, 0.865), X(ctx, 0.84) - X(ctx, 0.16), Math.max(1, Math.round(ctx.h * 0.012)), 'p');
    c.thickLine(X(ctx, 0.30), Y(ctx, 0.895), X(ctx, 0.47), Y(ctx, 0.975), 0, 'd');
    c.thickLine(X(ctx, 0.70), Y(ctx, 0.895), X(ctx, 0.53), Y(ctx, 0.975), 0, 'd');
    c.rect(X(ctx, 0.44), Y(ctx, 0.895), X(ctx, 0.56) - X(ctx, 0.44), Y(ctx, 0.945) - Y(ctx, 0.895), 'D');
    c.rect(X(ctx, 0.40), Y(ctx, 0.965), X(ctx, 0.60) - X(ctx, 0.40), Y(ctx, 0.985) - Y(ctx, 0.965), 'D');
  },
  /** The workbench base — bolted, with a maker's stripe. */
  crafted(ctx) {
    const c = ctx.c;
    c.rect(X(ctx, 0.185), Y(ctx, 0.87), X(ctx, 0.815) - X(ctx, 0.185), Y(ctx, 0.95) - Y(ctx, 0.87), 'd');
    c.rect(X(ctx, 0.24), Y(ctx, 0.95), X(ctx, 0.30) - X(ctx, 0.24), Y(ctx, 0.985) - Y(ctx, 0.95), 'D');
    c.rect(X(ctx, 0.70), Y(ctx, 0.95), X(ctx, 0.76) - X(ctx, 0.70), Y(ctx, 0.985) - Y(ctx, 0.95), 'D');
    c.rivet(X(ctx, 0.20), Y(ctx, 0.885));
    c.rivet(X(ctx, 0.775), Y(ctx, 0.885));
    c.stripe(X(ctx, 0.30), Y(ctx, 0.935), Math.round(ctx.w * 0.40), 'e');
  },
  /** The market shelf — a listing stand with its price tag. */
  market(ctx) {
    const c = ctx.c;
    c.rect(X(ctx, 0.15), Y(ctx, 0.88), X(ctx, 0.85) - X(ctx, 0.15), Y(ctx, 0.93) - Y(ctx, 0.88), 'P');
    c.rect(X(ctx, 0.42), Y(ctx, 0.885), X(ctx, 0.58) - X(ctx, 0.42), Y(ctx, 0.945) - Y(ctx, 0.885), 'd');
    c.rect(X(ctx, 0.30), Y(ctx, 0.93), X(ctx, 0.36) - X(ctx, 0.30), Y(ctx, 0.975) - Y(ctx, 0.93), 'd');
    c.rect(X(ctx, 0.64), Y(ctx, 0.93), X(ctx, 0.70) - X(ctx, 0.64), Y(ctx, 0.975) - Y(ctx, 0.93), 'd');
    c.rect(X(ctx, 0.775), Y(ctx, 0.93), X(ctx, 0.815) - X(ctx, 0.775), Y(ctx, 0.985) - Y(ctx, 0.93), 'E');
    c.set(X(ctx, 0.795), Y(ctx, 0.945), 'K');
  },
};

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
  id: 'relic-name-forms-v1',
  kind: 'relic',
  plate: GEAR_CARD_PLATES.relic,
  inputFromItem: relicInputFromItem,
  paint(canvas, input) {
    const [formId, treatmentId] = (input.variant ?? '').split('/');
    const row = RELIC_FORM_BY_ID.get(formId) ?? RELIC_FORM_ROWS[0];
    const treatment = RELIC_TREATMENT_PAINTS[(treatmentId as RelicTreatmentId)] ?? RELIC_TREATMENT_PAINTS.world;
    const ctx = makeCtx(canvas);
    row.paint(ctx);
    treatment(ctx);
    // Affix pips ride the plinth's front face (core detail kit —
    // card density only; the thumb carries form + colorway alone).
    const pips = Math.min(input.pips ?? 0, 5);
    if (pips > 0) {
      canvas.pipRow(ctx.cx - Math.floor((pips * 5 - 2) / 2), Y(ctx, 0.895), pips, pips);
    }
    // Seeded wear — a few texel-scale chips on the form.
    for (let i = 0; i < 5; i++) {
      canvas.chip(X(ctx, 0.14 + canvas.next() * 0.72), Y(ctx, 0.10 + canvas.next() * 0.66));
    }
  },
};
