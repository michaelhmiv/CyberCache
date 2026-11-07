import { Element, Rarity } from '@/types/game';
import type { GearItem, Ordnance } from '@/types/items';
import {
  GEAR_CARD_PLATES,
  type GearCanvas,
  type GearComposeInput,
  type GearGrammar,
  type GearShade,
} from './gearCardCompositor';

/**
 * Ordnance grammar — gear marriage slice 2.
 *
 * THE MARRIAGE: form = EFFECT CLASS. The old SVG picked its
 * family by `hash(effect) + seed mod 4` (ordnanceSilhouettes'
 * pickOrdnanceSilhouette) — effectively random against the one
 * thing a player chooses ordnance FOR. Here the item's actual
 * effect string assigns the silhouette, from the live effect
 * list in src/server/lib/generators/ordnanceGenerator.ts:
 *
 *   Spike       ← Fragmentation, Kinetic Slam   (burst / break)
 *   Disc        ← EMP Payload, Shockwave        (flat emitters)
 *   Seeker Dart ← Seeker, Void Tap              (guided / finned)
 *   Canister    ← Cluster, Incendiary,          (payload vessels)
 *                 Acid Burst, Cryo Shell
 *
 * Element = the core colorway (the whole body wears the element
 * ramp, exactly as the weapons and the owner-approved shield v3
 * plates do; Kinetic is the metallic honest absence). Rarity =
 * the core's frame finish — form never changes with rarity.
 * pixelSeed = markings variation via the canvas stream; affixes
 * = the socket pips on the mounting plaque every form shares.
 *
 * Authored AT the grid under DESIGN.md §8: fixed 240×120 plate,
 * five-tone ramps, silhouette-carried identity, single-texel
 * detail from the core kit only. The silhouette layer never
 * paints the 'T' shade — steel texels at card come only from
 * the detail kit, so a thumb (detail level 0) provably contains
 * no 'T'. Runtime-composed: zero sprite payload.
 */

export type OrdnanceFormId = 'spike' | 'disc' | 'dart' | 'canister';

/** Effect NAME (the part before the ':') → form. The live list. */
export const ORDNANCE_EFFECT_FORMS: Record<string, OrdnanceFormId> = {
  Fragmentation: 'spike',
  'Kinetic Slam': 'spike',
  'EMP Payload': 'disc',
  Shockwave: 'disc',
  Seeker: 'dart',
  'Void Tap': 'dart',
  Cluster: 'canister',
  Incendiary: 'canister',
  'Acid Burst': 'canister',
  'Cryo Shell': 'canister',
};

/** The named part of an effect string ('Fragmentation: +15%…' → 'Fragmentation'). */
export function ordnanceEffectName(effect: string): string {
  const cut = effect.indexOf(':');
  return (cut >= 0 ? effect.slice(0, cut) : effect).trim();
}

/**
 * Form for an effect string. Exact name match first, then a
 * containment scan (legacy strings with suffixes still land),
 * then a deterministic fallback — NEVER a hash: an unrecognized
 * future effect renders as the generic payload vessel until it
 * gets its own row above.
 */
export function ordnanceFormForEffect(effect: string): OrdnanceFormId {
  const name = ordnanceEffectName(effect);
  if (!name) return 'canister';
  const exact = ORDNANCE_EFFECT_FORMS[name];
  if (exact) return exact;
  for (const [known, form] of Object.entries(ORDNANCE_EFFECT_FORMS)) {
    if (name.includes(known) || known.includes(name)) return form;
  }
  return 'canister';
}

/* ------------------------------------------------------------------ */
/* Shared layout — play region above a mounting plaque                 */
/* ------------------------------------------------------------------ */

const PIP_TOTAL = 5;

interface GearLayout {
  cx: number;
  playTop: number;
  playBottom: number;
  playW: number;
  playH: number;
  u: number;
  plaqueX: number;
  plaqueY: number;
  plaqueW: number;
  plaqueH: number;
}

