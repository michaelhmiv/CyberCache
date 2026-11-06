import { describe, expect, it } from 'vitest';
import { DropSource, Element, Rarity } from '@/types/game';
import type { Shield } from '@/types/items';
import {
  BESPOKE_GEAR_SPRITES,
  GEAR_CARD_PLATES,
  bespokeGearKey,
  bespokeSpriteIdForGear,
  composeGear,
  composeGearCached,
  defaultGearInput,
  fiveToneRamp,
  gearGridFor,
  type GearComposeInput,
  type GearRender,
} from '@/lib/pixel/gearCardCompositor';
import { GEAR_GRAMMARS, gearKindOf } from '@/lib/pixel/gearDispatch';
import { fixtureBlockGrammar, fixtureSlabGrammar } from './gearFixtureGrammar';

/**
 * Gear marriage, slice 0 — the shared gear plate core.
 *
 * Pins the core contract the kind slices build on:
 *  - fixed texel grids per density (card = the kind's logical
 *    plate; thumb = quarter grid), authored AT the grid;
 *  - determinism + signature identity across surfaces, in the
 *    weapon system's pattern;
 *  - thumb is DETAIL LEVEL 0 by construction: the detail kit
 *    (rivets/seams/vents/sockets — the only painters of the T and
 *    k shades in the fixture grammars) physically cannot paint
 *    at thumb, so a thumb is a composed silhouette + core +
 *    colorway, never a downscale of the card render;
 *  - rarity is finish only: the frame escalates, the form never
 *    changes;
 *  - element colorways come from ELEMENT_VISUALS; Kinetic is the
 *    metallic honest absence, as weapons pin it;
 *  - bespoke-resolves-first exists and is empty; the dispatch
 *    seam routes every kind to its SVG until flag AND grammar.
 */

const block = (over: Partial<GearComposeInput> = {}): GearComposeInput => ({
  kind: 'shield',
  rarity: Rarity.Common,
  element: Element.Kinetic,
  seed: 1234,
  pips: 2,
  ...over,
});
const slab = (over: Partial<GearComposeInput> = {}): GearComposeInput => ({
  kind: 'ordnance',
  rarity: Rarity.Common,
  element: Element.Kinetic,
  seed: 777,
  pips: 1,
  ...over,
});

const countShade = (render: GearRender, s: string) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c === s).length, 0);
const filledCount = (render: GearRender) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c !== '.').length, 0);
/** Form cells only: frame (F/f) and outline (K/k) are finishes. */
const formMaskOf = (render: GearRender) =>
  render.rows.map((r) => [...r].map((c) => (c === '.' || c === 'F' || c === 'f' || c === 'K' || c === 'k' ? '0' : '1')).join('')).join('/');

describe('gear core — grid contract (the density law)', () => {
  it('card renders at the kind plate grid, authored at the grid', () => {
    const render = composeGear(block(), fixtureBlockGrammar, 'card');
    expect(render.width).toBe(240);
    expect(render.height).toBe(140);
    expect(render.rows).toHaveLength(140);
    for (const row of render.rows) expect(row).toHaveLength(240);
    expect(GEAR_CARD_PLATES.shield).toEqual({ width: 240, height: 140 });
    expect(GEAR_CARD_PLATES.ordnance).toEqual({ width: 240, height: 120 });
  });

  it('thumb renders at the quarter grid', () => {
    const render = composeGear(block(), fixtureBlockGrammar, 'thumb');
    expect(render.width).toBe(60);
    expect(render.height).toBe(35);
    expect(gearGridFor(fixtureSlabGrammar, 'thumb')).toEqual({ width: 60, height: 30 });
    expect(gearGridFor(fixtureSlabGrammar, 'card')).toEqual({ width: 240, height: 120 });
  });
});

