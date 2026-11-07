/**
 * Weapon Authored-Bases Scale-Up, Batch 1 — Pistol / SMG / Shotgun.
 *
 * The S5 pilot's pattern (sniperAuthoredBases.test.ts) replicated for
 * the first three of the five remaining weapon types. What this pins,
 * per type:
 *  - Lint: the 19 authored pieces, as checked-in grid data, lint at
 *    ZERO findings under the repo's pxl port (pixelLint.ts + the
 *    weapon-card banding options), and so do the composed matrix
 *    variants (6 elements × 5 rarities, one fixed representative
 *    part roll) on every rule the S2 gate asserts at zero (banding,
 *    jaggy, pillow, colors, near-duplicate). Orphan is the budgeted
 *    rule (S2 doctrine): weapon-card orphan ≤ 20 stray cells per
 *    render; the authored matrices observe maxima of 13–17 across
 *    the three types. ONE documented exception, pistol only: the
 *    Shock renders carry a single jaggy cell at (120, 28) — the
 *    production element-current thread stepping around the chamber,
 *    downstream-pass geometry rather than authored form (the
 *    approved package's own matrix evidence records the same class
 *    of cell; the S2 gate budgets weapon-card jaggy at 6/render).
 *    It is allowlisted by exact coordinate below, nothing else is.
 *  - Assembly integrity: partVariant() pinned value-for-value per
 *    type, and swapping ANY form slot's variant changes the composed
 *    render — batch 1 has no coded collapse: these types' Sight slot
 *    ships three authored forms (the sniper's single scope was its
 *    own scope-6 ruling), and the shotgun's Magazine slot authors
 *    its pump forms.
 *  - The living passes land on authored bases: rarity overlays by
 *    tier (exact landed cell counts), godroll sparkles, wear
 *    erasure, affix decals, the Kinetic window rule (grill 2), and
 *    the Ironwood wood-ramp remap (grill 1). The shotgun carries no
 *    Magazine anchor and the pistol no Stock anchor (procedural
 *    parity, both pinned here).
 *  - Containment: everything batch 1 must NOT move — the sniper
 *    card renders plus every pixel-path render — pinned as one
 *    super-hash over 504 render signatures swept on the
 *    pre-batch-1 master (evidence: cybercache-prep/
 *    pxl-craft-sweep/scaleup-batch1/renders/containment-baseline
 *    .json). The S5 test's own containment sweep was re-based in
 *    this slice to the complementary 576-signature partition.
 *    RE-SCOPED at the batch 1 + batch 2 reconciliation merge: the
 *    sweep originally also carried the Launcher and Beam card
 *    renders (648 signatures, super-hash bbd1dd68) — those types
 *    are batch 2's deliberate target, authored by PR #449, so
 *    their card renders leave this sweep exactly as batch 1's own
 *    types left the S5 sweep, and batch 2's suite (which pins the
 *    identical 504-signature set, super-hash 868d8adf) is the
 *    standing guard for them. No batch-1 render moved: this
 *    suite's lint, assembly, and living-pass pins are unchanged.
 *
 * PISTOL FORM SWAP (2026-11-07, parent audit): the pistol's form is
 * the owner-approved authored package from the S5 scale-up final
 * batch (cybercache-prep/pxl-craft-sweep/s5-scaleup/pistol/ —
 * approved by the owner from its matrix sheet), converted through
 * this batch's generalized converter; batch 1's own pistol
 * authoring is superseded (archived as
 * scaleup-batch1/sources/pistol-authored-batch1-superseded.px.js).
 * The pistol matrix roll below is that package's evidence roll
 * (Barrel 1 / Grip 1 / Core 1 / Magazine 1 / Sight 1 / Chamber 2),
 * so this suite's matrix is the exact composition the owner
 * approved. The swap moved no other type: the containment
 * super-hash above is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Affix, WeaponPart } from '../types/items';
import { composeWeaponCard, type WeaponCardRender } from '../lib/pixel/weaponCardCompositor';
import {
  PISTOL_AUTHORED_OVERLAYS,
  PISTOL_AUTHORED_PIECES,
} from '../lib/pixel/pistolAuthoredData';
import {
  SMG_AUTHORED_OVERLAYS,
  SMG_AUTHORED_PIECES,
} from '../lib/pixel/smgAuthoredData';
import {
  SHOTGUN_AUTHORED_OVERLAYS,
  SHOTGUN_AUTHORED_PIECES,
} from '../lib/pixel/shotgunAuthoredData';
import { composePixelWeapon, partVariant, type PixelWeaponInput } from '../lib/pixel/weaponCompositor';
import { lintBanding, lintRender, type LintFinding, type LintRender } from './pixelLint';
import { BANDING_BY_SYSTEM } from './pxlLintCorpus';

const BANDING = BANDING_BY_SYSTEM['weapon-card'];
const SLOTS = ['Barrel', 'Grip', 'Core', 'Magazine', 'Sight', 'Chamber'] as const;
type Tuple = [number, number, number, number, number, number];

interface TypeSpec {
  type: WeaponType;
  pieces: typeof PISTOL_AUTHORED_PIECES;
  overlays: typeof PISTOL_AUTHORED_OVERLAYS;
  /** critDamage per slot per variant (measured on the untouched implementation). */
  variantValue: Record<(typeof SLOTS)[number], [number, number, number]>;
  defaults: Tuple;
  /** The evidence matrix roll (generator-minted anchor parts). */
  matrixRoll: Tuple;
  /** Barrel zone for the godroll sparkle check [x0, x1, y0, y1]. */
  barrelZone: [number, number, number, number];
  /** Receiver zone for the wear check [x0, x1, y0, y1]. */
  receiverZone: [number, number, number, number];
  /** Chamber window bbox for the Kinetic warm-glass check. */
  windowBox: [number, number, number, number];
  /** Where 'e' may survive on a Kinetic card (the reflex lens box); null = nowhere. */
  lensBox: [number, number, number, number] | null;
  /** Decal-case seed: the seed whose decal positions land on this
   *  type's silhouette (see the decal test's note). */
  decalSeed: number;
  /** Documented downstream-pass jaggy cells tolerated in the
   *  composed matrix (exact coordinates; see the header note).
   *  Absent = jaggy asserts at absolute zero, as authored. */
  jaggyAllowance?: [number, number][];
}

