import type { Shield } from '@/types/items';
import { shieldBehaviorOf, type ShieldBehaviorId } from '@/lib/combat/shieldBehaviors';
import {
  GEAR_CARD_PLATES,
  defaultGearInput,
  type GearCanvas,
  type GearComposeInput,
  type GearGrammar,
} from './gearCardCompositor';

/**
 * Shield grammar — gear marriage, slice 1. The shield's silhouette
 * family is its rolled BEHAVIOR (the audit's verdict, §4.1): the
 * old SVG picked a family by element × coin flip and never showed
 * the trait that defines how the shield plays. Five data rows —
 * Standard / Nova / Absorb / Amp / Turtle — painted through the
 * shared plate core (gearCardCompositor): element = full-body
 * colorway from ELEMENT_VISUALS ramps, rarity = the core frame,
 * pixelSeed = deterministic panel/vent variation, affixes = the
 * core socket row.
 *
 * Fidelity register: the owner-approved v3 plates
 * (cybercache-prep/gear-marriage-samples/v3) — production forms
 * are those plates' siblings on the same grid, with the two
 * review fixes carried in: Nova's burst reads as overlapping
 * armored SHUTTER plates (tangential slats around the core), not
 * radial pinwheel wedges; and every family's footprint fills its
 * plate the way weapons fill theirs.
 *
 * Painters compose in body-relative fractions, so the same row
 * paints the card plate (240×140) and the thumb grid (60×35,
 * detail level 0 — the core's detail kit is structurally silent
 * there). Form never branches on rarity: rarity is frame +
 * finish only, exactly as the core contract pins.
 */

/* ------------------------------------------------------------------ */
/* Layout frame — body-relative coordinates                            */
/* ------------------------------------------------------------------ */

interface Frame {
  x: (f: number) => number;
  y: (f: number) => number;
  w: (f: number) => number;
  h: (f: number) => number;
  cx: number;
  cy: number;
  /** The smaller body dimension — radius yardstick. */
  min: number;
}

function frameOf(canvas: GearCanvas): Frame {
  const b = canvas.body;
  return {
    x: (f) => b.x + Math.round(b.w * f),
    y: (f) => b.y + Math.round(b.h * f),
    w: (f) => Math.max(1, Math.round(b.w * f)),
    h: (f) => Math.max(1, Math.round(b.h * f)),
    cx: b.x + Math.floor(b.w / 2),
    cy: b.y + Math.floor(b.h / 2),
    min: Math.min(b.w, b.h),
  };
}

/* ------------------------------------------------------------------ */
/* Shared furniture — footer hardware every family carries             */
/* ------------------------------------------------------------------ */

/**
 * The footer: an element chip in the v3 tab's seat (bottom-left;
 * a color block, no baked glyphs — the screens print the element
 * name, the plate carries the colorway) and the affix socket row
 * railed bottom-center. The rail is silhouette; the sockets are
 * the core detail kit (card only).
 */
function paintFooter(canvas: GearCanvas, input: GearComposeInput) {
  const F = frameOf(canvas);
  // Element chip.
  const chipX = F.x(0.012);
  const chipY = F.y(0.895);
  const chipW = F.w(0.058);
  const chipH = F.h(0.082);
  canvas.rect(chipX, chipY, chipW, chipH, 'c');
  canvas.rect(chipX + 1, chipY + 1, Math.max(1, chipW - 2), Math.max(1, chipH - 2), 'E');
  canvas.rect(chipX + 1, chipY + 1, Math.max(1, chipW - 2), 1, 'e');
  // Socket rail + pips (5 sockets — the affix ceiling).
  const railW = 29;
  const railX = F.cx - Math.floor(railW / 2);
  const railY = F.y(0.905);
  canvas.rect(railX, railY, railW, 7, 'k');
  canvas.rect(railX, railY, railW, 1, 'T');
  canvas.pipRow(F.cx - 11, railY + 2, input.pips ?? 0, 5);
  // The footer is a data surface (element chip + affix read):
  // the core wear ladder may never land on it (S3 floor 7).
  canvas.protect(chipX - 1, chipY - 1, chipW + 2, chipH + 2);
  canvas.protect(railX - 1, railY - 1, railW + 2, 9);
}

/* ------------------------------------------------------------------ */
/* STANDARD — balanced housing, top fins, hex emitter, side pods       */
/* ------------------------------------------------------------------ */