describe('gear core — determinism + cache', () => {
  it('same input → same signature and rows, twice', () => {
    const input = block({ element: Element.Void, rarity: Rarity.Epic });
    const a = composeGear(input, fixtureBlockGrammar);
    const b = composeGear({ ...input }, fixtureBlockGrammar);
    expect(a.signature).toBe(b.signature);
    expect(a.rows).toEqual(b.rows);
  });

  it('cached compose returns the identical render object', () => {
    const input = block({ seed: 4242 });
    expect(composeGearCached(input, fixtureBlockGrammar)).toBe(composeGearCached({ ...input }, fixtureBlockGrammar));
  });

  it('thumb and card signatures live in disjoint spaces', () => {
    const input = block();
    expect(composeGear(input, fixtureBlockGrammar, 'thumb').signature)
      .not.toBe(composeGear(input, fixtureBlockGrammar, 'card').signature);
  });

  it('seeded variation survives (different seeds re-render)', () => {
    const sigs = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => composeGear(block({ seed }), fixtureBlockGrammar).signature),
    );
    expect(sigs.size).toBeGreaterThan(1);
  });
});

describe('gear core — thumb is detail level 0 by construction', () => {
  it('the detail kit paints at card and cannot paint at thumb', () => {
    const card = composeGear(block(), fixtureBlockGrammar, 'card');
    const thumb = composeGear(block(), fixtureBlockGrammar, 'thumb');
    // In the fixture grammars the T shade is painted ONLY by the
    // detail kit (rivet cores, vent rims) and k ONLY by detail
    // seats/seams/sockets — the silhouette layer never uses them.
    expect(countShade(card, 'T')).toBeGreaterThan(0);
    expect(countShade(thumb, 'T')).toBe(0);
    expect(countShade(thumb, 'k')).toBe(0);
  });

  it('the thumb still carries silhouette, core, and the rarity colorway', () => {
    const thumb = composeGear(block({ element: Element.Fire, rarity: Rarity.Rare }), fixtureBlockGrammar, 'thumb');
    expect(filledCount(thumb)).toBeGreaterThan(200);
    expect(countShade(thumb, 'E')).toBeGreaterThan(0); // element core survives
    expect(countShade(thumb, 'F')).toBeGreaterThan(0); // frame = the rarity read
  });
});

describe('gear core — rarity is finish only', () => {
  it('Common and Legendary share the exact form mask; the frame escalates', () => {
    const common = composeGear(block({ rarity: Rarity.Common }), fixtureBlockGrammar);
    const legendary = composeGear(block({ rarity: Rarity.Legendary }), fixtureBlockGrammar);
    expect(formMaskOf(legendary)).toBe(formMaskOf(common));
    expect(legendary.signature).not.toBe(common.signature);
    expect(countShade(legendary, 'F')).toBeGreaterThan(countShade(common, 'F'));
  });
});

describe('gear core — colorways', () => {
  it('five-tone ramp: hue-shifted steps off the base hex (S1); straight mode keeps the legacy ramp', () => {
    // S1 (pxl craft sweep): the default derivation is hueLerp — the
    // base stays the game's exact hex, the steps gain hue movement
    // (shadow cools toward red-violet, highlights warm to gold).
    expect(fiveToneRamp('#FF9000')).toEqual({
      deep: '#6b2400',
      dark: '#b35000',
      base: '#FF9000',
      light: '#f6cc65',
      pale: '#f6eab1',
    });
    // The legacy straight lerp survives as the FX kit's flat ramp.
    expect(fiveToneRamp('#FF9000', 'straight')).toEqual({
      deep: '#6b3c00',
      dark: '#b36500',
      base: '#FF9000',
      light: '#ffb85c',
      pale: '#ffd9a8',
    });
  });

  it('element comes from ELEMENT_VISUALS; Kinetic is the metallic', () => {
    const fire = composeGear(block({ element: Element.Fire }), fixtureBlockGrammar);
    const kinetic = composeGear(block({ element: Element.Kinetic }), fixtureBlockGrammar);
    expect(fire.colors.E).toBe('#FF4B1F');
    expect(kinetic.colors.E).toBe('#B8B0A8');
    expect(countShade(fire, 'E')).toBeGreaterThan(0);
    expect(fire.signature).not.toBe(kinetic.signature);
  });

  it('a baseColor override carries the body colorway (tree/crystal kinds)', () => {
    const render = composeGear(block({ element: null, baseColor: '#22C55E' }), fixtureBlockGrammar);
    expect(render.colors.P).toBe('#22C55E');
  });
});

