import { CONSUMABLES } from '@/constants/consumables';
import type { ConsumableDef } from '@/constants/consumables';
import { ConsumableType } from '@/types/game';

type ConsFrame = ConsumableDef['visual']['frame'];
import { hashString } from '@/lib/utils/rng';
import { seededRandom } from '@/lib/weaponArt/decalSpec';
import { hueLerp } from './weaponCardCompositor';
import {
  ACCENT_SHADES,
  GROUND_SHADOW_HEX,
  HARD_WHITE_HEX,
  OUTLINE_HEX,
  RAMP_SHADES,
  SmallItemPlate,
  accentDark,
  choice,
  finishPass,
  fiveToneRamp,
  paintSmallItemRows,
  rint,
  smallItemCached,
  thumbGroundRow,
  toneNoise,
  type AccentShades,
  type RampShades,
  type Rng,
  type SmallItemWear,
} from './smallItemCore';

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
 * S4 (2026-11-07): the machinery the header describes as "exactly
 * the way STUFF built materials" is no longer a parallel copy —
 * both systems now build on the one shared core,
 * smallItemCore.ts (ramp, plate, finish, cache, painter). This
 * file keeps the consumable art table, motifs, frame treatments,
 * and painters.
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
 * PASS 2 — THE COLORWAY (owner direction 2026-11-04: the vendor
 * examples "look pretty similar"; sprites must separate "not
 * only in shape, but also in color and texture"). The pass-1
 * body derivation — accent lerped 45% toward warm gray — drained
 * the saturation §8 demands ("identity comes from silhouette +
 * SATURATED colorway") and collapsed every warm accent into the
 * same brass-brown: 16 of 43 renders shared dominant hue 37°,
 * and the six loose-rounds ammos were 56–61% brass casing with
 * the element surviving only in the tips. So the table now pins
 * an explicit COLORWAY per item, defensible from the def's
 * element/family semantics:
 *   BODY    — the casing as a deliberate material (olive frag
 *             steel, survey-pale instrument housing, hazard-
 *             yellow fuel drum, parchment contract card), never
 *             a desaturated echo of the contents hue.
 *   CASING  — the rounds' metal is per-item (the M/m ramp):
 *             brass belongs to Armor-Piercing alone; the
 *             elemental rounds wear their element as metal —
 *             burn-copper, steel-blue, acid-olive, frost-pale,
 *             void-black — so the Borderlands element code is
 *             the DOMINANT read, not a tip tint.
 *   EXTRAS  — up to three raw hexes (X/Y/Z shades) for the one
 *             genuinely multi-hue item (Prism Coating's flecks).
 * Same-hue families that remain (the amber market goods, the
 * red stims) separate on VALUE and TEXTURE instead — pale vs
 * charcoal housings, strapped vs glossy vs matte finishes —
 * and the test suite pins the separation so a future item
 * cannot silently re-collide (see consumableArt.test.ts).
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
  /** The COLORWAY's body: the casing as a deliberate material
   *  (pass 2). The contents color always comes from the def's
   *  accent; the body never derives from it by default anymore —
   *  a warm-gray lerp of the accent is what made 16 sprites read
   *  as the same brass-brown object. */
  body?: string;
  /** The COLORWAY's metal for the rounds painters (the M/m ramp):
   *  the cartridge casing as element-colored metal. Defaults to
   *  brass — which, after pass 2, only Armor-Piercing keeps. */
  casing?: string;
  /** Up to three raw accent hexes (the X/Y/Z shades) for the one
   *  multi-hue item in the set — Prism Coating's flecks. */
  extras?: readonly [string, string, string];
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
 * potion). Variants separate every declared-visual twin; the
 * pass-2 colorway (body / casing / extras — see the header note)
 * separates every item on color and texture as well.
 */
export const CONSUMABLE_ART: Readonly<Record<string, ConsumableArtRow>> = {
  // — survival —
  // Bone case + green lid band and cross (painter): medical green
  // is the identity, the bone is just the box it ships in.
  [T.MedKit]: { chassis: 'vial', variant: 'kit', body: '#CFC9B8' },
  // The refined kit is the same box gone premium: brighter stock,
  // brass lid band and base — value + metal separate the twins.
  [T.MedKitRefined]: { chassis: 'vial', variant: 'kitPro', body: '#E9E3D0' },
  [T.ShieldCell]: { chassis: 'cell', variant: 'cell', body: '#4E6E73' },
  // The swarm's bots are graphite tech; the green lives in their
  // cores, not in a green wash over the whole cluster.
  [T.NanoSwarm]: { chassis: 'swarm', variant: 'swarm', body: '#3C4147' },
  [T.AdrenalineShot]: { chassis: 'syringe', variant: 'stim', body: '#6E3B34' },
  // — ammo —
  [T.AmmoPack]: { chassis: 'magazine', variant: 'mag', body: '#43484E' },
  [T.HighCapacityAmmoPack]: { chassis: 'magazine', variant: 'magPro', body: '#7E3538' },
  // AP keeps the brass — dark steel penetrator tips over honest
  // brass casings. It is the ONLY brass-cased round after pass 2.
  [T.ArmorPiercingAmmo]: { chassis: 'rounds', variant: 'ap', casing: '#C9962E' },
  // Incendiary wears burn-copper: the whole cartridge is the
  // fire color, flame-flicker tips on top (painter).
  [T.IncendiaryAmmo]: { chassis: 'rounds', variant: 'flame', casing: '#C05A1E' },
  [T.ShockAmmo]: { chassis: 'rounds', variant: 'row', casing: '#7E97A8' },
  [T.CorrosiveAmmo]: { chassis: 'rounds', variant: 'acid', casing: '#77873A' },
  [T.CryoAmmo]: { chassis: 'rounds', variant: 'frost', casing: '#B9CDD4' },
  // The coatings: deep violet pot vs pale iridescent pot.
  [T.ElementalCoating]: { chassis: 'rounds', variant: 'coat', body: '#4A3560' },
  [T.PrismCoating]: {
    chassis: 'rounds', variant: 'coatPrism', body: '#A99BC0',
    extras: ['#59E3FF', '#FF6AD5', '#B6F34C'],
  },
  // — ordnance —
  // The plain frag goes olive-drab — standard-issue steel — so
  // the brass demo charge below owns the warm metal read.
  [T.Grenade]: { chassis: 'grenade', variant: 'charge', body: '#5A6142' },
  [T.OrdnanceCharge]: { chassis: 'grenade', variant: 'chargePro', body: '#B97A28' },
  [T.EMPCharge]: { chassis: 'grenade', variant: 'emp', body: '#3E4A52' },
  [T.CorrosiveCharge]: { chassis: 'grenade', variant: 'acid', body: '#46603A' },
  [T.PhaseShiftGrenade]: { chassis: 'grenade', variant: 'phase', body: '#4B3866' },
  [T.MagnetizedPayload]: { chassis: 'grenade', variant: 'magnet', body: '#5B6B7A' },
  // Forgeheart is charcoal with the forge showing through the
  // cracks (painter) — its orange is a glow, not a paint job.
  [T.ForgeheartCharge]: { chassis: 'grenade', variant: 'forge', body: '#33302E' },
  // — tactical —
  [T.TargetPainter]: { chassis: 'scanner', variant: 'painter', body: '#53383A' },
  // The two cyan scanners split on value: the boss scanner is a
  // pale survey instrument, the jammer a charcoal stealth box.
  [T.BossScanner]: { chassis: 'scanner', variant: 'scanner', body: '#B9C4C6' },
  [T.Jammer]: { chassis: 'scanner', variant: 'jammer', body: '#2F363B' },
  [T.SignalScrambler]: { chassis: 'scanner', variant: 'scrambler', body: '#3A5A8C' },
  [T.ThrowTechDecoyKit]: { chassis: 'beacon', variant: 'decoy', body: '#3A3F45' },
  [T.HeartwoodSightOil]: { chassis: 'vial', variant: 'oil', body: '#3E4A38' },
  // — economy —
  // The amber market goods stand on charcoal: the amber element
  // (dish, star) is the read, not an amber wash over the stand.
  [T.LootBeacon]: { chassis: 'beacon', variant: 'dish', body: '#3A3630' },
  [T.LuckBooster]: { chassis: 'beacon', variant: 'star', body: '#3A3630' },
  [T.InsuranceToken]: { chassis: 'contract', variant: 'token', body: '#D8C9A3' },
  [T.SalvageContract]: { chassis: 'contract', variant: 'form', body: '#CFC8B4' },
  [T.DataSkimmer]: { chassis: 'scanner', variant: 'skimmer', body: '#41474E' },
  // The two blue tickets split on value: rush is saturated card
  // stock, the calibration card is clinical pale.
  [T.WorkshopRushTicket]: { chassis: 'ticket', variant: 'ticket', body: '#3E6FB4' },
  [T.HelixCalibrationKit]: { chassis: 'ticket', variant: 'calib', body: '#D8DDE2' },
  // Fuel is a hazard-yellow drum in the real world; the crafted
  // cell is the pale premium canister beside it.
  [T.GenericFuelCell]: { chassis: 'cell', variant: 'drum', body: '#D9A514' },
  [T.FuelCell]: { chassis: 'cell', variant: 'cellPro', body: '#9AA0A3' },
  // The patch family: rust salve tin / worn field glass / dark
  // premium glass with brass — three browns no longer, three
  // values and three finishes.
  [T.PatchKit]: { chassis: 'vial', variant: 'tin', body: '#8A3B22' },
  [T.FieldPatchKit]: { chassis: 'vial', variant: 'field', body: '#7A5A38' },
  [T.MasterPatchKit]: { chassis: 'vial', variant: 'master', body: '#3E2C1E' },
  [T.CalibrationCore]: { chassis: 'cell', variant: 'core', body: '#546E73' },
  // — corrupted —
  [T.VoidAmmo]: { chassis: 'rounds', variant: 'row', casing: '#3A2E4A' },
  [T.OverchargeStim]: { chassis: 'syringe', variant: 'overcharge', body: '#3A3044' },
  [T.RedlineTonic]: { chassis: 'syringe', variant: 'tonic', body: '#33383E' },
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
/* Ramps — the shared small-item core (S4): the five-tone builder,    */
/* the plate, the seeded helpers, the finish pass, the thumb ground   */
/* row, the cache, and the painter all live in smallItemCore.ts now.  */
/* What stays here is consumables' own: the art table, the motif      */
/* system, the frame treatments, the painters, the colorways.         */
/* ------------------------------------------------------------------ */

/** Shade alphabet: D/d/P/p/L = body ramp deep→hot, A/a/E = contents
 *  ramp dark/base/lite, K = warm near-black outline, S = ground
 *  shadow, W = hard white, B/b = brass (market trim, premium
 *  fittings), M/m = casing metal ramp (the rounds' per-item
 *  colorway metal, pass 2), X/Y/Z = raw extra hexes (Prism flecks). */
// '.' is the empty/erase cell: grids initialize to it, filled() means
// !== '.', and set(x, y, '.') punches a cell back out (ticket corners,
// edge chips). It carries no color — palette maps are Partial and
// never consulted for it.
export type ConsShade = 'K' | 'S' | 'W' | 'D' | 'd' | 'P' | 'p' | 'L' | 'A' | 'a' | 'E' | 'B' | 'b' | 'M' | 'm' | 'X' | 'Y' | 'Z' | '.';

type R = RampShades;
type A = AccentShades;

const BRASS = '#C9962E';

type ConsPlate = SmallItemPlate;
type Pt = [number, number];

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

const WEAR: Record<ConsFrame, SmallItemWear> = {
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

/* toneNoise + finishPass are the shared core's now (smallItemCore):
 * the frame's WEAR profile supplies { chipP, scratches, noise }. */

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
    // Pass 2: the pass-1 kits were two pale boxes with a 13-texel
    // cross — near-colorless (6% saturated texels). The identity
    // band under the lid + a full-size cross make medical green
    // the read; the refined kit wears the band in brass instead.
    cv.rect(6, y0 + 1, 12, 1, variant === 'kit' ? 'a' : 'B');
    {
      const cy = y0 + 6;
      for (let d = -3; d <= 3; d++) { cv.set(11, cy + d, A.base); cv.set(11 + d, cy, A.base); }
      cv.set(11, cy, A.hot);
    }
    cv.set(7, y0 + 1, 'L'); cv.set(16, y0 + 1, 'L'); // latches
    if (variant === 'kitPro') { cv.rect(5, 19, 14, 1, 'B'); cv.set(12, y0 + 6, A.hot); }
    return;
  }
  if (variant === 'tin') {
    // Patch Kit: a flat salve tin, lid seam across the top, the
    // contents stripe under the seam (pass 2 — the tin's cross
    // alone was 6% of the render and the rust read as gold bars).
    cv.rect(5, 13, 14, 2, 'd');
    cv.rect(5, 13, 14, 1, 'p');
    cv.rect(5, 14, 14, 1, 'a');
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
    cv.rect(6, 15, 12, 1, 'B'); // brass label strap over the glass
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
    // Pass 2: the pass-1 core was a gray ring with a 6%-of-render
    // diamond — a halo of hot contents light makes the core glow.
    cv.ellipseRing(12, 11, 2.9, 2.9, 1, 'E');
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
  if (pro) {
    for (const y of [9, 17]) cv.rect(7, y, 10, 1, 'd'); // slat bands
    cv.rect(7, 18, 10, 1, 'a'); // contents stripe over the baseplate
  }
};

const paintRounds: Painter = (cv, R, A, variant, _icon, rng) => {
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
    if (variant === 'coat') {
      // Elemental: the pool is unsettled — a hot swirl turning
      // through the base coat (texture split from Prism's flecks).
      cv.set(11, 18, A.hot); cv.set(12, 18, A.hot); cv.set(13, 19, A.hot);
      cv.set(14, 18, 'E'); cv.set(10, 19, 'E');
    }
    if (variant === 'coatPrism') {
      // Prismatic flecks — the one multi-hue item in the family,
      // in its own raw hexes (X/Y/Z): cyan, magenta, lime, white.
      cv.set(10, 18, 'X'); cv.set(13, 19, 'Y'); cv.set(15, 18, 'Z');
      cv.set(12, 17, 'W'); cv.set(16, 19, 'X'); cv.set(11, 19, 'Y');
      cv.set(14, 17, 'Z'); cv.set(9, 18, 'W'); cv.set(15, 15, 'X');
    }
    return;
  }
  // Loose rounds: four standing cartridges. Pass 2 — the CASING
  // is the element's metal (M/m ramp, per-item colorway), so the
  // Borderlands element code is the body of the object, not a
  // tint on the tip of a brass tube.
  [4, 9, 14, 19].forEach((x, i) => {
    if (variant === 'ap') {
      // Armor-Piercing: dark steel penetrator tips — the one
      // round whose tip is NOT its element color, over brass.
      cv.set(x + 1, 6, 'K');
      cv.rect(x + 1, 7, 2, 2, 'd');
      cv.rect(x, 9, 4, 2, 'a'); // shoulder in the contents dark
    } else {
      cv.set(x + 1, 6, A.hot); // tip point
      cv.rect(x + 1, 7, 2, 2, A.base);
      cv.rect(x, 9, 4, 2, A.base); // shoulder
      if (variant === 'flame') {
        // Incendiary: the tips are lit — flicker texels licking
        // off alternating cartridges.
        if (i % 2 === 0) { cv.set(x + 1, 5, 'E'); cv.set(x + 2, 5, A.base); }
        else { cv.set(x + 1, 5, A.base); cv.set(x, 5, 'E'); }
      }
    }
    cv.rect(x, 11, 4, 1, 'a'); // band
    cv.rect(x, 12, 4, 8, 'M'); // casing in the colorway metal
    cv.rect(x, 12, 1, 8, 'm');
    cv.rect(x, 19, 4, 1, 'm');
    if (variant === 'acid') {
      // Corrosive: the casings themselves are pitted by the fill.
      for (let k = 0; k < 3; k++) cv.set(x + rint(rng, 1, 3), rint(rng, 13, 18), 'a');
    }
    if (variant === 'frost') {
      // Cryo: frost dusting settles on the casing tops.
      cv.set(x + 1, 12, 'W'); cv.set(x + 3, 13, 'W'); cv.set(x + 2, 12, 'E');
    }
    cv.set(x + 1, 20, 'K'); // primer
  });
  cv.rect(3, 20, 20, 1, 'd'); // the tray line they stand on
};

const paintGrenade: Painter = (cv, R, A, variant, icon, rng) => {
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
  // Equator band in the contents colors — bright over dark, so
  // the identity hue reads as a stripe, not a shadow (pass 2).
  cv.rect(4, 13, 17, 1, A.base);
  cv.rect(4, 14, 17, 1, 'a');
  if (variant === 'emp') {
    cv.rect(9, 5, 7, 3, 'd'); // flat top housing
    cv.rect(10, 8, 5, 2, A.base);
    cv.set(12, 9, A.hot);
    cv.rect(6, 11, 13, 1, 'a'); cv.set(12, 11, 'E'); // charge seam glowing through the shell
  }
  if (variant === 'acid') {
    cv.set(11, 8, A.base); cv.set(11, 9, A.base); cv.set(10, 10, A.hot); // corrosive weep
    cv.set(8, 16, 'a'); cv.set(15, 17, 'a'); cv.set(9, 18, 'a'); // pitting
  }
  if (variant === 'forge') {
    // Molten cracks: the forge shows through the charcoal shell
    // in short jagged seams of contents color, hot at the core.
    for (let c = 0; c < 4; c++) {
      let x = rint(rng, 7, 16); let y = rint(rng, 9, 12);
      const len = rint(rng, 2, 4);
      for (let k = 0; k < len; k++) {
        if (cv.get(x, y) === 'P') cv.set(x, y, k === 1 ? 'E' : A.base);
        x += rng() < 0.5 ? 0 : 1; y += 1;
      }
    }
  }
  if (variant === 'phase') {
    // The ghost: the same body, twice-struck, offset in deep shade.
    cv.ellipse(15, 12, 6.8, 6.2, 'D');
    cv.ellipse(12, 14, 7.6, 6.8, 'P');
    cv.rect(4, 13, 17, 1, A.base);
    cv.rect(4, 14, 17, 1, 'a');
  }
  paintMotif(cv, icon, 12, 17, A);
};

const paintScanner: Painter = (cv, R, A, variant, icon, rng) => {
  const twin = variant === 'jammer';
  cv.rect(15, 3, 2, 5, 'd'); cv.set(15, 2, A.hot); // antenna
  if (twin) { cv.rect(8, 4, 2, 4, 'd'); cv.set(8, 3, A.hot); }
  cv.rect(7, 7, 11, 14, 'P');
  cv.rect(7, 7, 11, 1, 'p');
  cv.rect(9, 9, 7, 6, 'a'); // screen, dark glass
  paintMotif(cv, icon, 12, 12, A);
  if (variant === 'scanner') {
    // The boss scanner's screen is LIT — hot glass edges on the
    // pale survey housing (texture split from the jammer below).
    for (const y of [10, 11, 12, 13]) { cv.set(9, y, 'E'); cv.set(15, y, 'E'); }
  }
  if (twin) {
    // The jammer's screen is static — interference scatter over
    // the waves, matte and broken where the scanner is clean.
    for (let k = 0; k < 12; k++) {
      cv.set(rint(rng, 10, 14), rint(rng, 10, 13), choice(rng, [A.base, 'a', 'E'] as const));
    }
  }
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
    cv.ellipse(12, 8, 2.2, 2.6, A.base); // head
    cv.rect(10, 11, 5, 1, A.base);
    cv.rect(9, 13, 7, 1, A.hot); // shoulders
    cv.set(12, 8, A.hot);
    // Holo scanlines: alternate rows of the projection fall dark
    // (pass 2 texture — the pawn is light, not a solid object).
    for (const y of [7, 9, 11]) {
      for (let x = 9; x <= 15; x++) if (cv.get(x, y) === A.base) cv.set(x, y, 'a');
    }
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
      // The identity band survives at thumb size (brass on the
      // refined kit, contents-dark on the base kit and the tin).
      cv.rect(2, 6, 8, 1, variant === 'kitPro' ? 'B' : 'a');
      if (variant === 'tin') {
        // S4: the tin's cross was contents-base on rust and died at
        // 48px — it rides in the contents' hot tone now, white-hot
        // at the core, so the patch identity survives the thumb.
        cv.set(6, 7, A.hot); cv.set(6, 8, 'W'); cv.set(5, 8, A.hot); cv.set(7, 8, A.hot); cv.set(6, 9, A.hot);
      } else {
        cv.set(6, 7, A.base); cv.set(6, 8, A.base); cv.set(5, 8, A.base); cv.set(7, 8, A.base); cv.set(6, 9, A.hot);
      }
      return;
    }
    // S4: the field and master patch bottles were anonymous brown
    // bottles at thumb — both now carry the patch cross on the
    // glass, and the master adds its brass collar + base strap
    // (the same marks its object painter wears).
    cv.rect(5, 2, 3, 2, variant === 'master' ? 'B' : 'd');
    cv.rect(4, 4, 5, 7, 'P');
    cv.rect(4, 8, 5, 3, A.base);
    if (variant === 'field' || variant === 'master') {
      cv.set(6, 5, A.hot); cv.set(5, 6, A.hot); cv.set(6, 6, 'W'); cv.set(7, 6, A.hot); cv.set(6, 7, A.hot);
      if (variant === 'master') cv.rect(4, 10, 5, 1, 'B');
    } else {
      cv.set(6, 6, A.hot);
    }
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
  syringe: (cv, R, A, variant) => {
    if (variant === 'stim') {
      // S4: AdrenalineShot's dose was 3 cells of red on a dark
      // red-brown barrel — it scanned as a bottle with a nub. The
      // stim painter is the wide barrel (its object form): dose at
      // full barrel width under a hot meniscus line reads as an
      // injector at 48px.
      cv.rect(4, 1, 5, 1, 'P');
      cv.rect(4, 3, 5, 7, 'P');
      cv.rect(4, 6, 5, 1, A.hot);
      cv.rect(4, 7, 5, 3, A.base);
      cv.set(6, 10, 'K'); cv.set(6, 11, 'K');
      return;
    }
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
      if (variant === 'coatPrism') {
        // S4: Prism's defining flecks (X/Y/Z) never reached the
        // thumb — the pot read as plain lavender. A 2-cell cluster
        // per hue on the pot's face keeps the fleck read at 48px
        // (clusters, per the craft standard — never lone cells).
        cv.set(5, 6, 'X'); cv.set(6, 6, 'X');
        cv.set(8, 7, 'Y'); cv.set(8, 8, 'Y');
        cv.set(5, 8, 'Z'); cv.set(6, 8, 'Z');
      }
      return;
    }
    for (const x of [3, 6, 9]) {
      cv.set(x, 2, A.hot);
      cv.rect(x, 3, 2, 2, A.base);
      cv.rect(x - 1, 5, 3, 6, 'M'); // casing metal, as the object grid
    }
  },
  grenade: (cv, R, A, variant) => {
    // S4 form pass: one stamp served all seven charges and members
    // separated on color alone. Each charge now carries its 24×24
    // form at thumb: ring, horseshoe, ghost, crack, reticle, brass
    // band — the plain frag keeps the original stamp as baseline.
    if (variant === 'magnet') {
      // The horseshoe rides on top of the body; pole faces lit.
      cv.rect(3, 2, 2, 3, A.base); cv.rect(8, 2, 2, 3, A.base);
      cv.rect(3, 2, 7, 2, A.base);
      cv.set(3, 4, A.hot); cv.set(4, 4, A.hot); cv.set(8, 4, A.hot); cv.set(9, 4, A.hot);
      cv.ellipse(6, 8, 3.4, 2.8, 'P');
      cv.set(6, 8, A.hot);
      return;
    }
    if (variant === 'emp') {
      // The ring IS the body, core glowing through the middle.
      cv.rect(5, 1, 3, 2, 'd');
      cv.ellipseRing(6, 7, 3.4, 3.2, 1, 'P');
      cv.set(6, 6, A.base); cv.set(5, 7, A.base); cv.set(6, 7, A.hot); cv.set(7, 7, A.base); cv.set(6, 8, A.base);
      return;
    }
    if (variant === 'phase') {
      // The ghost: the same body struck twice, offset.
      cv.rect(6, 1, 3, 2, 'd');
      cv.ellipse(8, 5, 2.8, 2.8, 'D');
      cv.ellipse(5, 7, 3.2, 3.2, 'P');
      cv.rect(2, 6, 7, 1, 'a');
      cv.set(5, 7, A.hot);
      return;
    }
    cv.rect(5, 2, 3, 2, 'd');
    cv.ellipse(6, 7, 3.4, 3.2, 'P');
    if (variant === 'chargePro') {
      // The demo charge's brass band, carried at full width.
      cv.rect(3, 6, 7, 1, 'B');
      cv.rect(3, 7, 7, 1, 'b');
      cv.set(6, 9, A.hot);
    } else if (variant === 'acid') {
      // The reticle rides the shell (its object's acid sight).
      cv.set(6, 5, A.base); cv.set(5, 6, A.base); cv.set(6, 6, A.hot); cv.set(7, 6, A.base); cv.set(6, 7, A.base);
    } else if (variant === 'forge') {
      // Molten crack walking down the charcoal shell.
      cv.set(5, 4, A.hot); cv.set(5, 5, A.base); cv.set(6, 6, A.base); cv.set(6, 7, A.hot); cv.set(7, 8, A.base);
    } else {
      // charge — the plain frag keeps the baseline stamp.
      cv.rect(3, 6, 7, 1, 'a'); // contents band — identity at thumb size too
      cv.set(6, 8, A.hot);
    }
  },
  scanner: (cv, R, A, variant) => {
    // S4 form pass: one box + screen + antenna stamp served all
    // five devices. Silhouettes now differ the way the 24×24
    // painters differ — whip antenna, lit screen, twin-antenna
    // block, emission ticks, skimmer dish.
    if (variant === 'skimmer') {
      // The dish rides on top; the box drops a row to carry it.
      cv.ellipse(6, 2, 2.8, 1.3, A.base);
      cv.set(6, 1, A.hot);
      cv.rect(6, 3, 1, 1, 'd');
      cv.rect(3, 4, 7, 7, 'P');
      cv.rect(4, 5, 5, 3, 'a');
      cv.set(6, 6, A.hot);
      cv.rect(4, 9, 1, 2, 'd'); cv.rect(6, 9, 1, 2, 'd');
      return;
    }
    if (variant === 'painter') {
      cv.set(2, 1, A.hot); cv.rect(2, 2, 1, 2, 'd'); // the long whip
    } else {
      cv.set(9, 1, A.hot); cv.rect(9, 2, 1, 2, 'd');
    }
    if (variant === 'jammer') {
      cv.set(3, 1, A.hot); cv.rect(3, 2, 1, 2, 'd'); // twin antenna
      cv.rect(2, 3, 8, 8, 'P'); // the blockier housing
      cv.rect(3, 4, 6, 3, 'a');
      cv.set(4, 5, A.base); cv.set(5, 5, A.base); cv.set(7, 4, A.hot); // static
      cv.rect(3, 8, 1, 2, 'd'); cv.rect(5, 8, 1, 2, 'd'); cv.rect(7, 8, 1, 2, 'd');
      return;
    }
    cv.rect(3, 3, 7, 8, 'P');
    if (variant === 'scanner') {
      cv.rect(4, 4, 5, 3, A.base); // the LIT screen (pale survey glass)
      cv.set(6, 5, A.hot);
    } else {
      cv.rect(4, 4, 5, 3, 'a');
      cv.set(6, 5, A.hot);
    }
    if (variant === 'painter') {
      cv.set(5, 5, A.base); cv.set(7, 5, A.base); // reticle ticks on the screen
    }
    if (variant === 'scrambler') {
      cv.set(10, 2, A.base); cv.set(11, 3, A.hot); // broken emission
    }
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
  ticket: (cv, R, A, variant) => {
    cv.rect(1, 4, 10, 5, 'P');
    cv.set(4, 5, 'K'); cv.set(4, 7, 'K');
    if (variant === 'calib') {
      // S4: the calibration kit was a blank pale slab at thumb —
      // its dial now rides the ticket the way it does at 24×24:
      // a ring in the contents base, hot at the center, with the
      // stub tick beside the perforation.
      cv.ellipseRing(8, 6, 1.7, 1.7, 1, A.base);
      cv.set(8, 6, A.hot);
      cv.set(2, 6, A.base);
      return;
    }
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
  // Pass 2: the body is the row's pinned colorway material. The
  // fallback derivation survives only for unlisted future types,
  // and even it no longer drains the accent halfway to gray.
  const bodyHex = row.body ?? hueLerp(accentHex, '#4A443C', 0.30);
  const frame: ConsFrame = def?.visual.frame ?? 'standard';
  const icon = def?.visual.icon ?? 'dot';

  const body = fiveToneRamp(bodyHex);
  const contents = fiveToneRamp(accentHex);
  const brass = fiveToneRamp(BRASS);
  const casing = fiveToneRamp(row.casing ?? BRASS);
  const colors: Partial<Record<ConsShade, string>> = {
    K: OUTLINE_HEX,
    S: GROUND_SHADOW_HEX,
    W: HARD_WHITE_HEX,
    D: body.deep, d: body.shade, P: body.base, p: body.lite, L: body.hot,
    A: contents.base, a: accentDark(accentHex), E: contents.lite,
    B: brass.base, b: brass.shade,
    M: casing.base, m: casing.shade,
    X: row.extras?.[0], Y: row.extras?.[1], Z: row.extras?.[2],
  };

  const grid = density === 'object' ? 24 : 12;
  const plate = new SmallItemPlate(grid);
  const rng = seededRandom(hashString(density === 'object' ? `cons:${id}` : `cons:${id}:thumb`));
  if (density === 'object') {
    OBJECT_PAINTERS[row.chassis](plate, RAMP_SHADES, ACCENT_SHADES, row.variant, icon, rng);
    frameTreatment(plate, frame);
    toneNoise(plate, WEAR[frame].noise, rng);
    finishPass(plate, WEAR[frame], rng);
    // Signal arcs ride antenna'd chassis only — over a grenade body
    // they detach and read as confetti (contact-sheet verdict).
    if (row.chassis !== 'grenade') signalArcs(plate, frame, ACCENT_SHADES);
  } else {
    THUMB_PAINTERS[row.chassis](plate, RAMP_SHADES, ACCENT_SHADES, row.variant, icon);
    thumbGroundRow(plate);
  }

  const rows = plate.rows();
  const signature = hashString(
    `consumable-${density}|${id}|${row.chassis}|${row.variant}|${frame}|${rows.join('/')}`,
  ).toString(16);
  return { width: grid, height: grid, rows, colors, signature, density, id };
}

const consumableCache = new Map<string, ConsumableRender>();

/** Cached compose. Input-keyed since S4 (the shared core helper):
 *  the old signature-keyed lookup composed in full before every
 *  check, so it never hit — composeConsumable is a pure function
 *  of (id, density), so the pair is an exact key. */
export function composeConsumableCached(id: string, density: ConsumableDensity = 'object'): ConsumableRender {
  return smallItemCached(consumableCache, `${density}|${id}`, () => composeConsumable(id, density));
}

/** Paint a consumable render into a 2D context at integer scale. */
export function paintConsumable(
  ctx2d: CanvasRenderingContext2D,
  render: ConsumableRender,
  scale: number,
): void {
  paintSmallItemRows(ctx2d, render.rows, render.colors, render.width, render.height, scale);
}