const SPECS: TypeSpec[] = [
  {
    type: WeaponType.Pistol,
    pieces: PISTOL_AUTHORED_PIECES,
    overlays: PISTOL_AUTHORED_OVERLAYS,
    variantValue: {
      Barrel: [0.852, 0.851, 0.85], Grip: [0.85, 0.852, 0.851], Core: [0.851, 0.852, 0.85],
      Magazine: [0.851, 0.85, 0.853], Sight: [0.85, 0.851, 0.853], Chamber: [0.85, 0.853, 0.851],
    },
    defaults: [0, 0, 2, 1, 1, 2],
    // The approved package's evidence roll (see the header's swap
    // note): Barrel 1 / Grip 1 / Core 1 / Magazine 1 / Sight 1 /
    // Chamber 2.
    matrixRoll: [1, 1, 1, 1, 1, 2],
    barrelZone: [130, 160, 24, 37],
    receiverZone: [74, 130, 20, 40],
    windowBox: [108, 124, 26, 35],
    lensBox: [91, 105, 11, 20],
    decalSeed: 4,
    // The Shock element-current thread's step around the chamber —
    // downstream-pass geometry, documented in the header.
    jaggyAllowance: [[120, 28]],
  },
  {
    type: WeaponType.SMG,
    pieces: SMG_AUTHORED_PIECES,
    overlays: SMG_AUTHORED_OVERLAYS,
    variantValue: {
      Barrel: [0.852, 0.851, 0.85], Grip: [0.851, 0.85, 0.852], Core: [0.852, 0.85, 0.851],
      Magazine: [0.853, 0.851, 0.85], Sight: [0.853, 0.85, 0.851], Chamber: [0.853, 0.851, 0.85],
    },
    defaults: [2, 1, 2, 2, 0, 0],
    matrixRoll: [2, 1, 0, 1, 2, 2],
    barrelZone: [130, 174, 23, 36],
    receiverZone: [58, 130, 19, 41],
    windowBox: [101, 114, 26, 37],
    lensBox: null,
    decalSeed: 7,
  },
  {
    type: WeaponType.Shotgun,
    pieces: SHOTGUN_AUTHORED_PIECES,
    overlays: SHOTGUN_AUTHORED_OVERLAYS,
    variantValue: {
      Barrel: [0.85, 0.851, 0.853], Grip: [0.85, 0.851, 0.853], Core: [0.85, 0.853, 0.851],
      Magazine: [0.85, 0.851, 0.852], Sight: [0.853, 0.851, 0.85], Chamber: [0.853, 0.85, 0.851],
    },
    defaults: [2, 1, 2, 0, 1, 0],
    matrixRoll: [1, 2, 0, 2, 1, 2],
    barrelZone: [122, 190, 22, 38],
    receiverZone: [54, 122, 19, 41],
    windowBox: [95, 108, 26, 37],
    lensBox: [74, 88, 10, 19],
    decalSeed: 7,
  },
];

