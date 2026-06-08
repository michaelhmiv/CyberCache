import React from 'react';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import { GEAR_VISUALS, type GearVisualId } from '@/constants/visualAssets';
import { RARITIES } from '@/constants/rarities';
import { WeaponIllustration } from '@/components/weapon/WeaponIllustration';

function isWeapon(item: GearItem): item is Weapon {
  return 'weaponType' in item;
}
function isShield(item: GearItem): item is Shield {
  return 'hp' in item && !('weaponType' in item);
}
function isClassMod(item: GearItem): item is ClassMod {
  return 'treeBonus' in item;
}
function isOrdnance(item: GearItem): item is Ordnance {
  return 'damage' in item && 'effect' in item && !('weaponType' in item);
}
function isRelic(item: GearItem): item is Relic {
  return 'affixes' in item && !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);
}

export function getGearVisualId(item: GearItem): GearVisualId {
  if (isWeapon(item)) return 'weapon';
  if (isShield(item)) return 'shield';
  if (isClassMod(item)) return 'classMod';
  if (isRelic(item)) return 'relic';
  return 'ordnance';
}

interface GearIconProps {
  item: GearItem;
  size?: number;
  className?: string;
  showBadges?: boolean;
}

export const GearIcon: React.FC<GearIconProps> = ({ item, size = 52, className = '', showBadges = false }) => {
  if (isWeapon(item)) {
    return <WeaponIllustration weapon={item} size={size} className={className} showBadges={showBadges} />;
  }

  const visual = GEAR_VISUALS[getGearVisualId(item)];
  const rarityColor = RARITIES[item.rarity]?.color || visual.color;
  const innerSize = Math.max(20, Math.round(size * 0.58));

  return (
    <div
      className={`relative inline-flex items-center justify-center overflow-hidden border-2 border-border bg-bg shadow-[3px_3px_0_rgba(0,0,0,0.75)] ${className}`}
      style={{
        width: size,
        height: size,
        borderLeftColor: rarityColor,
        borderLeftWidth: 5,
        clipPath: 'polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)',
      }}
      title={`${item.rarity} ${visual.label}`}
    >
      <div className="absolute inset-0 opacity-20" style={{ background: `linear-gradient(135deg, ${visual.color}, transparent 62%)` }} />
      <div
        className="relative flex items-center justify-center border-2 border-border font-black leading-none"
        style={{
          width: innerSize,
          height: innerSize,
          color: visual.color,
          backgroundColor: `${visual.color}16`,
          clipPath: 'polygon(7px 0,100% 0,calc(100% - 7px) 100%,0 100%)',
        }}
      >
        {visual.mark}
      </div>
      <div className="absolute bottom-0 left-0 right-0 border-t-2 border-border bg-bg/90 text-center text-[7px] font-black uppercase tracking-wide" style={{ color: rarityColor }}>
        {visual.shortLabel}
      </div>
    </div>
  );
};
