import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PART_POSES, PARTS_FEET_X, SKELETON } from '@/lib/pixel/parts';
import { layoutPartSet } from '@/lib/pixel/partsCompositor';
import {
  armedActorExtents,
  fitArmedActorHeight,
  partsWeaponFractionsFor,
} from '@/lib/pixel/partsStage';
import {
  pixelWeaponInputFromWeapon,
  type PixelWeaponInput,
} from '@/lib/pixel/weaponCompositor';
import { resolveWeaponPainting, weaponPaintingShell } from '@/lib/pixel/weaponPaintingRender';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { PixelPartsActor } from '@/components/pixelArt/PixelPartsActor';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

/**
 * Loadout truth — the width fit (2026-11-03). The raster and DOM
 * rigs always seated the equipped weapon grip-to-grip; the Gear-C
 * Loadout stage still showed an empty hand, because the actor is
 * height-sized and feet-anchored while the held weapon overhangs
 * the frame's right edge — on the stage's 152px column the entire
 * weapon (and the grip itself) fell outside the clip box. These
 * pins hold the fix at three levels:
 *
 *  - extents: an armed layout's reach past the frame is measured
 *    from the layout's own resolved weapon geometry;
 *  - fit math: wide stages are untouched (the returned height is
 *    exactly heightPct), narrow stages shrink until frame + weapon
 *    land inside the width, feet anchor and ground line unmoved;
 *  - the DOM actor: the held render's signature IS the equipped
 *    instance's held-render signature (and changes with the
 *    instance), the unarmed actor renders no weapon at all, and a
 *    narrow stage box engages the px fit while a wide one doesn't.
 *
 * Held-render medium updated by the painted renderer (2026-11-11):
 * the held render is the instance's Top-Choice painting, so the
 * signature pinned below is the painting shell's (held density) —
 * the loadout-truth law (the actor holds the EQUIPPED instance,
 * not a stand-in) is unchanged.
 */

