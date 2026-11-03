import { describe, expect, it } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import type { Affix, Relic } from '@/types/items';
import { hashString } from '@/lib/utils/rng';
import {
  composeGear,
  type GearComposeInput,
  type GearRender,
} from '@/lib/pixel/gearCardCompositor';
import {
  GEAR_GRAMMARS,
  GEAR_PIXEL_KINDS,
  gearRenderRoute,
} from '@/lib/pixel/gearRenderFlags';
import {
  RELIC_FORM_ROWS,
  RELIC_TREATMENTS,
  relicFormRowForName,
  relicGrammar,
  relicInputFromItem,
} from '@/lib/pixel/relicGrammar';
import { RELIC_NAMES } from '../server/lib/generators/relicGenerator';

/**
 * Gear marriage, slice 4 — relics.
 *
 * The marriage under test: a relic's form is its NAME (one
 * silhouette row per name in the closed generator pool), and its
 * sourceTag — all the old SVG keyed on — survives only as the
 * base treatment it rests on. Pins:
 *  - COVERAGE: the grammar rows and the generator's RELIC_NAMES
 *    are the same set. Grow the pool without a row and this suite
 *    goes red — there is no silent fallback (inputFromItem throws
 *    on an unmapped name, also pinned);
 *  - every name's silhouette is pairwise distinct;
 *  - rarity is the core's frame finish only (form mask identical
 *    Common vs Legendary), sourceTag moves the base and nothing
 *    above it;
 *  - determinism, seed-in-signature, thumb detail-level-0;
 *  - golden signature pins per name row.
 */

const affix = (id: string): Affix => ({
  id, category: 'combat', stat: 'luck', value: 5, displayText: '+5 Luck',
});

const relic = (over: Partial<Relic> = {}): Relic => ({
  id: 'test_relic',
  name: 'Void Prism',
  level: 10,
  rarity: Rarity.Rare,
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  ...over,
});

const inputFor = (name: string, over: Partial<GearComposeInput> = {}): GearComposeInput => {
  const row = relicFormRowForName(name)!;
  return {
    kind: 'relic',
    rarity: Rarity.Epic,
    element: null,
    seed: 4242,
    pips: 3,
    baseColor: row.baseColor,
    variant: `${row.formId}/world`,
    ...over,
  };
};

const countShade = (render: GearRender, s: string) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c === s).length, 0);
const filledCount = (render: GearRender) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c !== '.').length, 0);
/** Form cells only: frame (F/f) and outline/seat (K/k) are finishes. */
const formMaskOf = (render: GearRender) =>
  render.rows.map((r) => [...r].map((c) => (c === '.' || c === 'F' || c === 'f' || c === 'K' || c === 'k' ? '0' : '1')).join('')).join('/');

describe('relic grammar — coverage: every name in the pool maps to a row', () => {
  it('the grammar rows and RELIC_NAMES are exactly the same set', () => {
    expect(RELIC_FORM_ROWS.map((r) => r.name).sort()).toEqual([...RELIC_NAMES].sort());
    expect(RELIC_FORM_ROWS).toHaveLength(12);
  });

  it('every pooled name resolves a row and composes at both densities', () => {
    for (const name of RELIC_NAMES) {
      expect(relicFormRowForName(name), name).toBeDefined();
      const input = relicInputFromItem(relic({ name }));
      const card = composeGear(input, relicGrammar, 'card');
      const thumb = composeGear(input, relicGrammar, 'thumb');
      expect(card.width, name).toBe(240);
      expect(card.height, name).toBe(140);
      expect(thumb.width, name).toBe(60);
      expect(thumb.height, name).toBe(35);
      expect(filledCount(card), name).toBeGreaterThan(1500);
      expect(filledCount(thumb), name).toBeGreaterThan(150);
    }
  });

  it('an unmapped name throws — no silent fallback art', () => {
    expect(() => relicInputFromItem(relic({ name: 'Mystery Relic' }))).toThrow(/no form row/);
  });
});

describe('relic grammar — form is the name', () => {
  it('all twelve silhouettes are pairwise distinct at identical inputs', () => {
    const masks = RELIC_NAMES.map((name) => formMaskOf(composeGear(inputFor(name), relicGrammar, 'card')));
    expect(new Set(masks).size).toBe(RELIC_NAMES.length);
    const sigs = RELIC_NAMES.map((name) => composeGear(inputFor(name), relicGrammar, 'card').signature);
    expect(new Set(sigs).size).toBe(RELIC_NAMES.length);
  });

  it('same name, different instance: same form family, new signature (seed is in the hash)', () => {
    const a = composeGear(inputFor('Echo Stone', { seed: 1 }), relicGrammar, 'card');
    const b = composeGear(inputFor('Echo Stone', { seed: 2 }), relicGrammar, 'card');
    expect(a.signature).not.toBe(b.signature);
  });

  it('determinism: the same input composes byte-identically, twice', () => {
    const input = inputFor('Scrap Core', { rarity: Rarity.Legendary });
    const a = composeGear(input, relicGrammar, 'card');
    const b = composeGear({ ...input }, relicGrammar, 'card');
    expect(a.signature).toBe(b.signature);
    expect(a.rows).toEqual(b.rows);
  });
});

