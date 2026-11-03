import React from 'react';
import { Element, Manufacturer, Rarity, WeaponType } from '../../types/game';
import { PixelWeapon } from './PixelWeapon';

interface WeaponCanvasProps {
  type: WeaponType;
  manufacturer: Manufacturer;
  element: Element;
  rarity: Rarity | string;
  size?: number;
  className?: string;
}

/**
 * WeaponCanvas — a weapon picture from bare identity props (no item
 * instance). Since the weapon marriage (slice 1) this renders
 * through the pixel card compositor like every other weapon card
 * surface — the vector WeaponIllustration path is retired from
 * weapon rendering (the component itself is removed in slice 3).
 * The seed derivation matches the old vector path's so a given
 * (type, maker, element, rarity) quad renders stably.
 */
export const WeaponCanvas: React.FC<WeaponCanvasProps> = ({
  type,
  manufacturer,
  element,
  rarity,
  size = 64,
  className = '',
}) => {
  const normalizedRarity = (Object.values(Rarity) as string[]).includes(rarity as string)
    ? (rarity as Rarity)
    : Rarity.Common;
  const pixelSeed = `${type}:${manufacturer}:${element}:${rarity}`
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return (
    <PixelWeapon
      input={{
        weaponType: type,
        manufacturer,
        element,
        rarity: normalizedRarity,
        pixelSeed,
        id: `canvas-${type}-${manufacturer}-${element}-${normalizedRarity}`,
      }}
      size={size}
      className={className}
      density="card"
    />
  );
};
