import React from 'react';
import { PxIcon, type PxIconName, type PxIconSize } from '@/components/pixelArt/PxIcon';
import { getResourceVisual, type ResourceVisualId } from '@/constants/visualAssets';

/**
 * PixelWalletIcon — the wallet resources (credits, scrap, keys,
 * cores, XP…) rendered from the §7 pixel icon sheet, tinted with
 * the shipped resource tint from the visualAssets registry.
 *
 * This replaces the retired ResourceIcon (census C-2): the SVG
 * silhouette renderer is gone; the wallet ids map to drawings
 * that already exist on the one icon sheet, exactly as DESIGN.md
 * §7 prescribes ("Wallet icons take the shipped resource tints").
 */
export const WALLET_ICONS: Record<ResourceVisualId, PxIconName> = {
  credits: 'coin',
  scrap: 'scrap',
  cacheKey: 'key',
  cacheFragment: 'frag',
  xp: 'chevs',
  level: 'star',
  masteryPoint: 'nodes',
  loot: 'loot',
  legendaryCore: 'core',
};

interface PixelWalletIconProps {
  id: ResourceVisualId;
  /** §7 size ramp only: 13 inline, 17 rails/rows, 26 doors, 40 heroes. */
  size?: PxIconSize;
  className?: string;
  style?: React.CSSProperties;
}

export const PixelWalletIcon: React.FC<PixelWalletIconProps> = ({ id, size = 17, className, style }) => {
  const visual = getResourceVisual(id);
  return (
    <PxIcon
      name={WALLET_ICONS[id]}
      size={size}
      className={className}
      style={{ color: visual.color, ...style }}
      title={visual.label}
    />
  );
};

export default PixelWalletIcon;
