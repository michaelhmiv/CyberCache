import React from 'react';
import type { GearItem } from '@/types/items';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { PixelGear } from '@/components/pixelArt/PixelGear';
import { GEAR_GRAMMARS, gearKindOf, isWeaponItem } from '@/lib/pixel/gearDispatch';
import type { GearDensity } from '@/lib/pixel/gearCardCompositor';

export type GearIllustrationSize = 'thumb' | 'card' | 'showcase';

/**
 * Pixel widths for the named sizes — the same horizontal footprint
 * the retired vector illustrations used (their shared SIZE_PX
 * table); the pixel height follows the parts-kit aspect (weapons
 * 120x44) or the gear plate's own aspect.
 */
const PIXEL_SIZE_PX: Record<GearIllustrationSize, number> = {
  thumb: 46,
  card: 70,
  showcase: 190,
};

/** Named size → plate density: thumb is its own composed density;
 *  card and showcase share the card plate (showcase is a bigger
 *  paint of it, exactly as PixelWeapon treats its densities). */
const PIXEL_GEAR_DENSITY: Record<GearIllustrationSize, GearDensity> = {
  thumb: 'thumb',
  card: 'card',
  showcase: 'card',
};

interface GearIllustrationProps {
  item: GearItem;
  size?: GearIllustrationSize | number;
  className?: string;
  showBadges?: boolean;
  animate?: boolean;
  /**
   * Weapon composition density override. Default 'card' — the
   * marriage rule: every card surface shows the same 240×88 image
   * for the same weapon. Compact list rows pass 'thumb' (60×22,
   * the latency-audit fix, 2026-11-12): the row displays the art at
   * 46×17 CSS px, and even the stage grid's 360×132 backing store
   * was ~61x the displayed pixels per row across a 2,366-item
   * inventory. 'stage' (120×44) remains for feed/market rows that
   * have not adopted the thumb grid yet.
   */
  weaponDensity?: 'stage' | 'card' | 'thumb';
  /**
   * Viewport-deferred composition (Gear cold-load fix): list
   * surfaces pass this so off-screen items mount at final geometry
   * and compose only when scrolled near. On-screen surfaces
   * (loadout slots, inspect) omit it — they compose immediately.
   */
  defer?: boolean;
}

/**
 * Unified gear illustration — the ONE dispatcher for gear art.
 * Weapons render through PixelWeapon at CARD density (bespoke
 * legendary sprite, else the 240×88 card compositor) so every card
 * surface shows the same image for the same weapon; every other
 * kind renders through the pixel plate engine via its grammar in
 * GEAR_GRAMMARS (gearDispatch) — gear marriage slice 5 retired the
 * procedural SVG illustrations, so there is no second route.
 *
 * `showBadges`/`animate` are accepted for caller compatibility and
 * ignored: the badges were drawn inside the retired vector SVGs,
 * and pixel art is a static render (surfaces animate the wrapper
 * if they want motion — e.g. the inspect sheet's float).
 */
export const GearIllustration: React.FC<GearIllustrationProps> = React.memo(({
  item,
  size = 'card',
  className = '',
  weaponDensity = 'card',
  defer = false,
}: GearIllustrationProps) => {
  if (isWeaponItem(item)) {
    const pixelSize = typeof size === 'number' ? size : PIXEL_SIZE_PX[size];
    return <PixelWeapon weapon={item} size={pixelSize} className={className} density={weaponDensity} defer={defer} />;
  }
  const kind = gearKindOf(item);
  if (kind === 'weapon') return null; // unreachable — handled above
  const grammar = GEAR_GRAMMARS[kind];
  const pixelSize = typeof size === 'number' ? size : PIXEL_SIZE_PX[size];
  const density = typeof size === 'number'
    ? (size <= PIXEL_SIZE_PX.thumb ? 'thumb' : 'card')
    : PIXEL_GEAR_DENSITY[size];
  return <PixelGear item={item} grammar={grammar} size={pixelSize} className={className} density={density} defer={defer} />;
});
