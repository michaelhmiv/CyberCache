import { describe, expect, it } from 'vitest';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Affix, WeaponPart } from '@/types/items';
import {
  CARD_WEAPON_HEIGHT,
  CARD_WEAPON_WIDTH,
  composeWeaponCard,
  composeWeaponCardCached,
  type WeaponCardRender,
} from '@/lib/pixel/weaponCardCompositor';
import { CARD_LAYOUTS } from '@/lib/pixel/weaponGrammarData';
import { composePixelWeapon, partVariant, type PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { buildDecals, weaponVisualSeed } from '@/lib/weaponArt/decalSpec';

/**
 * Weapon marriage, slice 1 — the card compositor (240×88).
 *
 * Pins the marriage contract:
 *  - FORGE grammars as data: the 36 maker×type identities are
 *    pairwise distinguishable by SILHOUETTE alone (palette-blind),
 *    so maker/type read at range, not just by color.
 *  - Element is a lit current on the spine: element texels reach
 *    the barrel zone; Kinetic is honest absence (zero element
 *    texels on every non-Beam form — the property the broken SVG
 *    element layer never had, golden-tested here).
 *  - Rarity is finish only: the form (filled mask) never changes.
 *  - Part variants survive: different part rolls render differently
 *    within a maker×type.
 *  - Real-item derivations match the stage engine's sources:
 *    buildDecals for affix decals, conditionFromRoll for condition.
 */

const base = (over: Partial<PixelWeaponInput> = {}): PixelWeaponInput => ({
  weaponType: WeaponType.SMG,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  rarity: Rarity.Common,
  rollQuality: 75,
  pixelSeed: 1234,
  ...over,
});

const maskOf = (render: WeaponCardRender) =>
  render.rows.map((r) => [...r].map((c) => (c === '.' ? '0' : '1')).join('')).join('/');
const countShade = (render: WeaponCardRender, s: string) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c === s).length, 0);
const maxShadeX = (render: WeaponCardRender, s: string) => {
  let m = -1;
  render.rows.forEach((r) => { for (let x = 0; x < r.length; x++) if (r[x] === s) m = Math.max(m, x); });
  return m;
};
const filledCount = (render: WeaponCardRender) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c !== '.').length, 0);

const MAKERS = Object.values(Manufacturer);
const TYPES = Object.values(WeaponType);
const identityInput = (type: WeaponType, maker: Manufacturer) =>
  base({ weaponType: type, manufacturer: maker, id: `id-${type}-${maker}` });

describe('card compositor — grid contract', () => {
  it('renders the 240x88 card grid', () => {
    const render = composeWeaponCard(base());
    expect(render.width).toBe(CARD_WEAPON_WIDTH);
    expect(render.height).toBe(CARD_WEAPON_HEIGHT);
    expect(render.width).toBe(240);
    expect(render.height).toBe(88);
    expect(render.rows).toHaveLength(88);
    for (const row of render.rows) expect(row).toHaveLength(240);
  });
});

describe('card compositor — determinism', () => {
  it('same instance → same signature and rows, twice', () => {
    const input = base({ weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Prismatek, element: Element.Void, rarity: Rarity.Epic });
    const a = composeWeaponCard(input);
    const b = composeWeaponCard({ ...input });
    expect(a.signature).toBe(b.signature);
    expect(a.rows).toEqual(b.rows);
  });

  it('cached compose returns the identical render object', () => {
    const input = base({ id: 'cache-probe' });
    expect(composeWeaponCardCached(input)).toBe(composeWeaponCardCached({ ...input }));
  });
});

