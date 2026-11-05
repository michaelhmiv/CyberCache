import { CONSUMABLES } from '@/constants/consumables';
import type { ConsumableDef } from '@/constants/consumables';
import { ConsumableType } from '@/types/game';

type ConsFrame = ConsumableDef['visual']['frame'];
import { hashString } from '@/lib/utils/rng';
import { seededRandom } from '@/lib/weaponArt/decalSpec';
import { hexLerp } from './weaponCardCompositor';

/**
 * consumableArt — real item art for consumables (owner complaint
 * 2026-11-04: the Vendor screen's item "logos" were the §7 sheet
 * glyphs — monochrome pictograms — while every other item family
 * in the game wears a formed object). Consumables were the one
 * family that never got sprites; this module retires the glyph on
 * every item surface and gives each of the 43 types a formed
 * object, built exactly the way STUFF built materials
 * (materialArt.ts): runtime-composed on a texel grid, zero sprite
 * payload, compose-then-cache.
 *
 * THE GRAMMAR (impeccable pass, Operate mode — the bolder hand:
 * a flat surface is one that opted out of the system's strongest
 * moves; consumables join the system every sibling already uses):
 *   CHASSIS  — the def's own declared silhouette (vial, cell,
 *              syringe, magazine, rounds, grenade, scanner,
 *              beacon, contract, ticket, swarm) drawn as a formed
 *              object: bottle, canister, injector, charge, device.
 *   CONTENTS — the def's accent as the live substance: the liquid
 *              in the vial, the charge in the cell, the glow in
 *              the scanner screen. Identity hue, full saturation.
 *   MOTIF    — the def's icon, demoted from "the whole picture"
 *              to what it always should have been: the emblem
 *              stamped on the object's face.
 *   FINISH   — the def's frame as physical finish: reinforced
 *              straps, volatile hazard banding, signal arcs,
 *              market brass. Wear follows the finish.
 * Because every axis resolves from the def's own visual record,
 * the art cannot drift from the item's declared identity, and a
 * new consumable is one def (its art row derives) — the table
 * below exists to pin the variants where two defs declare the
 * same visual and the objects still must not be twins.
 *
 * THE PIXEL DENSITY LAW (DESIGN.md §8) binds everything here:
 * texel = 4; authored AT the grid (24×24 object, 12×12 thumb —
 * the STUFF grids); five-tone ramp per hue; warm near-black
 * outline; wear at texel scale; glow is hard-edged texel shapes.
 * The thumb is DETAIL LEVEL 0, composed on its own grid.
 */

export type ConsumableChassis =
  | 'vial' | 'cell' | 'swarm' | 'syringe' | 'magazine' | 'rounds'
  | 'grenade' | 'scanner' | 'beacon' | 'contract' | 'ticket';
export type ConsumableDensity = 'object' | 'thumb';

export interface ConsumableArtRow {
  chassis: ConsumableChassis;
  /** Shape variant inside the chassis — the distinguisher where
   *  two defs declare identical visuals (PatchKit vs FieldPatchKit). */
  variant: string;
  /** Casing/body color override (the med kits' bone white). The
   *  contents color always comes from the def's accent. */
  body?: string;
}

/** Accent → contents hex (the ConsumableLedger's table, promoted
 *  here so art and ledger can never disagree about a hue). */
export const CONSUMABLE_ACCENT_HEX: Readonly<Record<string, string>> = {
  green: '#7CFC00', red: '#FF4B5C', orange: '#FF9000', cyan: '#00E5FF',
  amber: '#FFB300', purple: '#B66BFF', blue: '#5AA7FF',
};

const T = ConsumableType;

/**
 * The art table: one row per consumable type. Chassis follows the
 * def's silhouette except where the silhouette lies about the
 * object (the coatings are applicator jars, not loose rounds;
 * the patch kits are salve tins and field bottles, not vials of
 * potion). Variants separate every declared-visual twin.
 */
export const CONSUMABLE_ART: Readonly<Record<string, ConsumableArtRow>> = {
  // — survival —
  [T.MedKit]: { chassis: 'vial', variant: 'kit', body: '#CFC9B8' },
  [T.MedKitRefined]: { chassis: 'vial', variant: 'kitPro', body: '#E9E3D0' },
  [T.ShieldCell]: { chassis: 'cell', variant: 'cell' },
  [T.NanoSwarm]: { chassis: 'swarm', variant: 'swarm' },
  [T.AdrenalineShot]: { chassis: 'syringe', variant: 'stim' },
  // — ammo —
  [T.AmmoPack]: { chassis: 'magazine', variant: 'mag' },
  [T.HighCapacityAmmoPack]: { chassis: 'magazine', variant: 'magPro' },
  [T.ArmorPiercingAmmo]: { chassis: 'rounds', variant: 'row' },
  [T.IncendiaryAmmo]: { chassis: 'rounds', variant: 'row' },
  [T.ShockAmmo]: { chassis: 'rounds', variant: 'row' },
  [T.CorrosiveAmmo]: { chassis: 'rounds', variant: 'row' },
  [T.CryoAmmo]: { chassis: 'rounds', variant: 'row' },
  [T.ElementalCoating]: { chassis: 'rounds', variant: 'coat' },
  [T.PrismCoating]: { chassis: 'rounds', variant: 'coatPrism' },
  // — ordnance —
  [T.Grenade]: { chassis: 'grenade', variant: 'charge' },
  [T.OrdnanceCharge]: { chassis: 'grenade', variant: 'chargePro' },
  [T.EMPCharge]: { chassis: 'grenade', variant: 'emp' },
  [T.CorrosiveCharge]: { chassis: 'grenade', variant: 'acid' },
  [T.PhaseShiftGrenade]: { chassis: 'grenade', variant: 'phase' },
  [T.MagnetizedPayload]: { chassis: 'grenade', variant: 'magnet' },
  [T.ForgeheartCharge]: { chassis: 'grenade', variant: 'forge' },
  // — tactical —
  [T.TargetPainter]: { chassis: 'scanner', variant: 'painter' },
  [T.BossScanner]: { chassis: 'scanner', variant: 'scanner' },
  [T.Jammer]: { chassis: 'scanner', variant: 'jammer' },
  [T.SignalScrambler]: { chassis: 'scanner', variant: 'scrambler' },
  [T.ThrowTechDecoyKit]: { chassis: 'beacon', variant: 'decoy' },
  [T.HeartwoodSightOil]: { chassis: 'vial', variant: 'oil' },
  // — economy —
  [T.LootBeacon]: { chassis: 'beacon', variant: 'dish' },
  [T.LuckBooster]: { chassis: 'beacon', variant: 'star' },
  [T.InsuranceToken]: { chassis: 'contract', variant: 'token' },
  [T.SalvageContract]: { chassis: 'contract', variant: 'form' },
  [T.DataSkimmer]: { chassis: 'scanner', variant: 'skimmer' },
  [T.WorkshopRushTicket]: { chassis: 'ticket', variant: 'ticket' },
  [T.HelixCalibrationKit]: { chassis: 'ticket', variant: 'calib' },
  [T.GenericFuelCell]: { chassis: 'cell', variant: 'drum' },
  [T.FuelCell]: { chassis: 'cell', variant: 'cellPro' },
  [T.PatchKit]: { chassis: 'vial', variant: 'tin' },
  [T.FieldPatchKit]: { chassis: 'vial', variant: 'field' },
  [T.MasterPatchKit]: { chassis: 'vial', variant: 'master' },
  [T.CalibrationCore]: { chassis: 'cell', variant: 'core' },
  // — corrupted —
  [T.VoidAmmo]: { chassis: 'rounds', variant: 'row' },
  [T.OverchargeStim]: { chassis: 'syringe', variant: 'overcharge' },
  [T.RedlineTonic]: { chassis: 'syringe', variant: 'tonic' },
};

