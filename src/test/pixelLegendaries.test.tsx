import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

/**
 * P4 wave 2 — PixelWeapon bespoke resolution for real drops: a legendary
 * whose rolled name is procedural still renders its named legendary's
 * bespoke sprite via the effect it carries; a legendary with no named
 * effect keeps the compositor canvas.
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
  it('renders the bespoke sprite for a procedurally-named legendary via its effect', () => {
    render(<PixelWeapon weapon={{ ...BASE_WEAPON, legendaryEffectId: 'glass_sun' }} testId="pw-glass-sun" />);
    const img = screen.getByTestId('pw-glass-sun');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('data-pixel-sprite')).toBe('legendary-glass-sun');
  });

  it('resolves through the input path too (effect id carried on the input)', () => {
    render(
      <PixelWeapon
        input={{
          weaponType: WeaponType.Launcher,
          manufacturer: Manufacturer.BlastForge,
          rarity: Rarity.Legendary,
          element: Element.Fire,
          parts: BASE_WEAPON.parts,
          name: 'Molten BlastForge Tube Custom',
          legendaryEffectId: 'molten_core',
        }}
        testId="pw-molten"
      />,
    );
    const img = screen.getByTestId('pw-molten');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('data-pixel-sprite')).toBe('legendary-molten-core');
  });

  it('keeps the compositor canvas for a legendary with no named effect (fallback intact)', () => {
    render(<PixelWeapon weapon={{ ...BASE_WEAPON, legendaryEffectId: undefined }} testId="pw-fallback" />);
    const el = screen.getByTestId('pw-fallback');
    expect(el.tagName).toBe('CANVAS');
    expect(el.getAttribute('data-signature')).toBeTruthy();
  });
});
