import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Element, Rarity } from '@/types/game';
import type { Shield } from '@/types/items';
import { PixelGear } from '@/components/pixelArt/PixelGear';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import {
  bespokeGearKey,
  composeGear,
  defaultGearInput,
} from '@/lib/pixel/gearCardCompositor';
import { fixtureBlockGrammar } from './gearFixtureGrammar';

/**
 * Gear marriage, slice 0 — PixelGear shell + the dispatch seam.
 *
 * Pins: PixelGear composes through the core with the shared
 * signature (so a surface showing PixelGear agrees with every
 * other surface on the item), bespoke art resolves BEFORE grammar
 * when registered, and GearIllustration's default output for a
 * non-weapon kind is still its SVG (slice 0 flips nothing).
 */

const shield: Shield = {
  id: 'test_shield', name: 'Test Shield', level: 5, rarity: Rarity.Rare,
  hp: 200, rechargeRate: 5, mitigation: 0.2, element: Element.Fire,
  affixes: [], sourceTag: 'World Drop', isLocked: false, pixelSeed: 67890,
};

describe('PixelGear — composes through the core', () => {
  it('renders a canvas carrying the core signature at card density', () => {
    const { container } = render(<PixelGear item={shield} grammar={fixtureBlockGrammar} size={70} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const expected = composeGear(defaultGearInput(shield, fixtureBlockGrammar), fixtureBlockGrammar, 'card');
    expect(canvas!.dataset.signature).toBe(expected.signature);
    expect(canvas!.dataset.density).toBe('card');
  });

  it('thumb density carries the thumb signature space', () => {
    const { container } = render(<PixelGear item={shield} grammar={fixtureBlockGrammar} size={46} density="thumb" />);
    const canvas = container.querySelector('canvas');
    const expected = composeGear(defaultGearInput(shield, fixtureBlockGrammar), fixtureBlockGrammar, 'thumb');
    expect(canvas!.dataset.signature).toBe(expected.signature);
    expect(canvas!.dataset.density).toBe('thumb');
  });
});

describe('PixelGear — bespoke resolves first', () => {
  it('a registered bespoke sprite outranks the grammar composition', () => {
    const registry = { [bespokeGearKey('shield', 'Test Shield')]: 'gear-shield-emitter' };
    const { container } = render(
      <PixelGear item={shield} grammar={fixtureBlockGrammar} size={70} bespokeRegistry={registry} />,
    );
    expect(container.querySelector('canvas')).toBeNull();
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.dataset.pixelSprite).toBe('gear-shield-emitter');
  });
});

describe('GearIllustration — slice 0 flips nothing', () => {
  it('a shield still renders its SVG illustration by default', () => {
    const { container } = render(<GearIllustration item={shield} size="card" showBadges={false} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });
});
