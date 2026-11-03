import React from 'react';
import type { GearItem } from '@/types/items';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { PixelGear } from '@/components/pixelArt/PixelGear';
import {
  GEAR_GRAMMARS,
  gearKindOf,
  gearRenderRoute,
  isClassModItem,
  isOrdnanceItem,
  isRelicItem,
  isShieldItem,
  isWeaponItem,
} from '@/lib/pixel/gearRenderFlags';
import type { GearDensity } from '@/lib/pixel/gearCardCompositor';
import { ShieldIllustration, type IllustrationSize } from './ShieldIllustration';
import { OrdnanceIllustration } from './OrdnanceIllustration';
import { RelicIllustration } from './RelicIllustration';
import { ClassModIllustration } from './ClassModIllustration';

export type GearIllustrationSize = IllustrationSize;

/**
 * Pixel weapon widths for the named sizes — the same horizontal footprint
 * the vector illustrations used (their shared SIZE_PX table); the pixel
 * height follows the parts-kit aspect (120x44) or the bespoke sprite's own.
 */
const PIXEL_WEAPON_SIZE_PX: Record<IllustrationSize, number> = {
  thumb: 46,
  card: 70,
  showcase: 190,
};

/** Pixel gear widths for the named sizes — same footprint table. */
const PIXEL_GEAR_SIZE_PX = PIXEL_WEAPON_SIZE_PX;

/** Named size → plate density: thumb is its own composed density;
 *  card and showcase share the card plate (showcase is a bigger
 *  paint of it, exactly as PixelWeapon treats its densities). */
const PIXEL_GEAR_DENSITY: Record<IllustrationSize, GearDensity> = {
  thumb: 'thumb',
  card: 'card',
  showcase: 'card',
};

/** Type guards (shared classification lives in gearRenderFlags). */
const isWeapon = isWeaponItem;
const isShield = isShieldItem;
const isOrdnance = isOrdnanceItem;
const isClassMod = isClassModItem;
const isRelic = isRelicItem;

interface GearIllustrationProps {
  item: GearItem;
  size?: GearIllustrationSize | number;
  className?: string;
  showBadges?: boolean;
  animate?: boolean;
}

/**
 * Unified gear illustration — dispatches to the correct type-specific
 * illustration component. Weapons render through the pixel path at
 * CARD density (PixelWeapon density="card": bespoke legendary sprite,
 * else the 240×88 card compositor) so every card surface shows the
 * same image for the same weapon; the other gear types keep their
 * procedural SVG illustrations.
 *
 * For weapons, `showBadges`/`animate` no longer apply: the badges were
 * drawn inside the vector weapon SVG itself, and pixel weapons are static
 * renders (surfaces animate the wrapper if they want motion — e.g. the
 * inspect sheet's float).
 */
export const GearIllustration: React.FC<GearIllustrationProps> = React.memo(({
  item,
  size = 'card',
  className = '',
  showBadges = true,
  animate = false,
}: GearIllustrationProps) => {
  if (isWeapon(item)) {
    const pixelSize = typeof size === 'number' ? size : PIXEL_WEAPON_SIZE_PX[size];
    return <PixelWeapon weapon={item} size={pixelSize} className={className} density="card" />;
  }
  // Gear-marriage seam: a kind renders through the pixel plate
  // engine only when its flag is on AND its grammar is registered
  // (gearRenderFlags). Ordnance flipped in slice 2; the kinds
  // below still take their SVG branches until their slices land.
  const kind = gearKindOf(item);
  if (kind !== 'weapon' && gearRenderRoute(kind) === 'pixel') {
    const grammar = GEAR_GRAMMARS[kind]!;
    const pixelSize = typeof size === 'number' ? size : PIXEL_GEAR_SIZE_PX[size];
    const density = typeof size === 'number'
      ? (size <= PIXEL_GEAR_SIZE_PX.thumb ? 'thumb' : 'card')
      : PIXEL_GEAR_DENSITY[size];
    return <PixelGear item={item} grammar={grammar} size={pixelSize} className={className} density={density} />;
  }
  if (isShield(item)) {
    return <ShieldIllustration shield={item} size={size as IllustrationSize | number} className={className} showBadges={showBadges} animate={animate} />;
  }
  if (isOrdnance(item)) {
    return <OrdnanceIllustration ordnance={item} size={size as IllustrationSize | number} className={className} showBadges={showBadges} animate={animate} />;
  }
  if (isClassMod(item)) {
    return <ClassModIllustration mod={item} size={size as IllustrationSize | number} className={className} showBadges={showBadges} animate={animate} />;
  }
  if (isRelic(item)) {
    return <RelicIllustration relic={item} size={size as IllustrationSize | number} className={className} showBadges={showBadges} animate={animate} />;
  }

  // Never reached — all GearItem types are covered
  return null;
});
