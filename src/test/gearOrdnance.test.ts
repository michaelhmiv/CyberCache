import { describe, expect, it } from 'vitest';
import { Element, Rarity } from '@/types/game';
import type { Ordnance } from '@/types/items';
import {
  composeGear,
  type GearComposeInput,
  type GearRender,
} from '@/lib/pixel/gearCardCompositor';
import {
  GEAR_GRAMMARS,
  gearKindOf,
  isOrdnanceItem,
} from '@/lib/pixel/gearDispatch';
import {
  ORDNANCE_EFFECT_FORMS,
  ordnanceEffectName,
  ordnanceFormForEffect,
  ordnanceGrammar,
  type OrdnanceFormId,
} from '@/lib/pixel/ordnanceGrammar';
import { getElementVisual } from '@/constants/visualAssets';
import { createRNG } from '@/lib/utils/rng';
import { generateOrdnance } from '@/server/lib/generators/ordnanceGenerator';

/**
 * Gear marriage, slice 2 — ordnance.
 *
 * The marriage: FORM = EFFECT CLASS. The SVG this replaces
 * picked its family by hash(effect)+seed — the anti-hash pins
 * below are the point of the slice: every one of the 10 live
 * effects renders its assigned form, two effects in a class
 * share the form, an effect change across classes changes the
 * silhouette, and the mapping stays in sync with the generator
 * that actually rolls the strings.
 */

const input = (over: Partial<GearComposeInput> = {}): GearComposeInput => ({
  kind: 'ordnance',
  rarity: Rarity.Rare,
  element: Element.Fire,
  seed: 777,
  pips: 2,
  variant: 'spike',
  ...over,
});

const item = (over: Partial<Ordnance> = {}): Ordnance => ({
  id: 'ord_test',
  name: 'Fire Grenade',
  level: 10,
  rarity: Rarity.Rare,
  damage: 240,
  shieldDamage: 180,
  armorDamage: 200,
  element: Element.Fire,
  effect: 'Fragmentation: +15% area damage',
  affixes: [
    { id: 'a1', category: 'combat', stat: 'damage', value: 0.1, displayText: '+10% damage' },
    { id: 'a2', category: 'combat', stat: 'armorBreak', value: 0.05, displayText: '+5% armor break' },
  ],
  sourceTag: 'World Drop' as Ordnance['sourceTag'],
  isLocked: false,
  pixelSeed: 777,
  ...over,
});

const countShade = (render: GearRender, s: string) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c === s).length, 0);
const filledCount = (render: GearRender) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c !== '.').length, 0);
/** Form cells only: frame (F/f) and outline (K/k) are finishes. */
const formMaskOf = (render: GearRender) =>
  render.rows.map((r) => [...r].map((c) => (c === '.' || c === 'F' || c === 'f' || c === 'K' || c === 'k' ? '0' : '1')).join('')).join('/');

const EXPECTED: Record<string, OrdnanceFormId> = {
  'Fragmentation: +15% area damage': 'spike',
  'Kinetic Slam: +30% armor break': 'spike',
  'EMP Payload: +25% shield break': 'disc',
  'Shockwave: +40% stagger chance': 'disc',
  'Seeker: Homes on weakpoints (+15% crit)': 'dart',
  'Void Tap: 10% chance to refund charge': 'dart',
  'Cluster: Splits into 3 bomblets': 'canister',
  'Incendiary: Fire DoT for 5s': 'canister',
  'Acid Burst: Corrosive DoT for 6s': 'canister',
  'Cryo Shell: Slows boss by 20% for 8s': 'canister',
};

