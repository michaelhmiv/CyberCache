import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useBossStore, useKillCycleStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
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
    // Chrome is shared: the status ribbon renders and NO area
    // plate rides the art (owner ruling 2026-11-02 removed the
    // "Area · …" banner from the scene; drift-fix F2 had already
    // retired the in-stage action buttons — actions live in the
    // workspace under the stage).
    expect(screen.queryByTestId('diorama-stage-plate')).toBeNull();
    expect(screen.getByTestId('diorama-status-ribbon').textContent).toContain('Roaming');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
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

describe('LiveTurfDiorama — stage overlay layout (owner ruling 2026-11-02)', () => {
  it('enemy HP plate rides IN the stage, level with the hunter plate, name + % whole', () => {
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 30, currentTargetHpMax: 45 });
    useSurvivalStore.setState({ currentHp: 66, maxHp: 100 });
    render(
      <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={DIORAMA_WEAPON} equippedCount={4} activityKind="roaming_loot" reducedMotion />,
    );
    const plate = screen.getByTestId('primary-diorama-target-hp');
    // Owner ruling 2026-11-03: lifted off the ground line into the
    // stage by the hunter plate's own lift — ground line 0.86 for
    // every zone background, minus the shared 18.5-point lift puts
    // its top edge at 67.5%, over the enemy's lower body on the
    // enemy's column (74%) — NOT the ground-line perch that read
    // as part of the stats row, and never across the face.
    expect(parseFloat(plate.style.top)).toBeCloseTo(67.5, 5);
    expect(plate.style.left).toBe('74%');
    // The pair law: its top edge is EXACTLY the hunter plate's.
    const hunterPlate = screen.getByTestId('diorama-hunter-hp');
    expect(plate.style.top).toBe(hunterPlate.style.top);
    expect(plate.className).not.toContain('top-[68px]');
    expect(plate.textContent).toContain('Wraith Scavenger');
    expect(plate.textContent).toContain('67%');
    // The count plate keeps the top-right corner.
    expect(screen.getByText('4/7 gear')).toBeTruthy();
    useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
  });

  it('boss HP plate does NOT move: still anchored under the boss on the ground line', () => {
    // The 2026-11-03 lift is the roaming plate's alone — the boss
    // plate's ground-line anchor was owner-ruled to stay.
    useBossStore.setState({ activeBossId: 'dune_tyrant', activeBossHp: 500, activeBossMaxHp: 1000, activeStatus: 'active' });
    render(
      <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={DIORAMA_WEAPON} equippedCount={4} activityKind="boss_fight" bossPhase="fight" reducedMotion />,
    );
    const plate = screen.getByTestId('primary-diorama-boss-hp');
    expect(plate.style.top).toMatch(/^calc\(86(\.0+)?% \+ 2px\)$/);
    expect(plate.style.left).toBe('74%');
    useBossStore.setState({ activeBossId: null, activeBossHp: 0, activeBossMaxHp: 0, activeStatus: 'idle' });
  });

  it('hunter HP plate rides raised on the hunter column in combat, numbers whole; absent at camp', () => {
    useSurvivalStore.setState({ currentHp: 66, maxHp: 100 });
    const { unmount } = render(
      <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={DIORAMA_WEAPON} equippedCount={4} activityKind="roaming_loot" reducedMotion />,
    );
    const plate = screen.getByTestId('diorama-hunter-hp');
    expect(plate.textContent).toContain('66/100');
    // Anchored to the hunter's placement (xPct 22), raised off the
    // ground line to lower-body height (groundY − 18.5 points).
    expect(plate.style.left).toBe('22%');
    expect(parseFloat(plate.style.top)).toBeCloseTo(67.5, 5);
    unmount();
    // Non-combat modes keep the art unobstructed.
    render(
      <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={DIORAMA_WEAPON} equippedCount={4} activityKind="crafting" reducedMotion />,
    );
    expect(screen.queryByTestId('diorama-hunter-hp')).toBeNull();
  });

  it('stage controls sit top-left; the standby stage carries the Switch chip and no Stop slot content of its own', () => {
    render(
      <LiveTurfDiorama
        area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
        weapon={DIORAMA_WEAPON}
        equippedCount={4}
        activityKind="idle_standby"
        reducedMotion
        stageControls={<button type="button">Switch Action</button>}
      />,
    );
    const controls = screen.getByTestId('diorama-stage-controls');
    expect(controls.className).toContain('left-2');
    expect(controls.className).toContain('top-2');
    expect(controls.className).not.toContain('bottom-11');
    expect(controls.textContent).toContain('Switch Action');
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
