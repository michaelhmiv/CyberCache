import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PART_POSES, PARTS_FEET_X, SKELETON } from '@/lib/pixel/parts';
import { layoutPartSet } from '@/lib/pixel/partsCompositor';
import {
  armedActorExtents,
  fitArmedActorHeight,
  fitDollActorHeight,
  partsWeaponFractionsFor,
} from '@/lib/pixel/partsStage';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { PixelPartsActor } from '@/components/pixelArt/PixelPartsActor';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

/**
 * The doll fit (2026-11-04) — the Gear Loadout stage is a 152px
 * column, and the armed WIDTH LAW (fitArmedActorHeight, pinned in
 * loadoutTruthFit.test.tsx) shrank the hunter to ~90px there: the
 * whole armed extent (frame + weapon overhang to frame x≈341) had
 * to fit the width. The doll is a portrait, not a stage: its fit
 * (fitDollActorHeight) sizes the actor until the FRAME fills the
 * width and centers it — the body is never cropped, the weapon
 * crops at the stage edge past the frame, and the height lands at
 * ~73% of the stage instead of ~35%. These pins hold:
 *
 *  - the doll fit math in the real doll geometry (152×257 @91),
 *    for the worst-overhang weapon case the layout produces;
 *  - portrait-crop's rejection, in numbers: at nominal height the
 *    stage window ends at frame x≈177 while weapons span to
 *    x≈333–347, so under a quarter of the gun would show;
 *  - the DOM actor in doll mode: armed and unarmed hunters get the
 *    SAME fitted height (equipping never resizes the figure), a
 *    wide box leaves the actor at its % sizing, and the default
 *    stage mode in the very same narrow box still obeys the old
 *    width law exactly.
 */

