import React from 'react';
import { RARITIES } from '../../constants/rarities';
import { ELEMENTS } from '../../constants/elements';
import { Rarity, Element } from '../../types/game';

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
      className={`relative rounded-xl overflow-hidden ${className} ${isLegendary ? 'rarity-legendary-glow' : ''} ${isEpic ? 'rarity-epic-glow' : ''}`}
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

export const ElementIcon: React.FC<ElementIconProps> = ({ element, size = 14 }) => {
  const def = ELEMENTS[element];
  return (
    <span
      className="inline-block rounded-sm font-bold text-[9px] px-1 py-0.5 uppercase tracking-wider"
      style={{ backgroundColor: `${def.color}20`, color: def.color, fontSize: size }}
    >
      {def.name.slice(0, 3)}
    </span>
  );
};