const PARTS_A = [
  { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
  { slot: 'Grip', modifier: { handling: 1.04 } },
  { slot: 'Core', modifier: { baseDamage: 1.02 } },
  { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
  { slot: 'Sight', modifier: { critChance: 1.06 } },
  { slot: 'Chamber', modifier: { fireRate: 0.98 } },
] as Weapon['parts'];

const PARTS_B = [
  { slot: 'Barrel', modifier: { baseDamage: 0.92, handling: 1.12 } },
  { slot: 'Grip', modifier: { handling: 0.95 } },
  { slot: 'Core', modifier: { baseDamage: 1.11 } },
  { slot: 'Magazine', modifier: { magazineSize: 0.9 } },
  { slot: 'Sight', modifier: { critChance: 0.94 } },
  { slot: 'Chamber', modifier: { fireRate: 1.07 } },
] as Weapon['parts'];

const SNIPER: Weapon = {
  id: 'fit-sniper',
  name: 'Invariant Test Longshot',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: PARTS_A,
  pixelSeed: 42,
} as unknown as Weapon;

const SHOTGUN: Weapon = {
  id: 'fit-shotgun',
  name: 'Molten BlastForge Scatter Variant',
  weaponType: WeaponType.Shotgun,
  manufacturer: Manufacturer.BlastForge,
  rarity: Rarity.Rare,
  element: Element.Fire,
  level: 3,
  baseStats: { baseDamage: 34, critChance: 6, fireRate: 0.9, handling: 48, magazineSize: 6, reloadTime: 2.2 },
  parts: PARTS_B,
  pixelSeed: 777,
} as unknown as Weapon;

const INPUTS: [string, PixelWeaponInput][] = [
  ['sniper', pixelWeaponInputFromWeapon(SNIPER)],
  ['shotgun', pixelWeaponInputFromWeapon(SHOTGUN)],
  [
    'smg',
    {
      id: 'fit-smg',
      name: 'Rare Fire SMG',
      weaponType: WeaponType.SMG,
      manufacturer: Manufacturer.Redline,
      element: Element.Fire,
      rarity: Rarity.Rare,
      pixelSeed: 99,
      affixes: [],
      rollQuality: 60,
      parts: PARTS_A as PixelWeaponInput['parts'],
    },
  ],
  [
    'pistol',
    {
      id: 'fit-pistol',
      name: 'Common Kinetic Pistol',
      weaponType: WeaponType.Pistol,
      manufacturer: Manufacturer.Ironwood,
      element: Element.Kinetic,
      rarity: Rarity.Common,
      pixelSeed: 1234,
      affixes: [],
      rollQuality: 50,
    },
  ],
];

function extentsFor(input: PixelWeaponInput) {
  return armedActorExtents(layoutPartSet(STANDARD_ISSUE, PART_POSES.idle, partsWeaponFractionsFor(input)));
}

/** The stage-x of the extents' right edge for a fitted actor. */
function rightEdgePx(
  fit: { heightPx: number },
  args: { containerW: number; xPct: number },
  extents: { right: number },
): number {
  const actorW = (fit.heightPx / SKELETON.frameHeight) * SKELETON.frameWidth;
  const anchorX = (args.xPct / 100) * args.containerW;
  return anchorX + (extents.right / SKELETON.frameWidth - PARTS_FEET_X) * actorW;
}

describe('loadout truth — armed extents (the overhang that was clipped)', () => {
  it.each(INPUTS)('%s: the held weapon reaches past the frame right edge', (_name, input) => {
    const extents = extentsFor(input);
    expect(extents.right).toBeGreaterThan(SKELETON.frameWidth);
    expect(extents.left).toBeLessThanOrEqual(0 + 0.001);
  });

  it('extents are the layout weapon box, resolved from the instance input', () => {
    const input = pixelWeaponInputFromWeapon(SHOTGUN);
    const layout = layoutPartSet(STANDARD_ISSUE, PART_POSES.idle, partsWeaponFractionsFor(input));
    const extents = armedActorExtents(layout);
    const expectedRight =
      layout.weapon!.gripStage.x + (1 - layout.weapon!.gripFrac.x) * layout.weapon!.targetW;
    expect(extents.right).toBeCloseTo(expectedRight, 6);
  });

  it('an unarmed layout’s extents are exactly the frame', () => {
    const layout = layoutPartSet(STANDARD_ISSUE, PART_POSES.relaxed);
    expect(armedActorExtents(layout)).toEqual({ left: 0, right: SKELETON.frameWidth });
  });
});

describe('loadout truth — the width fit', () => {
  // The master Loadout figure box and the diorama are wide: the
  // fit must return the nominal height so nothing on them moves.
  it.each(INPUTS)('%s: wide stage (388×176) is unconstrained', (_name, input) => {
    const fit = fitArmedActorHeight({
      containerW: 388,
      containerH: 176,
      heightPct: 96,
      xPct: 50,
      groundY: 0.97,
      extents: extentsFor(input),
    });
    expect(fit.constrained).toBe(false);
    expect(fit.heightPx).toBeCloseTo(0.96 * 176, 6);
    expect(fit.topPx).toBeCloseTo(0.97 * 176 - fit.heightPx, 6);
  });

  // The Gear-C Loadout column: 152 wide for a 96%-of-228 figure.
  // Before the fit, the weapon's right edge landed ~70px past the
  // column edge and the grip itself sat outside the box.
  it.each(INPUTS)('%s: the narrow Loadout column (152×228) constrains and lands the weapon inside', (_name, input) => {
    const extents = extentsFor(input);
    const fit = fitArmedActorHeight({
      containerW: 152,
      containerH: 228,
      heightPct: 96,
      xPct: 50,
      groundY: 0.97,
      extents,
    });
    expect(fit.constrained).toBe(true);
    expect(fit.heightPx).toBeLessThan(0.96 * 228);
    expect(rightEdgePx(fit, { containerW: 152, xPct: 50 }, extents)).toBeLessThanOrEqual(152 + 0.01);
    // The ground line does not move: top + height == groundY × H.
    expect(fit.topPx + fit.heightPx).toBeCloseTo(0.97 * 228, 6);
  });

  it('an actor anchored near the right edge constrains on the right room alone', () => {
    const fit = fitArmedActorHeight({
      containerW: 388,
      containerH: 176,
      heightPct: 96,
      xPct: 92,
      groundY: 0.97,
      extents: extentsFor(pixelWeaponInputFromWeapon(SHOTGUN)),
    });
    expect(fit.constrained).toBe(true);
  });

  it('a flipped actor in the narrow column fits to the same height (mirrored extents)', () => {
    const extents = extentsFor(pixelWeaponInputFromWeapon(SHOTGUN));
    const plain = fitArmedActorHeight({
      containerW: 152, containerH: 228, heightPct: 96, xPct: 50, groundY: 0.97, extents,
    });
    const flipped = fitArmedActorHeight({
      containerW: 152, containerH: 228, heightPct: 96, xPct: 50, groundY: 0.97, flip: true, extents,
    });
    expect(flipped.constrained).toBe(true);
    expect(flipped.heightPx).toBeCloseTo(plain.heightPx, 6);
  });
});

/* -- The DOM actor ------------------------------------------------ */

class FakeResizeObserver {
  static callback: (() => void) | null = null;
  constructor(cb: () => void) {
    FakeResizeObserver.callback = cb;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function stubStageSize(stage: HTMLElement, w: number, h: number): void {
  Object.defineProperty(stage, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(stage, 'clientHeight', { configurable: true, value: h });
}

const actorProps = {
  set: STANDARD_ISSUE,
  xPct: 50,
  heightPct: 96,
  groundY: 0.97,
  pose: 'idle' as const,
  reduced: true,
  testId: 'fit-hunter',
  weaponTestId: 'fit-held-weapon',
};

describe('loadout truth — the DOM actor holds the equipped instance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeResizeObserver.callback = null;
  });

  const heldPaintingSignature = (weapon: Weapon) => {
    const input = pixelWeaponInputFromWeapon(weapon);
    return weaponPaintingShell(input, resolveWeaponPainting(input)!, 'held').signature;
  };

  it('the held render’s signature is the equipped instance’s own painting signature', () => {
    render(<PixelPartsActor {...actorProps} weapon={SNIPER} />);
    const held = screen.getByTestId('fit-held-weapon');
    expect(held.getAttribute('data-painted-sprite')).toBe('weapon-base-sniper-ironwood');
    expect(held.getAttribute('data-signature')).toBe(heldPaintingSignature(SNIPER));
    expect(held.getAttribute('data-density')).toBe('held');
  });

  it('swapping the instance swaps the held render (and a different type reads differently)', () => {
    const { rerender } = render(<PixelPartsActor {...actorProps} weapon={SNIPER} />);
    const sniperSig = screen.getByTestId('fit-held-weapon').getAttribute('data-signature');
    rerender(<PixelPartsActor {...actorProps} weapon={SHOTGUN} />);
    const shotgun = screen.getByTestId('fit-held-weapon');
    const shotgunSig = shotgun.getAttribute('data-signature');
    expect(shotgun.getAttribute('data-painted-sprite')).toBe('weapon-base-shotgun-blast-forge');
    expect(shotgunSig).toBe(heldPaintingSignature(SHOTGUN));
    expect(shotgunSig).not.toBe(sniperSig);
  });

  it('unarmed: no held-weapon element exists in the actor at all (#230 preserved)', () => {
    render(<PixelPartsActor {...actorProps} pose="relaxed" />);
    expect(screen.queryByTestId('fit-held-weapon')).toBeNull();
    expect(screen.getByTestId('fit-hunter').getAttribute('data-armed')).toBe('false');
  });

  it('a narrow stage box engages the px fit; the ground line stays put', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(
      <div data-testid="stage">
        <PixelPartsActor {...actorProps} weapon={SHOTGUN} />
      </div>,
    );
    const stage = screen.getByTestId('stage');
    stubStageSize(stage, 152, 228);
    act(() => FakeResizeObserver.callback?.());
    const root = screen.getByTestId('fit-hunter');
    const extents = extentsFor(pixelWeaponInputFromWeapon(SHOTGUN));
    const expected = fitArmedActorHeight({
      containerW: 152, containerH: 228, heightPct: 96, xPct: 50, groundY: 0.97, extents,
    });
    expect(expected.constrained).toBe(true);
    expect(root.getAttribute('data-fit')).toBe('width');
    expect(parseFloat(root.style.height)).toBeCloseTo(expected.heightPx, 4);
    expect(parseFloat(root.style.top)).toBeCloseTo(expected.topPx, 4);
  });

  it('a wide stage box leaves the actor at its % sizing, unfitted', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(
      <div data-testid="stage">
        <PixelPartsActor {...actorProps} weapon={SHOTGUN} />
      </div>,
    );
    stubStageSize(screen.getByTestId('stage'), 388, 176);
    act(() => FakeResizeObserver.callback?.());
    const root = screen.getByTestId('fit-hunter');
    expect(root.getAttribute('data-fit')).toBeNull();
    expect(root.style.height).toBe('96%');
  });

  it('the unarmed actor never engages the fit, even in the narrow box', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(
      <div data-testid="stage">
        <PixelPartsActor {...actorProps} pose="relaxed" />
      </div>,
    );
    stubStageSize(screen.getByTestId('stage'), 152, 228);
    act(() => FakeResizeObserver.callback?.());
    const root = screen.getByTestId('fit-hunter');
    expect(root.getAttribute('data-fit')).toBeNull();
    expect(root.style.height).toBe('96%');
  });
});