describe('ordnance marriage — effect class assigns the form (the anti-hash pins)', () => {
  for (const [effect, form] of Object.entries(EXPECTED)) {
    it(`${effect} → ${form}`, () => {
      expect(ordnanceFormForEffect(effect)).toBe(form);
      expect(ordnanceGrammar.inputFromItem!(item({ effect })).variant).toBe(form);
    });
  }

  it('the mapping covers exactly the 10 live effect names', () => {
    expect(Object.keys(ORDNANCE_EFFECT_FORMS).sort()).toEqual(
      Object.keys(EXPECTED).map(ordnanceEffectName).sort(),
    );
  });

  it('stays in sync with the generator: every rolled effect maps, all 10 roll', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createRNG(seed * 7919);
      for (let i = 0; i < 12; i++) {
        const rolled = generateOrdnance(10, rng);
        seen.add(ordnanceEffectName(rolled.effect));
        expect(ORDNANCE_EFFECT_FORMS[ordnanceEffectName(rolled.effect)]).toBeDefined();
        expect(ordnanceGrammar.inputFromItem!(rolled).variant)
          .toBe(EXPECTED[rolled.effect]);
      }
    }
    expect(seen.size).toBe(10);
  });

  it('same class, different effect → identical render; class change → new silhouette', () => {
    const frag = ordnanceGrammar.inputFromItem!(item({ effect: 'Fragmentation: +15% area damage' }));
    const slam = ordnanceGrammar.inputFromItem!(item({ effect: 'Kinetic Slam: +30% armor break' }));
    expect(composeGear(frag, ordnanceGrammar).signature)
      .toBe(composeGear(slam, ordnanceGrammar).signature);
    const emp = ordnanceGrammar.inputFromItem!(item({ effect: 'EMP Payload: +25% shield break' }));
    expect(formMaskOf(composeGear(emp, ordnanceGrammar)))
      .not.toBe(formMaskOf(composeGear(frag, ordnanceGrammar)));
  });

  it('an unrecognized effect falls back deterministically — never to a hash', () => {
    expect(ordnanceFormForEffect('Mystery Box: ???')).toBe('canister');
    expect(ordnanceFormForEffect('Mystery Box: ???')).toBe(ordnanceFormForEffect('Mystery Box: ???'));
    expect(ordnanceFormForEffect('')).toBe('canister');
  });
});

describe('ordnance grammar — derivation from the real record', () => {
  it('inputFromItem derives element/rarity/seed/pips/form from the record', () => {
    const derived = ordnanceGrammar.inputFromItem!(item({ effect: 'Seeker: Homes on weakpoints (+15% crit)' }));
    expect(derived).toEqual({
      kind: 'ordnance', rarity: Rarity.Rare, element: Element.Fire,
      seed: 777, pips: 2, variant: 'dart',
    });
    expect(gearKindOf(item())).toBe('ordnance');
    expect(isOrdnanceItem(item())).toBe(true);
  });

  it('the registered grammar is this grammar (slice 5: the table is the only route)', () => {
    expect(GEAR_GRAMMARS.ordnance).toBe(ordnanceGrammar);
    expect(ordnanceGrammar.plate).toEqual({ width: 240, height: 120 });
  });
});

describe('ordnance grammar — form identity', () => {
  const forms: OrdnanceFormId[] = ['spike', 'disc', 'dart', 'canister'];

  it('the four forms are pairwise-distinct silhouettes at card', () => {
    const masks = forms.map((f) => formMaskOf(composeGear(input({ variant: f }), ordnanceGrammar)));
    expect(new Set(masks).size).toBe(4);
  });

  it('rarity is finish only: form mask identical Common → Legendary per form', () => {
    for (const f of forms) {
      const common = composeGear(input({ variant: f, rarity: Rarity.Common }), ordnanceGrammar);
      const legendary = composeGear(input({ variant: f, rarity: Rarity.Legendary }), ordnanceGrammar);
      expect(formMaskOf(legendary)).toBe(formMaskOf(common));
      expect(countShade(legendary, 'F')).toBeGreaterThan(countShade(common, 'F'));
    }
  });

  it('element is the colorway: E matches ELEMENT_VISUALS, Kinetic the metallic', () => {
    for (const element of Object.values(Element)) {
      const render = composeGear(input({ element }), ordnanceGrammar);
      expect(render.colors.E).toBe(getElementVisual(element).color);
      expect(countShade(render, 'E')).toBeGreaterThan(0);
    }
    expect(composeGear(input({ element: Element.Kinetic }), ordnanceGrammar).colors.E).toBe('#B8B0A8');
  });

  it('every form × element corner composes filled, with a lit core', () => {
    for (const f of forms) {
      for (const element of Object.values(Element)) {
        const render = composeGear(input({ variant: f, element }), ordnanceGrammar);
        expect(render.width).toBe(240);
        expect(render.height).toBe(120);
        expect(filledCount(render)).toBeGreaterThan(2500);
        expect(countShade(render, 'E')).toBeGreaterThan(0);
      }
    }
  });
});

describe('ordnance grammar — determinism + seed variation', () => {
  it('same input → same signature and rows, twice', () => {
    const a = composeGear(input({ variant: 'disc', element: Element.Void }), ordnanceGrammar);
    const b = composeGear(input({ variant: 'disc', element: Element.Void }), ordnanceGrammar);
    expect(a.signature).toBe(b.signature);
    expect(a.rows).toEqual(b.rows);
  });

  it('different seeds re-render (markings variation is alive)', () => {
    for (const f of ['spike', 'disc', 'dart', 'canister'] as OrdnanceFormId[]) {
      const sigs = new Set(
        [11, 222, 3333, 44444, 555555].map((seed) =>
          composeGear(input({ variant: f, seed }), ordnanceGrammar).signature),
      );
      expect(sigs.size).toBeGreaterThan(1);
    }
  });
});

