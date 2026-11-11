import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { ActionFeed } from '@/components/action/ActionWorkspace';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { resolveWeaponPainting, weaponPaintingShell } from '@/lib/pixel/weaponPaintingRender';
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
 * the one card surface.) All of them must resolve to the ONE weapon
 * renderer: since the painted renderer (Top-Choice renderer slice,
 * 2026-11-11) that is the weapon's adopted Top-Choice painting —
 * the bespoke legendary painting for named legendaries, the
 * type x manufacturer base painting for everything else — with
 * element/decals/condition as overlays. (Re-pinned from the V4
 * compositor signatures; the surface-agreement law is unchanged.)
 *
 * Weapon marriage (slice 1): CARD surfaces (GearIllustration)
 * render at card density (240×88) and share the CARD signature;
 * the ActionFeed loot log keeps the stage density (120×44) and
 * the stage signature. Within each density, every surface agrees
 * exactly.
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

/** Stage-density painting signature (ActionFeed loot log). */
const paintingSignature = (weapon: Weapon) => {
  const input = sharedInput(weapon);
  return weaponPaintingShell(input, resolveWeaponPainting(input)!, 'stage').signature;
};
/** Card-density painting signature (GearIllustration card surfaces). */
const cardPaintingSignature = (weapon: Weapon) => {
  const input = sharedInput(weapon);
  return weaponPaintingShell(input, resolveWeaponPainting(input)!, 'card').signature;
};
const paintedSpriteId = (weapon: Weapon) => resolveWeaponPainting(sharedInput(weapon))!.spriteId;

describe('GearIllustration — weapon branch renders pixel (inventory/market/inspect/chest path)', () => {
  it('renders a procedural weapon as its base painting canvas with the shared signature', () => {
    const { container } = render(<GearIllustration item={proceduralWeapon} size={50} showBadges={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-painted-sprite')).toBe('weapon-base-shotgun-blast-forge');
    expect(canvas?.getAttribute('data-painted-sprite')).toBe(paintedSpriteId(proceduralWeapon));
    expect(canvas?.getAttribute('data-signature')).toBe(cardPaintingSignature(proceduralWeapon));
    expect(canvas?.getAttribute('data-density')).toBe('card');
    // The old vector weapon SVG (aria-label "Rarity Element Type") is gone.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders a named legendary as its bespoke painting, resolved via its effect', () => {
    const { container } = render(<GearIllustration item={legendaryWeapon} size="showcase" showBadges animate />);
    // The legendary renders its bespoke painting on the shared
    // canvas (the painted layer paints into the canvas; no <img>
    // stands in for the weapon itself).
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-painted-sprite')).toBe('legendary-painting-glass-sun');
    expect(canvas?.getAttribute('data-signature')).toBe(cardPaintingSignature(legendaryWeapon));
    expect(canvas?.getAttribute('data-signature')).not.toBe(
      cardPaintingSignature({ ...legendaryWeapon, legendaryEffectId: undefined } as Weapon),
    );
  });

  it('renders a legendary with no named effect as its base painting', () => {
    const { container } = render(<GearIllustration item={plainLegendary} size={46} showBadges={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-painted-sprite')).toBe('weapon-base-shotgun-blast-forge');
    expect(canvas?.getAttribute('data-signature')).toBe(cardPaintingSignature(plainLegendary));
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
    // INT-2 (2026-11-11): married gear renders its adopted painting —
    // the node is the painted <img> carrying data-painted-sprite
    // (jsdom resolves the decode synchronously; the pending canvas
    // placeholder carries the same identity). The slice-era
    // data-density='thumb' canvas pin is superseded by the painting.
    const painted = container.querySelector('[data-painted-sprite]');
    expect(painted).not.toBeNull();
  });

  it('renders a married relic as its pixel plate (gear marriage, slice 4)', () => {
    const { container } = render(<GearIllustration item={relic} size={46} showBadges={false} />);
    expect(container.querySelector('svg')).toBeNull();
    // INT-2 (2026-11-11): married gear renders its adopted painting —
    // the node is the painted <img> carrying data-painted-sprite
    // (jsdom resolves the decode synchronously; the pending canvas
    // placeholder carries the same identity). The slice-era
    // data-density='thumb' canvas pin is superseded by the painting.
    const painted = container.querySelector('[data-painted-sprite]');
    expect(painted).not.toBeNull();
  });

  it('renders a married shield as its pixel plate (gear marriage, slice 1)', () => {
    const { container } = render(<GearIllustration item={shield} size={46} showBadges={false} />);
    expect(container.querySelector('svg')).toBeNull();
    // INT-2 (2026-11-11): married gear renders its adopted painting —
    // the node is the painted <img> carrying data-painted-sprite
    // (jsdom resolves the decode synchronously; the pending canvas
    // placeholder carries the same identity). The slice-era
    // data-density='thumb' canvas pin is superseded by the painting.
    const painted = container.querySelector('[data-painted-sprite]');
    expect(painted).not.toBeNull();
  });
});

describe('ActionFeed — loot-log weapon thumbs render pixel', () => {
  it('renders the painting canvas for a weapon drop entry', () => {
    const { container } = render(
      <ActionFeed
        entries={[{ id: 'e1', label: 'Weapon drop', detail: 'Epic shotgun', gear: proceduralWeapon }]}
      />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-painted-sprite')).toBe('weapon-base-shotgun-blast-forge');
    expect(canvas?.getAttribute('data-signature')).toBe(paintingSignature(proceduralWeapon));
    expect(canvas?.style.width).toBe('46px');
  });

  it('renders the bespoke painting for a legendary drop entry', () => {
    const { container } = render(
      <ActionFeed
        entries={[{ id: 'e2', label: 'Legendary drop', detail: 'Glass Sun', gear: legendaryWeapon }]}
      />,
    );
    // The feed thumb is the stage-density bespoke painting — a
    // canvas with the shared stage signature.
    // (INT-10, 2026-11-11: functional icons render as <img>
    // paintings elsewhere in the row, so the no-baked-sprite pin
    // is scoped to the thumb itself: no img stands in for it.)
    expect(container.querySelector('canvas')?.parentElement?.querySelector('img')).toBeFalsy();
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-painted-sprite')).toBe('legendary-painting-glass-sun');
    expect(canvas?.getAttribute('data-signature')).toBe(paintingSignature(legendaryWeapon));
  });

  it('still shows the plain feed dot for entries without gear', () => {
    const { container } = render(
      <ActionFeed entries={[{ id: 'e3', label: 'Credits', detail: '+120 cr' }]} />,
    );
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText('Credits')).toBeTruthy();
  });
});