describe('card compositor — 36 identities, silhouette-distinct', () => {
  const masks = new Map<string, string>();
  for (const type of TYPES) for (const maker of MAKERS) {
    masks.set(`${maker}:${type}`, maskOf(composeWeaponCard(identityInput(type, maker))));
  }

  it('all 36 maker×type silhouettes are pairwise distinct (palette-blind)', () => {
    expect(new Set(masks.values()).size).toBe(36);
  });

  it('within each type, the six makers read as six silhouettes', () => {
    for (const type of TYPES) {
      const set = new Set(MAKERS.map((m) => masks.get(`${m}:${type}`)));
      expect(set.size).toBe(6);
    }
  });

  it('within each maker, the six types read as six silhouettes', () => {
    for (const maker of MAKERS) {
      const set = new Set(TYPES.map((t) => masks.get(`${maker}:${t}`)));
      expect(set.size).toBe(6);
    }
  });
});

describe('card compositor — element current (the golden the SVG never had)', () => {
  const NON_KINETIC = [Element.Fire, Element.Shock, Element.Corrosive, Element.Cryo, Element.Void];

  it('every non-Kinetic element traces E texels into the barrel zone, with bed and line', () => {
    for (const el of NON_KINETIC) {
      const render = composeWeaponCard(base({
        weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Redline, element: el, id: `el-${el}`,
      }));
      const layout = CARD_LAYOUTS[WeaponType.Sniper];
      const bodyFront = layout.bodyX + layout.bodyLen;
      expect(countShade(render, 'E'), el).toBeGreaterThan(0);
      // The current ARRIVES: element texels exist past the receiver,
      // deep into the barrel — a chamber-only glow would fail this.
      expect(maxShadeX(render, 'E'), el).toBeGreaterThan(bodyFront + Math.round(layout.barrelLen * 0.5));
      // FORGE current structure: dark bed + bright line are present.
      expect(countShade(render, 'c'), el).toBeGreaterThan(20);
      expect(countShade(render, 'e'), el).toBeGreaterThan(10);
    }
  });

  it('the current reads on other forms too (SMG, shotgun, pistol)', () => {
    for (const type of [WeaponType.SMG, WeaponType.Shotgun, WeaponType.Pistol]) {
      const render = composeWeaponCard(base({ weaponType: type, manufacturer: Manufacturer.ThrowTech, element: Element.Shock, id: `cur-${type}` }));
      const layout = CARD_LAYOUTS[type];
      expect(maxShadeX(render, 'E'), type).toBeGreaterThan(layout.bodyX + layout.bodyLen);
    }
  });

  it('Kinetic is honest absence: zero E texels on every non-Beam form', () => {
    for (const type of TYPES) {
      if (type === WeaponType.Beam) continue; // the Beam core is form — see below
      for (const maker of MAKERS) {
        const render = composeWeaponCard(identityInput(type, maker));
        expect(countShade(render, 'E'), `${maker} ${type}`).toBe(0);
      }
    }
  });

  it('the Beam core at Kinetic is the metallic channel color, not a glow color', () => {
    const render = composeWeaponCard(identityInput(WeaponType.Beam, Manufacturer.Redline));
    expect(render.colors.E).toBe('#B8B0A8'); // Kinetic metallic (visualAssets)
  });

  it('element changes the render (Fire ≠ Kinetic for the same gun)', () => {
    const kinetic = composeWeaponCard(base({ weaponType: WeaponType.Sniper, id: 'el-diff' }));
    const fire = composeWeaponCard(base({ weaponType: WeaponType.Sniper, element: Element.Fire, id: 'el-diff' }));
    expect(fire.signature).not.toBe(kinetic.signature);
  });
});

