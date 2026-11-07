/**
 * Pxl Craft Sweep S3 — the gear-engine craft pass pins.
 *
 * What this file holds (the per-grammar files carry their own
 * re-pins + the rarity re-argument):
 *  - S3-1 selective outline, behaviorally: an outline cell takes
 *    the shade two ramp steps darker than the form cell it
 *    borders, with the pxl neighbor preference (below first);
 *    ink remains only where no ramp mapping exists.
 *  - S3-2 the wear ladder's budget table, pinned at the grill's
 *    numbers (half the relic ladder, counts rounded up) and
 *    monotonic in rarity.
 *  - Floor 7 at the core: a protected zone refuses every wear
 *    operation — proven against a wear-off compose and against
 *    an unprotected control that MUST show wear (the test can
 *    bite).
 *  - S3-3 Absorb at thumb: the five shield families stay
 *    pairwise distinguishable at 60×35, and Absorb instances
 *    vary by seed there (the seeded sectors are silhouette
 *    layer, not detail).
 *  - Floor 7 at the data surface: the class-mod node deck —
 *    read through the exported NODE_DECK_ORIGINS data, never
 *    re-derived — is byte-identical across all five rarities
 *    for the same input, and a +3 stack paints exactly one full
 *    four-texel lit core (one white glint) in the field.
 */
import { describe, expect, it } from 'vitest';
import {
  composeGear,
  GEAR_CARD_PLATES,
  GEAR_WEAR_BUDGET,
  type GearComposeInput,
  type GearGrammar,
  type GearRender,
} from '@/lib/pixel/gearCardCompositor';
import { shieldGrammar } from '@/lib/pixel/shieldGrammar';
import {
  classModGrammar,
  classModInputFromItem,
  NODE_DECK_ORIGINS,
  NODE_DECK_SIZE,
} from '@/lib/pixel/classModGrammar';
import { DropSource, Element, Rarity, SkillTreeType } from '@/types/game';
import type { ClassMod } from '@/types/items';

const input = (over: Partial<GearComposeInput> = {}): GearComposeInput => ({
  kind: 'shield',
  rarity: Rarity.Rare,
  element: Element.Fire,
  seed: 1234,
  pips: 0,
  variant: 'standard',
  ...over,
});

const cellDistance = (a: GearRender, b: GearRender) => {
  let diff = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    if (a.rows[y][x] !== b.rows[y][x]) diff++;
  }
  return diff;
};

/* ------------------------------------------------------------------ */
/* Probe grammars — minimal painters for core-level pins               */
/* ------------------------------------------------------------------ */

/** Four floating blocks (p / E / D / T) + a 'd' block + a
 *  one-cell notch between a D block above and a p block below. */
const seloutProbeGrammar: GearGrammar = {
  id: 's3-selout-probe',
  kind: 'shield',
  plate: GEAR_CARD_PLATES.shield,
  paint(canvas) {
    const b = canvas.body;
    canvas.rect(b.x + 20, b.y + 20, 30, 18, 'p');
    canvas.rect(b.x + 70, b.y + 20, 30, 18, 'E');
    canvas.rect(b.x + 120, b.y + 20, 30, 18, 'D');
    canvas.rect(b.x + 170, b.y + 20, 30, 18, 'T');
    canvas.rect(b.x + 150, b.y + 64, 30, 16, 'd');
    canvas.rect(b.x + 40, b.y + 70, 30, 10, 'D');
    canvas.rect(b.x + 40, b.y + 81, 30, 10, 'p');
  },
};

const FIELD = { inset: 12, protectInset: { x: 62, y: 42, w: 88, h: 40 } };
const wearProbePaint = (protect: boolean): GearGrammar['paint'] => (canvas) => {
  const b = canvas.body;
  canvas.rect(b.x + FIELD.inset, b.y + FIELD.inset, b.w - FIELD.inset * 2, b.h - FIELD.inset * 2, 'P');
  if (protect) {
    canvas.protect(
      b.x + FIELD.protectInset.x, b.y + FIELD.protectInset.y,
      FIELD.protectInset.w, FIELD.protectInset.h,
    );
  }
};
const wearProbeGrammar: GearGrammar = {
  id: 's3-wear-probe', kind: 'shield', plate: GEAR_CARD_PLATES.shield,
  wearLadder: true, paint: wearProbePaint(true),
};
const wearUnprotectedGrammar: GearGrammar = {
  id: 's3-wear-probe-open', kind: 'shield', plate: GEAR_CARD_PLATES.shield,
  wearLadder: true, paint: wearProbePaint(false),
};
const wearOffGrammar: GearGrammar = {
  id: 's3-wear-probe-off', kind: 'shield', plate: GEAR_CARD_PLATES.shield,
  paint: wearProbePaint(true),
};

