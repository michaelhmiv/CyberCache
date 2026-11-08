/**
 * Stage-side parts helpers — the pieces of the parts system that
 * depend on stage placement (movement) and the sprite manifest.
 * Kept apart from partsCompositor.ts so the compositor stays
 * loadable by the node-side tooling (golden renderer, QC scripts)
 * that cannot resolve Vite's import.meta.glob in the manifest.
 */
import { PARTS_FEET_X, SKELETON, type PartPoint } from './parts';
import {
  compositorWeaponFractions,
  type PartSetLayout,
  type PartsWeaponFractions,
} from './partsCompositor';
import { STAGE_DESIGN_ASPECT, type ActorPlacement } from './movement';
import type { PixelWeaponInput } from './weaponCompositor';

/** Fractions for ANY held weapon input, from its HELD card render
 *  (One Grammar, 2026-11-06 — the card grammar in held mode, seated
 *  by its declared grip anchor). A bespoke legendary's authored set
 *  declares its own grip/muzzle, which compositorWeaponFractions
 *  honors (V4). The DOM actor and the stages share this so the
 *  weapon they draw and the muzzle they flash from are the same
 *  geometry. */
export function partsWeaponFractionsFor(input: PixelWeaponInput): PartsWeaponFractions {
  return compositorWeaponFractions(input);
}

/** The actor's horizontal extent in S-REF frame px: how far the
 *  rendered figure reaches left/right of the frame's own edges. The
 *  unarmed figure IS the frame ([0, frameWidth]); a held weapon
 *  reaches past the right edge by design (the barrel runs ahead of
 *  the grip), and that overhang is exactly what narrow stages used
 *  to clip away — the hunter read as unarmed with a full weapon
 *  layer rendered off-box (the Gear-C Loadout column, 2026-11-03). */
export interface ActorFrameExtents {
  left: number;
  right: number;
}

/** Extents of a laid-out actor: the frame unioned with the held
 *  weapon's stage box, from the layout's own resolved geometry. */
export function armedActorExtents(layout: PartSetLayout): ActorFrameExtents {
  const extents: ActorFrameExtents = { left: 0, right: SKELETON.frameWidth };
  if (!layout.weapon) return extents;
  const weaponLeft = layout.weapon.gripStage.x - layout.weapon.gripFrac.x * layout.weapon.targetW;
  const weaponRight =
    layout.weapon.gripStage.x + (1 - layout.weapon.gripFrac.x) * layout.weapon.targetW;
  return {
    left: Math.min(extents.left, weaponLeft),
    right: Math.max(extents.right, weaponRight),
  };
}

export interface ArmedActorFit {
  /** Actor height in px after the width fit. */
  heightPx: number;
  /** Actor top in px: the ground line stays on groundY. */
  topPx: number;
  /** True when the width fit shrank the actor below heightPct. */
  constrained: boolean;
}

/**
 * The armed actor's width fit (loadout truth): the actor is sized
 * by heightPct and anchored on its feet at xPct — on a stage
 * narrower than the height implies (a side column, a card), the
 * frame's right side, weapon first, falls outside the stage's clip
 * box. This fit shrinks the actor — feet anchor and ground line
 * unmoved — until the FULL extent (frame + held weapon) lands
 * inside the stage width. It engages only when the extent would
 * otherwise overflow; at unconstrained geometries the returned
 * height is exactly heightPct of the container, so wide stages
 * render pixel-identically to before. Pure math: the DOM actor
 * measures its stage box and applies the result.
 */
export function fitArmedActorHeight(args: {
  containerW: number;
  containerH: number;
  heightPct: number;
  xPct: number;
  groundY: number;
  /** Feet anchor x as a fraction of the frame width. */
  feetX?: number;
  flip?: boolean;
  extents: ActorFrameExtents;
}): ArmedActorFit {
  const feetX = args.feetX ?? PARTS_FEET_X;
  const desired = (args.heightPct / 100) * args.containerH;
  const feetPx = feetX * SKELETON.frameWidth;
  let { left, right } = args.extents;
  if (args.flip) {
    // The inner flip mirrors the frame around its own center; to
    // first order the extents mirror around the feet anchor.
    const mirroredLeft = 2 * feetPx - right;
    right = 2 * feetPx - left;
    left = mirroredLeft;
  }
  const anchorX = (args.xPct / 100) * args.containerW;
  const rightSpan = right - feetPx;
  const leftSpan = feetPx - left;
  let maxActorW = Number.POSITIVE_INFINITY;
  if (rightSpan > 0) {
    maxActorW = Math.min(maxActorW, ((args.containerW - anchorX) / rightSpan) * SKELETON.frameWidth);
  }
  if (leftSpan > 0) {
    maxActorW = Math.min(maxActorW, (anchorX / leftSpan) * SKELETON.frameWidth);
  }
  const maxHeight = (maxActorW / SKELETON.frameWidth) * SKELETON.frameHeight;
  const heightPx = Math.min(desired, maxHeight);
  return {
    heightPx,
    topPx: args.groundY * args.containerH - heightPx,
    constrained: heightPx < desired - 0.5,
  };
}

