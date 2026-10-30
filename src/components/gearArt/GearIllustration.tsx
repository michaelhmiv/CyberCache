import React from 'react';
import type { ClassMod, GearItem, Ordnance, Relic, Shield as ShieldItem, Weapon } from '@/types/items';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
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

/** Type guards */
const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
const isShield = (item: GearItem): item is ShieldItem => 'hp' in item && 'rechargeRate' in item && !isWeapon(item);
const isOrdnance = (item: GearItem): item is Ordnance => 'damage' in item && 'effect' in item && !isWeapon(item);
const isClassMod = (item: GearItem): item is ClassMod => 'treeBonus' in item;
const isRelic = (item: GearItem): item is Relic => !isWeapon(item) && !isShield(item) && !isOrdnance(item) && !isClassMod(item);

interface GearIllustrationProps {
  item: GearItem;
  size?: GearIllustrationSize | number;
  className?: string;
  showBadges?: boolean;
  animate?: boolean;
}

/**
 * Unified gear illustration — dispatches to the correct type-specific
 * illustration component. Weapons render through the pixel path
 * (PixelWeapon: bespoke legendary sprite, else the deterministic parts-kit
 * compositor) so every surface shows the same image for the same weapon;
 * the other gear types keep their procedural SVG illustrations.
 *
 * For weapons, `showBadges`/`animate` no longer apply: the badges were
 * drawn inside the vector weapon SVG itself, and pixel weapons are static
 * renders (surfaces animate the wrapper if they want motion — e.g. the
 * inspect sheet's float).
 */
export const GearIllustration: React.FC<GearIllustrationProps> = ({
  item,
  size = 'card',
  className = '',
  showBadges = true,
  animate = false,
}) => {
  if (isWeapon(item)) {
    const pixelSize = typeof size === 'number' ? size : PIXEL_WEAPON_SIZE_PX[size];
    return <PixelWeapon weapon={item} size={pixelSize} className={className} />;
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
};
