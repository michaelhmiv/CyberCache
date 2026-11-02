/**
 * Stage-side parts helpers — the pieces of the parts system that
 * depend on stage placement (movement) and the sprite manifest.
 * Kept apart from partsCompositor.ts so the compositor stays
 * loadable by the node-side tooling (golden renderer, QC scripts)
 * that cannot resolve Vite's import.meta.glob in the manifest.
 */
import { PARTS_FEET_X, SKELETON, type PartPoint } from './parts';
import { compositorWeaponFractions, type PartsWeaponFractions } from './partsCompositor';
import { STAGE_DESIGN_ASPECT, type ActorPlacement } from './movement';
import { bespokeSpriteIdForWeapon, getPixelSprite } from './manifest';
import type { PixelWeaponInput } from './weaponCompositor';

/** Fractions for ANY held weapon input: a bespoke legendary reads
 *  its manifest sprite's measured grip/muzzle anchors; a kit weapon
 *  reads its compositor render. The DOM actor and the stages share
 *  this so the weapon they draw and the muzzle they flash from are
 *  the same geometry. */
export function partsWeaponFractionsFor(input: PixelWeaponInput): PartsWeaponFractions {
  const bespokeId = bespokeSpriteIdForWeapon(input);
  const sprite = bespokeId ? getPixelSprite(bespokeId) : undefined;
  if (sprite?.anchors.grip && sprite.anchors.muzzle) {
    return {
      gripFrac: { x: sprite.anchors.grip.x, y: sprite.anchors.grip.y },
      muzzleFrac: { x: sprite.anchors.muzzle.x, y: sprite.anchors.muzzle.y },
      aspect: sprite.height / sprite.width,
    };
  }
  return compositorWeaponFractions(input);
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