function layout(canvas: GearCanvas): GearLayout {
  const b = canvas.body;
  // Plaque proportions scale with the body: at card it exactly
  // houses the 5-socket pip row (31×8); at thumb the sockets are
  // detail-level-0 silent and the plaque is just the base tab.
  const plaqueH = Math.max(3, Math.round(b.h * 0.07));
  const plaqueW = Math.max(8, Math.round(b.w * 0.135));
  const plaqueY = b.y + b.h - plaqueH;
  const gap = Math.max(1, Math.round(b.h * 0.02));
  const playTop = b.y;
  const playBottom = plaqueY - gap;
  return {
    cx: b.x + Math.floor(b.w / 2),
    playTop,
    playBottom,
    playW: b.w,
    playH: playBottom - playTop,
    u: Math.min(b.w, playBottom - playTop),
    plaqueX: b.x + Math.floor((b.w - plaqueW) / 2),
    plaqueY,
    plaqueW,
    plaqueH,
  };
}

/** The mounting plaque + affix socket row every form shares. */
function paintPlaque(canvas: GearCanvas, lay: GearLayout, input: GearComposeInput) {
  canvas.rect(lay.plaqueX, lay.plaqueY, lay.plaqueW, lay.plaqueH, 'D');
  canvas.pipRow(
    lay.plaqueX + 4,
    lay.plaqueY + Math.floor((lay.plaqueH - 3) / 2),
    Math.min(input.pips ?? 0, PIP_TOTAL),
    PIP_TOTAL,
  );
  // The plaque carries the affix read — a data surface the core
  // wear ladder may never land on (S3 floor 7).
  canvas.protect(lay.plaqueX - 1, lay.plaqueY - 1, lay.plaqueW + 2, lay.plaqueH + 2);
}

/* ------------------------------------------------------------------ */
/* Form rows                                                           */
/* ------------------------------------------------------------------ */

type FormPaint = (canvas: GearCanvas, input: GearComposeInput, lay: GearLayout) => void;

/** Spike — a spiked burst charge: radial spikes, frag-grooved
 *  casing, stepped element core, stabilizer pods filling the
 *  wide plate (the shield v3 side-pod language). */
