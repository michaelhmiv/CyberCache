/**
 * Pxl Craft Sweep S5 scale-up, batch 2 — authored bases for the
 * LAUNCHER and the BEAM (the last two of the five remaining weapon
 * types in declaration order; the sniper pilot is
 * sniperAuthoredBases.test.ts, Pistol/SMG/Shotgun are the sibling
 * batch).
 *
 * What this pins, per type, mirroring the pilot:
 *  - Lint: the authored pieces (Launcher 17 piece slots — the
 *    drum drawing holds Magazine rolls 0 and 2; Beam 19 pieces),
 *    as checked-in grid data, lint at ZERO findings under the
 *    repo's pxl port, and so do the composed matrix variants
 *    (6 elements × 5 rarities at each type's representative part
 *    roll) on every rule the S2 gate asserts at zero. Orphan is
 *    the one budgeted rule, per the S2 calibration doctrine: the
 *    batch's measured per-render maxima are pinned (Launcher 25 —
 *    its Legendary halo sheds single cells around the biggest
 *    silhouette of the three authored types; Beam 14). The S2
 *    gate's own corpus stays within its global budget of 20.
 *  - Assembly integrity: partVariant() is pinned value-for-value
 *    per type (the hash is type-dependent — each type's table was
 *    measured on the untouched implementation), and swapping any
 *    form slot's variant changes the composed render, with the
 *    two coded exceptions the launcher's production passes
 *    dictate: its Sight roll cannot change the render (the sight
 *    form is the carry handle — one piece, no roll), and its
 *    Magazine rolls 0 and 2 cannot differ (one drum drawing, the
 *    way production draws the drum for both). The Beam collapses
 *    nothing: all six slots move the render, Sight included.
 *  - The living passes land on authored bases: rarity overlays by
 *    tier (landed counts pinned), godroll sparkles, wear erasure,
 *    affix decals, the Kinetic window rule (Launcher: the chamber
 *    window; Beam: the whole current path — layout spine row,
 *    chamber window, cell gauge — because for the Beam the
 *    element current IS the form), the Ironwood wood-ramp remap,
 *    and the Launcher warhead's glow tip: the cone tip is form
 *    drawn in the glow key 'G', so it reads 'G' at every rarity —
 *    never the trim key 'g' (the converter's disambiguation pin).
 *  - Containment: everything batch 2 must NOT move that the S5
 *    pin does not already cover — the sniper's card renders
 *    (authored in S5, untouched here) and every pixel-path
 *    render — pinned as one super-hash over 504 render
 *    signatures swept on the pre-batch master (evidence:
 *    cybercache-prep/pxl-craft-sweep/scaleup-batch2/renders/
 *    containment-baseline.json). Together with the S5 file's
 *    re-pinned 648, every render outside this batch's two target
 *    types is pinned by at least one suite.
 */
import { describe, expect, it } from 'vitest';
import { Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Affix, WeaponPart } from '../types/items';
import { composeWeaponCard, type WeaponCardRender } from '../lib/pixel/weaponCardCompositor';
import {
  LAUNCHER_AUTHORED_OVERLAYS,
  LAUNCHER_AUTHORED_PIECES,
} from '../lib/pixel/launcherAuthoredData';
import {
  BEAM_AUTHORED_OVERLAYS,
  BEAM_AUTHORED_PIECES,
} from '../lib/pixel/beamAuthoredData';
import { composePixelWeapon, partVariant, type PixelWeaponInput } from '../lib/pixel/weaponCompositor';
import { lintBanding, lintRender, type LintFinding, type LintRender } from './pixelLint';
import { BANDING_BY_SYSTEM } from './pxlLintCorpus';

const BANDING = BANDING_BY_SYSTEM['weapon-card'];
const SLOTS = ['Barrel', 'Grip', 'Core', 'Magazine', 'Sight', 'Chamber'] as const;
type Slot = (typeof SLOTS)[number];

/**
 * Single-stat parts whose full-map hash selects a known variant,
 * per type (partVariant input→slot mapping, measured on the
 * untouched implementation): critDamage value per slot per
 * variant index.
 */