describe('card compositor — rarity is finish only', () => {
  const formInput = base({ weaponType: WeaponType.Shotgun, manufacturer: Manufacturer.BlastForge, id: 'form-probe' });
  // FORM vs OUTLINE BAND. The law: rarity finishes never change the
  // gun's body. The band — the outline ring, its anti-step cells and
  // the notch pockets between them — is finish territory: its exact
  // footprint legitimately shifts when a trim recolors the top-edge
  // cell it hugs, and since S1 (selective outline) band cells carry
  // shades derived from the bordered finish cell, so band SHADES are
  // rarity-dependent by design. The band is therefore identified
  // geometrically from the PAIR of renders under comparison: on the
  // union silhouette, band cells sit within ortho-distance 2 of
  // empty space. Everything deeper is body, and body must coincide.
  const unionDist = (a: WeaponCardRender, b: WeaponCardRender) => {
    const Hh = a.rows.length;
    const Ww = a.rows[0].length;
    const inU = (x: number, y: number) => a.rows[y][x] !== '.' || b.rows[y][x] !== '.';
    const dist = new Int16Array(Ww * Hh).fill(-1);
    const q: number[] = [];
    for (let y = 0; y < Hh; y++) for (let x = 0; x < Ww; x++) {
      if (!inU(x, y)) { dist[y * Ww + x] = 0; q.push(y * Ww + x); }
    }
    for (let i = 0; i < q.length; i++) {
      const cx = q[i] % Ww;
      const cy = Math.floor(q[i] / Ww);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= Ww || ny >= Hh || dist[ny * Ww + nx] >= 0 || !inU(nx, ny)) continue;
        dist[ny * Ww + nx] = dist[q[i]] + 1;
        q.push(ny * Ww + nx);
      }
    }
    return dist;
  };
  /** Deep-form mask of `render` against a comparison render: filled
   *  in both, past the band, and not an ink detail shade. */
  const deepFormMaskOf = (render: WeaponCardRender, other: WeaponCardRender) => {
    const dist = unionDist(render, other);
    const Ww = render.rows[0].length;
    return render.rows.map((r, y) => [...r].map((c, x) => (
      c !== '.' && c !== 'K' && c !== 'k' && other.rows[y][x] !== '.' && dist[y * Ww + x] >= 3 ? '1' : '0'
    )).join('')).join('/');
  };

  it('Common and Uncommon share the exact form mask', () => {
    const common = composeWeaponCard({ ...formInput, rarity: Rarity.Common });
    const uncommon = composeWeaponCard({ ...formInput, rarity: Rarity.Uncommon });
    // Silhouette differences, if any, live entirely in the band.
    const dist = unionDist(common, uncommon);
    const Ww = common.rows[0].length;
    for (let y = 0; y < CARD_WEAPON_HEIGHT; y++) {
      for (let x = 0; x < CARD_WEAPON_WIDTH; x++) {
        const cf = common.rows[y][x] !== '.';
        const uf = uncommon.rows[y][x] !== '.';
        if (cf !== uf) expect(dist[y * Ww + x], `silhouette diff at ${x},${y} must be band`).toBeLessThanOrEqual(2);
      }
    }
    expect(deepFormMaskOf(uncommon, common)).toBe(deepFormMaskOf(common, uncommon));
    expect(uncommon.signature).not.toBe(common.signature); // finish differs
  });

  it('Legendary keeps every Common form cell and adds the halo outside', () => {
    const common = composeWeaponCard({ ...formInput, rarity: Rarity.Common });
    const legendary = composeWeaponCard({ ...formInput, rarity: Rarity.Legendary });
    const cm = deepFormMaskOf(common, legendary).split('/');
    for (let y = 0; y < CARD_WEAPON_HEIGHT; y++) {
      for (let x = 0; x < CARD_WEAPON_WIDTH; x++) {
        if (cm[y][x] === '1') expect(legendary.rows[y][x], `form cell ${x},${y}`).not.toBe('.');
      }
    }
    expect(countShade(legendary, 'G')).toBeGreaterThan(30); // halo + pooled glow
  });
});

