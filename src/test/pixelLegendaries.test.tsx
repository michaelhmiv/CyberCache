import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { resolveWeaponPainting, weaponPaintingShell } from '@/lib/pixel/weaponPaintingRender';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

/**
 * P4 wave 2 — PixelWeapon bespoke resolution for real drops: a legendary
 * whose rolled name is procedural still renders its named legendary's
 * bespoke art via the effect it carries.
 *
 * Re-pinned by the painted renderer (Top-Choice renderer slice,
 * 2026-11-11): the bespoke art on surfaces is now the legendary's
 * adopted Top-Choice PAINTING (legendary-painting-<slug>) — the
 * canvas carries data-painted-sprite and the painting shell's
 * signature (PixelWeapon's default density is 'stage', so the
 * stage shell pins it). A legendary with no named effect renders
 * its type x manufacturer BASE painting; the texel compositor
 * remains only for inputs that resolve to no painting at all
 * (weaponPaintingRender.test.ts pins the resolution law).
 */

const BASE_WEAPON: Weapon = {
  id: 'p4b-weapon',
  name: 'Scorched HelixWorks Rail Prototype',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.HelixWorks,
  rarity: Rarity.Legendary,
  element: Element.Fire,
  level: 12,
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
    { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } },
    { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } },
    { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ],
  pixelSeed: 42,
} as Weapon;

describe('PixelWeapon — bespoke legendary resolution (P4 wave 2)', () => {
  it("renders the bespoke painting for a procedurally-named legendary via its effect", () => {
    const weapon = { ...BASE_WEAPON, legendaryEffectId: 'glass_sun' } as Weapon;
    render(<PixelWeapon weapon={weapon} testId="pw-glass-sun" />);
    const el = screen.getByTestId('pw-glass-sun');
    expect(el.tagName).toBe('CANVAS');
    expect(el.getAttribute('data-painted-sprite')).toBe('legendary-painting-glass-sun');
    const input = pixelWeaponInputFromWeapon(weapon);
    expect(el.getAttribute('data-signature')).toBe(
      weaponPaintingShell(input, resolveWeaponPainting(input)!, 'stage').signature,
    );
    // ...and it is NOT the base painting the same roll would otherwise get.
    const procedural = { ...input, name: 'Unnamed Roll', legendaryEffectId: undefined };
    expect(el.getAttribute('data-signature')).not.toBe(
      weaponPaintingShell(procedural, resolveWeaponPainting(procedural)!, 'stage').signature,
    );
  });

  it('resolves through the input path too (effect id carried on the input)', () => {
    const input = {
      weaponType: WeaponType.Launcher,
      manufacturer: Manufacturer.BlastForge,
      rarity: Rarity.Legendary,
      element: Element.Fire,
      parts: BASE_WEAPON.parts,
      name: 'Molten BlastForge Tube Custom',
      legendaryEffectId: 'molten_core',
    };
    render(<PixelWeapon input={input} testId="pw-molten" />);
    const el = screen.getByTestId('pw-molten');
    expect(el.tagName).toBe('CANVAS');
    expect(el.getAttribute('data-painted-sprite')).toBe('legendary-painting-molten-core');
    expect(el.getAttribute('data-signature')).toBe(
      weaponPaintingShell(input, resolveWeaponPainting(input)!, 'stage').signature,
    );
  });

  it('a legendary with no named effect renders its type x manufacturer base painting', () => {
    render(<PixelWeapon weapon={{ ...BASE_WEAPON, legendaryEffectId: undefined }} testId="pw-fallback" />);
    const el = screen.getByTestId('pw-fallback');
    expect(el.tagName).toBe('CANVAS');
    expect(el.getAttribute('data-painted-sprite')).toBe('weapon-base-sniper-helix-works');
    expect(el.getAttribute('data-signature')).toBeTruthy();
  });
});
