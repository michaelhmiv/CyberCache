import type { PixelSprite } from './manifest';
import { STAGE_DESIGN_ASPECT, type ActorPlacement } from './movement';

/**
 * Painted-actor stage math (Cache Hunters slice (c); owner ruling
 * 2026-11-15 — PAINTINGS ONLY ON STAGE: the stage figure is the
 * hunter's whole painting alone, its signature weapon part of the
 * character; no compositor weapon rides the stage figure).
 *
 * A whole painting has no held-weapon overhang, so the armed width
 * law in partsStage.ts (which prices frame + weapon extent) does
 * not apply. This is the painting's own width law — the same
 * invariant (the figure never paints past the stage edge) priced
 * on the painting's own frame: at the placement's nominal height
 * the painting's width is height × its own aspect, and the feet
 * anchor splits that width into left/right spans from the mark.
 * The fit engages only when a span would cross the stage edge; at
 * every shipped placement it does not engage — the Cast B
 * paintings are far narrower than the old skeleton frame plus its
 * held-weapon overhang at equal height.
 */
export interface PaintedHeightFit {
  /** The height the painting renders at (% of stage height). */
  heightPct: number;
  /** True when the width law shrank the figure below the nominal
   *  placement height. */
  constrained: boolean;
}

/** Percent-space fit (design aspect — the space the choreography
 *  models and the DOM stage share). */
export function fitPaintedHeightPct(sprite: PixelSprite, placement: ActorPlacement): PaintedHeightFit {
  const aspect = sprite.width / sprite.height;
  const feetX = sprite.anchors.feet?.x ?? 0.5;
  let maxHeightPct = Number.POSITIVE_INFINITY;
  if (feetX > 0) {
    maxHeightPct = Math.min(maxHeightPct, (placement.xPct * STAGE_DESIGN_ASPECT) / (feetX * aspect));
  }
  if (feetX < 1) {
    maxHeightPct = Math.min(maxHeightPct, ((100 - placement.xPct) * STAGE_DESIGN_ASPECT) / ((1 - feetX) * aspect));
  }
  const heightPct = Math.min(placement.heightPct, maxHeightPct);
  return { heightPct, constrained: heightPct < placement.heightPct - 0.01 };
}

/**
 * The placement the painted figure actually renders at: the
 * caller's mark with the width-law height applied. FX anchors
 * resolve from THIS placement (actorAnchorPoint) so muzzle / grip /
 * mass points sit on the rendered figure, fitted or not.
 */
export function paintedPlacement(sprite: PixelSprite, placement: ActorPlacement): ActorPlacement {
  const fit = fitPaintedHeightPct(sprite, placement);
  return fit.constrained ? { ...placement, heightPct: fit.heightPct } : placement;
}

export interface PaintedActorFit {
  heightPx: number;
  topPx: number;
  constrained: boolean;
}

/**
 * Px-space twin for the Pixi stages (the fitArmedActorHeight call
 * shape): the same width law against the real container size.
 */
export function fitPaintedActorHeight(args: {
  containerW: number;
  containerH: number;
  heightPct: number;
  xPct: number;
  groundY: number;
  sprite: PixelSprite;
}): PaintedActorFit {
  const desired = (args.heightPct / 100) * args.containerH;
  const aspect = args.sprite.width / args.sprite.height;
  const feetX = args.sprite.anchors.feet?.x ?? 0.5;
  const anchorX = (args.xPct / 100) * args.containerW;
  let maxWidthPx = Number.POSITIVE_INFINITY;
  if (feetX > 0) maxWidthPx = Math.min(maxWidthPx, anchorX / feetX);
  if (feetX < 1) maxWidthPx = Math.min(maxWidthPx, (args.containerW - anchorX) / (1 - feetX));
  const heightPx = Math.min(desired, maxWidthPx / aspect);
  return {
    heightPx,
    topPx: args.groundY * args.containerH - heightPx,
    constrained: heightPx < desired - 0.5,
  };
}
