import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { WeaponCard } from '@/components/common/WeaponCard';
import { ActionFeed } from '@/components/action/ActionWorkspace';
import { composePixelWeapon, type PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { createRNG } from '@/lib/utils/rng';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Shield as ShieldItem, Weapon } from '@/types/items';

/**
 * P5 — pixel weapons everywhere: the inventory (GearHub), market
 * (MarketScreen mini-cards), inspect sheet and chest surfaces all draw
 * weapons through GearIllustration; WeaponCard and the ActionFeed loot
 * log draw them directly. All of them must resolve to the ONE pixel
 * renderer: bespoke sprite for named legendaries, the deterministic
 * parts-kit compositor for everything else — the same signature the
 * diorama/loot surfaces produce for the same weapon.
 */

const proceduralWeapon = generateWeapon(
  { source: DropSource.WorldDrop, level: 7, forcedType: WeaponType.Shotgun, forcedRarity: Rarity.Epic, forcedManufacturer: Manufacturer.BlastForge, forcedElement: Element.Fire },
  createRNG(20261029),
);

const legendaryWeapon: Weapon = {
  ...proceduralWeapon,
  id: 'p5-legendary',
  name: 'Procedurally Rolled Tube Custom',
  rarity: Rarity.Legendary,
  legendaryEffectId: 'glass_sun',
} as Weapon;

const plainLegendary: Weapon = {
  ...proceduralWeapon,
  id: 'p5-plain-legendary',
  rarity: Rarity.Legendary,
  legendaryEffectId: undefined,
} as Weapon;

const shield = {
  id: 'p5-shield',
  name: 'Bastion Plate',
  rarity: Rarity.Rare,
  element: Element.Kinetic,
  level: 5,
  hp: 120,
  rechargeRate: 8,
  mitigation: 0.12,
  pixelSeed: 7,
} as unknown as ShieldItem;

const compositorSignature = (weapon: Weapon) =>
  composePixelWeapon({
    weaponType: weapon.weaponType,
    manufacturer: weapon.manufacturer,
    rarity: weapon.rarity,
    element: weapon.element,
    parts: weapon.parts,
    name: weapon.name,
    // Overhaul §4.2 real-item invariant: PixelWeapon resolves the FULL
    // instance identity (id/seed/affixes/roll quality drive decals and
    // condition), so the shared-signature reference must compose the
    // same input — the surfaces still agree with each other exactly.
    id: weapon.id,
    pixelSeed: weapon.pixelSeed,
    affixes: weapon.affixes,
    rollQuality: weapon.rollQuality,
    legendaryEffectId: weapon.legendaryEffectId,
  } satisfies PixelWeaponInput).signature;

describe('GearIllustration — weapon branch renders pixel (inventory/market/inspect/chest path)', () => {
  it('renders a procedural weapon as the compositor canvas with the shared signature', () => {
    const { container } = render(<GearIllustration item={proceduralWeapon} size={50} showBadges={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-signature')).toBe(compositorSignature(proceduralWeapon));
    // The old vector weapon SVG (aria-label "Rarity Element Type") is gone.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders a named legendary as its bespoke sprite, resolved via its effect', () => {
    const { container } = render(<GearIllustration item={legendaryWeapon} size="showcase" showBadges animate />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('data-pixel-sprite')).toBe('legendary-glass-sun');
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('keeps the compositor fallback for a legendary with no named effect', () => {
    const { container } = render(<GearIllustration item={plainLegendary} size={46} showBadges={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-signature')).toBe(compositorSignature(plainLegendary));
  });

  it('maps named sizes to the shared pixel widths (thumb/card/showcase)', () => {
    const { container, rerender } = render(<GearIllustration item={proceduralWeapon} size="thumb" />);
    expect(container.querySelector('canvas')?.style.width).toBe('46px');
    rerender(<GearIllustration item={proceduralWeapon} size="card" />);
    expect(container.querySelector('canvas')?.style.width).toBe('70px');
    rerender(<GearIllustration item={proceduralWeapon} size="showcase" />);
    expect(container.querySelector('canvas')?.style.width).toBe('190px');
  });

  it('leaves non-weapon gear on its existing illustration', () => {
    const { container } = render(<GearIllustration item={shield} size={46} showBadges={false} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('WeaponCard — pixel render', () => {
  it('renders the same compositor signature as GearIllustration for the same weapon', () => {
    const { container: card } = render(<WeaponCard weapon={proceduralWeapon} />);
    const { container: hub } = render(<GearIllustration item={proceduralWeapon} size={50} showBadges={false} />);
    expect(card.querySelector('canvas')?.getAttribute('data-signature')).toBe(
      hub.querySelector('canvas')?.getAttribute('data-signature'),
    );
    expect(card.querySelector('canvas')?.style.width).toBe('70px');
  });

  it('renders a named legendary as its bespoke sprite', () => {
    const { container } = render(<WeaponCard weapon={legendaryWeapon} />);
    expect(container.querySelector('img')?.getAttribute('data-pixel-sprite')).toBe('legendary-glass-sun');
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('ActionFeed — loot-log weapon thumbs render pixel', () => {
  it('renders the compositor canvas for a weapon drop entry', () => {
    const { container } = render(
      <ActionFeed
        entries={[{ id: 'e1', label: 'Weapon drop', detail: 'Epic shotgun', gear: proceduralWeapon }]}
      />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-signature')).toBe(compositorSignature(proceduralWeapon));
    expect(canvas?.style.width).toBe('46px');
  });

  it('renders the bespoke sprite for a legendary drop entry', () => {
    const { container } = render(
      <ActionFeed
        entries={[{ id: 'e2', label: 'Legendary drop', detail: 'Glass Sun', gear: legendaryWeapon }]}
      />,
    );
    expect(container.querySelector('img')?.getAttribute('data-pixel-sprite')).toBe('legendary-glass-sun');
  });

  it('still shows the plain feed dot for entries without gear', () => {
    const { container } = render(
      <ActionFeed entries={[{ id: 'e3', label: 'Credits', detail: '+120 cr' }]} />,
    );
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText('Credits')).toBeTruthy();
  });
});