describe('relic grammar — rarity is finish only; sourceTag is base only', () => {
  it('Common and Legendary share the exact form mask; the frame escalates', () => {
    const common = composeGear(inputFor('Void Prism', { rarity: Rarity.Common, seed: 99, pips: 2 }), relicGrammar, 'card');
    const legendary = composeGear(inputFor('Void Prism', { rarity: Rarity.Legendary, seed: 99, pips: 2 }), relicGrammar, 'card');
    expect(formMaskOf(legendary)).toBe(formMaskOf(common));
    expect(legendary.signature).not.toBe(common.signature);
    expect(countShade(legendary, 'F')).toBeGreaterThan(countShade(common, 'F'));
  });

  it('changing sourceTag changes the base and nothing above it', () => {
    // Neural Key's form bottoms out well above the plinth zone, so
    // rows above the base must be byte-identical across treatments.
    const world = composeGear(
      relicInputFromItem(relic({ name: 'Neural Key', sourceTag: DropSource.WorldDrop })),
      relicGrammar, 'card',
    );
    const boss = composeGear(
      relicInputFromItem(relic({ name: 'Neural Key', sourceTag: DropSource.BossDrop })),
      relicGrammar, 'card',
    );
    expect(boss.rows.slice(0, 108)).toEqual(world.rows.slice(0, 108));
    expect(boss.rows.slice(108).join('/')).not.toBe(world.rows.slice(108).join('/'));
    expect(boss.signature).not.toBe(world.signature);
  });

  it('every DropSource has a treatment, and it lands in the variant', () => {
    for (const tag of Object.values(DropSource)) {
      const treatment = RELIC_TREATMENTS[tag];
      expect(treatment, tag).toBeDefined();
      const input = relicInputFromItem(relic({ sourceTag: tag }));
      expect(input.variant).toBe(`void-prism/${treatment}`);
    }
  });
});

describe('relic grammar — input derivation from the real record', () => {
  it('derives form, treatment, colorway, seed, and pips from the record', () => {
    const item = relic({
      id: 'abc',
      name: 'Glitched Token',
      rarity: Rarity.Legendary,
      sourceTag: DropSource.BossDrop,
      affixes: [affix('a1'), affix('a2'), affix('a3'), affix('a4'), affix('a5')],
    });
    expect(relicInputFromItem(item)).toEqual({
      kind: 'relic',
      rarity: Rarity.Legendary,
      element: null,
      seed: hashString('abc|Glitched Token'),
      pips: 5,
      baseColor: '#C93BAA',
      variant: 'glitched-token/boss',
    });
  });

  it('affix pips land on the plinth: more affixes, more lit cores', () => {
    const none = composeGear(relicInputFromItem(relic({ affixes: [] })), relicGrammar, 'card');
    const four = composeGear(
      relicInputFromItem(relic({ affixes: [affix('a1'), affix('a2'), affix('a3'), affix('a4')] })),
      relicGrammar, 'card',
    );
    // Lit socket cores burn the row's own base hue (E = ramp base
    // for element-less kinds): count them in the plinth rows only.
    const plinthE = (r: GearRender) => r.rows.slice(112).reduce((n, row) => n + [...row].filter((c) => c === 'E').length, 0);
    expect(plinthE(four)).toBeGreaterThan(plinthE(none));
  });
});

describe('relic grammar — thumb is detail level 0', () => {
  it('the detail kit cannot paint at thumb, for every name', () => {
    for (const name of RELIC_NAMES) {
      const thumb = composeGear(inputFor(name), relicGrammar, 'thumb');
      // In this grammar the silhouette layer never uses T (rivet /
      // vent steel) or k (socket seats, seams) — those shades come
      // only from the core detail kit, which is gated at thumb.
      expect(countShade(thumb, 'T'), name).toBe(0);
      expect(countShade(thumb, 'k'), name).toBe(0);
      // Silhouette + core + frame survive.
      expect(countShade(thumb, 'E'), name).toBeGreaterThan(0);
      expect(countShade(thumb, 'F'), name).toBeGreaterThan(0);
    }
  });

  it('the detail kit does paint at card (rivets/vents carry T)', () => {
    const card = composeGear(inputFor('Ancient Module'), relicGrammar, 'card');
    expect(countShade(card, 'T')).toBeGreaterThan(0);
  });
});