function partsFor(spec: TypeSpec, tuple: Tuple): WeaponPart[] {
  return SLOTS.map((slot, i) => ({
    slot, modifier: { critDamage: spec.variantValue[slot][tuple[i]] },
  })) as unknown as WeaponPart[];
}

function base(spec: TypeSpec, over: Partial<PixelWeaponInput> = {}): PixelWeaponInput {
  return {
    weaponType: spec.type,
    manufacturer: Manufacturer.BlastForge,
    element: Element.Kinetic,
    rarity: Rarity.Common,
    rollQuality: 75,
    pixelSeed: 7,
    parts: partsFor(spec, spec.matrixRoll),
    ...over,
  };
}

function countKey(render: WeaponCardRender, key: string): number {
  let n = 0;
  for (const row of render.rows) for (const ch of row) if (ch === key) n++;
  return n;
}

function allFindings(render: LintRender, name: string): LintFinding[] {
  return [...lintRender(render, name), ...lintBanding(render, name, BANDING)];
}

for (const spec of SPECS) {
  describe(`Batch 1 authored bases — ${spec.type} lint`, () => {
    it('the 19 checked-in pieces lint at zero findings', () => {
      const colors = composeWeaponCard(base(spec, { element: Element.Shock, rarity: Rarity.Legendary })).colors;
      const pieces: [string, { rows: string[] }][] = [
        ['layout', spec.pieces.layout],
        ...spec.pieces.barrel.map((p, i) => [`barrel-${i}`, p] as [string, { rows: string[] }]),
        ...spec.pieces.grip.map((p, i) => [`grip-${i}`, p] as [string, { rows: string[] }]),
        ...spec.pieces.core.map((p, i) => [`core-${i}`, p] as [string, { rows: string[] }]),
        ...spec.pieces.magazine.map((p, i) => [`magazine-${i}`, p] as [string, { rows: string[] }]),
        ...spec.pieces.chamber.map((p, i) => [`chamber-${i}`, p] as [string, { rows: string[] }]),
        ...spec.pieces.sight.map((p, i) => [`sight-${i}`, p] as [string, { rows: string[] }]),
      ];
      expect(pieces).toHaveLength(19);
      for (const [name, piece] of pieces) {
        const w = Math.max(...piece.rows.map((r) => r.length));
        const rows = piece.rows.map((r) => r.padEnd(w, '.'));
        const found = allFindings({ rows, colors, width: w, height: rows.length }, `${spec.type}-authored/${name}`);
        expect(found, `${name}: ${JSON.stringify(found)}`).toEqual([]);
      }
    });

    it('the 30 composed matrix variants: zero on the zero-rules, orphan within the S2 budget', () => {
      for (const element of Object.values(Element)) {
        for (const rarity of Object.values(Rarity)) {
          const render = composeWeaponCard(base(spec, { element, rarity, id: `b1-matrix-${spec.type}-${element}-${rarity}` }));
          const found = allFindings(render, `${spec.type}-matrix/${element}/${rarity}`);
          const zeroRule = found.filter((f) => f.rule !== 'orphan').filter((f) => {
            // The spec's documented downstream jaggy cells (exact
            // coordinates only) are the single tolerated exception.
            if (f.rule !== 'jaggy' || !spec.jaggyAllowance) return true;
            return !(f.at ?? []).every(([x, y]) => spec.jaggyAllowance!.some(([ax, ay]) => ax === x && ay === y));
          });
          expect(zeroRule, `${element}/${rarity}: ${JSON.stringify(zeroRule)}`).toEqual([]);
          const orphanCells = found.filter((f) => f.rule === 'orphan')
            .reduce((n, f) => n + (f.at?.length ?? 0), 0);
          expect(orphanCells, `${element}/${rarity} orphan cells`).toBeLessThanOrEqual(20);
        }
      }
      // Explicit timeout, the S5 containment sweep's precedent: 30
      // composes + 60 lint evaluations per type outgrow the default
      // 5s on a contended runner; the assertions are unchanged.
    }, 120_000);
  });

  describe(`Batch 1 authored bases — ${spec.type} assembly integrity`, () => {
    it('partVariant distribution is pinned (assembly untouched)', () => {
      for (const slot of SLOTS) {
        for (let variant = 0; variant < 3; variant++) {
          const input = base(spec, {
            parts: partsFor(spec, [0, 0, 0, 0, 0, 0]).map((p) =>
              p.slot === slot ? { slot, modifier: { critDamage: spec.variantValue[slot][variant] } } as unknown as WeaponPart : p),
          });
          expect(partVariant(input, slot), `${slot} → ${variant}`).toBe(variant);
        }
      }
      const bare = base(spec, { parts: undefined });
      expect(SLOTS.map((slot) => partVariant(bare, slot))).toEqual(spec.defaults);
      const matrix = base(spec);
      expect(SLOTS.map((slot) => partVariant(matrix, slot))).toEqual(spec.matrixRoll);
    });

    it('swapping any form slot variant changes the render (no coded collapse)', () => {
      const baseSig = composeWeaponCard(base(spec, { id: 'b1-swap' })).signature;
      for (const slot of SLOTS) {
        const other = (spec.matrixRoll[SLOTS.indexOf(slot)] + 1) % 3;
        const parts = partsFor(spec, spec.matrixRoll).map((p) => (p.slot === slot
          ? { slot, modifier: { critDamage: spec.variantValue[slot][other] } }
          : p)) as unknown as WeaponPart[];
        const sig = composeWeaponCard(base(spec, { id: 'b1-swap', parts })).signature;
        expect(sig, `${slot} → ${other}`).not.toBe(baseSig);
      }
    });
  });

  describe(`Batch 1 authored bases — ${spec.type} living passes`, () => {
    it('rarity overlays stamp by tier at their coordinates', () => {
      const gAt = (render: WeaponCardRender, cells: [number, number][]) =>
        cells.filter(([x, y]) => render.rows[y][x] === 'g').length;
      const mag = spec.overlays.magStripe[spec.matrixRoll[3]];
      const rec = spec.overlays.receiverLine;
      const cha = spec.overlays.chamberLine[spec.matrixRoll[5]];
      const at = (rarity: Rarity) => composeWeaponCard(base(spec, { rarity, id: 'b1-overlay' }));
      expect(gAt(at(Rarity.Common), mag)).toBe(0);
      expect(gAt(at(Rarity.Common), rec)).toBe(0);
      expect(gAt(at(Rarity.Common), cha)).toBe(0);
      // Landed counts equal the authored counts for these types:
      // no maker detail overdrawing lands on the overlay cells.
      expect(gAt(at(Rarity.Uncommon), mag)).toBe(mag.length);
      expect(gAt(at(Rarity.Uncommon), rec)).toBe(0);
      expect(gAt(at(Rarity.Rare), rec)).toBe(rec.length);
      expect(gAt(at(Rarity.Rare), cha)).toBe(0);
      expect(gAt(at(Rarity.Epic), cha)).toBe(cha.length);
      expect(gAt(at(Rarity.Legendary), cha)).toBe(cha.length);
    });

    it('godroll sparkles land on the authored barrel', () => {
      const render = composeWeaponCard(base(spec, {
        element: Element.Shock, rarity: Rarity.Legendary, rollQuality: 100, id: 'b1-godroll',
      }));
      const [x0, x1, y0, y1] = spec.barrelZone;
      let sparkles = 0;
      render.rows.forEach((row, y) => {
        [...row].forEach((ch, x) => { if (ch === 'G' && x >= x0 && x <= x1 && y >= y0 && y <= y1) sparkles++; });
      });
      expect(sparkles).toBeGreaterThan(0);
    });

    it('wear erases cells out of the authored receiver', () => {
      const pristine = composeWeaponCard(base(spec, { id: 'b1-wear' }));
      const worn = composeWeaponCard(base(spec, { id: 'b1-wear', rollQuality: 25 }));
      const filled = (r: WeaponCardRender) => r.rows.reduce((n, row) => n + [...row].filter((c) => c !== '.').length, 0);
      expect(filled(worn)).toBeLessThan(filled(pristine));
      const [x0, x1, y0, y1] = spec.receiverZone;
      let holes = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (pristine.rows[y][x] !== '.' && worn.rows[y][x] === '.') holes++;
      }
      expect(holes).toBeGreaterThan(0);
    });

    it('an affix decal stamps onto the authored body', () => {
      const affixes: Affix[] = [
        { id: 'af-1', category: 'elemental', stat: 'statusChance', value: 4, displayText: '+4% status' },
        { id: 'af-2', category: 'boss', stat: 'bossDamageMod', value: 9, displayText: '+9% boss damage' },
      ];
      // Decal positions are seed-derived view-space points. On the
      // short pistol the seed-7 pair lands in air beside the gun
      // (pre-existing decal geometry — the procedural pistol missed
      // the same way), so each type uses the seed whose decals land
      // on its silhouette; the assertion is that they stamp.
      const plain = composeWeaponCard(base(spec, { id: 'b1-decal', pixelSeed: spec.decalSeed }));
      const decaled = composeWeaponCard(base(spec, { id: 'b1-decal', pixelSeed: spec.decalSeed, affixes }));
      expect(decaled.signature).not.toBe(plain.signature);
      expect(countKey(decaled, 'T') + countKey(decaled, 'G')).toBeGreaterThan(countKey(plain, 'T') + countKey(plain, 'G'));
    });

    it('Kinetic window rule: the chamber window resolves onto the body ramp', () => {
      const kinetic = composeWeaponCard(base(spec, { id: 'b1-kinetic' }));
      expect(countKey(kinetic, 'E')).toBe(0);
      expect(countKey(kinetic, 'c')).toBe(0);
      // The reflex lens keeps its glass glints (production lens
      // behavior); the aperture tower carries none. Everywhere
      // else 'e' is remapped.
      let eOutsideLens = 0;
      kinetic.rows.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch !== 'e') return;
          const inLens = spec.lensBox !== null
            && x >= spec.lensBox[0] && x <= spec.lensBox[1] && y >= spec.lensBox[2] && y <= spec.lensBox[3];
          if (!inLens) eOutsideLens++;
        });
      });
      expect(eOutsideLens).toBe(0);
      const [x0, x1, y0, y1] = spec.windowBox;
      let pInWindow = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (kinetic.rows[y][x] === 'p') pInWindow++;
      expect(pInWindow).toBeGreaterThan(10);
      const shock = composeWeaponCard(base(spec, { id: 'b1-kinetic', element: Element.Shock }));
      expect(countKey(shock, 'E')).toBeGreaterThan(10);
    });

    it('Ironwood rides the wood ramp: no metal body cells survive the remap', () => {
      const render = composeWeaponCard(base(spec, { manufacturer: Manufacturer.Ironwood, id: 'b1-wood' }));
      expect(countKey(render, 'P')).toBe(0);
      expect(countKey(render, 'w')).toBeGreaterThan(100);
    });
  });
}