const PARTS_A = [
  { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
  { slot: 'Grip', modifier: { handling: 1.04 } },
  { slot: 'Core', modifier: { baseDamage: 1.02 } },
  { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
  { slot: 'Sight', modifier: { critChance: 1.06 } },
  { slot: 'Chamber', modifier: { fireRate: 0.98 } },
] as Weapon['parts'];

/** The worst-overhang case from the loadout-truth suite. */
const SNIPER: Weapon = {
  id: 'dollfit-sniper',
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

/** The Split doll's real geometry (ActionLoadout). */
const DOLL = { containerW: 152, containerH: 257, heightPct: 91, xPct: 50, groundY: 0.97 };

describe('doll fit — the math in the doll geometry', () => {
  it('frame fills the width: height is the frame-aspect height, ≥65% of the stage', () => {
    const fit = fitDollActorHeight(DOLL);
    expect(fit.constrained).toBe(true);
    expect(fit.heightPx).toBeCloseTo((152 / SKELETON.frameWidth) * SKELETON.frameHeight, 6);
    expect(fit.heightPx).toBeGreaterThanOrEqual(0.65 * DOLL.containerH);
    // The frame spans the full stage width: its left edge is stage
    // x=0, i.e. the actor root (the feet anchor) sits at feetX.
    const rootLeftPx = (fit.leftPct / 100) * DOLL.containerW;
    const actorW = (fit.heightPx / SKELETON.frameHeight) * SKELETON.frameWidth;
    expect(rootLeftPx - PARTS_FEET_X * actorW).toBeCloseTo(0, 6);
    expect(actorW).toBeCloseTo(DOLL.containerW, 6);
  });

  it('the ground line does not move: top + height == groundY × H', () => {
    const fit = fitDollActorHeight(DOLL);
    expect(fit.topPx + fit.heightPx).toBeCloseTo(DOLL.groundY * DOLL.containerH, 6);
  });

  it('roughly doubles the width law’s height in the same box (sniper extents)', () => {
    const extents = armedActorExtents(
      layoutPartSet(STANDARD_ISSUE, PART_POSES.idle, partsWeaponFractionsFor(pixelWeaponInputFromWeapon(SNIPER))),
    );
    const widthLaw = fitArmedActorHeight({ ...DOLL, extents });
    const doll = fitDollActorHeight(DOLL);
    expect(widthLaw.heightPx).toBeLessThan(0.4 * DOLL.containerH);
    expect(doll.heightPx).toBeGreaterThan(1.9 * widthLaw.heightPx);
  });

  it('why not portrait-crop: at nominal height the stage window ends at frame x≈177, weapons span past x≈330', () => {
    // No fit at all renders heightPct and crops horizontally: the
    // visible frame window is [0, containerW / scale] anchored by
    // the feet. Every weapon type's extent runs far past it — the
    // gun would read as a grip stub.
    const layout = layoutPartSet(
      STANDARD_ISSUE,
      PART_POSES.idle,
      partsWeaponFractionsFor(pixelWeaponInputFromWeapon(SNIPER)),
    );
    const extents = armedActorExtents(layout);
    expect(extents.right).toBeGreaterThan(330);
    const nominalH = (DOLL.heightPct / 100) * DOLL.containerH;
    const scale = ((nominalH / SKELETON.frameHeight) * SKELETON.frameWidth) / SKELETON.frameWidth;
    const frameLeftStage = (50 / 100) * DOLL.containerW - PARTS_FEET_X * nominalH * (SKELETON.frameWidth / SKELETON.frameHeight);
    const windowRightFrame = (DOLL.containerW - frameLeftStage) / scale;
    expect(windowRightFrame).toBeLessThan(180);
    expect(windowRightFrame).toBeLessThan(extents.right - 150);
  });

  it('a wide stage is unconstrained: the returned height is exactly heightPct', () => {
    const fit = fitDollActorHeight({ containerW: 388, containerH: 176, heightPct: 96, groundY: 0.97 });
    expect(fit.constrained).toBe(false);
    expect(fit.heightPx).toBeCloseTo(0.96 * 176, 6);
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

const dollProps = {
  set: STANDARD_ISSUE,
  fitMode: 'doll' as const,
  xPct: 50,
  heightPct: 91,
  groundY: 0.97,
  pose: 'idle' as const,
  reduced: true,
  testId: 'dollfit-hunter',
  weaponTestId: 'dollfit-held-weapon',
};

describe('doll fit — the DOM actor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeResizeObserver.callback = null;
  });

  it('an armed hunter in the doll box gets the doll fit: frame-filling height, stage-fit disengaged', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(
      <div data-testid="stage">
        <PixelPartsActor {...dollProps} weapon={SNIPER} />
      </div>,
    );
    stubStageSize(screen.getByTestId('stage'), DOLL.containerW, DOLL.containerH);
    act(() => FakeResizeObserver.callback?.());
    const root = screen.getByTestId('dollfit-hunter');
    const expected = fitDollActorHeight(DOLL);
    expect(root.getAttribute('data-fit')).toBe('doll');
    expect(parseFloat(root.style.height)).toBeCloseTo(expected.heightPx, 4);
    expect(parseFloat(root.style.top)).toBeCloseTo(expected.topPx, 4);
    expect(parseFloat(root.style.left)).toBeCloseTo(expected.leftPct, 4);
  });

  it('an unarmed hunter in the doll box gets the SAME fitted height — equipping never resizes him', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(
      <div data-testid="stage">
        <PixelPartsActor {...dollProps} pose="relaxed" />
      </div>,
    );
    stubStageSize(screen.getByTestId('stage'), DOLL.containerW, DOLL.containerH);
    act(() => FakeResizeObserver.callback?.());
    const root = screen.getByTestId('dollfit-hunter');
    const expected = fitDollActorHeight(DOLL);
    expect(root.getAttribute('data-armed')).toBe('false');
    expect(root.getAttribute('data-fit')).toBe('doll');
    expect(parseFloat(root.style.height)).toBeCloseTo(expected.heightPx, 4);
  });

  it('a wide stage box leaves the doll-mode actor at its % sizing, unfitted', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(
      <div data-testid="stage">
        <PixelPartsActor {...dollProps} heightPct={96} weapon={SNIPER} />
      </div>,
    );
    stubStageSize(screen.getByTestId('stage'), 388, 176);
    act(() => FakeResizeObserver.callback?.());
    const root = screen.getByTestId('dollfit-hunter');
    expect(root.getAttribute('data-fit')).toBeNull();
    expect(root.style.height).toBe('96%');
  });

  it('the default stage mode in the same narrow box still obeys the width law exactly', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(
      <div data-testid="stage">
        <PixelPartsActor
          set={STANDARD_ISSUE}
          xPct={50}
          heightPct={91}
          groundY={0.97}
          pose="idle"
          reduced
          testId="dollfit-hunter"
          weaponTestId="dollfit-held-weapon"
          weapon={SNIPER}
        />
      </div>,
    );
    stubStageSize(screen.getByTestId('stage'), DOLL.containerW, DOLL.containerH);
    act(() => FakeResizeObserver.callback?.());
    const root = screen.getByTestId('dollfit-hunter');
    const extents = armedActorExtents(
      layoutPartSet(STANDARD_ISSUE, PART_POSES.idle, partsWeaponFractionsFor(pixelWeaponInputFromWeapon(SNIPER))),
    );
    const expected = fitArmedActorHeight({ ...DOLL, extents });
    expect(expected.constrained).toBe(true);
    expect(root.getAttribute('data-fit')).toBe('width');
    expect(parseFloat(root.style.height)).toBeCloseTo(expected.heightPx, 4);
  });
});