/* ------------------------------------------------------------------ */
/* S3-1 — selective outline                                            */
/* ------------------------------------------------------------------ */

describe('S3-1 selective outline (gear core)', () => {
  const render = composeGear(input(), seloutProbeGrammar, 'card');
  const body = { x: 4, y: 4 }; // shield plate margin at card
  const below = (blockX: number) => render.rows[body.y + 20 + 18][body.x + blockX + 15];

  it('an outline cell takes the shade two ramp steps darker than the form cell it borders', () => {
    expect(below(20)).toBe('d'); // p → d (two steps down the ramp D<d<P<p<L)
    expect(below(70)).toBe('c'); // E → c (element deep, not ink)
    expect(below(120)).toBe('K'); // D is the ramp floor — no darker seat, ink fallback
    expect(below(170)).toBe('K'); // T (steel, no ramp seat) → ink
    // d clamps at the floor: the cell below the d block is D.
    expect(render.rows[body.y + 64 + 16][body.x + 150 + 15]).toBe('D');
  });

  it('neighbor preference is below first: the notch cell follows the block beneath it', () => {
    // Gap row between the D block (above) and the p block (below).
    expect(render.rows[body.y + 80][body.x + 55]).toBe('d');
  });
});

/* ------------------------------------------------------------------ */
/* S3-2 — the wear ladder budget                                       */
/* ------------------------------------------------------------------ */