const paintSpike: FormPaint = (canvas, _input, lay) => {
  const rot = canvas.pick(45); // seeded rotation of the spike ring, degrees
  const spikeGrow = canvas.pick(3); // spike length jitter
  const chipA = canvas.next();
  const chipB = canvas.next();

  const cy = lay.playTop + Math.floor(lay.playH / 2);
  const rBody = Math.max(4, Math.round(lay.u * 0.30));
  const r0 = rBody * 0.80;
  const r1 = rBody * (1.42 + spikeGrow * 0.05);

  // Stabilizer pods, left and right, with outward spikes — the
  // pair DIVERGES per side now (S3-5): length, height, and the
  // stripe seat are drawn per pod from the stream.
  const spikeLen = Math.round(lay.u * 0.15);
  for (const side of [-1, 1] as const) {
    const podLen = Math.round(lay.playW * 0.20) + (canvas.pick(3) - 1) * 3;
    const podH = Math.max(3, Math.round(lay.u * 0.30)) + (canvas.pick(3) - 1) * 2;
    const podY = cy - Math.floor(podH / 2);
    const housingEdge = lay.cx + side * (rBody + 4);
    const hx = side < 0 ? housingEdge - podLen : housingEdge;
    canvas.rect(hx, podY, podLen, podH, 'd');
    canvas.rect(hx, podY + Math.floor(podH * 0.3), podLen, Math.max(1, Math.floor(podH * 0.4)), 'P');
    // Deep foot band: the pod sits IN its mount shadow. (At
    // thumb the pod's lower 'd' section plus its selout row
    // otherwise stacks into a flat d/D march — the S2 gate
    // flagged it. The foot's edge is JITTERED, not straight:
    // a straight deep band at card merely moves the march to
    // the foot's own rows, as the gate also showed.)
    const footH = Math.max(1, Math.round(podH * 0.25));
    canvas.bandJittered(hx, podY + podH - footH, podLen, footH, 'D');
    const tipX = side < 0 ? hx - spikeLen : hx + podLen + spikeLen;
    canvas.poly(
      [
        [side < 0 ? hx : hx + podLen, cy - Math.floor(podH * 0.32)],
        [tipX, cy],
        [side < 0 ? hx : hx + podLen, cy + Math.floor(podH * 0.32)],
      ],
      'd',
    );
    // Detail: pod vents + a lit stripe run.
    canvas.vents(side < 0 ? hx + 3 : hx + podLen - 12, podY + podH - 3, 3);
    canvas.stripe(side < 0 ? hx + 4 : hx + podLen - 16, podY + 2, 12, 'e');
  }

  // Spikes first (the body disc covers their bases).
  for (let i = 0; i < 8; i++) {
    const a = ((rot + i * 45) * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = -dy;
    const py = dx;
    const bw = rBody * 0.30;
    canvas.poly(
      [
        [lay.cx + dx * r0 + px * bw, cy + dy * r0 + py * bw],
        [lay.cx + dx * r1, cy + dy * r1],
        [lay.cx + dx * r0 - px * bw, cy + dy * r0 - py * bw],
      ],
      'd',
    );
  }
  // Casing, frag groove, panel, seated core (S3-5): the lit core
  // sits a texel off-axis in its panel and the accent step is an
  // off-center cluster, not a concentric disc pair.
  canvas.disc(lay.cx, cy, rBody, 'P');
  canvas.ring(lay.cx, cy, rBody * 0.8, rBody * 0.87, 'c', true);
  canvas.disc(lay.cx, cy, Math.round(rBody * 0.62), 'd');
  const hubX = lay.cx + (canvas.pick(3) - 1);
  const hubY = cy + (canvas.pick(3) - 1);
  canvas.disc(hubX, hubY, Math.round(rBody * 0.4), 'E');
  const clX = hubX - Math.max(1, Math.round(rBody * 0.07));
  const clY = hubY - Math.max(1, Math.round(rBody * 0.07));
  canvas.disc(clX, clY, Math.max(1, Math.round(rBody * 0.13)), 'e');
  if (rBody >= 10) canvas.set(clX, clY, 'W');
  // Detail: seams out from the panel, wear at the rim.
  canvas.seam(lay.cx - rBody + 3, cy - Math.round(rBody * 0.5), lay.cx - Math.round(rBody * 0.66), cy - Math.round(rBody * 0.3));
  canvas.seam(lay.cx + Math.round(rBody * 0.66), cy + Math.round(rBody * 0.3), lay.cx + rBody - 3, cy + Math.round(rBody * 0.5));
  for (const t of [chipA, chipB]) {
    const a = t * Math.PI * 2;
    canvas.chip(lay.cx + Math.round(Math.cos(a) * rBody), cy + Math.round(Math.sin(a) * rBody));
  }
};

/** Disc — a flat emitter mine: stepped-dome ellipse, hub core,
 *  groove ring, radial seams. Sits low on the plaque line. */
const paintDisc: FormPaint = (canvas, _input, lay) => {
  const seamRot = canvas.next() * Math.PI * 2;
  const grooveJitter = 0.78 + canvas.pick(3) * 0.03;

  const rx = Math.round(lay.playW * 0.36);
  const ry = Math.max(3, Math.round(lay.playH * 0.3));
  const cyD = lay.playBottom - ry - 1;

  const ellipseRows = (
    cxE: number, cyE: number, rxE: number, ryE: number,
    shade: (dyFrac: number) => GearShade,
    overOnly = false,
  ) => {
    for (let dy = -ryE; dy <= ryE; dy++) {
      const f = dy / ryE;
      const hw = Math.floor(rxE * Math.sqrt(Math.max(0, 1 - f * f)));
      for (let x = cxE - hw; x <= cxE + hw; x++) {
        if (overOnly) canvas.over(x, cyE + dy, shade(f));
        else canvas.set(x, cyE + dy, shade(f));
      }
    }
  };

  // Dome: pale crown, base mid, deep skirt.
  ellipseRows(lay.cx, cyD, rx, ry, (f) => (f < -0.45 ? 'p' : f < 0.25 ? 'P' : 'D'));
  // Groove ring in element-deep: only texels whose normalized
  // radius lands in the groove band, and only over the dome. The
  // band edge now JITTERs per angle from the stream (S3-5) — the
  // groove is machined, not compass-drawn.
  const grooveJit: number[] = [];
  for (let i = 0; i < 32; i++) grooveJit.push((canvas.pick(3) - 1) * 0.03);
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const rn = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
      const bucket = Math.floor(((Math.atan2(dy / ry, dx / rx) + Math.PI) / (Math.PI * 2)) * 32) % 32;
      const edge = grooveJitter + grooveJit[bucket];
      if (rn >= edge && rn <= edge + 0.09) canvas.over(lay.cx + dx, cyD + dy, 'c');
    }
  }
  // Hub + core, SEATED (S3-5): a dark socket ellipse, the hub a
  // texel off-axis, the accent an off-center cluster — the flat
  // emitter keeps its concentric identity, its steps are broken.
  const hubX = lay.cx + (canvas.pick(3) - 1);
  const hubCy = cyD - Math.round(ry * 0.18);
  ellipseRows(hubX, hubCy, Math.round(rx * 0.31), Math.max(2, Math.round(ry * 0.48)), () => 'D');
  ellipseRows(hubX, hubCy, Math.round(rx * 0.27), Math.max(2, Math.round(ry * 0.42)), () => 'd');
  const coreR = Math.max(2, Math.round(lay.u * 0.075));
  canvas.disc(hubX, hubCy, coreR, 'E');
  const clX = hubX - Math.max(1, Math.round(coreR * 0.4));
  const clY = hubCy - Math.max(1, Math.round(coreR * 0.4));
  canvas.disc(clX, clY, Math.max(1, Math.round(coreR * 0.45)), 'e');
  if (coreR >= 5) canvas.set(clX, clY, 'W');
  // Detail: radial seams from the hub, rim rivets.
  for (let i = 0; i < 5; i++) {
    const a = seamRot + (i * Math.PI * 2) / 5;
    canvas.seam(
      hubX + Math.round(Math.cos(a) * rx * 0.4), cyD + Math.round(Math.sin(a) * ry * 0.4),
      lay.cx + Math.round(Math.cos(a) * rx * 0.92), cyD + Math.round(Math.sin(a) * ry * 0.92),
    );
  }
  canvas.rivet(lay.cx - rx + 4, cyD);
  canvas.rivet(lay.cx + rx - 6, cyD);
};