function paintStandard(canvas: GearCanvas, input: GearComposeInput) {
  const F = frameOf(canvas);
  const finCount = 4 + canvas.pick(3); // 4–6 fins, seed-varied
  const seamShift = canvas.pick(3);

  // Side pods (behind the housing) with lit slits.
  for (const px of [F.x(0.045), F.x(0.878)]) {
    const pw = F.w(0.077);
    canvas.rect(px, F.y(0.235), pw, F.h(0.485), 'd');
    canvas.rect(px, F.y(0.235), pw, F.h(0.07), 'P');
    const slitX = px + Math.floor(pw / 2) - 1;
    canvas.rect(slitX, F.y(0.315), 2, F.h(0.325), 'E');
    canvas.set(slitX, F.y(0.465), 'W');
  }

  // Housing — its full-width light/shade bands now break at
  // jittered boundaries (S3-4, the core brokenBands move).
  const hx0 = F.x(0.155);
  const hx1 = F.x(0.845);
  const hy0 = F.y(0.125);
  const hy1 = F.y(0.79);
  canvas.brokenBands(hx0, hy0, hx1 - hx0, hy1 - hy0, 'p', 'P', 'd', 0.07, 0.87);
  canvas.rect(hx0, hy0, 1, hy1 - hy0, 'd');
  canvas.rect(hx1 - 1, hy0, 1, hy1 - hy0, 'd');

  // Top fins.
  const finW = F.w(0.028);
  const finSpan = F.w(0.36);
  const finStart = F.cx - Math.floor(finSpan / 2);
  for (let i = 0; i < finCount; i++) {
    const fx = finCount === 1 ? finStart : finStart + Math.round((finSpan - finW) * (i / (finCount - 1)));
    canvas.rect(fx, F.y(0.03), finW, F.h(0.095), 'd');
    canvas.rect(fx, F.y(0.03), finW, Math.max(1, F.h(0.028)), 'p');
  }

  // Hex emitter — stepped concentric hexagons, hard-edged glow.
  const coreY = F.y(0.455);
  const r = Math.max(3, Math.round(F.min * 0.163));
  const hex = (rad: number): [number, number][] => {
    const dy = Math.round(rad * 0.87);
    const hx = Math.round(rad / 2);
    return [
      [F.cx - rad, coreY], [F.cx - hx, coreY - dy], [F.cx + hx, coreY - dy],
      [F.cx + rad, coreY], [F.cx + hx, coreY + dy], [F.cx - hx, coreY + dy],
    ];
  };
  canvas.poly(hex(r), 'K');
  canvas.poly(hex(Math.round(r * 0.84)), 'c');
  canvas.poly(hex(Math.round(r * 0.62)), 'p');
  canvas.poly(hex(Math.round(r * 0.4)), 'E');
  const cw = r >= 8 ? 2 : 1;
  canvas.rect(F.cx - Math.floor(cw / 2), coreY - Math.floor(cw / 2), cw, cw, 'W');
  if (r >= 8) {
    for (const [dx, dy] of [[-0.8, -0.55], [0.8, -0.55], [-0.8, 0.55], [0.8, 0.55]] as const) {
      canvas.set(F.cx + Math.round(r * dx), coreY + Math.round(r * dy), 'L');
    }
  }

  // Pale panel block (the weapons' panel language), right of core.
  const pbX = F.x(0.655) + seamShift;
  canvas.rect(pbX, F.y(0.255), F.w(0.135), F.h(0.205), 'p');
  canvas.rect(pbX + F.w(0.135) - 1, F.y(0.255), 1, F.h(0.205), 'D');
  canvas.rect(pbX, F.y(0.255) + F.h(0.205) - 1, F.w(0.135), 1, 'D');

  // Detail kit.
  canvas.seam(F.x(0.375), F.y(0.175), F.x(0.375), F.y(0.695));
  canvas.seam(F.x(0.625), F.y(0.175), F.x(0.625), F.y(0.695));
  canvas.rivet(hx0 + 2, hy0 + 2);
  canvas.rivet(hx1 - 4, hy0 + 2);
  canvas.rivet(hx0 + 2, hy1 - 3);
  // Vent runs with cluster spacing and one dead slit (S3-4).
  canvas.ventsBroken(F.x(0.195), F.y(0.615), 4);
  canvas.ventsBroken(F.x(0.72), F.y(0.615), 4);
  canvas.chip(hx1 - 2, hy1 - 2);
  paintFooter(canvas, input);
}

/* ------------------------------------------------------------------ */
/* NOVA — shutter ring around a stepped core, vented back plate        */
/* ------------------------------------------------------------------ */