describe('ordnance grammar — thumb is detail level 0', () => {
  const forms: OrdnanceFormId[] = ['spike', 'disc', 'dart', 'canister'];

  it('no steel texels at thumb: the silhouette layer never paints T', () => {
    for (const f of forms) {
      const card = composeGear(input({ variant: f }), ordnanceGrammar, 'card');
      const thumb = composeGear(input({ variant: f }), ordnanceGrammar, 'thumb');
      expect(countShade(card, 'T')).toBeGreaterThan(0); // kit paints at card
      expect(countShade(thumb, 'T')).toBe(0); // and cannot paint at thumb
    }
  });

  it('thumbs are bold composed silhouettes: filled, cored, framed, pairwise distinct', () => {
    const masks: string[] = [];
    for (const f of forms) {
      const thumb = composeGear(input({ variant: f }), ordnanceGrammar, 'thumb');
      expect(thumb.width).toBe(60);
      expect(thumb.height).toBe(30);
      expect(filledCount(thumb)).toBeGreaterThan(150);
      expect(countShade(thumb, 'E')).toBeGreaterThan(0);
      expect(countShade(thumb, 'F')).toBeGreaterThan(0);
      masks.push(formMaskOf(thumb));
    }
    expect(new Set(masks).size).toBe(4);
  });
});

describe('ordnance grammar — golden signature pins', () => {
  // Regression tripwires: any intentional art change re-pins
  // these deliberately (and the capture sheets get re-read).
  const GOLDENS: Record<string, string> = {
    'spike Kinetic Common card': 'f8792032',
    'spike Fire Epic card': '554eae6a',
    'spike Void Legendary card': '34ff9dcf',
    'disc Shock Rare card': '6b60622e',
    'disc Cryo Epic card': 'fa4d7f5c',
    'dart Fire Rare card': '6b81978d',
    'dart Kinetic Legendary card': '3fd3f424',
    'canister Corrosive Epic card': 'd3ea6c29',
    'canister Void Common card': 'a7ce29f6',
    'spike Fire Rare thumb': 'da541453',
    'disc Shock Rare thumb': '6dda4d32',
    'dart Void Rare thumb': '1341cad6',
    'canister Kinetic Rare thumb': '7bb3a8d3',
  };
  const CASES: Record<string, { input: GearComposeInput; density: 'card' | 'thumb' }> = {
    'spike Kinetic Common card': { input: input({ variant: 'spike', element: Element.Kinetic, rarity: Rarity.Common, pips: 0 }), density: 'card' },
    'spike Fire Epic card': { input: input({ variant: 'spike', rarity: Rarity.Epic, pips: 3 }), density: 'card' },
    'spike Void Legendary card': { input: input({ variant: 'spike', element: Element.Void, rarity: Rarity.Legendary, seed: 4242, pips: 5 }), density: 'card' },
    'disc Shock Rare card': { input: input({ variant: 'disc', element: Element.Shock }), density: 'card' },
    'disc Cryo Epic card': { input: input({ variant: 'disc', element: Element.Cryo, rarity: Rarity.Epic, seed: 99, pips: 1 }), density: 'card' },
    'dart Fire Rare card': { input: input({ variant: 'dart' }), density: 'card' },
    'dart Kinetic Legendary card': { input: input({ variant: 'dart', element: Element.Kinetic, rarity: Rarity.Legendary, seed: 4242, pips: 4 }), density: 'card' },
    'canister Corrosive Epic card': { input: input({ variant: 'canister', element: Element.Corrosive, rarity: Rarity.Epic, pips: 3 }), density: 'card' },
    'canister Void Common card': { input: input({ variant: 'canister', element: Element.Void, rarity: Rarity.Common, seed: 99, pips: 0 }), density: 'card' },
    'spike Fire Rare thumb': { input: input({ variant: 'spike' }), density: 'thumb' },
    'disc Shock Rare thumb': { input: input({ variant: 'disc', element: Element.Shock }), density: 'thumb' },
    'dart Void Rare thumb': { input: input({ variant: 'dart', element: Element.Void }), density: 'thumb' },
    'canister Kinetic Rare thumb': { input: input({ variant: 'canister', element: Element.Kinetic }), density: 'thumb' },
  };
  for (const [name, { input: caseInput, density }] of Object.entries(CASES)) {
    it(`pins ${name}`, () => {
      expect(composeGear(caseInput, ordnanceGrammar, density).signature).toBe(GOLDENS[name]);
    });
  }
});