const VARIANT_VALUE: Record<'Launcher' | 'Beam', Record<Slot, [number, number, number]>> = {
  Launcher: {
    Barrel: [0.9005, 0.9015, 0.9], Grip: [0.9015, 0.9, 0.9005], Core: [0.9015, 0.9005, 0.9],
    Magazine: [0.9, 0.9005, 0.9025], Sight: [0.9015, 0.9005, 0.9], Chamber: [0.9015, 0.9, 0.9005],
  },
  Beam: {
    Barrel: [0.9025, 0.9005, 0.9], Grip: [0.9005, 0.9, 0.9025], Core: [0.9025, 0.9, 0.9005],
    Magazine: [0.9, 0.9015, 0.9005], Sight: [0.9015, 0.9, 0.9005], Chamber: [0.9005, 0.9, 0.9015],
  },
};
/** No-parts defaults (the hash of the default key, per slot). */
const DEFAULTS: Record<'Launcher' | 'Beam', number[]> = {
  Launcher: [2, 1, 0, 0, 0, 2],
  Beam: [0, 2, 2, 0, 0, 2],
};
/** The representative rolls the judgment sheets were rendered at. */
const REP_TUPLE: Record<'Launcher' | 'Beam', number[]> = {
  Launcher: [0, 1, 2, 0, 1, 2],
  Beam: [0, 1, 0, 1, 0, 1],
};
/** Measured matrix orphan maxima (see the header's budget note). */
const ORPHAN_BUDGET: Record<'Launcher' | 'Beam', number> = { Launcher: 25, Beam: 14 };

function partsFor(type: 'Launcher' | 'Beam', tuple: number[]): WeaponPart[] {
  return SLOTS.map((slot, i) => ({
    slot, modifier: { critDamage: VARIANT_VALUE[type][slot][tuple[i]] },
  })) as unknown as WeaponPart[];
}

function gun(type: 'Launcher' | 'Beam', over: Partial<PixelWeaponInput> = {}): PixelWeaponInput {
  return {
    weaponType: WeaponType[type],
    manufacturer: Manufacturer.BlastForge,
    element: Element.Kinetic,
    rarity: Rarity.Common,
    rollQuality: 75,
    pixelSeed: 7,
    parts: partsFor(type, REP_TUPLE[type]),
    ...over,
  };
}

function countKey(render: WeaponCardRender, key: string): number {
  let n = 0;
  for (const row of render.rows) for (const ch of row) if (ch === key) n++;
  return n;
}
function countKeyIn(render: WeaponCardRender, key: string, x0: number, x1: number, y0: number, y1: number): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (render.rows[y][x] === key) n++;
  return n;
}
function allFindings(render: LintRender, name: string): LintFinding[] {
  return [...lintRender(render, name), ...lintBanding(render, name, BANDING)];
}

const TYPES = ['Launcher', 'Beam'] as const;

describe('batch 2 authored bases — lint', () => {
  for (const type of TYPES) {
    it(`${type}: the checked-in pieces lint at zero findings`, () => {
      const P = type === 'Launcher' ? LAUNCHER_AUTHORED_PIECES : BEAM_AUTHORED_PIECES;
      const colors = composeWeaponCard(gun(type, { element: Element.Shock, rarity: Rarity.Legendary })).colors;
      const pieces: [string, { rows: string[] }][] = [
        ['layout', P.layout],
        ...P.barrel.map((p, i) => [`barrel-${i}`, p] as [string, { rows: string[] }]),
        ...P.grip.map((p, i) => [`grip-${i}`, p] as [string, { rows: string[] }]),
        ...P.core.map((p, i) => [`core-${i}`, p] as [string, { rows: string[] }]),
        ...P.magazine.map((p, i) => [`magazine-${i}`, p] as [string, { rows: string[] }]),
        ...P.chamber.map((p, i) => [`chamber-${i}`, p] as [string, { rows: string[] }]),
        ...(type === 'Launcher'
          ? [['sight', LAUNCHER_AUTHORED_PIECES.sight] as [string, { rows: string[] }]]
          : BEAM_AUTHORED_PIECES.sight.map((p, i) => [`sight-${i}`, p] as [string, { rows: string[] }])),
      ];
      expect(pieces, `${type} piece count`).toHaveLength(type === 'Launcher' ? 17 : 19);
      for (const [name, piece] of pieces) {
        const w = Math.max(...piece.rows.map((r) => r.length));
        const rows = piece.rows.map((r) => r.padEnd(w, '.'));
        const found = allFindings({ rows, colors, width: w, height: rows.length }, `${type}-authored/${name}`);
        expect(found, `${type}/${name}: ${JSON.stringify(found)}`).toEqual([]);
      }
    });

    it(`${type}: the 30 composed matrix variants — zero on the zero-rules, orphan within the batch budget`, () => {
      for (const element of Object.values(Element)) {
        for (const rarity of Object.values(Rarity)) {
          const render = composeWeaponCard(gun(type, { element, rarity, id: `b2-matrix-${type}-${element}-${rarity}` }));
          const found = allFindings(render, `${type}-matrix/${element}/${rarity}`);
          const zeroRule = found.filter((f) => f.rule !== 'orphan');
          expect(zeroRule, `${type} ${element}/${rarity}: ${JSON.stringify(zeroRule)}`).toEqual([]);
          const orphanCells = found.filter((f) => f.rule === 'orphan')
            .reduce((n, f) => n + (f.at?.length ?? 0), 0);
          expect(orphanCells, `${type} ${element}/${rarity} orphan cells`).toBeLessThanOrEqual(ORPHAN_BUDGET[type]);
        }
      }
    }, 120_000);
  }
});