function paintNova(canvas: GearCanvas, input: GearComposeInput) {
  const F = frameOf(canvas);
  const seamShift = canvas.pick(4);
  const coreY = F.y(0.475);
  const R = Math.max(5, Math.round(F.min * 0.27));
  const T = Math.max(2, Math.round(R * 0.5));

  // Back plate — dark hot metal under the burst assembly; its
  // band boundaries break per column now (S3-4). The region
  // reaches the old foot strip's bottom edge: at thumb scale
  // that strip rounded one row BELOW the plate rect, and the
  // region must cover it or the row is silently lost.
  canvas.brokenBands(
    F.x(0.075), F.y(0.145), F.w(0.85),
    F.y(0.775) + F.h(0.03) - F.y(0.145),
    'P', 'd', 'D', 0.05, 0.95,
  );

  // Side pods straddling the plate edges, banded, with lit dots.
  for (const px of [F.x(0.018), F.x(0.907)]) {
    const pw = F.w(0.075);
    canvas.rect(px, F.y(0.245), pw, F.h(0.50), 'P');
    canvas.rect(px, F.y(0.375), pw, Math.max(1, F.h(0.022)), 'p');
    canvas.rect(px, F.y(0.545), pw, Math.max(1, F.h(0.022)), 'p');
    canvas.rect(px + Math.floor(pw / 2) - 1, F.y(0.425), 2, F.h(0.075), 'K');
    canvas.set(px + Math.floor(pw / 2) - 1, F.y(0.455), 'e');
  }

  // Shoulder vents — chunky slits with accent hearts (silhouette
  // scale, the v3 shoulder language).
  for (const vx of [F.x(0.135), F.x(0.755)]) {
    const vw = F.w(0.085);
    for (const vy of [F.y(0.235), F.y(0.325), F.y(0.415)]) {
      canvas.rect(vx, vy, vw, Math.max(2, F.h(0.026)), 'K');
      canvas.rect(vx + Math.round(vw * 0.18), vy + Math.floor(Math.max(2, F.h(0.026)) / 2), Math.round(vw * 0.64), 1, 'e');
    }
  }

  // Assembly backing ring (gaps between slats read as housing).
  canvas.ring(F.cx, coreY, R - Math.round(T * 0.4), R + Math.round(T * 0.62), 'D');

  // Eight shutter plates — long tangential slats, overlapping in
  // draw order like a blast aperture. Alternating tones give the
  // overlap rhythm; a pale outer edge + dark inner seam + bolt
  // finish each slat as a separate armored plate.
  const L = Math.round(R * 1.32);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = F.cx + dx * R;
    const py = coreY + dy * R;
    const tx = -dy;
    const ty = dx;
    const hl = L / 2;
    const ht = T / 2;
    const corners: [number, number][] = [
      [Math.round(px + tx * hl + dx * ht), Math.round(py + ty * hl + dy * ht)],
      [Math.round(px - tx * hl + dx * ht), Math.round(py - ty * hl + dy * ht)],
      [Math.round(px - tx * hl - dx * ht), Math.round(py - ty * hl - dy * ht)],
      [Math.round(px + tx * hl - dx * ht), Math.round(py + ty * hl - dy * ht)],
    ];
    canvas.poly(corners, k % 2 === 0 ? 'P' : 'd');
    // Pale outer edge (the slat's exposed rim).
    canvas.slope(corners[0][0], corners[0][1], corners[1][0], corners[1][1], 'p');
    // Inner-edge seam (the slat's leading edge) + bolt.
    canvas.seam(corners[2][0], corners[2][1], corners[3][0], corners[3][1]);
    if (canvas.detailLevel > 0) {
      canvas.set(Math.round(px), Math.round(py), 'k');
      canvas.set(Math.round(px - dy), Math.round(py + dx), 'L');
    }
  }

  // Stepped core — hard-edged concentric glow.
  canvas.disc(F.cx, coreY, Math.round(R * 0.52), 'P');
  canvas.disc(F.cx, coreY, Math.round(R * 0.38), 'E');
  canvas.disc(F.cx, coreY, Math.round(R * 0.24), 'e');
  const cw = R >= 10 ? 2 : 1;
  canvas.rect(F.cx - Math.floor(cw / 2), coreY - Math.floor(cw / 2), cw, cw, 'W');
  for (const [dx, dy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]] as const) {
    canvas.set(F.cx + Math.round(R * 0.68 * dx), coreY + Math.round(R * 0.68 * dy), 'e');
  }

  // Detail kit: back-plate seams; the scorch wear is one seeded
  // cluster at the plate's foot, not four metronome chips (S3-4).
  canvas.seam(F.x(0.295) + seamShift, F.y(0.19), F.x(0.295) + seamShift, F.y(0.775));
  canvas.seam(F.x(0.705) - seamShift, F.y(0.19), F.x(0.705) - seamShift, F.y(0.775));
  const scorchX = F.x(0.28) + canvas.pick(Math.max(1, F.w(0.38)));
  canvas.clusterWear(scorchX, F.y(0.79), 7, { bite: true });
  canvas.clusterWear(scorchX + F.w(0.06), F.y(0.795), 4);
  paintFooter(canvas, input);
}