describe('Batch 1 authored bases — anchor parity', () => {
  it('the pistol seats no Stock anchor; the shotgun no Magazine anchor', () => {
    const byType = (type: WeaponType) => composeWeaponCard({
      weaponType: type, manufacturer: Manufacturer.BlastForge, rarity: Rarity.Common, rollQuality: 75, pixelSeed: 7,
    });
    expect(byType(WeaponType.Pistol).partAnchors.Stock).toBeUndefined();
    expect(byType(WeaponType.Pistol).partAnchors.Magazine).toBeDefined();
    expect(byType(WeaponType.Shotgun).partAnchors.Magazine).toBeUndefined();
    expect(byType(WeaponType.Shotgun).partAnchors.Stock).toBeDefined();
    expect(byType(WeaponType.SMG).partAnchors.Magazine).toBeDefined();
    expect(byType(WeaponType.SMG).partAnchors.Stock).toBeDefined();
  });

  it('the shotgun bead stays drawn in code at the procedural seat, in both modes', () => {
    const input: PixelWeaponInput = {
      weaponType: WeaponType.Shotgun, manufacturer: Manufacturer.BlastForge, rarity: Rarity.Common, rollQuality: 75, pixelSeed: 7,
    };
    // Bead: (bodyFront + barrelLen - 3, SPINE - 8) = (187, 22).
    expect(composeWeaponCard(input).rows[22][187]).toBe('G');
    expect(composeWeaponCard(input, undefined, { held: true }).rows[22][187]).toBe('G');
  });
});