export interface DollActorFit extends ArmedActorFit {
  /** Actor left in % of container width: the doll places the FRAME
   *  (centered in the stage), not the feet anchor — the feet land
   *  wherever the centered frame puts them. */
  leftPct: number;
}

/**
 * The DOLL fit (Gear Loadout stage, 2026-11-04): the width law
 * above prices the whole armed extent — frame + held weapon — and
 * in the Loadout column (152px wide for a 234px nominal figure) it
 * crushed the hunter to ~90px, a third of his stage, hidden behind
 * the DPS/HP plate. Portrait-crop (no fit at all) is worse in the
 * opposite direction: at nominal height the stage window ends at
 * frame x≈177 while every held weapon spans to x≈333–347, so only
 * ~16–23% of the gun shows and a legendary sniper reads as a grip
 * stub — the unarmed-read failure the width law was built to kill.
 *
 * The doll's subject is the hunter's FRAME: this fit sizes the
 * actor by heightPct until the FRAME itself (260 S-REF px) fills
 * the stage width, then centers the frame. The body is never
 * cropped; the weapon runs past the frame's right edge and crops
 * at the stage edge like a portrait — receiver, grip and most of
 * the barrel stay in view, so the held weapon still reads as its
 * type. The fit is weapon-independent (it never reads extents), so
 * armed and unarmed hunters size identically and equipping a gun
 * never resizes the figure. It engages only in a stage too narrow
 * for the nominal height's frame; at unconstrained geometries the
 * returned height is exactly heightPct of the container and the
 * caller renders its ordinary % sizing. Doll surfaces opt in via
 * the actor's `fitMode` prop — stage surfaces keep the width law
 * above, untouched. Placement note: the returned left centers the
 * actor BOX; a flipped actor mirrors its contents inside the box,
 * so the box placement is the same either way (no doll caller
 * flips today).
 */
export function fitDollActorHeight(args: {
  containerW: number;
  containerH: number;
  heightPct: number;
  groundY: number;
  /** Feet anchor x as a fraction of the frame width. */
  feetX?: number;
}): DollActorFit {
  const feetX = args.feetX ?? PARTS_FEET_X;
  const desired = (args.heightPct / 100) * args.containerH;
  const widthHeight = (args.containerW / SKELETON.frameWidth) * SKELETON.frameHeight;
  const heightPx = Math.min(desired, widthHeight);
  const actorW = (heightPx / SKELETON.frameHeight) * SKELETON.frameWidth;
  const frameLeftPx = (args.containerW - actorW) / 2;
  const leftPct = ((frameLeftPx + feetX * actorW) / args.containerW) * 100;
  return {
    heightPx,
    topPx: args.groundY * args.containerH - heightPx,
    leftPct,
    constrained: heightPx < desired - 0.5,
  };
}

/**
 * Convert a stage-space point (S-REF coordinates) into stage % for
 * a placement — the parts successor to movement's actorAnchorPoint
 * (which read the deleted whole-hunter sprite's manifest anchors).
 * The feet reference is PARTS_FEET_X; the frame is the S-REF frame.
 * FX (muzzle flash, tracers, damage numbers) anchor through here.
 */
export function partsAnchorPoint(
  point: PartPoint,
  placement: ActorPlacement,
  stageAspect: number = STAGE_DESIGN_ASPECT,
): { xPct: number; yPct: number } {
  const widthPct = (placement.heightPct * (SKELETON.frameWidth / SKELETON.frameHeight)) / stageAspect;
  return {
    xPct: placement.xPct + (point.x / SKELETON.frameWidth - PARTS_FEET_X) * widthPct,
    yPct: placement.groundY * 100 - placement.heightPct + (point.y / SKELETON.frameHeight) * placement.heightPct,
  };
}