describe('gear core — bespoke resolves first (slot exists, registry empty)', () => {
  it('the production registry is empty — no bespoke gear art exists yet', () => {
    expect(Object.keys(BESPOKE_GEAR_SPRITES)).toHaveLength(0);
    expect(bespokeSpriteIdForGear('shield', 'Test Plate')).toBeUndefined();
    expect(bespokeSpriteIdForGear('relic', undefined)).toBeUndefined();
  });

  it('a registered name wins, keyed by kind + normalized name', () => {
    const registry = { [bespokeGearKey('shield', 'Test Plate')]: 'gear-shield-emitter' };
    expect(bespokeSpriteIdForGear('shield', '  test plate ', registry)).toBe('gear-shield-emitter');
    expect(bespokeSpriteIdForGear('relic', 'Test Plate', registry)).toBeUndefined();
  });
});

describe('gear core — dispatch table (slice 5: total registry, no route left)', () => {
  it('the registry is total: exactly the four gear kinds, each grammar matching its key', () => {
    // Slices 0–4 flipped the kinds one at a time behind a flag +
    // route seam whose fail-safe was "flag without a grammar
    // renders the SVG". Slice 5 deleted the SVG island, so the
    // seam collapsed into this table: GEAR_GRAMMARS is a Record,
    // not a Partial — a missing grammar is a compile error. This
    // pin guards the runtime shape of that contract: no missing
    // kind, no extra kind, no grammar filed under the wrong key.
    expect(Object.keys(GEAR_GRAMMARS).sort()).toEqual(['classMod', 'ordnance', 'relic', 'shield']);
    for (const kind of ['shield', 'ordnance', 'classMod', 'relic'] as const) {
      expect(GEAR_GRAMMARS[kind].kind).toBe(kind);
    }
  });
});

describe('gear core — default input derivation', () => {
  it('derives rarity/element/seed/pips from the item record', () => {
    const shield: Shield = {
      id: 'test_shield', name: 'Test Shield', level: 5, rarity: Rarity.Rare,
      hp: 200, rechargeRate: 5, mitigation: 0.2, element: Element.Fire,
      affixes: [
        { id: 'a1', category: 'combat', stat: 'maxHp', value: 10, displayText: '+10 HP' },
        { id: 'a2', category: 'combat', stat: 'mitigation', value: 2, displayText: '+2% mitigation' },
      ],
      sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 67890,
    };
    const input = defaultGearInput(shield, fixtureBlockGrammar);
    expect(input).toEqual({
      kind: 'shield', rarity: Rarity.Rare, element: Element.Fire, seed: 67890, pips: 2,
    });
    expect(gearKindOf(shield)).toBe('shield');
  });
});

describe('gear core — golden signature pins', () => {
  // Regression tripwires: any intentional art change re-pins
  // these deliberately (and the capture sheets get re-read).
  const GOLDENS: Record<string, string> = {
    'block Fire Epic card': '2e10720',
    'block Kinetic Common card': 'ace3970b',
    'block Fire Epic thumb': '92727b59',
    'block Void Rare thumb': '895b9a65',
    'slab Shock Rare card': '5d06f70f',
    'slab Kinetic Legendary card': 'bf12b5a0',
  };
  const CASES: Record<string, { input: GearComposeInput; grammar: typeof fixtureBlockGrammar; density: 'card' | 'thumb' }> = {
    'block Fire Epic card': { input: block({ element: Element.Fire, rarity: Rarity.Epic }), grammar: fixtureBlockGrammar, density: 'card' },
    'block Kinetic Common card': { input: block(), grammar: fixtureBlockGrammar, density: 'card' },
    'block Fire Epic thumb': { input: block({ element: Element.Fire, rarity: Rarity.Epic }), grammar: fixtureBlockGrammar, density: 'thumb' },
    'block Void Rare thumb': { input: block({ element: Element.Void, rarity: Rarity.Rare, seed: 99 }), grammar: fixtureBlockGrammar, density: 'thumb' },
    'slab Shock Rare card': { input: slab({ element: Element.Shock, rarity: Rarity.Rare }), grammar: fixtureSlabGrammar, density: 'card' },
    'slab Kinetic Legendary card': { input: slab({ rarity: Rarity.Legendary }), grammar: fixtureSlabGrammar, density: 'card' },
  };
  for (const [name, { input, grammar, density }] of Object.entries(CASES)) {
    it(`pins ${name}`, () => {
      expect(composeGear(input, grammar, density).signature).toBe(GOLDENS[name]);
    });
  }
});
