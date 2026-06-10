import React from 'react';
import type { ClassMod, GearItem, Ordnance, Relic, Shield as ShieldItem, Weapon } from '@/types/items';
import { WeaponIllustration, type WeaponIllustrationSize } from '@/components/weapon/WeaponIllustration';
import { ShieldIllustration, type IllustrationSize } from './ShieldIllustration';
import { OrdnanceIllustration } from './OrdnanceIllustration';
import { RelicIllustration } from './RelicIllustration';
import { ClassModIllustration } from './ClassModIllustration';

export type GearIllustrationSize = WeaponIllustrationSize | IllustrationSize;

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
 * illustration component. Every item type in the game gets a procedural SVG.
 */
export const GearIllustration: React.FC<GearIllustrationProps> = ({
  item,
  size = 'card',
  className = '',
  showBadges = true,
  animate = false,
}) => {
  if (isWeapon(item)) {
    return <WeaponIllustration weapon={item} size={size as WeaponIllustrationSize | number} className={className} showBadges={showBadges} animate={animate} />;
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