/* ------------------------------------------------------------------ */
/* ABSORB — shell plates around a seated core, shell stacks            */
/*                                                                     */
/* S3-3 register fix: Absorb was the plate engine's one glossy         */
/* object — mirrored shell stacks, four sectors at exact 90°           */
/* spacing under a uniform pale rim band, and a core of two            */
/* perfect concentric discs (a radial falloff with a glint). It        */
/* now joins its siblings' register: a seated machine component.       */
/* The stacks draw per side (no mirror), the sectors take seeded       */
/* unequal spans with per-sector tones, rim light lands as             */
/* clusters on the lit side only, and the core sits off-center         */
/* in an irregular socket (the relic socketCore pattern). The          */
/* ring-of-shell-plates silhouette — the family's identity — is        */
/* unchanged, and the feed conduit, base block, struts, and            */
/* footer are untouched.                                               */
/* ------------------------------------------------------------------ */

function paintAbsorb(canvas: GearCanvas, input: GearComposeInput) {
  const F = frameOf(canvas);
  const arcShift = canvas.pick(30); // degrees of shell-plate rotation
  const coreY = F.y(0.465);
  const r = Math.max(5, Math.round(F.min * 0.30));

  // Side shell stacks — three stepped plates per side, drawn PER
  // SIDE from the stream: step depth, plate heights, vertical
  // placement, and tone phase all diverge (the mirror is dead).
  for (const side of [0, 1] as const) {
    const sx0 = side === 0 ? F.x(0.025) : F.x(0.815);
    const sw = F.w(0.16);
    const tonePhase = canvas.pick(2);
    for (let i = 0; i < 3; i++) {
      const py = F.y(0.185 + i * 0.20) + (canvas.pick(3) - 1) * Math.max(1, Math.round(F.h(0.012)));
      const ph = F.h(0.155) + (canvas.pick(3) - 1) * Math.max(1, Math.round(F.h(0.014)));
      const step = Math.round(ph * (0.24 + canvas.pick(3) * 0.06));
      // Local plate: full outer edge, stepped (chamfered) inner edge.
      const local: [number, number][] = [
        [0, 0], [sw - step, 0], [sw, step], [sw, ph - step], [sw - step, ph], [0, ph],
      ];
      const pts: [number, number][] = local.map(([u, v]) => [
        side === 0 ? sx0 + u : sx0 + (sw - u),
        py + v,
      ]);
      canvas.poly(pts, (i + tonePhase) % 2 === 0 ? 'P' : 'd');
      // The lit top edge as a jittered band, not a printed strip.
      canvas.bandJittered(sx0, py, sw, Math.max(1, Math.round(ph * 0.18)), 'p');
      canvas.rivet(side === 0 ? sx0 + 2 : sx0 + sw - 4, py + Math.round(ph / 2));
    }
  }

  // Struts tying the shell stacks into the orb housing.
  for (const [xa, xb] of [[F.x(0.185), F.cx - r - 2], [F.cx + r + 2, F.x(0.815)]] as const) {
    canvas.rect(xa, coreY - Math.max(1, F.h(0.02)), xb - xa, Math.max(2, F.h(0.04)), 'd');
    canvas.rect(xa, coreY - Math.max(1, F.h(0.02)), xb - xa, 1, 'p');
  }

  // Feed conduit + base block under the orb.
  canvas.rect(F.cx - F.w(0.026), F.y(0.615), F.w(0.052), F.h(0.23), 'd');
  canvas.rect(F.cx - 1, F.y(0.615), 2, F.h(0.23), 'E');
  canvas.rect(F.x(0.415), F.y(0.795), F.w(0.17), F.h(0.065), 'P');
  canvas.rect(F.x(0.415), F.y(0.795), F.w(0.17), Math.max(1, F.h(0.02)), 'p');

  // Orb assembly: deep field, then four shell PLATES — annulus
  // sectors with honest gaps between them — then the seated core.
  canvas.disc(F.cx, coreY, r, 'c');
  canvas.ring(F.cx, coreY, r * 0.70, r * 0.76, 'K');
  const sector = (a0: number, a1: number, rOut: number, rIn: number): [number, number][] => {
    const pts: [number, number][] = [];
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([Math.round(F.cx + Math.cos(a) * rOut), Math.round(coreY + Math.sin(a) * rOut)]);
    }
    for (let i = steps; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([Math.round(F.cx + Math.cos(a) * rIn), Math.round(coreY + Math.sin(a) * rIn)]);
    }
    return pts;
  };
  // Seeded unequal spans and gaps — the exact 90° rotation is
  // dead. Tones are drawn per sector (not strictly alternating),
  // rim light lands as CLUSTERS on the lit side only (top-left
  // light), and at card density one sector carries a chip bite.
  const biteSector = canvas.pick(4);
  let cursor = arcShift;
  for (let seg = 0; seg < 4; seg++) {
    const span = 46 + canvas.pick(20); // 46–65°
    const a0 = (cursor * Math.PI) / 180;
    const a1 = ((cursor + span) * Math.PI) / 180;
    canvas.poly(sector(a0, a1, r, r * 0.76), canvas.pick(2) === 0 ? 'P' : 'd');
    const mid = (a0 + a1) / 2;
    const litSide = Math.cos(mid) < 0.15 && Math.sin(mid) < 0.15; // up and/or left of center
    if (litSide) {
      // 1–3 short pale runs along the sector's outer edge.
      const runs = 1 + canvas.pick(3);
      for (let run = 0; run < runs; run++) {
        const t0 = 0.12 + canvas.next() * 0.6;
        const runLen = 2 + canvas.pick(3);
        for (let s = 0; s < runLen; s++) {
          const a = a0 + (a1 - a0) * Math.min(0.97, t0 + s * 0.045);
          canvas.set(Math.round(F.cx + Math.cos(a) * r * 0.965), Math.round(coreY + Math.sin(a) * r * 0.965), 'p');
        }
      }
    } else if (canvas.pick(3) === 0) {
      canvas.set(Math.round(F.cx + Math.cos(mid) * r * 0.965), Math.round(coreY + Math.sin(mid) * r * 0.965), 'p');
    }
    if (canvas.detailLevel > 0) {
      canvas.set(Math.round(F.cx + Math.cos(mid) * r * 0.85), Math.round(coreY + Math.sin(mid) * r * 0.85), 'k');
      if (seg === biteSector) {
        const ba = a0 + (a1 - a0) * 0.5;
        canvas.chip(Math.round(F.cx + Math.cos(ba) * r * 0.99), Math.round(coreY + Math.sin(ba) * r * 0.99));
      }
    }
    cursor += span + 24 + canvas.pick(14); // the gap takes the rest
  }

  // The core, SEATED — not displayed (the relic socketCore move):
  // an irregular dark socket with worn rim texels, the lit core
  // offset from center by a texel or two from the seed, its pale
  // step an off-center cluster rather than a full disc, and the
  // glint one hard cluster at the core's upper-left. The element
  // mass is unchanged; the sphere shading is gone.
  const offX = (canvas.pick(3) - 1) * Math.max(1, Math.round(r * 0.07));
  const offY = (canvas.pick(3) - 1) * Math.max(1, Math.round(r * 0.07));
  const coreX = F.cx + offX;
  const seatedY = coreY + offY;
  const socketR = Math.round(r * 0.62);
  canvas.disc(coreX, seatedY, socketR, 'D');
  if (canvas.detailLevel > 0) {
    for (let i = 0; i < 3; i++) {
      const a = canvas.next() * Math.PI * 2;
      canvas.set(coreX + Math.round(Math.cos(a) * socketR), seatedY + Math.round(Math.sin(a) * socketR * 0.85), 'k');
    }
  }
  canvas.disc(coreX, seatedY, Math.round(r * 0.55), 'E');
  const clusterX = coreX - Math.round(r * 0.17);
  const clusterY = seatedY - Math.round(r * 0.17);
  canvas.disc(clusterX, clusterY, Math.max(1, Math.round(r * 0.20)), 'e');
  canvas.set(clusterX, clusterY, 'W');
  if (r >= 9) canvas.set(clusterX + 1, clusterY, 'W');

  canvas.ventsBroken(F.x(0.445), F.y(0.845), 5);
  paintFooter(canvas, input);
}

