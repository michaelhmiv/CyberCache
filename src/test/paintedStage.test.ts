/**
 * Painted-actor width law (slice (c), paintings-only ruling
 * 2026-11-15). The invariant: a whole painting never paints past
 * the stage edge — priced on the painting's own frame and feet
 * anchor — and the fit NEVER engages at the shipped placements
 * (the Cast B paintings are narrower than the stage seat the old
 * skeleton frame + held-weapon overhang needed).
 */
import { describe, it, expect } from 'vitest';
import { fitPaintedHeightPct, fitPaintedActorHeight, paintedPlacement } from '@/lib/pixel/paintedStage';
import { pixelHunterSpriteForHunter, requirePixelSprite, type PixelSprite } from '@/lib/pixel/manifest';
import { STAGE_DESIGN_ASPECT, type ActorPlacement } from '@/lib/pixel/movement';
import { HUNTERS } from '@/lib/hunters/hunters';

const SHIPPED_PLACEMENTS: Record<string, ActorPlacement> = {
  roam: { xPct: 12, heightPct: 57, groundY: 0.86 },
  camp: { xPct: 52.6, heightPct: 57, groundY: 0.86 },
  dioramaBoss: { xPct: 22, heightPct: 57, groundY: 0.86 },
  bossStage: { xPct: 20, heightPct: 62, groundY: 0.86 },
};

const spriteFor = (hunterId: (typeof HUNTERS)[number]['id']): PixelSprite =>
  requirePixelSprite(pixelHunterSpriteForHunter(hunterId) ?? 'hunter-vesper-cole');

describe('paintedStage — the painting width law', () => {
  it('never engages at any shipped placement for any Cast B hunter', () => {
    for (const hunter of HUNTERS) {
      const sprite = spriteFor(hunter.id);
      for (const [name, placement] of Object.entries(SHIPPED_PLACEMENTS)) {
        const fit = fitPaintedHeightPct(sprite, placement);
        expect(fit.constrained, `${hunter.id} @ ${name}`).toBe(false);
        expect(fit.heightPct).toBe(placement.heightPct);
        // paintedPlacement is value-identical when unconstrained.
        expect(paintedPlacement(sprite, placement)).toEqual(placement);
      }
    }
  });

  it('engages on edge overflow and keeps both feet-anchor spans inside the stage', () => {
    // A synthetic painting far wider than any Cast B figure.
    const wide = {
      id: 'synthetic-wide',
      width: 900,
      height: 384,
      anchors: { feet: { x: 0.4, y: 1 } },
    } as unknown as PixelSprite;
    const placement: ActorPlacement = { xPct: 6, heightPct: 80, groundY: 0.86 };
    const fit = fitPaintedHeightPct(wide, placement);
    expect(fit.constrained).toBe(true);
    const widthPctOfStage = (fit.heightPct * (wide.width / wide.height)) / STAGE_DESIGN_ASPECT;
    const leftSpan = 0.4 * widthPctOfStage;
    const rightSpan = 0.6 * widthPctOfStage;
    expect(leftSpan).toBeLessThanOrEqual(placement.xPct + 0.001);
    expect(rightSpan).toBeLessThanOrEqual(100 - placement.xPct + 0.001);
    const fitted = paintedPlacement(wide, placement);
    expect(fitted.heightPct).toBeCloseTo(fit.heightPct, 5);
    expect(fitted.xPct).toBe(placement.xPct);
    expect(fitted.groundY).toBe(placement.groundY);
  });

  it('px-space twin: unconstrained at design size, top sits on the ground line', () => {
    for (const hunter of HUNTERS) {
      const sprite = spriteFor(hunter.id);
      const fit = fitPaintedActorHeight({
        containerW: 420,
        containerH: 286,
        heightPct: 62,
        xPct: 20,
        groundY: 0.86,
        sprite,
      });
      expect(fit.constrained, hunter.id).toBe(false);
      expect(fit.heightPx).toBeCloseTo(0.62 * 286, 5);
      expect(fit.topPx).toBeCloseTo(0.86 * 286 - fit.heightPx, 5);
    }
  });

  it('px-space twin: constrains a wide figure at the left edge to the anchor span', () => {
    const wide = {
      id: 'synthetic-wide',
      width: 900,
      height: 384,
      anchors: { feet: { x: 0.4, y: 1 } },
    } as unknown as PixelSprite;
    const fit = fitPaintedActorHeight({
      containerW: 420,
      containerH: 286,
      heightPct: 90,
      xPct: 4,
      groundY: 0.86,
      sprite: wide,
    });
    expect(fit.constrained).toBe(true);
    // Width is capped by the left span: anchorX / feetX.
    const widthPx = fit.heightPx * (wide.width / wide.height);
    expect(widthPx).toBeCloseTo((0.04 * 420) / 0.4, 3);
  });
});
