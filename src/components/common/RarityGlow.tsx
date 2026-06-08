import React from 'react';
import { RARITIES } from '../../constants/rarities';
import { Rarity, Element } from '../../types/game';
import { VisualBadge } from './VisualBadge';

interface RarityGlowProps {
  rarity: Rarity;
  children: React.ReactNode;
  className?: string;
}

export const RarityGlow: React.FC<RarityGlowProps> = ({ rarity, children, className = '' }) => {
  const color = RARITIES[rarity].color;
  const isLegendary = rarity === Rarity.Legendary;
  const isEpic = rarity === Rarity.Epic;
  return (
    <div
      className={`relative overflow-hidden ${className} ${isLegendary ? 'rarity-legendary-glow' : ''} ${isEpic ? 'rarity-epic-glow' : ''}`}
      style={{ borderColor: color, borderWidth: 1 }}
    >
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundColor: color }} />
      {children}
    </div>
  );
};

interface ElementIconProps {
  element: Element;
  size?: number;
}

export const ElementIcon: React.FC<ElementIconProps> = ({ element, size = 14 }) => (
  <VisualBadge kind="element" id={element} label={size >= 12} size={size >= 14 ? 'sm' : 'xs'} />
);