describe('batch 2 authored bases — assembly integrity', () => {
  for (const type of TYPES) {
    it(`${type}: partVariant distribution is pinned (assembly untouched)`, () => {
      for (const slot of SLOTS) {
        for (let variant = 0; variant < 3; variant++) {
          const input = gun(type, {
            parts: partsFor(type, [0, 0, 0, 0, 0, 0]).map((p) =>
              p.slot === slot ? { slot, modifier: { critDamage: VARIANT_VALUE[type][slot][variant] } } as unknown as WeaponPart : p),
          });
          expect(partVariant(input, slot), `${type} ${slot} → ${variant}`).toBe(variant);
        }
      }
      const bare = gun(type, { parts: undefined });
      expect(SLOTS.map((slot) => partVariant(bare, slot)), `${type} defaults`).toEqual(DEFAULTS[type]);
      const rep = gun(type);
      expect(SLOTS.map((slot) => partVariant(rep, slot)), `${type} rep tuple`).toEqual(REP_TUPLE[type]);
    });
  }

  it('Launcher: swapping any form slot changes the render; Sight and the shared drum cannot', () => {
    const base = composeWeaponCard(gun('Launcher', { id: 'b2-swap' })).signature;
    const swapped = (slot: Slot, variant: number) => {
      const tuple = [...REP_TUPLE.Launcher];
      tuple[SLOTS.indexOf(slot)] = variant;
      return composeWeaponCard(gun('Launcher', { id: 'b2-swap', parts: partsFor('Launcher', tuple) })).signature;
    };
    expect(swapped('Barrel', 1)).not.toBe(base);
    expect(swapped('Grip', 2)).not.toBe(base);
    expect(swapped('Core', 0)).not.toBe(base);
    expect(swapped('Chamber', 0)).not.toBe(base);
    // The drum holds Magazine rolls 0 and 2 (production's two
    // effective forms): roll 1 (the box) differs, roll 2 cannot.
    expect(swapped('Magazine', 1)).not.toBe(base);
    expect(swapped('Magazine', 2)).toBe(base);
    // The carry handle is one piece: the Sight roll still selects
    // a variant, and the render cannot change.
    expect(partVariant(gun('Launcher', { parts: partsFor('Launcher', [0, 1, 2, 0, 2, 2]) }), 'Sight')).toBe(2);
    expect(swapped('Sight', 2)).toBe(base);
  });

  it('Beam: swapping any slot variant changes the render — Sight included, nothing collapses', () => {
    const base = composeWeaponCard(gun('Beam', { id: 'b2-swap' })).signature;
    const swapped = (slot: Slot) => {
      const tuple = [...REP_TUPLE.Beam];
      const i = SLOTS.indexOf(slot);
      tuple[i] = (tuple[i] + 1) % 3;
      return composeWeaponCard(gun('Beam', { id: 'b2-swap', parts: partsFor('Beam', tuple) })).signature;
    };
    for (const slot of SLOTS) expect(swapped(slot), `Beam swap ${slot}`).not.toBe(base);
  });
});