describe('Batch 1 authored bases — pistol barrel variants, composed', () => {
  // The matrix roll exercises the braked barrel (variant 1). The
  // other two composed barrels lint here at the S2 gate's own
  // weapon-card standard: zero on banding / pillow / colors /
  // near-duplicate, orphan ≤ 20, jaggy within the gate's budget of
  // 6 cells per render. Measured on the approved form: the plain
  // barrel is clean; the suppressed can's composed outline carries
  // 2 doubled corners at its shoulder step (152, 26) plus, under
  // Shock, the element bed's step at (158, 27) — form-in-composition
  // geometry the approved package's matrix (braked roll) never
  // exercised, recorded here rather than re-authored away: the
  // owner approved the form as authored.
  it('all three barrels compose within the S2 weapon-card budgets', () => {
    const spec = SPECS[0];
    for (let barrelV = 0; barrelV < 3; barrelV++) {
      for (const [element, rarity] of [[Element.Kinetic, Rarity.Common], [Element.Shock, Rarity.Legendary]] as const) {
        const render = composeWeaponCard(base(spec, {
          element, rarity,
          parts: partsFor(spec, [barrelV, 1, 1, 1, 1, 2]),
          id: `b1-barrels-Pistol-${barrelV}-${element}-${rarity}`,
        }));
        const found = allFindings(render, `Pistol-barrels/${barrelV}/${element}/${rarity}`);
        const hardZero = found.filter((f) => f.rule !== 'orphan' && f.rule !== 'jaggy');
        expect(hardZero, `barrel ${barrelV} ${element}/${rarity}: ${JSON.stringify(hardZero)}`).toEqual([]);
        const orphanCells = found.filter((f) => f.rule === 'orphan').reduce((n, f) => n + (f.at?.length ?? 0), 0);
        expect(orphanCells, `barrel ${barrelV} ${element}/${rarity} orphan cells`).toBeLessThanOrEqual(20);
        const jaggyCells = found.filter((f) => f.rule === 'jaggy').reduce((n, f) => n + (f.at?.length ?? 0), 0);
        expect(jaggyCells, `barrel ${barrelV} ${element}/${rarity} jaggy cells`).toBeLessThanOrEqual(6);
      }
    }
  }, 120_000);
});

