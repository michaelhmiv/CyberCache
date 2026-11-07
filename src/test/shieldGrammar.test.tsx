import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DropSource, Element, Rarity } from '@/types/game';
import type { Shield } from '@/types/items';
import type { ShieldBehaviorId } from '@/lib/combat/shieldBehaviors';
import { PixelGear } from '@/components/pixelArt/PixelGear';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import {
  BESPOKE_GEAR_SPRITES,
  bespokeGearKey,
  composeGear,
  type GearComposeInput,
  type GearRender,
} from '@/lib/pixel/gearCardCompositor';
import { GEAR_GRAMMARS } from '@/lib/pixel/gearDispatch';
import { SHIELD_FAMILY_ROWS, shieldGrammar } from '@/lib/pixel/shieldGrammar';

/**
 * Gear marriage, slice 1 — shields render as pixel plates.
 *
 * The family is the shield's rolled BEHAVIOR (the audit's
 * verdict): five rows, one per archetype, and changing ONLY the
 * behavior on an otherwise identical record must change the
 * family — the invariant the old SVG violated by picking its
 * family from element × coin flip. Element is the colorway,
 * rarity is finish only, the seed varies panels/vents, affixes
 * are the socket row. Golden signatures pin the matrix corners;
 * the v3 reference combos (Nova·Fire·Epic, Amp·Shock·Legendary,
 * Turtle·Kinetic·Rare, Standard·Void·Epic) are among them.
 */

const BEHAVIORS: ShieldBehaviorId[] = ['standard', 'nova', 'absorb', 'amp', 'turtle'];
const ELEMENTS: Element[] = [Element.Kinetic, Element.Fire, Element.Shock, Element.Corrosive, Element.Cryo, Element.Void];

const input = (over: Partial<GearComposeInput> = {}): GearComposeInput => ({
  kind: 'shield',
  rarity: Rarity.Rare,
  element: Element.Fire,
  seed: 1101,
  pips: 3,
  variant: 'standard',
  ...over,
});

const makeShield = (over: Partial<Shield> = {}): Shield => ({
  id: 'shield-1',
  name: 'Test Aegis',
  level: 5,
  rarity: Rarity.Rare,
  hp: 200,
  rechargeRate: 5,
  mitigation: 0.2,
  element: Element.Fire,
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 67890,
  behavior: 'nova',
  ...over,
});

const countShade = (render: GearRender, s: string) =>
  render.rows.reduce((n, r) => n + [...r].filter((c) => c === s).length, 0);
/** Form cells only: frame (F/f) and outline (K/k) are finishes. */
const formMaskOf = (render: GearRender) =>
  render.rows.map((r) => [...r].map((c) => (c === '.' || c === 'F' || c === 'f' || c === 'K' || c === 'k' ? '0' : '1')).join('')).join('/');
const cellDistance = (a: GearRender, b: GearRender) => {
  let diff = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    if (a.rows[y][x] !== b.rows[y][x]) diff++;
  }
  return diff;
};
/** Cells where two renders' form masks disagree. */
const formMaskDelta = (a: GearRender, b: GearRender) => {
  const ma = formMaskOf(a).split('/');
  const mb = formMaskOf(b).split('/');
  let diff = 0;
  for (let y = 0; y < ma.length; y++) for (let x = 0; x < ma[y].length; x++) {
    if (ma[y][x] !== mb[y][x]) diff++;
  }
  return diff;
};