describe('S3-2 manufactured-gear wear ladder', () => {
  it('the budget table is the grill ruling: half the relic ladder, counts rounded up', () => {
    expect(GEAR_WEAR_BUDGET).toEqual({
      [Rarity.Common]: { chips: 7, scratches: 6, grime: 0.28, patina: 3 },
      [Rarity.Uncommon]: { chips: 5, scratches: 4, grime: 0.21, patina: 2 },
      [Rarity.Rare]: { chips: 3, scratches: 2, grime: 0.14, patina: 1 },
      [Rarity.Epic]: { chips: 2, scratches: 1, grime: 0.09, patina: 1 },
      [Rarity.Legendary]: { chips: 1, scratches: 1, grime: 0.05, patina: 1 },
    });
  });

  it('wear strictly relaxes as rarity climbs (chips + grime monotonic)', () => {
    const order = [Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary];
    for (let i = 1; i < order.length; i++) {
      expect(GEAR_WEAR_BUDGET[order[i]].chips).toBeLessThanOrEqual(GEAR_WEAR_BUDGET[order[i - 1]].chips);
      expect(GEAR_WEAR_BUDGET[order[i]].grime).toBeLessThan(GEAR_WEAR_BUDGET[order[i - 1]].grime);
    }
  });

  it('floor 7: a protected zone refuses the wear pass whole', () => {
    const common = input({ rarity: Rarity.Common, seed: 99 });
    const off = composeGear(common, wearOffGrammar, 'card');
    const worn = composeGear(common, wearProbeGrammar, 'card');
    const open = composeGear(common, wearUnprotectedGrammar, 'card');
    // Protected interior (inset 2 from the declared rect, clear
    // of any outline interplay at its edge).
    const x0 = 4 + FIELD.protectInset.x + 2;
    const y0 = 4 + FIELD.protectInset.y + 2;
    const w = FIELD.protectInset.w - 4;
    const h = FIELD.protectInset.h - 4;
    let openDiffs = 0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        expect(worn.rows[y][x]).toBe(off.rows[y][x]);
        if (open.rows[y][x] !== off.rows[y][x]) openDiffs++;
      }
    }
    // The control MUST show wear in the same window — otherwise
    // the protection assertion above proves nothing.
    expect(openDiffs).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* S3-3 — Absorb at thumb                                              */
/* ------------------------------------------------------------------ */

describe('S3-3 absorb rewrite — thumb identity', () => {
  const families = ['standard', 'nova', 'absorb', 'amp', 'turtle'];
  const thumbOf = (variant: string, seed = 4242) =>
    composeGear(input({ variant, seed, rarity: Rarity.Rare }), shieldGrammar, 'thumb');

  it('the five families stay pairwise distinguishable at 60×35', () => {
    const renders = families.map((f) => thumbOf(f));
    for (let i = 0; i < renders.length; i++) {
      for (let j = i + 1; j < renders.length; j++) {
        expect(renders[i].signature).not.toBe(renders[j].signature);
        expect(cellDistance(renders[i], renders[j])).toBeGreaterThan(100);
      }
    }
  });

  it('absorb instances vary by seed at thumb (sectors are silhouette layer)', () => {
    expect(thumbOf('absorb', 1).rows).not.toEqual(thumbOf('absorb', 2).rows);
    expect(thumbOf('absorb', 1).rows).not.toEqual(thumbOf('absorb', 3).rows);
  });
});

/* ------------------------------------------------------------------ */
/* Floor 7 — the class-mod node deck                                   */
/* ------------------------------------------------------------------ */

const modItem = (over: Partial<ClassMod> = {}): ClassMod => ({
  id: 'cm_s3',
  name: 'S3 Probe Class Mod',
  level: 10,
  slot: 'classMod',
  rarity: Rarity.Common,
  treeBonus: 'Gunslinger',
  nodeBoosts: {},
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 7,
  ...over,
} as ClassMod);

/** Deck rect in canvas coords, from the exported origin data and
 *  the same design→canvas mapping the painter uses (232×112
 *  design space over the card body). */
const deckRectOf = (tree: SkillTreeType) => {
  const plate = GEAR_CARD_PLATES.classMod;
  const body = { x: 4, y: 4, w: plate.width - 8, h: plate.height - 8 };
  const X = (v: number) => body.x + Math.round((v * body.w) / 232);
  const Y = (v: number) => body.y + Math.round((v * body.h) / 112);
  const o = NODE_DECK_ORIGINS[tree];
  return { x: X(o.x), y: Y(o.y), w: X(o.x + NODE_DECK_SIZE.w) - X(o.x), h: Y(o.y + NODE_DECK_SIZE.h) - Y(o.y) };
};
const deckCells = (render: GearRender, tree: SkillTreeType) => {
  const r = deckRectOf(tree);
  const cells: string[] = [];
  for (let y = r.y; y < r.y + r.h; y++) cells.push(render.rows[y].slice(r.x, r.x + r.w));
  return cells.join('/');
};

describe('floor 7 — the node deck is wear-proof data', () => {
  const boosts = { gs_dmg_1: 2, demo_ord_1: 1, scav_cache_1: 2, fix_quality_1: 1 };

  it('deck cells are byte-identical across all five rarities, every tree', () => {
    for (const tree of Object.values(SkillTreeType)) {
      const base = classModInputFromItem(modItem({ treeBonus: tree, nodeBoosts: boosts }));
      const reference = deckCells(composeGear({ ...base, rarity: Rarity.Common }, classModGrammar, 'card'), tree);
      for (const rarity of [Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary]) {
        const cells = deckCells(composeGear({ ...base, rarity }, classModGrammar, 'card'), tree);
        expect(cells).toBe(reference);
      }
    }
  });

  it('pip anatomy survives the slice: a +3 stack paints exactly one full lit core', () => {
    const tree = SkillTreeType.Gunslinger;
    const base = classModInputFromItem(modItem({ treeBonus: tree, nodeBoosts: { gs_crit_1: 3 } }));
    const render = composeGear({ ...base, rarity: Rarity.Common }, classModGrammar, 'card');
    const r = deckRectOf(tree);
    let glints = 0;
    let fullCores = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (render.rows[y][x] === 'W') glints++;
        if (
          render.rows[y][x] === 'E' && render.rows[y][x + 1] === 'p' &&
          render.rows[y + 1]?.[x] === 'p' && render.rows[y + 1]?.[x + 1] === 'W'
        ) fullCores++;
      }
    }
    expect(glints).toBe(1);
    expect(fullCores).toBe(1);
    // And an unboosted deck has no glint at all.
    const plain = composeGear(
      { ...classModInputFromItem(modItem({ treeBonus: tree })), rarity: Rarity.Common },
      classModGrammar, 'card',
    );
    const pr = deckRectOf(tree);
    let plainGlints = 0;
    for (let y = pr.y; y < pr.y + pr.h; y++) {
      for (let x = pr.x; x < pr.x + pr.w; x++) if (plain.rows[y][x] === 'W') plainGlints++;
    }
    expect(plainGlints).toBe(0);
  });
});