describe('Batch 1 authored bases — containment', () => {
  it('the sniper card renders and every pixel render are byte-identical to the pre-batch-1 sweep (batch-2 types excluded by their own slice)', () => {
    const sigs: Record<string, string> = {};
    for (const type of Object.values(WeaponType)) {
      for (const manufacturer of Object.values(Manufacturer)) {
        for (const element of [Element.Kinetic, Element.Fire, Element.Shock, Element.Void]) {
          for (const rarity of [Rarity.Common, Rarity.Rare, Rarity.Legendary]) {
            const input: PixelWeaponInput = {
              weaponType: type, manufacturer, element, rarity,
              rollQuality: 75, pixelSeed: 4242, id: `contain-${type}-${manufacturer}-${element}-${rarity}`,
            };
            // Re-scoped at the reconciliation merge (see the
            // header): batch 2's card types (Launcher, Beam) are
            // outside this pin — their renders are batch 2's
            // deliberate target, characterized by their own
            // suite. What remains pinned here: the sniper's card
            // renders + every pixel render.
            if (type === WeaponType.Sniper) sigs[`card/${type}/${manufacturer}/${element}/${rarity}`] = composeWeaponCard(input).signature;
            sigs[`pixel/${type}/${manufacturer}/${element}/${rarity}`] = composePixelWeapon(input).signature;
          }
        }
      }
    }
    expect(Object.keys(sigs)).toHaveLength(504);
    let h = 0x811c9dc5;
    const joined = Object.keys(sigs).sort().map((k) => `${k}=${sigs[k]}`).join('\n');
    for (let i = 0; i < joined.length; i++) h = Math.imul(h ^ joined.charCodeAt(i), 0x01000193);
    expect((h >>> 0).toString(16).padStart(8, '0')).toBe('868d8adf');
  }, 120_000);
});