/** Seeker Dart — a finned guided dart: two-tone tapered body,
 *  spine charge stripe, seeker eye, swept tail fins. */
const paintDart: FormPaint = (canvas, _input, lay) => {
  const stripeFrac = 0.55 + canvas.pick(3) * 0.05; // charge stripe length jitter
  const eyeShift = (canvas.pick(3) - 1) * 0.02; // eye placement jitter

  const L = Math.round(lay.playW * 0.92);
  const x0 = lay.cx - Math.floor(L / 2);
  const x1 = x0 + L;
  const spineY = lay.playTop + Math.round(lay.playH * 0.46);
  const halfH = Math.max(3, Math.round(lay.u * 0.17));

  // Tail fins (behind the body), swept and dark — the pair's
  // sweep DIVERGES per side from the seed now (S3-5).
  const finTop = Math.max(2, Math.round(halfH * 2.4));
  const finReachTop = finTop + (canvas.pick(3) - 1) * 2;
  const finReachBottom = finTop + (canvas.pick(3) - 1) * 2;
  canvas.poly(
    [
      [x0 + Math.round(L * 0.03), spineY - Math.round(halfH * 0.8)],
      [x0 - Math.round(L * 0.015), spineY - finReachTop],
      [x0 + Math.round(L * 0.22), spineY - Math.round(halfH * 0.9)],
    ],
    'd',
  );
  canvas.poly(
    [
      [x0 + Math.round(L * 0.03), spineY + Math.round(halfH * 0.8)],
      [x0 - Math.round(L * 0.015), spineY + finReachBottom],
      [x0 + Math.round(L * 0.22), spineY + Math.round(halfH * 0.9)],
    ],
    'd',
  );
  // Body: two-tone by the spine (belly in ramp dark).
  canvas.poly(
    [
      [x0 + Math.round(L * 0.06), spineY - halfH],
      [x0 + Math.round(L * 0.52), spineY - Math.round(halfH * 1.12)],
      [x0 + Math.round(L * 0.8), spineY - Math.round(halfH * 0.42)],
      [x1, spineY],
      [x0 + Math.round(L * 0.8), spineY + Math.round(halfH * 0.42)],
      [x0 + Math.round(L * 0.52), spineY + Math.round(halfH * 1.12)],
      [x0 + Math.round(L * 0.06), spineY + halfH],
    ],
    (_x, y) => (y > spineY ? 'd' : 'P'),
  );
  // Tail nozzle block.
  canvas.rect(x0, spineY - Math.round(halfH * 0.7), Math.max(2, Math.round(L * 0.045)), Math.round(halfH * 1.4), 'D');
  // Spine charge stripe + seeker eye (silhouette layer).
  canvas.thickLine(
    x0 + Math.round(L * 0.16), spineY,
    x0 + Math.round(L * stripeFrac), spineY,
    Math.max(1, Math.round(halfH * 0.16)), 'E',
  );
  const eyeX = x0 + Math.round(L * (0.76 + eyeShift));
  const eyeR = Math.max(2, Math.round(halfH * 0.52));
  canvas.disc(eyeX, spineY, eyeR, 'E');
  // The eye's bright heart is an off-center cluster (S3-5).
  canvas.disc(
    eyeX - Math.max(1, Math.round(eyeR * 0.35)), spineY - Math.max(1, Math.round(eyeR * 0.35)),
    Math.max(1, Math.round(eyeR * 0.45)), 'e',
  );
  // Detail: spine seam, fin stripe, tail vents.
  canvas.seam(x0 + Math.round(L * 0.1), spineY - halfH + 1, x0 + Math.round(L * 0.5), spineY - halfH + 1);
  canvas.stripe(x0 + Math.round(L * 0.05), spineY - finTop + Math.round(finTop * 0.4), Math.round(L * 0.08), 'e');
  canvas.vents(x0 + Math.round(L * 0.08), spineY + halfH - 1, 3);
};