/** The art row for a consumable type id. Falls back to the def's
 *  declared silhouette so an unlisted future type still draws a
 *  formed object, never a glyph. */
export function consumableArtRow(id: string): ConsumableArtRow {
  const row = CONSUMABLE_ART[id];
  if (row) return row;
  const def = CONSUMABLES[id];
  const chassis = (def?.visual.silhouette ?? 'vial') as ConsumableChassis;
  return { chassis, variant: 'standard' };
}

/* ------------------------------------------------------------------ */
/* Ramps                                                               */
/* ------------------------------------------------------------------ */

/** Shade alphabet: D/d/P/p/L = body ramp deep→hot, A/a/E = contents
 *  ramp dark/base/lite, K = warm near-black outline, S = ground
 *  shadow, W = hard white, B/b = brass (rounds casings, market trim). */
export type ConsShade = 'K' | 'S' | 'W' | 'D' | 'd' | 'P' | 'p' | 'L' | 'A' | 'a' | 'E' | 'B' | 'b';

interface Ramp { deep: string; shade: string; base: string; lite: string; hot: string }

function ramp(base: string): Ramp {
  return {
    deep: hexLerp(base, '#000000', 0.52),
    shade: hexLerp(base, '#000000', 0.26),
    base,
    lite: hexLerp(base, '#FFFFFF', 0.34),
    hot: hexLerp(base, '#FFFFFF', 0.60),
  };
}

const RAMP_SHADES = { deep: 'D', shade: 'd', base: 'P', lite: 'p', hot: 'L' } as const;
const ACCENT_SHADES = { base: 'A', dark: 'a', hot: 'E' } as const;
type R = typeof RAMP_SHADES;
type A = typeof ACCENT_SHADES;

const BRASS = '#C9962E';
const GROUND_Y = 21;

/* ------------------------------------------------------------------ */
/* Plate (the STUFF plate discipline, consumables' own hand)           */
/* ------------------------------------------------------------------ */

type Pt = [number, number];

class ConsPlate {
  readonly n: number;
  cells: string[][];

  constructor(n: number) {
    this.n = n;
    this.cells = Array.from({ length: n }, () => new Array<string>(n).fill('.'));
  }

  in(x: number, y: number) { return x >= 0 && x < this.n && y >= 0 && y < this.n; }
  get(x: number, y: number): string { return this.in(x, y) ? this.cells[y][x] : '.'; }
  set(x: number, y: number, s: ConsShade) { if (this.in(x, y)) this.cells[y][x] = s; }
  over(x: number, y: number, s: ConsShade) { if (this.get(x, y) !== '.') this.set(x, y, s); }
  filled(x: number, y: number) { return this.get(x, y) !== '.'; }
  rows(): string[] { return this.cells.map((r) => r.join('')); }

