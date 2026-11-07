/**
 * Pxl Craft Sweep S5 — the authored-bases pilot (sniper).
 *
 * What this pins:
 *  - Lint: the 17 authored pieces, as checked-in grid data, lint at
 *    ZERO findings under the repo's pxl port (pixelLint.ts + the
 *    weapon-card banding options), and so do the composed matrix
 *    variants (6 elements × 5 rarities, one fixed representative
 *    part roll) on every rule the S2 gate asserts at zero (banding,
 *    jaggy, pillow, colors, near-duplicate). Orphan is the one
 *    budgeted rule, per the S2 calibration doctrine: the game's
 *    seeded detail passes (wear scratches, maker speckle, element
 *    finish, Legendary glow) shed single cells whose positions are
 *    seed luck, so the gate freezes a per-render budget instead —
 *    weapon-card orphan ≤ 20 stray cells, the S2 maximum, which
 *    the authored matrix meets (observed range 3–20).
 *  - Assembly integrity: partVariant() — the hash over each part's
 *    full modifier map — is pinned value-for-value, and swapping
 *    any form slot's variant changes the composed render, so the
 *    authored data never flattens the part roll. The Sight slot
 *    stays the coded collapse (scope 6): its roll still selects
 *    among variants, but the sniper ships one scope, so the
 *    render cannot change.
 *  - Containment: everything S5 must NOT move — every non-sniper
 *    card render and every pixel-path render (sniper included) —
 *    pinned as one super-hash over 792 render signatures swept on
 *    the pre-S5 master (evidence: cybercache-prep/pxl-craft-sweep/
 *    s5-evidence/renders/containment-baseline.json). Any future
 *    change that moves one of those renders fails here and
 *    re-pins deliberately, the way the card goldens do.
 *  - The living passes land on authored bases: rarity overlays by
 *    tier (exact landed cell counts at the overlay coordinates),
 *    godroll sparkles, wear erasure, affix decals, the Kinetic
 *    window rule (grill 2), and the Ironwood wood-ramp remap
 *    (grill 1's maker-neutrality mechanics).
 */
import { describe, expect, it } from 'vitest';
import { Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Affix, WeaponPart } from '../types/items';
import { composeWeaponCard, type WeaponCardRender } from '../lib/pixel/weaponCardCompositor';
import {
  SNIPER_AUTHORED_OVERLAYS,
  SNIPER_AUTHORED_PIECES,
} from '../lib/pixel/sniperAuthoredData';
import { composePixelWeapon, partVariant, type PixelWeaponInput } from '../lib/pixel/weaponCompositor';
import { lintBanding, lintRender, type LintFinding, type LintRender } from './pixelLint';
import { BANDING_BY_SYSTEM } from './pxlLintCorpus';

const BANDING = BANDING_BY_SYSTEM['weapon-card'];
const SLOTS = ['Barrel', 'Grip', 'Core', 'Magazine', 'Sight', 'Chamber'] as const;

/**
 * Single-stat parts whose full-map hash selects a known variant
 * (partVariant input→slot mapping, measured on the untouched
 * implementation): critDamage value per slot per variant index.
 */
const VARIANT_VALUE: Record<string, [number, number, number]> = {
  Barrel: [0.903, 0.901, 0.9],
  Grip: [0.903, 0.901, 0.9],
  Core: [0.9, 0.901, 0.903],
  Magazine: [0.9, 0.902, 0.901],
  Sight: [0.9, 0.901, 0.902],
  Chamber: [0.901, 0.9, 0.902],
};

function partsFor(tuple: [number, number, number, number, number, number]): WeaponPart[] {
  return SLOTS.map((slot, i) => ({
    slot, modifier: { critDamage: VARIANT_VALUE[slot][tuple[i]] },
  })) as unknown as WeaponPart[];
}

/** The matrix roll: Barrel 2 / Grip 2 / Core 2 / Magazine 1 / Sight 2 / Chamber 2. */
const MATRIX_PARTS = partsFor([2, 2, 2, 1, 2, 2]);

