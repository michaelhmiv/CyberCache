import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
// The diorama's area prop is required in practice (its siblings always pass one).
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

const DIORAMA_WEAPON: Weapon = {
  id: 'diorama-pixel-weapon',
  name: 'Pixel Test Carbine',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
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

describe('LiveTurfDiorama — pixel conversion (P1)', () => {
  it('renders the pixel stage for the converted dustwaste zone', () => {
    expect(DEFAULT_ROAMING_AREA_ID).toBe('dustwaste_frontier');
    const { container } = render(
      <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={DIORAMA_WEAPON} activityKind="roaming_loot" reducedMotion />,
    );
    expect(screen.getByTestId('pixel-diorama-stage')).toBeTruthy();
    expect(screen.getByTestId('pixel-hunter')).toBeTruthy();
    expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
    expect(screen.getByTestId('pixel-held-weapon')).toBeTruthy();
    // The vector SVG scene is gone for this zone.
    expect(container.querySelector('svg[viewBox="0 0 420 286"]')).toBeNull();
    // Chrome is shared: title + moment buttons still render.
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the pixel stage for redline too (P4 wave 1 converted every zone)', () => {
    const area = getRoamingArea('redline_circuit');
    const { container } = render(
      <LiveTurfDiorama area={area} weapon={DIORAMA_WEAPON} activityKind="roaming_loot" reducedMotion />,
    );
    expect(screen.getByTestId('pixel-diorama-stage')).toBeTruthy();
    expect(container.querySelector('svg[viewBox="0 0 420 286"]')).toBeNull();
  });

  it('keeps the vector scene as fallback for areas with no pixel background', () => {
    const area = { ...getRoamingArea('redline_circuit'), id: 'unconverted_test_zone' };
    const { container } = render(
      <LiveTurfDiorama area={area} weapon={DIORAMA_WEAPON} activityKind="roaming_loot" reducedMotion />,
    );
    expect(screen.queryByTestId('pixel-diorama-stage')).toBeNull();
    expect(container.querySelector('svg[viewBox="0 0 420 286"]')).toBeTruthy();
  });
});

describe('PixelWeapon component', () => {
  it('paints the compositor canvas with a stable signature', () => {
    const input = {
      weaponType: WeaponType.Sniper,
      manufacturer: Manufacturer.Ironwood,
      rarity: Rarity.Epic,
      element: Element.Fire,
      parts: DIORAMA_WEAPON.parts,
    };
    const { rerender } = render(<PixelWeapon input={input} testId="pw" />);
    const first = screen.getByTestId('pw');
    expect(first.tagName).toBe('CANVAS');
    const signature = first.getAttribute('data-signature');
    expect(signature).toBeTruthy();
    rerender(<PixelWeapon input={{ ...input, parts: input.parts.map((p) => ({ ...p })) }} testId="pw" />);
    expect(screen.getByTestId('pw').getAttribute('data-signature')).toBe(signature);
  });

  it('renders the bespoke sprite for the Emberfall legendary', () => {
    render(<PixelWeapon weapon={{ ...DIORAMA_WEAPON, name: 'Emberfall' }} testId="pw-legendary" />);
    const img = screen.getByTestId('pw-legendary');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('data-pixel-sprite')).toBe('legendary-emberfall');
  });
});
