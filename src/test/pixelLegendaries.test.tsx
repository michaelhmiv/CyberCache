import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { composePixelWeaponCached, pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

/**
 * P4 wave 2 — PixelWeapon bespoke resolution for real drops: a legendary
 * whose rolled name is procedural still renders its named legendary's
 * bespoke art via the effect it carries; a legendary with no named
 * effect keeps the compositor canvas.
 *
 * V4: the bespoke art is a hand-authored pxl piece set rendered
 * through the same compositor as every other weapon — a canvas whose
 * signature equals the compositor's bespoke render (PixelWeapon's
 * default density is 'stage', so the small compositor pins it).
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
  it("renders the bespoke authored set for a procedurally-named legendary via its effect", () => {
    const weapon = { ...BASE_WEAPON, legendaryEffectId: 'glass_sun' } as Weapon;
    render(<PixelWeapon weapon={weapon} testId="pw-glass-sun" />);
    const el = screen.getByTestId('pw-glass-sun');
    expect(el.tagName).toBe('CANVAS');
    expect(el.getAttribute('data-signature')).toBe(
      composePixelWeaponCached(pixelWeaponInputFromWeapon(weapon)).signature,
    );
    // ...and it is NOT the procedural render of the same roll.
    const procedural = composePixelWeaponCached({
      ...pixelWeaponInputFromWeapon(weapon),
      name: 'Unnamed Roll',
      legendaryEffectId: undefined,
    });
    expect(el.getAttribute('data-signature')).not.toBe(procedural.signature);
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
    expect(el.getAttribute('data-signature')).toBe(composePixelWeaponCached(input).signature);
  });

  it('keeps the compositor canvas for a legendary with no named effect (fallback intact)', () => {
    render(<PixelWeapon weapon={{ ...BASE_WEAPON, legendaryEffectId: undefined }} testId="pw-fallback" />);
    const el = screen.getByTestId('pw-fallback');
    expect(el.tagName).toBe('CANVAS');
    expect(el.getAttribute('data-signature')).toBeTruthy();
  });
});