describe('shield grammar — registration + dispatch', () => {
  it('the shield grammar is registered in the total dispatch table', () => {
    // Slice 5 retired the flag + route seam: the registry is a
    // total Record, so registration IS the route — there is no
    // second path left to fall back to.
    expect(GEAR_GRAMMARS.shield).toBe(shieldGrammar);
    expect(Object.keys(SHIELD_FAMILY_ROWS).sort()).toEqual([...BEHAVIORS].sort());
  });

  it('GearIllustration renders a shield as the pixel plate, never the SVG', () => {
    const shield = makeShield();
    const { container } = render(<GearIllustration item={shield} size="card" showBadges={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    const expected = composeGear(shieldGrammar.inputFromItem!(shield), shieldGrammar, 'card');
    expect(canvas!.dataset.signature).toBe(expected.signature);
    expect(canvas!.dataset.density).toBe('card');
  });

  it('GearIllustration renders a shield thumb at the thumb density', () => {
    const shield = makeShield();
    const { container } = render(<GearIllustration item={shield} size={46} showBadges={false} />);
    const canvas = container.querySelector('canvas');
    const expected = composeGear(shieldGrammar.inputFromItem!(shield), shieldGrammar, 'thumb');
    expect(canvas!.dataset.signature).toBe(expected.signature);
    expect(canvas!.dataset.density).toBe('thumb');
  });
});

describe('shield grammar — inputFromItem derives from the real record', () => {
  it('behavior comes from the record, one variant per archetype', () => {
    for (const behavior of BEHAVIORS) {
      const derived = shieldGrammar.inputFromItem!(makeShield({ behavior }));
      expect(derived.variant).toBe(behavior);
      expect(derived.kind).toBe('shield');
    }
  });

  it('a legacy shield with no behavior field reads as Standard', () => {
    const legacy = makeShield();
    delete legacy.behavior;
    expect(shieldGrammar.inputFromItem!(legacy).variant).toBe('standard');
  });

  it('rarity, element, seed, and affix pips ride along', () => {
    const shield = makeShield({
      rarity: Rarity.Epic,
      element: Element.Void,
      pixelSeed: 4242,
      affixes: [
        { id: 'a1', category: 'combat', stat: 'maxHp', value: 10, displayText: '+10 HP' },
        { id: 'a2', category: 'combat', stat: 'mitigation', value: 2, displayText: '+2%' },
      ],
    });
    const derived = shieldGrammar.inputFromItem!(shield);
    expect(derived.rarity).toBe(Rarity.Epic);
    expect(derived.element).toBe(Element.Void);
    expect(derived.seed).toBe(4242);
    expect(derived.pips).toBe(2);
  });
});

describe('shield grammar — golden signature pins', () => {
  // Regression tripwires across the matrix corners, including
  // the four owner-approved v3 reference combos. Any intentional
  // art change re-pins these deliberately (and re-shoots the
  // capture sheets with scripts/render-shield-fixtures.ts).
  // S3 re-pin (2026-11-07): broken-band casings, the Absorb
    // rewrite, broken vents + scorch clusters, the wear ladder,
    // and selective outline (S3-1..S3-4, S3-8). Acceptance corpus
    // + form-diff report: cybercache-prep pxl-craft-sweep/s3-evidence/.
  const GOLDENS: Record<string, string> = {
    'standard Kinetic Common card': 'c8af1228',
    'standard Void Epic card': '65626e79',
    'nova Fire Epic card': 'b66a98fc',
    'nova Shock Common card': 'b623e66d',
    'absorb Void Legendary card': 'a6c97fca',
    'absorb Cryo Rare card': 'c871bb35',
    'amp Shock Legendary card': '68ef2f07',
    'amp Corrosive Uncommon card': '77d07702',
    'turtle Kinetic Rare card': 'b92a648',
    'turtle Fire Legendary card': '1b861a7c',
    'nova Fire Epic thumb': '1c94886c',
    'turtle Kinetic Rare thumb': 'a9f49fde',
  };
  const CASES: Record<string, { input: GearComposeInput; density: 'card' | 'thumb' }> = {
    'standard Kinetic Common card': { input: input({ variant: 'standard', element: Element.Kinetic, rarity: Rarity.Common, seed: 101, pips: 0 }), density: 'card' },
    'standard Void Epic card': { input: input({ variant: 'standard', element: Element.Void, rarity: Rarity.Epic }), density: 'card' },
    'nova Fire Epic card': { input: input({ variant: 'nova', rarity: Rarity.Epic }), density: 'card' },
    'nova Shock Common card': { input: input({ variant: 'nova', element: Element.Shock, rarity: Rarity.Common, seed: 7, pips: 1 }), density: 'card' },
    'absorb Void Legendary card': { input: input({ variant: 'absorb', element: Element.Void, rarity: Rarity.Legendary, pips: 4 }), density: 'card' },
    'absorb Cryo Rare card': { input: input({ variant: 'absorb', element: Element.Cryo, seed: 42, pips: 2 }), density: 'card' },
    'amp Shock Legendary card': { input: input({ variant: 'amp', element: Element.Shock, rarity: Rarity.Legendary }), density: 'card' },
    'amp Corrosive Uncommon card': { input: input({ variant: 'amp', element: Element.Corrosive, rarity: Rarity.Uncommon, seed: 9, pips: 1 }), density: 'card' },
    'turtle Kinetic Rare card': { input: input({ variant: 'turtle', element: Element.Kinetic, seed: 1103, pips: 2 }), density: 'card' },
    'turtle Fire Legendary card': { input: input({ variant: 'turtle', rarity: Rarity.Legendary, seed: 5, pips: 5 }), density: 'card' },
    'nova Fire Epic thumb': { input: input({ variant: 'nova', rarity: Rarity.Epic }), density: 'thumb' },
    'turtle Kinetic Rare thumb': { input: input({ variant: 'turtle', element: Element.Kinetic, seed: 1103, pips: 2 }), density: 'thumb' },
  };
  for (const [name, { input: caseInput, density }] of Object.entries(CASES)) {
    it(`pins ${name}`, () => {
      expect(composeGear(caseInput, shieldGrammar, density).signature).toBe(GOLDENS[name]);
    });
  }
});

describe('shield grammar — family invariants', () => {
  it('behavior change ⇒ family change: the five silhouettes are pairwise far apart', () => {
    const renders = BEHAVIORS.map((variant) => composeGear(input({ variant }), shieldGrammar));
    for (let i = 0; i < renders.length; i++) {
      for (let j = i + 1; j < renders.length; j++) {
        expect(renders[i].signature).not.toBe(renders[j].signature);
        expect(cellDistance(renders[i], renders[j])).toBeGreaterThan(4000);
      }
    }
  });

  it('every behavior × element cell of the matrix renders a distinct plate', () => {
    const sigs = new Set<string>();
    for (const variant of BEHAVIORS) {
      for (const element of ELEMENTS) {
        sigs.add(composeGear(input({ variant, element }), shieldGrammar).signature);
      }
    }
    expect(sigs.size).toBe(30);
  });

  it('same input → same signature and rows, twice (determinism)', () => {
    const a = composeGear(input({ variant: 'absorb', element: Element.Cryo }), shieldGrammar);
    const b = composeGear(input({ variant: 'absorb', element: Element.Cryo }), shieldGrammar);
    expect(a.signature).toBe(b.signature);
    expect(a.rows).toEqual(b.rows);
  });

  it('the seed varies every family (panels/vents are per-instance)', () => {
    for (const variant of BEHAVIORS) {
      const sigs = new Set(
        [1, 2, 3, 4, 5, 6].map((seed) => composeGear(input({ variant, seed }), shieldGrammar).signature),
      );
      expect(sigs.size).toBe(6);
    }
  });

  it('rarity is finish only: thumbs byte-identical across rarities; card form moves only inside the wear footprint', () => {
    // S3-8 re-argument (the relic precedent, extended): pre-S3
    // this asserted ONE form mask for all rarities, which held
    // because the old finish (frame + ink outline) never touched
    // a form cell. S3's finishes do, deliberately: the wear
    // ladder (grill ruling 2) bites silhouette-edge cells at
    // card density, and selective outline (S3-1) reclassifies an
    // outline cell's mask membership when wear darkening moves
    // its lightest neighbor across the deep-accent boundary.
    // The invariant's intent — form never branches on rarity —
    // is therefore pinned where it is exact and bounded where
    // the finish legitimately reaches:
    //   · thumb: byte-identical rows across rarities (the
    //     ladder never runs at detail level 0);
    //   · card: form-mask delta ≤ 96 cells (measured worst case
    //     50 across the family × seed matrix, standard/7 — the
    //     bound is that measurement with headroom, not a hope).
    for (const variant of BEHAVIORS) {
      const common = composeGear(input({ variant, rarity: Rarity.Common }), shieldGrammar);
      const legendary = composeGear(input({ variant, rarity: Rarity.Legendary }), shieldGrammar);
      expect(legendary.signature).not.toBe(common.signature);
      expect(countShade(legendary, 'F')).toBeGreaterThan(countShade(common, 'F'));
      expect(formMaskDelta(common, legendary)).toBeLessThanOrEqual(96);
      const commonT = composeGear(input({ variant, rarity: Rarity.Common }), shieldGrammar, 'thumb');
      const legendaryT = composeGear(input({ variant, rarity: Rarity.Legendary }), shieldGrammar, 'thumb');
      expect(legendaryT.rows).toEqual(commonT.rows);
    }
  });
});

describe('shield grammar — thumb is detail level 0', () => {
  it('thumb rows do not depend on pips (the socket row cannot paint there)', () => {
    for (const variant of BEHAVIORS) {
      const bare = composeGear(input({ variant, pips: 0 }), shieldGrammar, 'thumb');
      const loaded = composeGear(input({ variant, pips: 5 }), shieldGrammar, 'thumb');
      expect(loaded.rows).toEqual(bare.rows);
    }
  });

  it('card rows DO carry the affix sockets', () => {
    const bare = composeGear(input({ pips: 0 }), shieldGrammar, 'card');
    const loaded = composeGear(input({ pips: 5 }), shieldGrammar, 'card');
    expect(loaded.rows).not.toEqual(bare.rows);
  });

  it('the thumb still carries silhouette, core, and the rarity colorway', () => {
    for (const variant of BEHAVIORS) {
      const thumbRender = composeGear(input({ variant }), shieldGrammar, 'thumb');
      expect(thumbRender.width).toBe(60);
      expect(thumbRender.height).toBe(35);
      expect(countShade(thumbRender, 'E')).toBeGreaterThan(0);
      expect(countShade(thumbRender, 'F')).toBeGreaterThan(0);
    }
  });
});

describe('shield grammar — bespoke resolves first (untouched)', () => {
  it('the production bespoke registry is still empty for shields', () => {
    expect(BESPOKE_GEAR_SPRITES[bespokeGearKey('shield', 'Test Aegis')]).toBeUndefined();
  });

  it('a registered bespoke sprite would outrank the shield grammar', () => {
    const registry = { [bespokeGearKey('shield', 'Test Aegis')]: 'gear-shield-emitter' };
    const { container } = render(
      <PixelGear item={makeShield()} grammar={shieldGrammar} size={70} bespokeRegistry={registry} />,
    );
    expect(container.querySelector('canvas')).toBeNull();
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.dataset.pixelSprite).toBe('gear-shield-emitter');
  });
});