/* ------------------------------------------------------------------ */
/* AMP — twin capacitor towers, coil console, hard-edged bolt          */
/* ------------------------------------------------------------------ */

function paintAmp(canvas: GearCanvas, input: GearComposeInput) {
  const F = frameOf(canvas);

  // Bolt — steep-toothed arc above the console (2-texel brush).
  const boltY0 = F.y(0.085);
  const boltY1 = F.y(0.185);
  const teeth = 5;
  const bx0 = F.x(0.335);
  const bx1 = F.x(0.665);
  let prevX = bx0;
  let prevY = boltY1;
  for (let i = 1; i <= teeth * 2; i++) {
    const nx = bx0 + Math.round(((bx1 - bx0) * i) / (teeth * 2));
    const ny = i % 2 === 1 ? boltY0 : boltY1;
    canvas.thickLine(prevX, prevY, nx, ny, 0, 'e');
    canvas.thickLine(prevX + 1, prevY, nx + 1, ny, 0, 'e');
    if (i % 2 === 1) canvas.set(nx, ny, 'W');
    prevX = nx;
    prevY = ny;
  }

  // Towers — the mirrored pair DIVERGES per side now (S3-4):
  // section heights, edge widths, and every charge-band row are
  // drawn per tower from the stream, never one shared offset.
  for (const tcx of [F.x(0.195), F.x(0.805)]) {
    const tw = F.w(0.078);
    // Rarity-finish cap (frame shades — finish, never form).
    canvas.rect(tcx - Math.round(tw * 0.8), F.y(0.055), Math.round(tw * 1.6), F.h(0.052), 'F');
    canvas.rect(tcx - Math.round(tw * 0.8), F.y(0.055), Math.round(tw * 1.6), 1, 'f');
    canvas.rect(tcx - Math.round(tw * 0.62), F.y(0.107), Math.round(tw * 1.24), F.h(0.03), 'd');
    let sy = F.y(0.14);
    for (let s = 0; s < 3; s++) {
      const sh = F.h(0.198) + (canvas.pick(3) - 1) * Math.max(1, Math.round(F.h(0.014)));
      const edgeW = Math.max(1, Math.round(tw * 0.22)) + canvas.pick(2);
      canvas.rect(tcx - tw, sy, tw * 2, sh, 'P');
      canvas.rect(tcx - tw, sy, edgeW, sh, 'd');
      canvas.rect(tcx + tw - edgeW, sy, edgeW, sh, 'd');
      canvas.rect(tcx - 1, sy, 3, sh, 'p');
      const bandY = sy + Math.round(sh * 0.42) + (canvas.pick(3) - 1) * 2;
      canvas.rect(tcx - tw, bandY, tw * 2, Math.max(2, F.h(0.032)), 'E');
      canvas.rect(tcx - 1, bandY, 3, Math.max(2, F.h(0.032)), 'W');
      sy += sh;
      if (s < 2) {
        canvas.rect(tcx - tw, sy, tw * 2, F.h(0.023), 'K');
        sy += F.h(0.023);
      }
    }
    // Foot tying the tower into the chassis.
    canvas.rect(tcx - tw, sy, tw * 2, F.y(0.80) - sy, 'd');
  }

  // Bus bars, towers → console.
  for (const [bxa, bxb] of [[F.x(0.273), F.x(0.365)], [F.x(0.635), F.x(0.727)]] as const) {
    canvas.rect(bxa, F.y(0.465), bxb - bxa, F.h(0.052), 'd');
    canvas.rect(bxa, F.y(0.482), bxb - bxa, Math.max(1, F.h(0.016)), 'E');
  }

  // Console — its top/bottom bands break at jittered boundaries
  // (S3-4, brokenBands over the console rect).
  const cx0 = F.x(0.365);
  const cx1 = F.x(0.635);
  const cy0 = F.y(0.275);
  const cy1 = F.y(0.80);
  canvas.brokenBands(cx0, cy0, cx1 - cx0, cy1 - cy0, 'p', 'P', 'd', 0.08, 0.91);
  // Sight block on top.
  canvas.rect(F.x(0.462), F.y(0.215), F.w(0.076), F.h(0.06), 'd');
  canvas.rect(F.x(0.478), F.y(0.232), F.w(0.044), Math.max(1, F.h(0.02)), 'e');
  // Inset panel + three coil loops around lit bars.
  canvas.rect(F.x(0.392), F.y(0.355), F.w(0.216), F.h(0.325), 'D');
  const loopW = F.w(0.052);
  const loopY = F.y(0.385);
  const loopH = F.h(0.245);
  for (let i = 0; i < 3; i++) {
    const lx = F.x(0.408 + i * 0.068);
    canvas.rect(lx, loopY, loopW, 1, 'e');
    canvas.rect(lx, loopY + loopH - 1, loopW, 1, 'e');
    canvas.rect(lx, loopY, 1, loopH, 'e');
    canvas.rect(lx + loopW - 1, loopY, 1, loopH, 'e');
    canvas.rect(lx + Math.floor(loopW / 2) - 1, loopY, 2, loopH, 'E');
  }
  // Core bar.
  canvas.rect(F.x(0.408), F.y(0.705), F.w(0.184), F.h(0.038), 'E');
  canvas.rect(F.cx - F.w(0.016), F.y(0.705), F.w(0.032), F.h(0.038), 'W');

  // Chassis plinth.
  canvas.rect(F.x(0.045), F.y(0.80), F.w(0.91), F.h(0.075), 'k');
  canvas.rect(F.x(0.045), F.y(0.80), F.w(0.91), 1, 'T');

  canvas.rivet(F.x(0.385), F.y(0.295));
  canvas.rivet(F.x(0.60), F.y(0.295));
  paintFooter(canvas, input);
}

