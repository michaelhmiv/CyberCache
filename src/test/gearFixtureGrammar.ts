import {
  GEAR_CARD_PLATES,
  type GearGrammar,
} from '@/lib/pixel/gearCardCompositor';

/**
 * Slice-0 PROOF fixtures — deliberately minimal placeholder
 * grammars (block shapes only) that exercise the shared gear
 * plate core end to end: silhouette layer, element core, detail
 * kit, seeded variation, pip sockets. These are NOT kind
 * grammars; shields/relics/class mods/ordnance bring their real
 * family rows in their own slices. Painting is resolution-relative
 * (fractions of the canvas body), so the same grammar composes at
 * card and thumb grids.
 */
export const fixtureBlockGrammar: GearGrammar = {
  id: 'fixture-block',
  kind: 'shield',
  plate: GEAR_CARD_PLATES.shield, // 240×140
  paint(canvas, input) {
    const b = canvas.body;
    const ix = Math.round(b.w * 0.08);
    const iy = Math.round(b.h * 0.14);
    const x0 = b.x + ix;
    const y0 = b.y + iy;
    const w = b.w - ix * 2;
    const h = b.h - iy * 2;
    // Slab silhouette: three horizontal ramp bands.
    const band = Math.max(1, Math.floor(h / 3));
    canvas.rect(x0, y0, w, band, 'p');
    canvas.rect(x0, y0 + band, w, band, 'P');
    canvas.rect(x0, y0 + band * 2, w, h - band * 2, 'D');
    // Element core (silhouette layer — present at every density).
    const cx = x0 + Math.floor(w / 2);
    const cy = y0 + Math.floor(h / 2);
    const r = Math.max(3, Math.round(Math.min(w, h) * 0.16));
    canvas.disc(cx, cy, r, 'E');
    canvas.disc(cx, cy, Math.max(1, Math.round(r * 0.45)), 'e');
    // Detail kit — paints at card, structurally absent at thumb.
    const seamY = y0 + band + canvas.pick(3);
    canvas.seam(x0 + 2, seamY, x0 + w - 3, seamY);
    canvas.rivet(x0 + 2, y0 + 2);
    canvas.rivet(x0 + w - 4, y0 + 2);
    canvas.rivet(x0 + 2, y0 + h - 3);
    canvas.rivet(x0 + w - 4, y0 + h - 3);
    canvas.vents(x0 + 6, y0 + h - 5, 4);
    canvas.pipRow(cx - 10, y0 + h - 11, input.pips ?? 0, 4);
  },
};

export const fixtureSlabGrammar: GearGrammar = {
  id: 'fixture-slab',
  kind: 'ordnance',
  plate: GEAR_CARD_PLATES.ordnance, // 240×120
  paint(canvas, input) {
    const b = canvas.body;
    const ix = Math.round(b.w * 0.05);
    const iy = Math.round(b.h * 0.22);
    const x0 = b.x + ix;
    const y0 = b.y + iy;
    const w = b.w - ix * 2;
    const h = b.h - iy * 2;
    // Wide low slab in two ramp bands.
    const band = Math.max(1, Math.floor(h / 2));
    canvas.rect(x0, y0, w, band, 'P');
    canvas.rect(x0, y0 + band, w, h - band, 'D');
    // Twin element cores.
    const cy = y0 + Math.floor(h / 2);
    const r = Math.max(2, Math.round(h * 0.22));
    canvas.disc(x0 + Math.floor(w / 3), cy, r, 'E');
    canvas.disc(x0 + Math.floor((w * 2) / 3), cy, r, 'E');
    // Detail kit.
    canvas.stripe(x0 + 4, y0 + 2, Math.floor(w * 0.4), 'e');
    canvas.seam(x0 + 2, y0 + band, x0 + w - 3, y0 + band);
    canvas.rivet(x0 + 2, y0 + 2);
    canvas.rivet(x0 + w - 4, y0 + h - 3);
    canvas.pipRow(x0 + Math.floor(w / 2) - 10, y0 + h - 9, input.pips ?? 0, 4);
  },
};
