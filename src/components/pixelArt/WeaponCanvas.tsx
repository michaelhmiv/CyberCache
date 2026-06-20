import React from 'react';
import { Element, Manufacturer, Rarity, WeaponType } from '../../types/game';
import { WeaponIllustration } from '@/components/weapon/WeaponIllustration';

interface WeaponCanvasProps {
  type: WeaponType;
  manufacturer: Manufacturer;
  element: Element;
  rarity: Rarity | string;
  size?: number;
  className?: string;
}

export const WeaponCanvas: React.FC<WeaponCanvasProps> = ({
  type,
  manufacturer,
  element,
  rarity,
  size = 64,
  className = '',
}) => {
  return (
    <WeaponIllustration
      type={type}
      manufacturer={manufacturer}
      element={element}
      rarity={rarity}
      visualSeed={`${type}:${manufacturer}:${element}:${rarity}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)}
      size={size}
      className={className}
      showBadges={size >= 56}
      allowFallbackSpec
    />
  );
};