/* ------------------------------------------------------------------ */
/* TURTLE — one riveted bulwark slab, ribbed, segmented emitter slit   */
/* ------------------------------------------------------------------ */

function paintTurtle(canvas: GearCanvas, input: GearComposeInput) {
  const F = frameOf(canvas);
  const tickCount = 4 + canvas.pick(4); // serial ticks, seed-varied

  // Top beam with end caps.
  canvas.rect(F.x(0.025), F.y(0.045), F.w(0.95), F.h(0.11), 'P');
  canvas.rect(F.x(0.025), F.y(0.045), F.w(0.95), Math.max(1, F.h(0.026)), 'L');
  canvas.rect(F.x(0.025), F.y(0.045), F.w(0.032), F.h(0.11), 'd');
  canvas.rect(F.x(0.943), F.y(0.045), F.w(0.032), F.h(0.11), 'd');

  // Main slab — one ramp step down so big fields never read pale.
  const sx0 = F.x(0.055);
  const sx1 = F.x(0.945);
  const sy0 = F.y(0.155);
  const sy1 = F.y(0.745);
  canvas.rect(sx0, sy0, sx1 - sx0, sy1 - sy0, 'd');
  const edgeW = Math.max(1, F.w(0.009));
  canvas.rect(sx0, sy0, edgeW, sy1 - sy0, 'D');
  canvas.rect(sx1 - edgeW, sy0, edgeW, sy1 - sy0, 'D');
  // The slab's foot band breaks per column (S3-4).
  canvas.bandJittered(sx0, F.y(0.685), sx1 - sx0, sy1 - F.y(0.685), 'D');

  // Ribs — raised armor panels, bolted; width and step now vary
  // per rib from the seed instead of four identical copies.
  for (let i = 0; i < 4; i++) {
    const rx = F.x(0.115 + i * 0.20) + (canvas.pick(3) - 1) * Math.max(1, Math.round(F.w(0.006)));
    const rw = F.w(0.078) + (canvas.pick(3) - 1) * Math.max(1, Math.round(F.w(0.008)));
    canvas.rect(rx, F.y(0.19), rw, F.h(0.515), 'P');
    canvas.rect(rx, F.y(0.19), Math.max(1, Math.round(rw * 0.18)), F.h(0.515), 'p');
    if (canvas.detailLevel > 0) {
      canvas.set(rx + Math.floor(rw / 2), F.y(0.225), 'K');
      canvas.set(rx + Math.floor(rw / 2), F.y(0.665), 'K');
    }
  }

  // Emitter recess + five lit segments.
  canvas.rect(F.x(0.29), F.y(0.335), F.w(0.42), F.h(0.195), 'K');
  canvas.rect(F.x(0.29), F.y(0.335), F.w(0.42), Math.max(1, F.h(0.02)), 'd');
  const segW = F.w(0.064);
  const segY = F.y(0.378);
  const segH = F.h(0.108);
  for (let i = 0; i < 5; i++) {
    const gx = F.x(0.312 + i * 0.081);
    canvas.rect(gx, segY, segW, segH, 'E');
    const inset = Math.max(1, Math.round(segW * 0.25));
    canvas.rect(gx + inset, segY + Math.round(segH * 0.25), Math.max(1, segW - inset * 2), Math.max(1, Math.round(segH * 0.5)), 'e');
    if (segW >= 6) canvas.rect(gx + Math.floor(segW / 2) - 1, segY + Math.round(segH * 0.35), 2, Math.max(1, Math.round(segH * 0.3)), 'W');
  }

  // Feet.
  for (const fx of [F.x(0.085), F.x(0.695)]) {
    canvas.rect(fx, sy1, F.w(0.22), F.h(0.085), 'd');
    canvas.rect(fx, sy1 + F.h(0.085) - Math.max(1, F.h(0.02)), F.w(0.22), Math.max(1, F.h(0.02)), 'D');
  }

  // Detail kit: the beam's rivet row walks with jittered spacing
  // and occasional gaps (S3-4); serial ticks; seeded cluster wear
  // where the fixed dither list used to sit.
  {
    let rx = F.x(0.075);
    while (rx < F.x(0.92)) {
      if (canvas.pick(6) !== 0) canvas.rivet(rx, F.y(0.088)); // occasional gap
      rx += F.w(0.077) + (canvas.pick(3) - 1) * 2;
    }
  }
  for (let i = 0; i < tickCount; i++) {
    canvas.rect(F.x(0.075 + i * 0.013), F.y(0.175), 1, F.h(0.028), 'P');
  }
  canvas.seam(sx0 + 3, F.y(0.605), sx1 - 4, F.y(0.605));
  if (canvas.detailLevel > 0) {
    canvas.clusterWear(F.x(0.10) + canvas.pick(Math.max(1, F.w(0.07))), F.y(0.565) + canvas.pick(6), 5);
    canvas.clusterWear(F.x(0.17) + canvas.pick(Math.max(1, F.w(0.07))), F.y(0.578) + canvas.pick(6), 4);
    canvas.slope(F.x(0.60), F.y(0.575), F.x(0.665), F.y(0.615), 'p', true);
    canvas.slope(F.x(0.70), F.y(0.63), F.x(0.755), F.y(0.665), 'p', true);
    canvas.slope(F.x(0.085), F.y(0.235), F.x(0.125), F.y(0.265), 'D', true);
    canvas.chip(F.x(0.50), sy1 - 1);
    canvas.chip(F.x(0.78), sy1 - 2);
  }
  paintFooter(canvas, input);
}

