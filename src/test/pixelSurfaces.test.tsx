import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { ActionFeed } from '@/components/action/ActionWorkspace';
import { composePixelWeapon, type PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { composeWeaponCard } from '@/lib/pixel/weaponCardCompositor';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { createRNG } from '@/lib/utils/rng';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ClassMod, Relic, Shield as ShieldItem, Weapon } from '@/types/items';

/**
 * P5 — pixel weapons everywhere: the inventory (GearHub), market
 * (MarketScreen mini-cards), inspect sheet and chest surfaces all draw
 * weapons through GearIllustration; the ActionFeed loot log draws
 * them directly. (The legacy common/WeaponCard surface was deleted
 * 2026-11-07 — no production importer remained; GearIllustration is
 * the one card surface.) All of them must resolve to the ONE pixel
 * renderer: the bespoke authored set for named legendaries (V4 —
 * composed by the same compositor, never a baked sprite), the
 * deterministic parts-kit compositor for everything else.
 *
 * Weapon marriage (slice 1): CARD surfaces (GearIllustration)
 * render at card density (240×88 card compositor) and
 * share the CARD signature; the ActionFeed loot log keeps the stage
 * density (120×44) and the stage signature. Within each density,
 * every surface agrees exactly.
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

const relic = {
  id: 'p5-relic',
  name: 'Vault Chip',
  rarity: Rarity.Common,
  level: 3,
  affixes: [],
  sourceTag: 'World Drop',
  isLocked: false,
} as unknown as Relic;

const classMod = {
  id: 'p5-mod',
  name: 'Gunslinger Charm',
  rarity: Rarity.Rare,
  level: 4,
  treeBonus: 'Gunslinger',
  nodeBoosts: {},
  affixes: [],
  sourceTag: 'World Drop',
  isLocked: false,
} as unknown as ClassMod;

const sharedInput = (weapon: Weapon) => ({
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
} satisfies PixelWeaponInput);

/** Stage-density signature (ActionFeed loot log). */
const compositorSignature = (weapon: Weapon) => composePixelWeapon(sharedInput(weapon)).signature;
/** Card-density signature (GearIllustration card surfaces). */
const cardCompositorSignature = (weapon: Weapon) => composeWeaponCard(sharedInput(weapon)).signature;

describe('GearIllustration — weapon branch renders pixel (inventory/market/inspect/chest path)', () => {
  it('renders a procedural weapon as the compositor canvas with the shared signature', () => {
    const { container } = render(<GearIllustration item={proceduralWeapon} size={50} showBadges={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-signature')).toBe(cardCompositorSignature(proceduralWeapon));
    expect(canvas?.getAttribute('data-density')).toBe('card');
    // The old vector weapon SVG (aria-label "Rarity Element Type") is gone.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders a named legendary as its bespoke authored set, resolved via its effect', () => {
    const { container } = render(<GearIllustration item={legendaryWeapon} size="showcase" showBadges animate />);
    // V4: no baked sprite anywhere — the legendary composes through
    // the card compositor like every other weapon, and its
    // signature is the bespoke render of its authored set.
    expect(container.querySelector('img')).toBeNull();
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-signature')).toBe(cardCompositorSignature(legendaryWeapon));
    expect(canvas?.getAttribute('data-signature')).not.toBe(
      cardCompositorSignature({ ...legendaryWeapon, legendaryEffectId: undefined } as Weapon),
    );
  });

  it('keeps the compositor fallback for a legendary with no named effect', () => {
    const { container } = render(<GearIllustration item={plainLegendary} size={46} showBadges={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-signature')).toBe(cardCompositorSignature(plainLegendary));
  });

  it('maps named sizes to the shared pixel widths (thumb/card/showcase)', () => {
    const { container, rerender } = render(<GearIllustration item={proceduralWeapon} size="thumb" />);
    expect(container.querySelector('canvas')?.style.width).toBe('46px');
    rerender(<GearIllustration item={proceduralWeapon} size="card" />);
    expect(container.querySelector('canvas')?.style.width).toBe('70px');
    rerender(<GearIllustration item={proceduralWeapon} size="showcase" />);
    expect(container.querySelector('canvas')?.style.width).toBe('190px');
  });

  it('renders a married class mod as its pixel plate (gear marriage, slice 3)', () => {
    // This case began as slice 0's "not-yet-married kinds keep
    // their illustration" pin and was retargeted kind by kind as
    // the slices landed; with slice 3 every kind is married, so
    // the pin now asserts the last flip instead.
    const { container } = render(<GearIllustration item={classMod} size={46} showBadges={false} />);
    expect(container.querySelector('svg')).toBeNull();
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-density')).toBe('thumb');
  });

  it('renders a married relic as its pixel plate (gear marriage, slice 4)', () => {
    const { container } = render(<GearIllustration item={relic} size={46} showBadges={false} />);
    expect(container.querySelector('svg')).toBeNull();
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-density')).toBe('thumb');
  });

  it('renders a married shield as its pixel plate (gear marriage, slice 1)', () => {
    const { container } = render(<GearIllustration item={shield} size={46} showBadges={false} />);
    expect(container.querySelector('svg')).toBeNull();
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-density')).toBe('thumb');
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

  it('renders the bespoke authored set for a legendary drop entry', () => {
    const { container } = render(
      <ActionFeed
        entries={[{ id: 'e2', label: 'Legendary drop', detail: 'Glass Sun', gear: legendaryWeapon }]}
      />,
    );
    // V4: the feed thumb is the stage-density bespoke render — a
    // canvas with the shared stage signature, never an <img>.
    expect(container.querySelector('img')).toBeNull();
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-signature')).toBe(compositorSignature(legendaryWeapon));
  });

  it('still shows the plain feed dot for entries without gear', () => {
    const { container } = render(
      <ActionFeed entries={[{ id: 'e3', label: 'Credits', detail: '+120 cr' }]} />,
    );
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText('Credits')).toBeTruthy();
  });
});