  rect(x: number, y: number, w: number, h: number, s: ConsShade) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, s);
  }

  poly(pts: Pt[], s: ConsShade) {
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

  ellipse(cx: number, cy: number, rx: number, ry: number, s: ConsShade) {
    const x0 = Math.floor(cx - rx - 1); const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1); const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / (rx + 0.5); const dy = (y - cy) / (ry + 0.5);
      if (dx * dx + dy * dy <= 1) this.set(x, y, s);
    }
  }

  ellipseRing(cx: number, cy: number, rx: number, ry: number, thickness: number, s: ConsShade) {
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

type Rng = () => number;
const rint = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
function choice<T>(rng: Rng, arr: readonly T[]): T { return arr[Math.floor(rng() * arr.length)]; }

/* ------------------------------------------------------------------ */
/* Motifs — the def's icon, drawn as the emblem on the object's face   */
/* ------------------------------------------------------------------ */

function paintMotif(cv: ConsPlate, icon: string, cx: number, cy: number, A: A) {
  const s = (dx: number, dy: number, sh: ConsShade = A.base) => cv.set(cx + dx, cy + dy, sh);
  switch (icon) {
    case 'cross':
      for (let d = -2; d <= 2; d++) { s(0, d); s(d, 0); }
      s(0, 0, A.hot);
      break;
    case 'hex':
      cv.poly([[cx - 1, cy - 2], [cx + 1, cy - 2], [cx + 2, cy], [cx + 1, cy + 2], [cx - 1, cy + 2], [cx - 2, cy]], A.base);
      s(0, 0, A.hot);
      break;
    case 'star':
    case 'star5':
      s(0, -2); s(-1, -1); s(0, -1, A.hot); s(1, -1);
      for (let d = -2; d <= 2; d++) s(d, 0);
      s(-1, 1); s(1, 1); s(-2, 2); s(2, 2);
      break;
    case 'bolt':
      s(1, -2); s(0, -1); s(1, -1, A.hot); s(0, 0); s(-1, 1); s(0, 1); s(-1, 2);
      break;
    case 'grid':
      cv.rect(cx - 2, cy - 2, 2, 2, A.base); cv.rect(cx + 1, cy - 2, 2, 2, A.base);
      cv.rect(cx - 2, cy + 1, 2, 2, A.base); cv.rect(cx + 1, cy + 1, 2, 2, A.hot);
      break;
    case 'hatchH':
      for (const dy of [-2, 0, 2]) for (let d = -2; d <= 2; d++) s(d, dy);
      break;
    case 'hatch':
      for (let d = -2; d <= 1; d++) { s(d, d + 2); s(d + 1, d + 2); }
      break;
    case 'diamond':
      s(0, -2); s(-1, -1); s(1, -1); s(-2, 0); s(2, 0); s(-1, 1); s(1, 1); s(0, 2);
      break;
    case 'diamondIn':
      s(0, -2); s(-1, -1); s(1, -1); s(-2, 0); s(2, 0); s(-1, 1); s(1, 1); s(0, 2);
      s(0, -1, A.hot); s(-1, 0, A.hot); s(0, 0, A.hot); s(1, 0, A.hot); s(0, 1, A.hot);
      break;
    case 'diamondFill':
      s(0, -2, A.hot);
      for (let d = -1; d <= 1; d++) s(d, -1);
      for (let d = -2; d <= 2; d++) s(d, 0);
      for (let d = -1; d <= 1; d++) s(d, 1);
      s(0, 2);
      break;
    case 'dot':
      cv.ellipse(cx, cy, 2, 2, A.base);
      s(0, 0, A.hot);
      break;
    case 'bullseye':
      cv.ellipseRing(cx, cy, 2.4, 2.4, 1, A.base);
      s(0, 0, A.hot);
      break;
    case 'ringDot':
      cv.ellipseRing(cx, cy, 2.6, 2.6, 1, A.base);
      cv.ellipse(cx, cy, 1, 1, A.hot);
      break;
    case 'target':
      cv.ellipseRing(cx, cy, 2.2, 2.2, 1, A.base);
      s(0, 0, A.hot);
      s(0, -3); s(0, 3); s(-3, 0); s(3, 0);
      break;
    case 'crosshair':
      cv.ellipseRing(cx, cy, 2.2, 2.2, 1, A.base);
      s(0, 0, A.hot);
      for (const d of [-3, -2, 2, 3]) { s(d, 0); s(0, d); }
      break;
    case 'waves':
      for (const [dx, dy] of [[-2, 0], [-1, -1], [0, 0], [1, 1], [2, 0]] as const) s(dx, dy - 1);
      for (const [dx, dy] of [[-2, 0], [-1, -1], [0, 0], [1, 1], [2, 0]] as const) s(dx, dy + 1, A.hot);
      break;
    case 'halfDisc':
      for (let d = -1; d <= 1; d++) s(d, -2);
      for (let d = -2; d <= 2; d++) { s(d, -1); s(d, 0); }
      for (let d = -2; d <= 2; d++) s(d, 1, A.hot);
      break;
    case 'barFill':
      cv.rect(cx - 2, cy - 1, 5, 3, A.base);
      cv.rect(cx - 2, cy - 1, 5, 1, A.hot);
      break;
    case 'barEmpty':
      cv.rect(cx - 2, cy - 1, 5, 1, A.base); cv.rect(cx - 2, cy + 1, 5, 1, A.base);
      s(-2, 0); s(2, 0);
      break;
    case 'triR':
      cv.poly([[cx - 1, cy - 2], [cx + 2, cy], [cx - 1, cy + 2]], A.base);
      s(0, 0, A.hot);
      break;
    case 'pawn':
      cv.ellipse(cx, cy - 1, 1.4, 1.4, A.base);
      s(0, 1); cv.rect(cx - 2, cy + 2, 5, 1, A.hot);
      break;
    case 'rings':
      cv.ellipseRing(cx - 1, cy, 1.8, 1.8, 1, A.base);
      cv.ellipseRing(cx + 1, cy, 1.8, 1.8, 1, A.hot);
      break;
    case 'burst':
      for (const [dx, dy] of [[0, -2], [0, 2], [-2, 0], [2, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) s(dx, dy);
      cv.ellipse(cx, cy, 1, 1, A.hot);
      break;
    default:
      cv.ellipse(cx, cy, 1.6, 1.6, A.base);
      s(0, 0, A.hot);
  }
}

/* ------------------------------------------------------------------ */
/* Finish — wear keyed by frame + the frame's physical treatment       */
/* ------------------------------------------------------------------ */

const WEAR: Record<ConsFrame, { chipP: number; scratches: number; noise: number }> = {
  standard: { chipP: 0.07, scratches: 1, noise: 0.14 },
  reinforced: { chipP: 0.02, scratches: 0, noise: 0.07 },
  volatile: { chipP: 0.11, scratches: 1, noise: 0.18 },
  signal: { chipP: 0.06, scratches: 1, noise: 0.12 },
  market: { chipP: 0.03, scratches: 0, noise: 0.08 },
};

function bodyBBox(cv: ConsPlate): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = cv.n; let y0 = cv.n; let x1 = -1; let y1 = -1;
  for (let y = 0; y < cv.n; y++) for (let x = 0; x < cv.n; x++) {
    if (!cv.filled(x, y)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Frame treatments that live ON the body (drawn before wear). */
function frameTreatment(cv: ConsPlate, frame: ConsFrame) {
  if (frame === 'standard' || frame === 'signal') return;
  const { x0, y0, x1, y1 } = bodyBBox(cv);
  if (x1 < 0) return;
  if (frame === 'reinforced') {
    // Two casing straps across the body's upper and lower thirds.
    for (const fy of [0.34, 0.68]) {
      const y = Math.round(y0 + (y1 - y0) * fy);
      for (let x = x0; x <= x1; x++) {
        if (cv.filled(x, y)) cv.set(x, y, 'd');
        if (cv.filled(x, y + 1)) cv.set(x, y + 1, 'K');
      }
      cv.over(x0 + 1, y, 'L'); cv.over(x1 - 1, y, 'L'); // rivets
    }
  } else if (frame === 'volatile') {
    // Hazard chevron band across the body's top rows.
    const y = y0 + 2;
    for (let x = x0; x <= x1; x++) {
      if (cv.filled(x, y)) cv.set(x, y, (x % 4 < 2) ? 'K' : 'a');
      if (cv.filled(x, y + 1)) cv.set(x, y + 1, (x % 4 < 2) ? 'a' : 'K');
    }
  } else if (frame === 'market') {
    // Brass corner trim + a punched tag dot.
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
      cv.over(cx, cy, 'B'); cv.over(cx + dx, cy, 'B'); cv.over(cx, cy + dy, 'B');
    }
    cv.over(x1 - 1, y0 + 1, 'E');
  }
}

/** Signal arcs live in the air above the object — drawn after the
 *  finish pass so the outline ring never chases them. */
function signalArcs(cv: ConsPlate, frame: ConsFrame, A: A) {
  if (frame !== 'signal') return;
  const { x0, x1, y0 } = bodyBBox(cv);
  const cx = Math.round((x0 + x1) / 2);
  for (const r of [3, 5]) {
    for (let dx = -r; dx <= r; dx++) {
      const dy = Math.round(Math.sqrt(Math.max(0, r * r - dx * dx)) * 0.62);
      const x = cx + dx; const y = y0 - 2 - dy;
      if (cv.in(x, y) && !cv.filled(x, y)) cv.set(x, y, r === 3 ? A.hot : A.base);
    }
  }
  cv.set(cx, Math.max(0, y0 - 2), A.hot);
}

function toneNoise(cv: ConsPlate, frame: ConsFrame, rng: Rng) {
  const { noise } = WEAR[frame];
  for (let y = 0; y < cv.n; y++) for (let x = 0; x < cv.n; x++) {
    if (cv.get(x, y) === 'P' && rng() < noise) cv.set(x, y, choice(rng, ['d', 'p'] as const));
  }
}

function finishPass(cv: ConsPlate, frame: ConsFrame, rng: Rng) {
  const { chipP, scratches } = WEAR[frame];
  const n = cv.n;
  let mask = cv.bodyMask();
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
  const body: Pt[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cv.filled(x, y)) body.push([x, y]);
  for (let i = 0; i < scratches && body.length > 0; i++) {
    const [sx, sy] = body[Math.floor(rng() * body.length)];
    const len = rint(rng, 2, 4);
    for (let k = 0; k < len; k++) if (cv.filled(sx + k, sy)) cv.set(sx + k, sy, 'D');
  }
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
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (cv.filled(x, y)) continue;
    const dx = (x - 12) / 8.5; const dy = (y - (GROUND_Y + 1)) / 1.5;
    if (dx * dx + dy * dy <= 1) cv.set(x, y, 'S');
  }
}

/* ------------------------------------------------------------------ */
/* Chassis — object density (24 grid). Painters receive the body       */
/* ramp (R), the contents ramp (A), the variant, and the def's icon    */
/* for the face motif.                                                 */
/* ------------------------------------------------------------------ */

type Painter = (cv: ConsPlate, R: R, A: A, variant: string, icon: string, rng: Rng) => void;

function bottleBase(cv: ConsPlate, x0: number, x1: number, yTop: number) {
  // Shoulders + neck + cap over a straight body x0..x1, yTop..20.
  const cx0 = Math.round((x0 + x1) / 2) - 1;
  cv.rect(cx0, yTop - 3, 4, 2, 'd'); // cap
  cv.rect(cx0, yTop - 3, 4, 1, 'p');
  cv.rect(cx0 + 1, yTop - 1, 2, 1, 'd'); // neck
  cv.poly([[x0, yTop + 2], [cx0 + 1, yTop - 1], [cx0 + 3, yTop - 1], [x1, yTop + 2]], 'P'); // shoulders
  cv.rect(x0, yTop + 2, x1 - x0 + 1, 20 - (yTop + 2) + 1, 'P');
  cv.rect(x0, yTop + 2, 1, 18 - yTop, 'p'); // glass highlight
}

function liquid(cv: ConsPlate, x0: number, x1: number, yFrom: number, A: A, rng: Rng) {
  cv.rect(x0 + 1, yFrom, x1 - x0 - 1, 20 - yFrom, 'a');
  cv.rect(x0 + 1, yFrom + 2, x1 - x0 - 1, 20 - yFrom - 2, A.base);
  cv.rect(x0 + 1, yFrom, x1 - x0 - 1, 1, A.hot); // meniscus
  for (let i = 0; i < 3; i++) cv.set(rint(rng, x0 + 2, x1 - 2), rint(rng, yFrom + 3, 19), A.hot); // bubbles
}

const paintVial: Painter = (cv, R, A, variant, icon, rng) => {
  if (variant === 'kit' || variant === 'kitPro') {
    // The med kits: a squat bone-white case-jar with a latched lid —
    // reads "medical" before the cross is even seen.
    const y0 = variant === 'kit' ? 10 : 8;
    cv.rect(6, y0, 12, 2, 'd'); // lid
    cv.rect(6, y0, 12, 1, 'p');
    cv.rect(5, y0 + 2, 14, 20 - y0 - 1, 'P');
    cv.rect(5, 20, 14, 1, 'd');
    cv.rect(6, y0 + 3, 1, 8, 'p');
    paintMotif(cv, 'cross', 11, y0 + 6, A);
    cv.set(7, y0 + 1, 'L'); cv.set(16, y0 + 1, 'L'); // latches
    if (variant === 'kitPro') { cv.rect(5, 19, 14, 1, 'B'); cv.set(12, y0 + 6, A.hot); }
    return;
  }
  if (variant === 'tin') {
    // Patch Kit: a flat salve tin, lid seam across the top.
    cv.rect(5, 13, 14, 2, 'd');
    cv.rect(5, 13, 14, 1, 'p');
    cv.rect(5, 15, 14, 6, 'P');
    cv.rect(5, 19, 14, 1, 'd');
    paintMotif(cv, 'cross', 11, 17, A);
    return;
  }
  if (variant === 'oil') {
    // Sight Oil: dark glass, dropper cap, a drawn sample in the neck.
    bottleBase(cv, 7, 16, 9);
    cv.rect(8, 11, 9, 9, 'd'); // dark glass over the lit shoulders
    cv.rect(8, 11, 1, 8, 'P');
    cv.rect(12, 6, 1, 5, 'K'); // dropper tube
    cv.rect(8, 16, 9, 4, 'a');
    cv.set(12, 18, A.hot); cv.set(13, 19, A.base); // the oil, pooled
    cv.set(12, 12, A.hot); cv.set(12, 13, A.base); cv.set(13, 13, A.base); // one drawn droplet (the waves motif muddies the narrow face)
    return;
  }
  // Standard bottle (field / master / fallback): liquid-forward.
  bottleBase(cv, 6, 17, 9);
  liquid(cv, 6, 17, 14, A, rng);
  paintMotif(cv, icon, 12, 12, A);
  if (variant === 'field') {
    for (let i = 0; i < 6; i++) cv.over(8 + i, 10 + i, 'd'); // field strap, diagonal
  }
  if (variant === 'master') {
    cv.rect(10, 5, 4, 1, 'B'); // brass collar under the cap
    cv.rect(6, 19, 12, 1, 'B');
  }
};

const paintCell: Painter = (cv, R, A, variant, icon, _rng) => {
  if (variant === 'drum') {
    // Generic Fuel Cell: a squat fuel drum with a carry handle.
    cv.rect(9, 8, 6, 2, 'd');
    cv.rect(7, 10, 11, 1, 'd');
    cv.rect(6, 11, 13, 10, 'P');
    cv.rect(6, 11, 13, 1, 'p');
    cv.rect(6, 14, 13, 1, 'd'); cv.rect(6, 18, 13, 1, 'd'); // ribs
    cv.rect(8, 15, 9, 3, 'a');
    cv.rect(8, 16, 9, 2, A.base); // the fuel, seen through the gauge
    cv.set(15, 15, A.hot);
    return;
  }
  if (variant === 'core') {
    // Calibration Core: a ring housing on a stand, diamond heart.
    cv.rect(9, 19, 7, 2, 'd');
    cv.rect(11, 17, 3, 2, 'd');
    cv.ellipseRing(12, 11, 5.6, 5.6, 2, 'P');
    cv.ellipseRing(12, 11, 5.6, 5.6, 1, 'd');
    cv.set(6, 8, 'L'); cv.set(18, 8, 'L'); cv.set(6, 14, 'L'); cv.set(18, 14, 'L'); // housing bolts
    paintMotif(cv, 'diamondIn', 12, 11, A);
    return;
  }
  // Cell / cellPro: a tall charge canister, windowed.
  const y0 = variant === 'cellPro' ? 5 : 6;
  cv.rect(10, y0 - 2, 5, 2, 'd'); // cap
  cv.set(12, y0 - 3, 'L'); // terminal
  cv.rect(8, y0, 9, 20 - y0, 'P');
  cv.rect(8, y0, 9, 1, 'p');
  cv.rect(8, 19, 9, 1, 'd');
  cv.rect(10, y0 + 3, 5, 8, 'a'); // charge window
  cv.rect(10, y0 + 6, 5, 5, A.base);
  cv.rect(10, y0 + 6, 5, 1, A.hot);
  cv.set(9, y0 + 5, 'W'); cv.set(9, y0 + 8, 'W'); // level ticks
  paintMotif(cv, icon, 12, 17, A);
  if (variant === 'cellPro') cv.rect(8, y0 + 1, 9, 1, 'B'); // brass collar
};

const paintSwarm: Painter = (cv, R, A) => {
  // Nano Swarm: a bright core with its bots in loose orbit.
  cv.ellipse(12, 12, 3.2, 3.2, A.base);
  cv.ellipse(12, 12, 1.4, 1.4, A.hot);
  const orbit: Array<[number, number]> = [[5, 8], [19, 8], [6, 16], [18, 16], [12, 5], [12, 19]];
  for (const [x, y] of orbit) {
    cv.ellipse(x, y, 1.6, 1.6, 'P');
    cv.set(x, y, A.base);
  }
  cv.set(8, 9, 'a'); cv.set(16, 15, 'a'); cv.set(15, 7, 'a'); // drift flecks
};

const paintSyringe: Painter = (cv, R, A, variant, icon) => {
  const slim = variant !== 'stim';
  const x0 = slim ? 9 : 8; const x1 = slim ? 14 : 15;
  cv.rect(x0 - 1, 2, x1 - x0 + 3, 2, 'P'); // thumb plate
  cv.rect(Math.round((x0 + x1) / 2), 4, 1, 3, 'd'); // plunger rod
  cv.rect(x0, 7, x1 - x0 + 1, 2, 'd'); // flange
  cv.rect(x0, 9, x1 - x0 + 1, 9, 'P'); // barrel
  cv.rect(x0 + 1, 12, x1 - x0 - 1, 6, A.base); // the dose
  cv.rect(x0 + 1, 12, x1 - x0 - 1, 1, A.hot);
  cv.rect(x0, 9, 1, 9, 'p');
  cv.rect(11, 18, 2, 1, 'd'); // hub
  cv.set(12, 19, 'K'); cv.set(12, 20, 'K'); // needle
  paintMotif(cv, icon, 11, 10, A);
  if (variant === 'overcharge') {
    cv.set(x0 + 1, 14, 'K'); cv.set(x0 + 2, 15, 'K'); cv.set(x0 + 1, 16, 'K'); // barrel crack
    cv.set(12, 20, A.hot); // charged drip
  }
  if (variant === 'tonic') {
    cv.rect(7, 9, 1, 9, 'd'); cv.rect(16, 9, 1, 9, 'd'); // twin rails
    cv.set(11, 21 - 1, A.base); // tonic drip at the tip
  }
};

const paintMagazine: Painter = (cv, R, A, variant) => {
  const pro = variant === 'magPro';
  const tips = pro ? [7, 10, 13, 16] : [8, 11, 14];
  for (const x of tips) {
    cv.rect(x, 5, 2, 3, 'B'); // brass cartridge tips over the top
    cv.set(x, 5, 'b');
  }
  cv.poly([[6, 8], [17, 8], [16, 20], [7, 20]], 'P');
  cv.rect(7, 8, 10, 1, 'p');
  cv.rect(8, 11, 8, 5, 'a'); // witness window
  for (const wy of [12, 13, 15]) cv.rect(9, wy, 6, 1, A.base); // rounds inside
  cv.rect(6, 19, 11, 2, 'd'); // baseplate
  if (pro) for (const y of [9, 17]) cv.rect(7, y, 10, 1, 'd'); // slat bands
};

const paintRounds: Painter = (cv, R, A, variant, _icon, _rng) => {
  if (variant === 'coat' || variant === 'coatPrism') {
    // The coatings: an applicator jar — squat pot, wide lid, the
    // dip brush resting against it, sheen pooled on the face.
    cv.rect(7, 11, 11, 2, 'd'); // lid
    cv.rect(7, 11, 11, 1, 'p');
    cv.rect(8, 13, 10, 8, 'P');
    cv.rect(8, 13, 1, 7, 'p');
    cv.rect(9, 17, 8, 3, A.base); // the coating, pooled
    cv.rect(9, 17, 8, 1, A.hot);
    cv.set(10, 15, A.base); cv.set(11, 16, A.base); // sheen drips on the face
    // brush: handle up-right, loaded tip at the lid line
    cv.set(16, 6, 'd'); cv.set(15, 7, 'd'); cv.set(15, 8, 'd'); cv.set(14, 9, 'd'); cv.set(14, 10, A.hot);
    if (variant === 'coatPrism') {
      // Prismatic flecks — the one multi-hue item in the family.
      cv.set(10, 18, 'W'); cv.set(13, 19, 'B'); cv.set(15, 18, 'E');
      cv.set(12, 17, 'W'); cv.set(16, 19, 'W');
    }
    return;
  }
  // Loose rounds: four standing cartridges, brass below, the
  // element carried in the tips and the band.
  for (const x of [4, 9, 14, 19]) {
    cv.set(x + 1, 6, A.hot); // tip point
    cv.rect(x + 1, 7, 2, 2, A.base);
    cv.rect(x, 9, 4, 2, A.base); // shoulder
    cv.rect(x, 11, 4, 1, 'a'); // band
    cv.rect(x, 12, 4, 8, 'B'); // brass casing
    cv.rect(x, 12, 1, 8, 'b');
    cv.rect(x, 19, 4, 1, 'b');
    cv.set(x + 1, 20, 'K'); // primer
  }
  cv.rect(3, 20, 20, 1, 'd'); // the tray line they stand on
};

const paintGrenade: Painter = (cv, R, A, variant, icon) => {
  if (variant === 'magnet') {
    // Magnetized Payload: the horseshoe rides on top of the body.
    cv.rect(8, 3, 3, 5, A.base); cv.rect(14, 3, 3, 5, A.base);
    cv.rect(8, 3, 9, 2, A.base);
    cv.set(9, 7, A.hot); cv.set(15, 7, A.hot); // pole faces
    cv.rect(9, 8, 7, 2, 'd');
  } else if (variant !== 'emp') {
    cv.rect(10, 6, 5, 2, 'd'); // neck
    cv.rect(13, 4, 4, 2, 'd'); // lever
    cv.ellipseRing(18, 4, 1.6, 1.6, 1, 'K'); // pin ring
  }
  const big = variant === 'forge';
  // Body fills the grid like the STUFF objects do — the first
  // capture pass showed a rx-6 body reading as a small pot at
  // 26px mounts while the Scrap sprite beside it filled its row.
  cv.ellipse(12, 14, big ? 8.4 : 7.6, big ? 7.4 : 6.8, 'P');
  cv.ellipse(8, 11, 1.8, 2.6, 'p'); // body light
  cv.rect(4, 13, 17, 2, 'a'); // equator band in the contents shade — the identity color carries at small sizes
  cv.rect(4, 13, 17, 1, 'd');
  if (variant === 'emp') {
    cv.rect(9, 5, 7, 3, 'd'); // flat top housing
    cv.rect(10, 8, 5, 2, A.base);
    cv.set(12, 9, A.hot);
  }
  if (variant === 'acid') {
    cv.set(11, 8, A.base); cv.set(11, 9, A.base); cv.set(10, 10, A.hot); // corrosive weep
    cv.set(8, 16, 'a'); cv.set(15, 17, 'a'); cv.set(9, 18, 'a'); // pitting
  }
  if (variant === 'phase') {
    // The ghost: the same body, twice-struck, offset in deep shade.
    cv.ellipse(15, 12, 6.8, 6.2, 'D');
    cv.ellipse(12, 14, 7.6, 6.8, 'P');
    cv.rect(4, 13, 17, 2, 'a');
    cv.rect(4, 13, 17, 1, 'd');
  }
  paintMotif(cv, icon, 12, 17, A);
};

const paintScanner: Painter = (cv, R, A, variant, icon) => {
  const twin = variant === 'jammer';
  cv.rect(15, 3, 2, 5, 'd'); cv.set(15, 2, A.hot); // antenna
  if (twin) { cv.rect(8, 4, 2, 4, 'd'); cv.set(8, 3, A.hot); }
  cv.rect(7, 7, 11, 14, 'P');
  cv.rect(7, 7, 11, 1, 'p');
  cv.rect(9, 9, 7, 6, 'a'); // screen, dark glass
  paintMotif(cv, icon, 12, 12, A);
  cv.rect(8, 17, 1, 3, 'd'); cv.rect(10, 17, 1, 3, 'd'); cv.rect(12, 17, 1, 3, 'd'); // grip ridges
  cv.rect(15, 17, 2, 2, A.base); // trigger cell
  if (variant === 'scrambler') {
    cv.set(17, 5, A.base); cv.set(18, 4, A.base); cv.set(19, 5, A.hot); // broken emission
  }
};

const paintBeacon: Painter = (cv, R, A, variant, _icon) => {
  cv.rect(6, 19, 13, 2, 'd'); // base plate
  cv.set(7, 18, 'd'); cv.set(16, 18, 'd'); // feet
  cv.rect(11, 11, 3, 8, 'P'); // mast
  cv.rect(11, 11, 3, 1, 'p');
  if (variant === 'dish') {
    cv.ellipse(12, 8, 5.2, 3.2, 'a'); // the dish bowl
    cv.ellipse(12, 7, 5.2, 2.6, A.base);
    cv.set(12, 6, A.hot);
    cv.set(8, 3, A.base); cv.set(16, 3, A.base); cv.set(12, 2, A.hot); // cast arcs
  } else if (variant === 'star') {
    cv.ellipse(12, 9, 2.6, 2.6, 'a');
    paintMotif(cv, 'star', 12, 8, A);
  } else { // decoy — a holo pawn over its projector
    cv.poly([[9, 19], [16, 19], [14, 15], [11, 15]], 'P'); // projector cone base
    cv.ellipse(12, 8, 2.2, 2.6, A.base); // head (broken rows read as holo scanlines)
    cv.rect(10, 11, 5, 1, A.base);
    cv.rect(9, 13, 7, 1, A.hot); // shoulders
    cv.set(12, 8, A.hot);
  }
};

const paintContract: Painter = (cv, R, A, variant, icon) => {
  if (variant === 'token') {
    // Insurance Token: a sealed card with a fat round seal.
    cv.rect(6, 6, 13, 14, 'P');
    cv.rect(6, 6, 13, 1, 'p');
    cv.rect(6, 18, 13, 1, 'd');
    cv.ellipse(12, 12, 4.2, 4.2, A.base);
    cv.ellipseRing(12, 12, 4.2, 4.2, 1, 'a');
    paintMotif(cv, icon, 12, 12, A);
    cv.set(8, 8, 'L'); cv.set(16, 8, 'L'); // card rivets
    return;
  }
  // Salvage Contract: the document itself — header, terms, seal line.
  cv.rect(7, 3, 11, 18, 'P');
  cv.rect(7, 3, 11, 1, 'p');
  cv.poly([[15, 3], [18, 3], [18, 6]], 'D'); // folded corner
  cv.rect(7, 5, 11, 2, A.base); // header band
  cv.rect(9, 9, 7, 1, 'd'); cv.rect(9, 11, 8, 1, 'd'); cv.rect(9, 13, 6, 1, 'd'); // terms
  paintMotif(cv, icon, 12, 17, A);
};

const paintTicket: Painter = (cv, R, A, variant, icon) => {
  // A stiff ticket card, landscape, perforated stub on the left.
  cv.rect(3, 9, 19, 9, 'P');
  cv.rect(3, 9, 19, 1, 'p');
  cv.rect(3, 17, 19, 1, 'd');
  for (let y = 10; y <= 16; y += 2) cv.set(7, y, 'K'); // perforation
  cv.set(3, 9, '.'); cv.set(21, 9, '.'); cv.set(3, 17, '.'); cv.set(21, 17, '.'); // punched corners
  paintMotif(cv, icon, 5, 13, A); // stub mark
  cv.rect(10, 11, 7, 1, 'd'); cv.rect(10, 15, 5, 1, 'd'); // print lines
  if (variant === 'calib') {
    cv.ellipseRing(18, 13, 1.8, 1.8, 1, A.base); // calibration dial
    cv.set(18, 13, A.hot);
  } else {
    paintMotif(cv, icon, 18, 13, A);
  }
};

const OBJECT_PAINTERS: Record<ConsumableChassis, Painter> = {
  vial: paintVial,
  cell: paintCell,
  swarm: paintSwarm,
  syringe: paintSyringe,
  magazine: paintMagazine,
  rounds: paintRounds,
  grenade: paintGrenade,
  scanner: paintScanner,
  beacon: paintBeacon,
  contract: paintContract,
  ticket: paintTicket,
};

/* ------------------------------------------------------------------ */
/* Chassis — thumb density (12 grid, DETAIL LEVEL 0: bold silhouette   */
/* + contents core + colorway, composed on its own grid)               */
/* ------------------------------------------------------------------ */

type ThumbPainter = (cv: ConsPlate, R: R, A: A, variant: string, icon: string) => void;

const THUMB_PAINTERS: Record<ConsumableChassis, ThumbPainter> = {
  vial: (cv, R, A, variant) => {
    if (variant === 'kit' || variant === 'kitPro' || variant === 'tin') {
      cv.rect(2, 4, 8, 2, 'd');
      cv.rect(2, 6, 8, 5, 'P');
      cv.set(6, 7, A.base); cv.set(6, 8, A.base); cv.set(5, 8, A.base); cv.set(7, 8, A.base); cv.set(6, 9, A.hot);
      return;
    }
    cv.rect(5, 2, 3, 2, 'd');
    cv.rect(4, 4, 5, 7, 'P');
    cv.rect(4, 8, 5, 3, A.base);
    cv.set(6, 6, A.hot);
  },
  cell: (cv, R, A, variant) => {
    if (variant === 'core') {
      cv.ellipseRing(6, 6, 3.4, 3.4, 1, 'P');
      cv.set(6, 6, A.hot); cv.set(5, 6, A.base); cv.set(7, 6, A.base); cv.set(6, 5, A.base); cv.set(6, 7, A.base);
      cv.rect(4, 10, 5, 1, 'd');
      return;
    }
    if (variant === 'drum') {
      cv.rect(3, 4, 7, 7, 'P');
      cv.rect(3, 7, 7, 2, A.base);
      return;
    }
    cv.rect(5, 2, 3, 1, 'd');
    cv.rect(4, 3, 5, 8, 'P');
    cv.rect(5, 5, 3, 4, A.base);
    cv.set(6, 6, A.hot);
  },
  swarm: (cv, R, A) => {
    cv.ellipse(6, 6, 2.2, 2.2, A.base);
    cv.set(6, 6, A.hot);
    for (const [x, y] of [[2, 3], [10, 3], [3, 9], [9, 9]] as const) { cv.ellipse(x, y, 1.2, 1.2, 'P'); cv.set(x, y, A.base); }
  },
  syringe: (cv, R, A) => {
    cv.rect(4, 1, 5, 1, 'P');
    cv.rect(5, 3, 3, 6, 'P');
    cv.rect(5, 6, 3, 3, A.base);
    cv.set(6, 9, 'K'); cv.set(6, 10, 'K');
    cv.set(6, 4, A.hot);
  },
  magazine: (cv, R, A) => {
    cv.set(4, 2, 'B'); cv.set(6, 2, 'B'); cv.set(8, 2, 'B');
    cv.rect(3, 3, 7, 8, 'P');
    cv.rect(4, 6, 5, 2, A.base);
    cv.rect(3, 10, 7, 1, 'd');
  },
  rounds: (cv, R, A, variant) => {
    if (variant === 'coat' || variant === 'coatPrism') {
      cv.rect(3, 4, 7, 2, 'd');
      cv.rect(4, 6, 6, 5, 'P');
      cv.rect(4, 9, 6, 2, A.base);
      cv.set(9, 3, A.hot);
      return;
    }
    for (const x of [3, 6, 9]) {
      cv.set(x, 2, A.hot);
      cv.rect(x, 3, 2, 2, A.base);
      cv.rect(x - 1, 5, 3, 6, 'B');
    }
  },
  grenade: (cv, R, A) => {
    cv.rect(5, 2, 3, 2, 'd');
    cv.ellipse(6, 7, 3.4, 3.2, 'P');
    cv.rect(3, 6, 7, 1, 'd');
    cv.set(6, 8, A.hot);
  },
  scanner: (cv, R, A) => {
    cv.set(9, 1, A.hot); cv.rect(9, 2, 1, 2, 'd');
    cv.rect(3, 3, 7, 8, 'P');
    cv.rect(4, 4, 5, 3, 'a');
    cv.set(6, 5, A.hot);
    cv.rect(4, 8, 1, 2, 'd'); cv.rect(6, 8, 1, 2, 'd');
  },
  beacon: (cv, R, A, variant) => {
    cv.rect(3, 10, 7, 1, 'd');
    cv.rect(6, 6, 1, 4, 'P');
    if (variant === 'star') { cv.set(6, 2, A.hot); cv.set(5, 3, A.base); cv.set(6, 3, A.base); cv.set(7, 3, A.base); cv.set(6, 4, A.base); }
    else if (variant === 'decoy') { cv.ellipse(6, 4, 1.8, 2, A.base); cv.set(6, 4, A.hot); }
    else { cv.ellipse(6, 4, 3, 1.8, A.base); cv.set(6, 3, A.hot); }
  },
  contract: (cv, R, A, variant) => {
    cv.rect(3, 2, 7, 9, 'P');
    if (variant === 'token') { cv.ellipse(6, 6, 2.4, 2.4, A.base); cv.set(6, 6, A.hot); }
    else { cv.rect(3, 3, 7, 1, A.base); cv.rect(4, 6, 5, 1, 'd'); cv.rect(4, 8, 4, 1, 'd'); }
  },
  ticket: (cv, R, A) => {
    cv.rect(1, 4, 10, 5, 'P');
    cv.set(4, 5, 'K'); cv.set(4, 7, 'K');
    cv.set(8, 6, A.hot); cv.set(7, 6, A.base); cv.set(9, 6, A.base);
  },
};

/* ------------------------------------------------------------------ */
/* Compose + cache + paint                                             */
/* ------------------------------------------------------------------ */

export interface ConsumableRender {
  width: number;
  height: number;
  rows: string[];
  colors: Partial<Record<ConsShade, string>>;
  signature: string;
  density: ConsumableDensity;
  id: string;
}

export function composeConsumable(id: string, density: ConsumableDensity = 'object'): ConsumableRender {
  const def = CONSUMABLES[id];
  const row = consumableArtRow(id);
  const accentHex = CONSUMABLE_ACCENT_HEX[def?.visual.accent ?? 'amber'] ?? '#FFB300';
  const bodyHex = row.body ?? hexLerp(accentHex, '#4A443C', 0.45);
  const frame: ConsFrame = def?.visual.frame ?? 'standard';
  const icon = def?.visual.icon ?? 'dot';

  const body = ramp(bodyHex);
  const contents = ramp(accentHex);
  const brass = ramp(BRASS);
  const colors: Partial<Record<ConsShade, string>> = {
    K: '#1A110A',
    S: '#0805026E',
    W: '#FFFFFF',
    D: body.deep, d: body.shade, P: body.base, p: body.lite, L: body.hot,
    A: contents.base, a: hexLerp(accentHex, '#000000', 0.30), E: contents.lite,
    B: brass.base, b: brass.shade,
  };

  const grid = density === 'object' ? 24 : 12;
  const plate = new ConsPlate(grid);
  const rng = seededRandom(hashString(density === 'object' ? `cons:${id}` : `cons:${id}:thumb`));
  if (density === 'object') {
    OBJECT_PAINTERS[row.chassis](plate, RAMP_SHADES, ACCENT_SHADES, row.variant, icon, rng);
    frameTreatment(plate, frame);
    toneNoise(plate, frame, rng);
    finishPass(plate, frame, rng);
    // Signal arcs ride antenna'd chassis only — over a grenade body
    // they detach and read as confetti (contact-sheet verdict).
    if (row.chassis !== 'grenade') signalArcs(plate, frame, ACCENT_SHADES);
  } else {
    THUMB_PAINTERS[row.chassis](plate, RAMP_SHADES, ACCENT_SHADES, row.variant, icon);
    const mask = plate.bodyMask();
    for (let x = 0; x < grid; x++) {
      let lowest = -1;
      for (let y = 0; y < grid; y++) if (mask[y][x]) lowest = y;
      if (lowest >= 0) plate.set(x, Math.min(lowest + 1, grid - 1), 'K');
    }
  }

  const rows = plate.rows();
  const signature = hashString(
    `consumable-${density}|${id}|${row.chassis}|${row.variant}|${frame}|${rows.join('/')}`,
  ).toString(16);
  return { width: grid, height: grid, rows, colors, signature, density, id };
}

const consumableCache = new Map<string, ConsumableRender>();

/** Cached compose, mirroring the gear/material compositors. */
export function composeConsumableCached(id: string, density: ConsumableDensity = 'object'): ConsumableRender {
  const composed = composeConsumable(id, density);
  const cached = consumableCache.get(composed.signature);
  if (cached) return cached;
  if (consumableCache.size > 400) consumableCache.clear();
  consumableCache.set(composed.signature, composed);
  return composed;
}

/** Paint a consumable render into a 2D context at integer scale. */
export function paintConsumable(
  ctx2d: CanvasRenderingContext2D,
  render: ConsumableRender,
  scale: number,
): void {
  const { rows, colors, width, height } = render;
  for (let y = 0; y < height; y++) {
    const rowStr = rows[y];
    let runShade = '';
    let runStart = 0;
    const flush = (endX: number) => {
      if (!runShade || runShade === '.') return;
      const color = colors[runShade as ConsShade];
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