/* ------------------------------------------------------------------ */
/* The grammar — five behavior rows                                    */
/* ------------------------------------------------------------------ */

export interface ShieldFamilyRow {
  id: ShieldBehaviorId;
  /** One-line form summary — the row's silhouette in words. */
  form: string;
  paint: (canvas: GearCanvas, input: GearComposeInput) => void;
}

export const SHIELD_FAMILY_ROWS: Record<ShieldBehaviorId, ShieldFamilyRow> = {
  standard: {
    id: 'standard',
    form: 'balanced housing + top fins + hex emitter + side pods',
    paint: paintStandard,
  },
  nova: {
    id: 'nova',
    form: 'shutter ring around a stepped core + vented back plate',
    paint: paintNova,
  },
  absorb: {
    id: 'absorb',
    form: 'uneven shell plates around a seated core + side shell stacks',
    paint: paintAbsorb,
  },
  amp: {
    id: 'amp',
    form: 'twin capacitor towers + coil console + bolt',
    paint: paintAmp,
  },
  turtle: {
    id: 'turtle',
    form: 'wide riveted bulwark slab + segmented emitter slit',
    paint: paintTurtle,
  },
};

export const shieldGrammar: GearGrammar = {
  id: 'shield-behavior',
  kind: 'shield',
  plate: GEAR_CARD_PLATES.shield,
  wearLadder: true,
  paint(canvas, input) {
    const row = SHIELD_FAMILY_ROWS[(input.variant as ShieldBehaviorId) ?? 'standard'] ?? SHIELD_FAMILY_ROWS.standard;
    row.paint(canvas, input);
  },
  inputFromItem(item) {
    const shield = item as Shield;
    const base = defaultGearInput(shield, shieldGrammar);
    // Behavior comes from the canonical reader: legacy shields
    // with no behavior field read as Standard, never rewritten.
    return { ...base, variant: shieldBehaviorOf(shield) };
  },
};