describe('card compositor — part variants survive', () => {
  const part = (slot: WeaponPart['slot'], value: number): WeaponPart => ({ slot, modifier: { baseDamage: value } });

  /** Find two modifier values whose partVariant for a slot differs. */
  const variantPair = (slot: WeaponPart['slot'], type: WeaponType): [number, number] => {
    const probe = (v: number) => partVariant(base({ weaponType: type, parts: [part(slot, v)] }), slot);
    const first = probe(1);
    for (let v = 2; v < 200; v++) if (probe(v) !== first) return [1, v];
    throw new Error(`no variant flip found for ${slot}`);
  };

  it('a Chamber roll change re-renders the gun', () => {
    const [a, b] = variantPair('Chamber', WeaponType.SMG);
    const mk = (v: number) => base({ weaponType: WeaponType.SMG, manufacturer: Manufacturer.HelixWorks, rarity: Rarity.Rare, parts: [part('Chamber', v)], id: 'var-chamber' });
    expect(composeWeaponCard(mk(a)).signature).not.toBe(composeWeaponCard(mk(b)).signature);
  });

  it('a Magazine roll change re-renders the gun', () => {
    const [a, b] = variantPair('Magazine', WeaponType.SMG);
    const mk = (v: number) => base({ weaponType: WeaponType.SMG, manufacturer: Manufacturer.Redline, rarity: Rarity.Rare, parts: [part('Magazine', v)], id: 'var-mag' });
    expect(composeWeaponCard(mk(a)).signature).not.toBe(composeWeaponCard(mk(b)).signature);
  });

  it('a Sight roll change re-renders the gun', () => {
    const [a, b] = variantPair('Sight', WeaponType.Shotgun);
    const mk = (v: number) => base({ weaponType: WeaponType.Shotgun, manufacturer: Manufacturer.ThrowTech, rarity: Rarity.Rare, parts: [part('Sight', v)], id: 'var-sight' });
    expect(composeWeaponCard(mk(a)).signature).not.toBe(composeWeaponCard(mk(b)).signature);
  });

  it('two full part sets render as two different guns within a maker×type', () => {
    const slots: WeaponPart['slot'][] = ['Barrel', 'Grip', 'Core', 'Magazine', 'Sight', 'Chamber'];
    const setA = slots.map((s) => part(s, 3));
    const setB = slots.map((s) => part(s, 17));
    const mk = (parts: WeaponPart[]) => base({ weaponType: WeaponType.SMG, manufacturer: Manufacturer.HelixWorks, rarity: Rarity.Rare, parts, id: 'var-full' });
    expect(composeWeaponCard(mk(setA)).signature).not.toBe(composeWeaponCard(mk(setB)).signature);
  });
});

describe('card compositor — themes are data rows', () => {
  it('wasteland-bone re-skins the Ironwood sniper furniture (stock zone changes)', () => {
    const input = base({ weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Ironwood, id: 'theme-probe' });
    const plain = composeWeaponCard(input);
    const boned = composeWeaponCard(input, 'wasteland-bone');
    expect(boned.signature).not.toBe(plain.signature);
    const stockZone = (r: WeaponCardRender) => r.rows.map((row) => row.slice(0, CARD_LAYOUTS[WeaponType.Sniper].bodyX)).join('/');
    expect(stockZone(boned)).not.toBe(stockZone(plain));
    expect(boned.colors.w).toBe('#D8CCAF'); // bone palette row applied
  });

  it('an unknown theme id falls back to the unthemed render', () => {
    const input = base({ id: 'theme-unknown' });
    expect(composeWeaponCard(input, 'no-such-theme').signature).toBe(composeWeaponCard(input).signature);
  });
});

describe('card compositor — real-item derivations match the stage sources', () => {
  const affixes: Affix[] = [
    { id: 'af-1', category: 'elemental', stat: 'statusChance', value: 4, displayText: '+4% status' },
    { id: 'af-2', category: 'boss', stat: 'bossDamageMod', value: 9, displayText: '+9% boss damage' },
  ];

  it('decals are buildDecals over the instance affixes, stamped on the body', () => {
    const input = base({ affixes, id: 'decal-probe' });
    const render = composeWeaponCard(input);
    const expected = buildDecals(affixes, weaponVisualSeed(input), undefined);
    expect(render.decals.map((d) => d.id)).toEqual(expected.map((d) => d.id));
    expect(countShade(render, 'T')).toBeGreaterThan(0);
  });

  it('condition grades come from the roll, and wear visibly erases', () => {
    const mk = (rollQuality: number) => composeWeaponCard(base({ rollQuality, id: 'cond-probe' }));
    expect(mk(10).condition).toBe('beat-up');
    expect(mk(50).condition).toBe('field-used');
    expect(mk(75).condition).toBe('clean');
    expect(mk(90).condition).toBe('mint');
    expect(mk(99).condition).toBe('godroll');
    expect(filledCount(mk(10))).toBeLessThan(filledCount(mk(75)));
  });
});

