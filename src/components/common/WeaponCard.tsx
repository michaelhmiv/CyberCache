import React from 'react';
import { motion } from 'framer-motion';
import { Weapon } from '../../types/items';
import { WeaponCanvas } from '../pixelArt/WeaponCanvas';
import { RollQualityBadge } from './RollQualityBadge';
import { ElementIcon } from './RarityGlow';
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
      className="relative rounded-xl p-3 bg-surface border border-border overflow-hidden flex items-center gap-3 cursor-pointer"
      style={{ borderLeftColor: rarityColor, borderLeftWidth: 4 }}
    >
      <div className="shrink-0">
        <WeaponCanvas
          type={weapon.weaponType}
          manufacturer={weapon.manufacturer}
          element={weapon.element}
          rarity={weapon.rarity}
          size={56}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-bold truncate" style={{ color: rarityColor }}>
            {weapon.name}
          </span>
          <RollQualityBadge quality={weapon.rollQuality} />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-text-secondary mb-1">
          <span>Lv.{weapon.level}</span>
          <span>{weapon.weaponType}</span>
          <ElementIcon element={weapon.element} />
        </div>
        {showDetails && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
            <span>Dmg {weapon.baseDamage}</span>
            <span>Spd {weapon.attackSpeed.toFixed(2)}</span>
            <span>Crit {(weapon.critChance * 100).toFixed(1)}%</span>
            <span>Boss {(weapon.bossDamageMod * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>
      {weapon.isLocked && (
        <div className="absolute top-1 right-1 text-text-muted">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C9.243 2 7 4.243 7 7v3H5v10h14V10h-2V7c0-2.757-2.243-5-5-5zm0 2c1.654 0 3 1.346 3 3v3H9V7c0-1.654 1.346-3 3-3zm-5 8h10v6H7v-6z"/></svg>
        </div>
      )}
    </motion.div>
  );
};