function sniper(over: Partial<PixelWeaponInput> = {}): PixelWeaponInput {
  return {
    weaponType: WeaponType.Sniper,
    manufacturer: Manufacturer.BlastForge,
    element: Element.Kinetic,
    rarity: Rarity.Common,
    rollQuality: 75,
    pixelSeed: 7,
    parts: MATRIX_PARTS,
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

describe('S5 authored bases — lint', () => {
  it('the 17 checked-in pieces lint at zero findings', () => {
    // Palette context: a composed render's resolved hexes (every
    // form key the pieces use is present on a Shock Legendary).
    const colors = composeWeaponCard(sniper({ element: Element.Shock, rarity: Rarity.Legendary })).colors;
    const pieces: [string, { rows: string[] }][] = [
      ['layout', SNIPER_AUTHORED_PIECES.layout],
      ...SNIPER_AUTHORED_PIECES.barrel.map((p, i) => [`barrel-${i}`, p] as [string, { rows: string[] }]),
      ...SNIPER_AUTHORED_PIECES.grip.map((p, i) => [`grip-${i}`, p] as [string, { rows: string[] }]),
      ...SNIPER_AUTHORED_PIECES.core.map((p, i) => [`core-${i}`, p] as [string, { rows: string[] }]),
      ...SNIPER_AUTHORED_PIECES.magazine.map((p, i) => [`magazine-${i}`, p] as [string, { rows: string[] }]),
      ...SNIPER_AUTHORED_PIECES.chamber.map((p, i) => [`chamber-${i}`, p] as [string, { rows: string[] }]),
      ['sight', SNIPER_AUTHORED_PIECES.sight],
    ];
    expect(pieces).toHaveLength(17);
    for (const [name, piece] of pieces) {
      const w = Math.max(...piece.rows.map((r) => r.length));
      const rows = piece.rows.map((r) => r.padEnd(w, '.'));
      const found = allFindings({ rows, colors, width: w, height: rows.length }, `sniper-authored/${name}`);
      expect(found, `${name}: ${JSON.stringify(found)}`).toEqual([]);
    }
  });

  it('the 30 composed matrix variants: zero on the zero-rules, orphan within the S2 budget', () => {
    for (const element of Object.values(Element)) {
      for (const rarity of Object.values(Rarity)) {
        const render = composeWeaponCard(sniper({ element, rarity, id: `s5-matrix-${element}-${rarity}` }));
        const found = allFindings(render, `sniper-matrix/${element}/${rarity}`);
        const zeroRule = found.filter((f) => f.rule !== 'orphan');
        expect(zeroRule, `${element}/${rarity}: ${JSON.stringify(zeroRule)}`).toEqual([]);
        const orphanCells = found.filter((f) => f.rule === 'orphan')
          .reduce((n, f) => n + (f.at?.length ?? 0), 0);
        expect(orphanCells, `${element}/${rarity} orphan cells`).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('S5 authored bases — assembly integrity', () => {
  it('partVariant distribution is pinned (assembly untouched)', () => {
    for (const slot of SLOTS) {
      for (let variant = 0; variant < 3; variant++) {
        const input = sniper({ parts: partsFor([0, 0, 0, 0, 0, 0]).map((p) =>
          p.slot === slot ? { slot, modifier: { critDamage: VARIANT_VALUE[slot][variant] } } as unknown as WeaponPart : p) });
        expect(partVariant(input, slot), `${slot} → ${variant}`).toBe(variant);
      }
    }
    // No-parts defaults (the hash of the default key, per slot).
    const bare = sniper({ parts: undefined });
    expect(SLOTS.map((slot) => partVariant(bare, slot))).toEqual([1, 2, 2, 1, 2, 2]);
    // The matrix roll selects the intended tuple.
    const matrix = sniper();
    expect(SLOTS.map((slot) => partVariant(matrix, slot))).toEqual([2, 2, 2, 1, 2, 2]);
  });

  it('swapping any form slot variant changes the render; Sight cannot', () => {
    const base = composeWeaponCard(sniper({ id: 's5-swap' })).signature;
    const swapped = (slot: string, variant: number) => {
      const parts = MATRIX_PARTS.map((p) => (p.slot === slot
        ? { slot, modifier: { critDamage: VARIANT_VALUE[slot][variant] } }
        : p)) as unknown as WeaponPart[];
      return composeWeaponCard(sniper({ id: 's5-swap', parts })).signature;
    };
    expect(swapped('Barrel', 1)).not.toBe(base);
    expect(swapped('Grip', 1)).not.toBe(base);
    expect(swapped('Core', 0)).not.toBe(base);
    expect(swapped('Magazine', 2)).not.toBe(base);
    expect(swapped('Chamber', 1)).not.toBe(base);
    // Scope 6: the roll still selects a different Sight variant —
    // the one shipped scope renders either way.
    expect(partVariant(sniper({ parts: partsFor([2, 2, 2, 1, 0, 2]) }), 'Sight')).toBe(0);
    expect(swapped('Sight', 0)).toBe(base);
  });
});

describe('S5 authored bases — the living passes land', () => {
  it('rarity overlays stamp by tier at their coordinates', () => {
    const gAt = (render: WeaponCardRender, cells: [number, number][]) =>
      cells.filter(([x, y]) => render.rows[y][x] === 'g').length;
    const mag = SNIPER_AUTHORED_OVERLAYS.magStripe[1];
    const rec = SNIPER_AUTHORED_OVERLAYS.receiverLine;
    const cha = SNIPER_AUTHORED_OVERLAYS.chamberLine[2];
    const at = (rarity: Rarity) => composeWeaponCard(sniper({ rarity, id: 's5-overlay' }));
    expect(gAt(at(Rarity.Common), mag)).toBe(0);
    expect(gAt(at(Rarity.Common), rec)).toBe(0);
    expect(gAt(at(Rarity.Common), cha)).toBe(0);
    expect(gAt(at(Rarity.Uncommon), mag)).toBe(mag.length);
    expect(gAt(at(Rarity.Uncommon), rec)).toBe(0);
    expect(gAt(at(Rarity.Rare), rec)).toBe(rec.length);
    expect(gAt(at(Rarity.Rare), cha)).toBe(0);
    // Epic+: the chamber line lands under the maker's detail pass,
    // which overdraws a cell or two of trim (BlastForge speckle) —
    // the landed count is pinned, not the drawn count.
    expect(gAt(at(Rarity.Epic), cha)).toBe(11);
    expect(gAt(at(Rarity.Legendary), cha)).toBe(11);
  });

  it('godroll sparkles land on the authored barrel', () => {
    const render = composeWeaponCard(sniper({
      element: Element.Shock, rarity: Rarity.Legendary, rollQuality: 100, id: 's5-godroll',
    }));
    let sparklesOnBarrel = 0;
    render.rows.forEach((row, y) => {
      [...row].forEach((ch, x) => { if (ch === 'G' && x >= 126 && y >= 23 && y <= 38) sparklesOnBarrel++; });
    });
    expect(sparklesOnBarrel).toBeGreaterThan(0);
  });

  it('wear erases cells out of the authored receiver', () => {
    const pristine = composeWeaponCard(sniper({ id: 's5-wear' }));
    const worn = composeWeaponCard(sniper({ id: 's5-wear', rollQuality: 25 }));
    const filled = (r: WeaponCardRender) => r.rows.reduce((n, row) => n + [...row].filter((c) => c !== '.').length, 0);
    expect(filled(worn)).toBeLessThan(filled(pristine));
    let holesInReceiver = 0;
    for (let y = 21; y < 39; y++) for (let x = 62; x < 126; x++) {
      if (pristine.rows[y][x] !== '.' && worn.rows[y][x] === '.') holesInReceiver++;
    }
    expect(holesInReceiver).toBeGreaterThan(0);
  });

  it('an affix decal stamps onto the authored body', () => {
    const affixes: Affix[] = [
      { id: 'af-1', category: 'elemental', stat: 'statusChance', value: 4, displayText: '+4% status' },
      { id: 'af-2', category: 'boss', stat: 'bossDamageMod', value: 9, displayText: '+9% boss damage' },
    ];
    const plain = composeWeaponCard(sniper({ id: 's5-decal' }));
    const decaled = composeWeaponCard(sniper({ id: 's5-decal', affixes }));
    expect(decaled.signature).not.toBe(plain.signature);
    expect(countKey(decaled, 'T') + countKey(decaled, 'G')).toBeGreaterThan(countKey(plain, 'T') + countKey(plain, 'G'));
  });

  it('Kinetic window rule: the chamber window resolves onto the body ramp', () => {
    const kinetic = composeWeaponCard(sniper({ id: 's5-kinetic' }));
    expect(countKey(kinetic, 'E')).toBe(0);
    expect(countKey(kinetic, 'c')).toBe(0);
    // The scope lens keeps its glass glints — the one place 'e'
    // may appear on a Kinetic card (the production lens behavior
    // the trained renders share). Everywhere else it is remapped.
    let eOutsideLens = 0;
    kinetic.rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === 'e' && !(x >= 74 && x <= 108 && y >= 12 && y <= 21)) eOutsideLens++;
      });
    });
    expect(eOutsideLens).toBe(0);
    // The window's warm-glass fill ('p') fills the chamber window
    // (chamber-2 seat 100,26, 22x11).
    let pInWindow = 0;
    for (let y = 26; y < 37; y++) for (let x = 100; x < 122; x++) if (kinetic.rows[y][x] === 'p') pInWindow++;
    expect(pInWindow).toBeGreaterThan(10);
    const shock = composeWeaponCard(sniper({ id: 's5-kinetic', element: Element.Shock }));
    expect(countKey(shock, 'E')).toBeGreaterThan(10);
  });

  it('Ironwood rides the wood ramp: no metal body cells survive the remap', () => {
    const render = composeWeaponCard(sniper({ manufacturer: Manufacturer.Ironwood, id: 's5-wood' }));
    expect(countKey(render, 'P')).toBe(0);
    expect(countKey(render, 'w')).toBeGreaterThan(100);
  });
});

describe('S5 authored bases — containment', () => {
  it('non-sniper card renders and all pixel renders are byte-identical to the pre-S5 sweep', () => {
    const sigs: Record<string, string> = {};
    for (const type of Object.values(WeaponType)) {
      for (const manufacturer of Object.values(Manufacturer)) {
        for (const element of [Element.Kinetic, Element.Fire, Element.Shock, Element.Void]) {
          for (const rarity of [Rarity.Common, Rarity.Rare, Rarity.Legendary]) {
            const input: PixelWeaponInput = {
              weaponType: type, manufacturer, element, rarity,
              rollQuality: 75, pixelSeed: 4242, id: `contain-${type}-${manufacturer}-${element}-${rarity}`,
            };
            if (type !== WeaponType.Sniper) sigs[`card/${type}/${manufacturer}/${element}/${rarity}`] = composeWeaponCard(input).signature;
            sigs[`pixel/${type}/${manufacturer}/${element}/${rarity}`] = composePixelWeapon(input).signature;
          }
        }
      }
    }
    expect(Object.keys(sigs)).toHaveLength(792);
    let h = 0x811c9dc5;
    const joined = Object.keys(sigs).sort().map((k) => `${k}=${sigs[k]}`).join('\n');
    for (let i = 0; i < joined.length; i++) h = Math.imul(h ^ joined.charCodeAt(i), 0x01000193);
    expect((h >>> 0).toString(16).padStart(8, '0')).toBe('b30349f7');
  }, 120_000);
});
