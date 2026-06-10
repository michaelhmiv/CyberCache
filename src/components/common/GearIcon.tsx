import React from 'react';
import type { GearItem } from '@/types/items';
import { GearIllustration } from '@/components/gearArt/GearIllustration';

interface GearIconProps {
  item: GearItem;
  size?: number;
  className?: string;
  showBadges?: boolean;
}

/** Gear icon used in inventory listings, loadout slots, and market cards. */
export const GearIcon: React.FC<GearIconProps> = ({ item, size = 52, className = '', showBadges = false }) => {
  return <GearIllustration item={item} size={size} className={className} showBadges={showBadges} />;
};
