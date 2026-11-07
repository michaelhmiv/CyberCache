import { describe, expect, it } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import type { Affix, Relic } from '@/types/items';
import { hashString } from '@/lib/utils/rng';
import {
  composeGear,
  type GearComposeInput,
  type GearRender,
} from '@/lib/pixel/gearCardCompositor';
import { GEAR_GRAMMARS } from '@/lib/pixel/gearDispatch';
import {
  RELIC_FORM_ROWS,
  RELIC_TREATMENTS,
  relicFormRowForName,
  relicGrammar,
  relicInputFromItem,
} from '@/lib/pixel/relicGrammar';
import { RELIC_NAMES } from '../server/lib/generators/relicGenerator';

/**
 * Gear marriage, slice 4 — relics; SALVAGE adoption (grammar id
 * `relic-salvage-v2`).
 *
 * The marriage under test: a relic's form is its NAME (one
 * silhouette row per name in the closed generator pool), and its
 * sourceTag — all the old SVG keyed on — survives only as the
 * footprint it leaves in the rubble. The v1 adoption stood every
 * form on a molded plinth with smooth banded planes; the salvage
 * grammar digs the forms up instead: broken per-cell tone fields,
 * seeded wear, no pedestals. Echo Stone, Void Prism and Glitched
 * Token were RE-FORMED outright (irregular silhouettes), per the
 * owner's note on the approval. Pins:
 *  - COVERAGE: the grammar rows and the generator's RELIC_NAMES
 *    are the same set. Grow the pool without a row and this suite
 *    goes red — there is no silent fallback (inputFromItem throws
 *    on an unmapped name, also pinned);
 *  - every name's silhouette is pairwise distinct;
 *  - rarity is frame + WEAR BUDGET (a Common render is strictly
 *    more chipped away than its Legendary; thumbs never wear),
 *    sourceTag moves the footprint and nothing above it;
 *  - determinism, seed-in-signature, thumb detail-level-0;
 *  - golden signature pins per name row — re-recorded wholesale
 *    at the salvage adoption and verified against the adoption
 *    capture sheets (the nine machine rows pixel-identical to the
 *    approved exploration renders outside the pip slab; the three
 *    gems differ by design).
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
    expect(RELIC_FORM_ROWS).toHaveLength(16);
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

describe('relic grammar — rarity is frame + wear budget; sourceTag is footprint only', () => {
  it('Common is strictly more worn than Legendary; the frame escalates; thumbs never wear', () => {
    // The salvage finish ladder, pinned for every name: the wear
    // pass bites silhouette cells away on a rarity budget (and a
    // Legendary carries more frame), so a Common render holds
    // strictly fewer filled cells than its Legendary. The wear
    // pass never runs at detail level 0 — the thumbs are identical,
    // so the small-size read cannot depend on rarity wear.
    for (const name of RELIC_NAMES) {
      const common = composeGear(inputFor(name, { rarity: Rarity.Common }), relicGrammar, 'card');
      const legendary = composeGear(inputFor(name, { rarity: Rarity.Legendary }), relicGrammar, 'card');
      expect(filledCount(common), name).toBeLessThan(filledCount(legendary));
      expect(legendary.rows.join('/'), name).not.toBe(common.rows.join('/'));
      expect(legendary.signature, name).not.toBe(common.signature);
      expect(countShade(legendary, 'F'), name).toBeGreaterThan(countShade(common, 'F'));
      const commonThumb = composeGear(inputFor(name, { rarity: Rarity.Common }), relicGrammar, 'thumb');
      const legendaryThumb = composeGear(inputFor(name, { rarity: Rarity.Legendary }), relicGrammar, 'thumb');
      expect(legendaryThumb.rows, name).toEqual(commonThumb.rows);
    }
  });

  it('changing sourceTag changes the footprint and nothing above it', () => {
    // Neural Key's form bottoms out well above the ground zone, so
    // rows above the rubble must be byte-identical across
    // treatments. (The ground's highest marker tops out at row
    // 116 and the outline pass reaches one row above it; the wear
    // draws are treatment-independent — the ground consumes the
    // same rolls under every marker.)
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

  it('affix pips ride the rubble: one lit core per affix, exactly', () => {
    const none = composeGear(relicInputFromItem(relic({ affixes: [] })), relicGrammar, 'card');
    const four = composeGear(
      relicInputFromItem(relic({ affixes: [affix('a1'), affix('a2'), affix('a3'), affix('a4')] })),
      relicGrammar, 'card',
    );
    // Lit socket cores burn the row's own base hue (E = ramp base
    // for element-less kinds): count them in the ground rows only —
    // the prism's form contributes no E down there. The cores sit
    // in a rubble slab the grammar lays for them (the core socket
    // kit only overpaints filled cells), and every socket seat is
    // guaranteed purchase, so the count is exact, not a minimum.
    const bandE = (r: GearRender) => r.rows.slice(112).reduce((n, row) => n + [...row].filter((c) => c === 'E').length, 0);
    expect(bandE(none)).toBe(0);
    expect(bandE(four)).toBe(4);
  });
});

describe('relic grammar — thumb is detail level 0', () => {
  it('silhouette, core light and frame survive at thumb, for every name', () => {
    for (const name of RELIC_NAMES) {
      const thumb = composeGear(inputFor(name), relicGrammar, 'thumb');
      // The density law: silhouette + core + colorway. The core
      // read is the light-tone pair (E/e) — the adopted socket
      // geometry rounds both layers to the same radius at thumb
      // scale, so the pair is the honest pin, not either alone.
      // (The v1 pins "no T / no k at thumb" are void under salvage:
      // the rubble ground is form-layer paint, not detail kit, and
      // it renders at every size — glints and shadow included.)
      expect(countShade(thumb, 'E') + countShade(thumb, 'e'), name).toBeGreaterThan(0);
      expect(countShade(thumb, 'F'), name).toBeGreaterThan(0);
    }
  });

  it('the finish lives at card: wear steel (T) paints there', () => {
    const card = composeGear(inputFor('Ancient Module'), relicGrammar, 'card');
    expect(countShade(card, 'T')).toBeGreaterThan(0);
  });
});

describe('relic grammar — dispatch table', () => {
  it('relic grammar is registered in the total dispatch table', () => {
    // Slice 5 retired the flag + route seam: the registry is a
    // total Record, so registration IS the route — there is no
    // second path left to fall back to.
    expect(GEAR_GRAMMARS.relic).toBe(relicGrammar);
  });
});

describe('relic grammar — golden signature pins', () => {
  // Regression tripwires: any intentional art change re-pins these
  // deliberately (and the capture sheets get re-read). Re-recorded
  // wholesale at the SALVAGE adoption — every pin moved with the
  // grammar id; see the suite header for the verification story.
  // S3 re-pin (2026-11-07): relic renders changed ONLY through
    // the core selective outline (S3-7) — measured silhouette
    // delta 0 across the 64-item acceptance corpus; no relic form,
    // tone, or SALVAGE code moved in the slice.
  const GOLDENS: Record<string, string> = {
    'vault-chip Epic card': 'a57ef28c',
    'data-shard Epic card': 'afb341bd',
    'neural-key Epic card': 'b8da5f12',
    'cache-relic Epic card': 'eeefb30b',
    'echo-stone Epic card': '3080874a',
    'void-prism Epic card': '80bf7e42',
    'circuit-totem Epic card': 'd599fbfa',
    'ancient-module Epic card': '9063f43c',
    'scrap-core Epic card': 'cac064cc',
    'glitched-token Epic card': 'e7aa907c',
    'ethereal-drive Epic card': '1c74ba47',
    'quantum-fragment Epic card': '267cd5c8',
    // The craft relics (economy slice 9): the converted workshop
    // tools + the Prime Laboratory join the pool and the pins.
    'precision-calipers Epic card': '12edb286',
    'servo-bench-rig Epic card': '3fe41aaa',
    'reclaimer-head Epic card': 'ab986be3',
    'prime-laboratory Epic card': 'ea73d0be',
    'vault-chip Epic thumb': '9fc1dcbe',
    'neural-key Epic thumb': 'c5c172ff',
    'glitched-token Epic thumb': '187705d0',
    'quantum-fragment Epic thumb': 'f324ad39',
    'cache-relic boss Rare card': '607d8a',
    'cache-relic cache Rare card': 'c3aa09a8',
    'void-prism Common card': '4e91197b',
    'void-prism Legendary card': '98a7bfaa',
    'echo-stone Common card': 'f38de159',
    'echo-stone Legendary card': '1268ec6e',
    'glitched-token Common card': '28c11dc1',
    'echo-stone Epic thumb': 'daac713c',
    'void-prism Epic thumb': '9f27049e',
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
    'precision-calipers Epic card': { input: byForm('precision-calipers'), density: 'card' },
    'servo-bench-rig Epic card': { input: byForm('servo-bench-rig'), density: 'card' },
    'reclaimer-head Epic card': { input: byForm('reclaimer-head'), density: 'card' },
    'prime-laboratory Epic card': { input: byForm('prime-laboratory'), density: 'card' },
    'vault-chip Epic thumb': { input: byForm('vault-chip'), density: 'thumb' },
    'neural-key Epic thumb': { input: byForm('neural-key'), density: 'thumb' },
    'glitched-token Epic thumb': { input: byForm('glitched-token'), density: 'thumb' },
    'quantum-fragment Epic thumb': { input: byForm('quantum-fragment'), density: 'thumb' },
    'cache-relic boss Rare card': { input: byForm('cache-relic', { rarity: Rarity.Rare, seed: 777, variant: 'cache-relic/boss' }), density: 'card' },
    'cache-relic cache Rare card': { input: byForm('cache-relic', { rarity: Rarity.Rare, seed: 777, variant: 'cache-relic/cache' }), density: 'card' },
    'void-prism Common card': { input: byForm('void-prism', { rarity: Rarity.Common, seed: 99, pips: 2 }), density: 'card' },
    'void-prism Legendary card': { input: byForm('void-prism', { rarity: Rarity.Legendary, seed: 99, pips: 2 }), density: 'card' },
    // The re-formed gems, pinned across the finish ladder too.
    'echo-stone Common card': { input: byForm('echo-stone', { rarity: Rarity.Common, seed: 99, pips: 2 }), density: 'card' },
    'echo-stone Legendary card': { input: byForm('echo-stone', { rarity: Rarity.Legendary, seed: 99, pips: 2 }), density: 'card' },
    'glitched-token Common card': { input: byForm('glitched-token', { rarity: Rarity.Common, seed: 99, pips: 2 }), density: 'card' },
    'echo-stone Epic thumb': { input: byForm('echo-stone'), density: 'thumb' },
    'void-prism Epic thumb': { input: byForm('void-prism'), density: 'thumb' },
  };
  for (const [name, { input, density }] of Object.entries(CASES)) {
    it(`pins ${name}`, () => {
      expect(composeGear(input, relicGrammar, density).signature).toBe(GOLDENS[name]);
    });
  }
});