/** Canister — an upright payload vessel: stepped shoulders,
 *  banded body, element payload window, nozzle cap. Cluster,
 *  fire, acid, and cryo all ship in this vessel. */
const paintCanister: FormPaint = (canvas, _input, lay) => {
  const ribA = 0.25 + canvas.pick(3) * 0.06; // rib seam placement jitter
  const wear = canvas.next();

  const wC = Math.round(lay.playW * 0.3);
  const x0 = lay.cx - Math.floor(wC / 2);
  const capH = Math.max(2, Math.round(lay.playH * 0.05));
  const yTop = lay.playTop + Math.round(lay.playH * 0.05) + capH;
  const yBot = lay.playBottom;
  const hC = yBot - yTop;

  // Nozzle cap (above the shoulders).
  canvas.rect(lay.cx - Math.round(wC * 0.17), yTop - capH, Math.round(wC * 0.34), capH, 'k');
  canvas.rect(lay.cx - 1, yTop - capH - 2, 3, 2, 'E');
  // Shoulders step out to full width; crown rows pale.
  const shoulderH = Math.max(2, Math.round(hC * 0.12));
  for (let i = 0; i < shoulderH; i++) {
    const inset = Math.round(wC * 0.18 * (1 - i / shoulderH));
    canvas.rect(x0 + inset, yTop + i, wC - inset * 2, 1, i === 0 ? 'p' : 'P');
  }
  // Body + bands + deep base + edge rails. The two body bands
  // break per column now (S3-5, the core bandJittered move).
  canvas.rect(x0, yTop + shoulderH, wC, hC - shoulderH, 'P');
  const bandH = Math.max(2, Math.round(hC * 0.07));
  canvas.bandJittered(x0, yTop + Math.round(hC * 0.24), wC, bandH, 'd');
  canvas.bandJittered(x0, yTop + Math.round(hC * 0.76), wC, bandH, 'd');
  canvas.rect(x0, yBot - Math.max(2, Math.round(hC * 0.06)), wC, Math.max(2, Math.round(hC * 0.06)), 'D');
  const railW = Math.max(2, Math.round(wC * 0.07));
  canvas.rect(x0 + Math.round(wC * 0.06), yTop + shoulderH, railW, hC - shoulderH, 'd');
  canvas.rect(x0 + wC - Math.round(wC * 0.06) - railW, yTop + shoulderH, railW, hC - shoulderH, 'd');
  // Payload window: element-deep frame, element fill, accent core.
  const ww = Math.round(wC * 0.44);
  const wx = lay.cx - Math.floor(ww / 2);
  const wy = yTop + Math.round(hC * 0.32);
  const wh = Math.round(hC * 0.38);
  const insetW = Math.max(1, Math.round(ww * 0.16));
  canvas.rect(wx, wy, ww, wh, 'c');
  canvas.rect(wx + insetW, wy + insetW, ww - insetW * 2, wh - insetW * 2, 'E');
  canvas.rect(lay.cx - 1, wy + insetW, 3, wh - insetW * 2, 'e');
  // Detail: rib seams, band rivets, hazard stripe, one wear chip.
  canvas.seam(x0 + Math.round(wC * ribA), yTop + shoulderH + 1, x0 + Math.round(wC * ribA), yBot - 3);
  canvas.seam(x0 + Math.round(wC * (1 - ribA)), yTop + shoulderH + 1, x0 + Math.round(wC * (1 - ribA)), yBot - 3);
  canvas.rivet(x0 + 2, yTop + Math.round(hC * 0.24) + 1);
  canvas.rivet(x0 + wC - 4, yTop + Math.round(hC * 0.76) + 1);
  canvas.stripe(x0 + 3, yTop + Math.round(hC * 0.76) + Math.floor(bandH / 2), Math.round(wC * 0.3), 'F');
  canvas.chip(x0 + Math.round(wC * (0.15 + wear * 0.7)), yTop + Math.round(hC * 0.55));
};