describe('card compositor — golden signature pins', () => {
  // Regression tripwires: any intentional art change re-pins these
  // deliberately (and the capture sheets get re-read).
  const GOLDENS: Record<string, string> = {
    'Redline Sniper Kinetic Common': '72260cb0',
    'Ironwood Sniper Fire Rare': '44adc260',
    'BlastForge Shotgun Kinetic Legendary': '4a3401ec',
    'Prismatek Beam Void Epic': '9280078f',
    'ThrowTech Pistol Shock Uncommon': '41427e42',
    'HelixWorks Launcher Cryo Rare': '31e8cd37',
    'Redline Pistol Corrosive Common': '144299c',
    'HelixWorks SMG Kinetic Common': 'a74d18f0',
  };
  const CASES: Record<string, PixelWeaponInput> = {
    'Redline Sniper Kinetic Common': base({ weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Redline, id: 'gold-1' }),
    'Ironwood Sniper Fire Rare': base({ weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Ironwood, element: Element.Fire, rarity: Rarity.Rare, id: 'gold-2' }),
    'BlastForge Shotgun Kinetic Legendary': base({ weaponType: WeaponType.Shotgun, manufacturer: Manufacturer.BlastForge, rarity: Rarity.Legendary, id: 'gold-3' }),
    'Prismatek Beam Void Epic': base({ weaponType: WeaponType.Beam, manufacturer: Manufacturer.Prismatek, element: Element.Void, rarity: Rarity.Epic, id: 'gold-4' }),
    'ThrowTech Pistol Shock Uncommon': base({ weaponType: WeaponType.Pistol, manufacturer: Manufacturer.ThrowTech, element: Element.Shock, rarity: Rarity.Uncommon, id: 'gold-5' }),
    'HelixWorks Launcher Cryo Rare': base({ weaponType: WeaponType.Launcher, manufacturer: Manufacturer.HelixWorks, element: Element.Cryo, rarity: Rarity.Rare, id: 'gold-6' }),
    'Redline Pistol Corrosive Common': base({ weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Redline, element: Element.Corrosive, id: 'gold-7' }),
    'HelixWorks SMG Kinetic Common': base({ weaponType: WeaponType.SMG, manufacturer: Manufacturer.HelixWorks, id: 'gold-8' }),
  };
  for (const [name, input] of Object.entries(CASES)) {
    it(`pins ${name}`, () => {
      expect(composeWeaponCard(input).signature).toBe(GOLDENS[name]);
    });
  }

  // The same matrix at STAGE density: the marriage does not touch
  // the stage engine, and these pins prove it stays byte-identical.
  const STAGE_GOLDENS: Record<string, string> = {
    'Redline Sniper Kinetic Common': '7527e806',
    'Ironwood Sniper Fire Rare': '74d41590',
    'BlastForge Shotgun Kinetic Legendary': '9f1e8365',
    'Prismatek Beam Void Epic': '1fa98bcd',
    'ThrowTech Pistol Shock Uncommon': '8ee4272f',
    'HelixWorks Launcher Cryo Rare': '11d98e64',
    'Redline Pistol Corrosive Common': '4c7a9c93',
    'HelixWorks SMG Kinetic Common': 'ba976903',
  };
  for (const [name, input] of Object.entries(CASES)) {
    it(`pins stage ${name}`, () => {
      const stage = composePixelWeapon(input);
      expect(stage.width).toBe(120);
      expect(stage.height).toBe(44);
      expect(stage.signature).toBe(STAGE_GOLDENS[name]);
      // Densities never share a signature space.
      expect(stage.signature).not.toBe(composeWeaponCard(input).signature);
    });
  }
});
