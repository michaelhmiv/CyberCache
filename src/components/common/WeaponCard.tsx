import React from 'react';
import { motion } from 'framer-motion';
import { Weapon } from '../../types/items';
import { RollQualityBadge } from './RollQualityBadge';
import { VisualBadge } from './VisualBadge';
import { WeaponIllustration } from '@/components/weapon/WeaponIllustration';
import { RARITIES } from '../../constants/rarities';

interface WeaponCardProps {
  weapon: Weapon;
  onClick?: () => void;
  showDetails?: boolean;
}

export const WeaponCard: React.FC<WeaponCardProps> = ({ weapon, onClick, showDetails = true }) => {
  const rarityColor = RARITIES[weapon.rarity].color;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="bl-card relative flex cursor-pointer items-center gap-2 overflow-hidden p-2"
      style={{
        borderLeftColor: rarityColor,
        borderLeftWidth: 5,
        boxShadow: weapon.rarity === 'Legendary' || weapon.rarity === 'Epic' ? `0 0 14px ${rarityColor}44, 5px 5px 0 rgba(0,0,0,0.75)` : undefined,
      }}
    >
      <div className="shrink-0">
        <WeaponIllustration weapon={weapon} size="card" showBadges />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="truncate text-xs font-black uppercase tracking-wide" style={{ color: rarityColor }}>
            {weapon.name}
          </span>
          <RollQualityBadge quality={weapon.rollQuality} />
        </div>
        <div className="mb-1 flex flex-wrap items-center gap-1 text-[9px] uppercase text-text-secondary">
          <span className="font-black text-text-muted">Lv.{weapon.level}</span>
          <span style={{ color: rarityColor }} className="font-black">{weapon.rarity}</span>
          <VisualBadge kind="weaponType" id={weapon.weaponType} size="xs" label />
          <VisualBadge kind="manufacturer" id={weapon.manufacturer} size="xs" label />
          <VisualBadge kind="element" id={weapon.element} size="xs" label />
        </div>
        {showDetails && (
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-mono text-text-muted">
            <span>Dmg {weapon.baseDamage}</span>
            <span>Spd {weapon.attackSpeed.toFixed(2)}</span>
            <span>Crit {(weapon.critChance * 100).toFixed(1)}%</span>
            <span>Boss {(weapon.bossDamageMod * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>
      {weapon.isLocked && (
        <div className="absolute right-1 top-1 text-text-muted">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C9.243 2 7 4.243 7 7v3H5v10h14V10h-2V7c0-2.757-2.243-5-5-5zm0 2c1.654 0 3 1.346 3 3v3H9V7c0-1.654 1.346-3 3-3zm-5 8h10v6H7v-6z"/></svg>
        </div>
      )}
    </motion.div>
  );
};