export const ORDNANCE_FORM_ROWS: Record<OrdnanceFormId, { label: string; paint: FormPaint }> = {
  spike: { label: 'Spike', paint: paintSpike },
  disc: { label: 'Disc', paint: paintDisc },
  dart: { label: 'Seeker Dart', paint: paintDart },
  canister: { label: 'Canister', paint: paintCanister },
};

/* ------------------------------------------------------------------ */
/* The grammar                                                         */
/* ------------------------------------------------------------------ */

export const ordnanceGrammar: GearGrammar = {
  id: 'ordnance',
  kind: 'ordnance',
  plate: GEAR_CARD_PLATES.ordnance, // 240×120
  wearLadder: true,
  paint(canvas, input) {
    const lay = layout(canvas);
    const form = (input.variant as OrdnanceFormId) in ORDNANCE_FORM_ROWS
      ? (input.variant as OrdnanceFormId)
      : 'canister';
    ORDNANCE_FORM_ROWS[form].paint(canvas, input, lay);
    paintPlaque(canvas, lay, input);
  },
  inputFromItem(item: GearItem): GearComposeInput {
    const ord = item as Ordnance;
    return {
      kind: 'ordnance',
      rarity: (ord.rarity ?? Rarity.Common) as Rarity,
      element: (ord.element ?? Element.Kinetic) as Element,
      seed: typeof ord.pixelSeed === 'number' ? ord.pixelSeed : 0,
      pips: ord.affixes?.length ?? 0,
      variant: ordnanceFormForEffect(ord.effect ?? ''),
    };
  },
};