describe('batch 2 authored bases — the living passes land', () => {
  const gAt = (render: WeaponCardRender, cells: [number, number][]) =>
    cells.filter(([x, y]) => render.rows[y][x] === 'g').length;

  it('Launcher: rarity overlays stamp by tier at their coordinates', () => {
    const O = LAUNCHER_AUTHORED_OVERLAYS;
    const mag = O.magStripe[0]; const rec = O.receiverLine; const cha = O.chamberLine[2];
    const at = (rarity: Rarity) => composeWeaponCard(gun('Launcher', { rarity, id: 'b2-overlay' }));
    expect(gAt(at(Rarity.Common), mag)).toBe(0);
    expect(gAt(at(Rarity.Common), rec)).toBe(0);
    expect(gAt(at(Rarity.Common), cha)).toBe(0);
    expect(gAt(at(Rarity.Uncommon), mag)).toBe(5);
    expect(gAt(at(Rarity.Uncommon), rec)).toBe(0);
    // The receiver line lands under later passes, which overdraw
    // a few trim cells — the landed count is pinned, not the
    // drawn count (the S5 chamber-line precedent).
    expect(gAt(at(Rarity.Rare), rec)).toBe(70);
    expect(gAt(at(Rarity.Rare), cha)).toBe(0);
    expect(gAt(at(Rarity.Epic), cha)).toBe(12);
    expect(gAt(at(Rarity.Legendary), cha)).toBe(12);
    expect(gAt(at(Rarity.Legendary), rec)).toBe(70);
  });

  it('Beam: rarity overlays stamp by tier at their coordinates', () => {
    const O = BEAM_AUTHORED_OVERLAYS;
    const mag = O.magStripe[1]; const rec = O.receiverLine; const cha = O.chamberLine[1];
    const at = (rarity: Rarity) => composeWeaponCard(gun('Beam', { rarity, id: 'b2-overlay' }));
    expect(gAt(at(Rarity.Common), mag)).toBe(0);
    expect(gAt(at(Rarity.Common), rec)).toBe(0);
    expect(gAt(at(Rarity.Common), cha)).toBe(0);
    expect(gAt(at(Rarity.Uncommon), mag)).toBe(36);
    expect(gAt(at(Rarity.Uncommon), rec)).toBe(0);
    expect(gAt(at(Rarity.Rare), rec)).toBe(33);
    expect(gAt(at(Rarity.Rare), cha)).toBe(0);
    expect(gAt(at(Rarity.Epic), cha)).toBe(16);
    expect(gAt(at(Rarity.Legendary), cha)).toBe(16);
    expect(gAt(at(Rarity.Legendary), rec)).toBe(33);
  });

  for (const type of TYPES) {
    it(`${type}: godroll sparkles land, wear erases, decals stamp`, () => {
      const clean = composeWeaponCard(gun(type, { rarity: Rarity.Legendary, id: 'b2-living' }));
      const god = composeWeaponCard(gun(type, { rarity: Rarity.Legendary, rollQuality: 100, id: 'b2-living' }));
      expect(countKey(god, 'G'), `${type} godroll glow`).toBeGreaterThan(countKey(clean, 'G'));
      const pristine = composeWeaponCard(gun(type, { id: 'b2-living' }));
      const worn = composeWeaponCard(gun(type, { id: 'b2-living', rollQuality: 25 }));
      const filled = (r: WeaponCardRender) => r.rows.reduce((n, row) => n + [...row].filter((c) => c !== '.').length, 0);
      expect(filled(worn), `${type} wear`).toBeLessThan(filled(pristine));
      const affixes: Affix[] = [
        { id: 'af-1', category: 'elemental', stat: 'statusChance', value: 4, displayText: '+4% status' },
        { id: 'af-2', category: 'boss', stat: 'bossDamageMod', value: 9, displayText: '+9% boss damage' },
      ];
      const decaled = composeWeaponCard(gun(type, { id: 'b2-living', affixes }));
      expect(decaled.signature, `${type} decal signature`).not.toBe(pristine.signature);
      expect(countKey(decaled, 'T') + countKey(decaled, 'G'), `${type} decal cells`)
        .toBeGreaterThan(countKey(pristine, 'T') + countKey(pristine, 'G'));
    });

    it(`${type}: Ironwood rides the wood ramp — no metal body cells survive the remap`, () => {
      const render = composeWeaponCard(gun(type, { manufacturer: Manufacturer.Ironwood, id: 'b2-wood' }));
      expect(countKey(render, 'P')).toBe(0);
      expect(countKey(render, 'w')).toBeGreaterThan(100);
    });
  }

  it('Launcher: Kinetic window rule — the chamber window resolves onto the body ramp', () => {
    const kinetic = composeWeaponCard(gun('Launcher', { id: 'b2-kinetic' }));
    expect(countKey(kinetic, 'E')).toBe(0);
    expect(countKey(kinetic, 'c')).toBe(0);
    // Warm glass ('p') fills the chamber window (chamber seats
    // x 104..125, y 26..36 across the three variants).
    expect(countKeyIn(kinetic, 'p', 104, 125, 26, 36)).toBeGreaterThan(10);
    const shock = composeWeaponCard(gun('Launcher', { id: 'b2-kinetic', element: Element.Shock }));
    expect(countKey(shock, 'E')).toBeGreaterThan(10);
    // The current ARRIVES: element texels reach deep into the
    // barrel zone, riding the authored tube to the warhead.
    let maxEX = -1;
    shock.rows.forEach((row) => { for (let x = 0; x < row.length; x++) if (row[x] === 'E') maxEX = Math.max(maxEX, x); });
    expect(maxEX).toBeGreaterThan(166);
  });

  it('Launcher: the warhead tip is glow-key form — identical at Common and Uncommon, never trim', () => {
    // The cone-tip columns (local dx 14..17 of the barrel piece).
    // The Uncommon trim line legitimately crosses the tube's top
    // edge further back — the pin is scoped to the tip itself:
    // its cells are 'G' at both rarities and no trim cell lands
    // among them (a tip stored as 'g' would flip to the rarity
    // frame color — lawngreen at Uncommon — exactly the failure
    // this guards).
    const tipG = (rarity: Rarity) => countKeyIn(composeWeaponCard(gun('Launcher', { rarity, id: 'b2-tip' })), 'G', 204, 207, 20, 40);
    const tipg = (rarity: Rarity) => countKeyIn(composeWeaponCard(gun('Launcher', { rarity, id: 'b2-tip' })), 'g', 204, 207, 20, 40);
    expect(tipG(Rarity.Common)).toBe(16);
    expect(tipG(Rarity.Uncommon)).toBe(16);
    expect(tipg(Rarity.Common)).toBe(0);
    expect(tipg(Rarity.Uncommon)).toBe(0);
  });

  it('Beam: Kinetic window rule — the whole current path resolves onto the body ramp', () => {
    const kinetic = composeWeaponCard(gun('Beam', { id: 'b2-kinetic' }));
    expect(countKey(kinetic, 'E')).toBe(0);
    expect(countKey(kinetic, 'c')).toBe(0);
    // The spine channel reads as warm conduit ('p') along the
    // receiver (the layout's channel row, y = SPINE).
    let pInChannel = 0;
    for (let x = 70; x <= 144; x++) if (kinetic.rows[30][x] === 'p') pInChannel++;
    expect(pInChannel).toBeGreaterThan(10);
    const shock = composeWeaponCard(gun('Beam', { id: 'b2-kinetic', element: Element.Shock }));
    expect(countKey(shock, 'E')).toBeGreaterThan(10);
  });
});

describe('batch 2 authored bases — containment', () => {
  it('sniper card renders and all pixel renders are byte-identical to the pre-batch sweep', () => {
    const sigs: Record<string, string> = {};
    for (const type of Object.values(WeaponType)) {
      for (const manufacturer of Object.values(Manufacturer)) {
        for (const element of [Element.Kinetic, Element.Fire, Element.Shock, Element.Void]) {
          for (const rarity of [Rarity.Common, Rarity.Rare, Rarity.Legendary]) {
            const input: PixelWeaponInput = {
              weaponType: type, manufacturer, element, rarity,
              rollQuality: 75, pixelSeed: 4242, id: `contain-${type}-${manufacturer}-${element}-${rarity}`,
            };
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