describe('relic grammar — dispatch seam', () => {
  it('relic routes pixel: flag on, grammar registered', () => {
    expect(GEAR_PIXEL_KINDS.relic).toBe(true);
    expect(GEAR_GRAMMARS.relic).toBe(relicGrammar);
    expect(gearRenderRoute('relic')).toBe('pixel');
  });

  it('every kind routes pixel now — all four slices have landed', () => {
    for (const kind of ['shield', 'classMod', 'ordnance'] as const) {
      expect(gearRenderRoute(kind)).toBe('pixel');
    }
  });
});

describe('relic grammar — golden signature pins', () => {
  // Regression tripwires: any intentional art change re-pins these
  // deliberately (and the capture sheets get re-read).
  const GOLDENS: Record<string, string> = {
    'vault-chip Epic card': '63f04f19',
    'data-shard Epic card': '286fd402',
    'neural-key Epic card': 'a3949855',
    'cache-relic Epic card': '388567a2',
    'echo-stone Epic card': '552d7c69',
    'void-prism Epic card': '6e741b5d',
    'circuit-totem Epic card': 'f04e90e5',
    'ancient-module Epic card': '3e5bc22c',
    'scrap-core Epic card': 'c6d28f35',
    'glitched-token Epic card': '19af5d7c',
    'ethereal-drive Epic card': '607fb28b',
    'quantum-fragment Epic card': '1d31b575',
    'vault-chip Epic thumb': '62283ead',
    'neural-key Epic thumb': 'eacdc3e1',
    'glitched-token Epic thumb': '45cc08a5',
    'quantum-fragment Epic thumb': '63d7b634',
    'cache-relic boss Rare card': 'a7ba6cf',
    'cache-relic cache Rare card': '5c341f63',
    'void-prism Common card': '32f42b1d',
    'void-prism Legendary card': '89ac3ea5',
  };
  const byForm = (formId: string, over: Partial<GearComposeInput> = {}): GearComposeInput => {
    const row = RELIC_FORM_ROWS.find((r) => r.formId === formId)!;
    return {
      kind: 'relic', rarity: Rarity.Epic, element: null, seed: 4242, pips: 3,
      baseColor: row.baseColor, variant: `${row.formId}/world`, ...over,
    };
  };
  const CASES: Record<string, { input: GearComposeInput; density: 'card' | 'thumb' }> = {
    'vault-chip Epic card': { input: byForm('vault-chip'), density: 'card' },
    'data-shard Epic card': { input: byForm('data-shard'), density: 'card' },
    'neural-key Epic card': { input: byForm('neural-key'), density: 'card' },
    'cache-relic Epic card': { input: byForm('cache-relic'), density: 'card' },
    'echo-stone Epic card': { input: byForm('echo-stone'), density: 'card' },
    'void-prism Epic card': { input: byForm('void-prism'), density: 'card' },
    'circuit-totem Epic card': { input: byForm('circuit-totem'), density: 'card' },
    'ancient-module Epic card': { input: byForm('ancient-module'), density: 'card' },
    'scrap-core Epic card': { input: byForm('scrap-core'), density: 'card' },
    'glitched-token Epic card': { input: byForm('glitched-token'), density: 'card' },
    'ethereal-drive Epic card': { input: byForm('ethereal-drive'), density: 'card' },
    'quantum-fragment Epic card': { input: byForm('quantum-fragment'), density: 'card' },
    'vault-chip Epic thumb': { input: byForm('vault-chip'), density: 'thumb' },
    'neural-key Epic thumb': { input: byForm('neural-key'), density: 'thumb' },
    'glitched-token Epic thumb': { input: byForm('glitched-token'), density: 'thumb' },
    'quantum-fragment Epic thumb': { input: byForm('quantum-fragment'), density: 'thumb' },
    'cache-relic boss Rare card': { input: byForm('cache-relic', { rarity: Rarity.Rare, seed: 777, variant: 'cache-relic/boss' }), density: 'card' },
    'cache-relic cache Rare card': { input: byForm('cache-relic', { rarity: Rarity.Rare, seed: 777, variant: 'cache-relic/cache' }), density: 'card' },
    'void-prism Common card': { input: byForm('void-prism', { rarity: Rarity.Common, seed: 99, pips: 2 }), density: 'card' },
    'void-prism Legendary card': { input: byForm('void-prism', { rarity: Rarity.Legendary, seed: 99, pips: 2 }), density: 'card' },
  };
  for (const [name, { input, density }] of Object.entries(CASES)) {
    it(`pins ${name}`, () => {
      expect(composeGear(input, relicGrammar, density).signature).toBe(GOLDENS[name]);
    });
  }
});
