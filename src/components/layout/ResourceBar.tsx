/**
 * ResourceBar — compact universal resource header for all tabs.
 *
 * Replaces the bl-title text-3xl heading + subtitle on every tab with a
 * dense 5-chip resource strip showing Credits, Scrap, Keys, Loot, Level.
 *
 * Tapping any chip can optionally open a detail tooltip or navigate.
 * All icons rendered via ResourceIcon (central visualAssets registry).
 */
import React from 'react';
import { motion } from 'framer-motion';
import { ResourceIcon } from '@/components/common/ResourceIcon';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

interface ChipProps {
  resourceId: 'credits' | 'scrap' | 'cacheKey' | 'cacheFragment' | 'loot' | 'level';
  value: string | number;
  sub: string;
  seed?: number;
}

const Chip: React.FC<ChipProps> = ({ resourceId, value, sub, seed = 0 }) => (
  <motion.div
    className="relative min-w-[70px] flex-1 overflow-hidden border-2 border-border bg-bg px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
    style={signClip}
    whileTap={{ scale: 0.97 }}
  >
    {/* Left color bar derived from the resource's visualAsset */}
    <ResourceIcon id={resourceId} size={18} seed={seed} className="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-70" />
    <div className="ml-6">
      <div className="text-sm font-black leading-none text-text-primary">{value}</div>
      <div className="truncate text-[8px] text-text-muted">{sub}</div>
    </div>
  </motion.div>
);

interface ResourceBarProps {
  /** Optional extra class for the wrapper */
  className?: string;
}

export const ResourceBar: React.FC<ResourceBarProps> = ({ className = '' }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();

  const equippedCount = Object.values(loadout.slots).filter(Boolean).length;

  return (
    <div className={`flex gap-1.5 ${className}`}>
      <Chip
        resourceId="credits"
        value={compact(player.credits)}
        sub="credits"
        seed={1}
      />
      <Chip
        resourceId="scrap"
        value={compact(player.scrap)}
        sub="bench"
        seed={2}
      />
      <Chip
        resourceId="cacheKey"
        value={player.cacheKeys}
        sub={`${player.cacheKeyFragments}/5 frags`}
        seed={3}
      />
      <Chip
        resourceId="loot"
        value={inventory.items.length}
        sub={`${equippedCount}/7 equip`}
        seed={4}
      />
      <Chip
        resourceId="level"
        value={player.level}
        sub={`LV ${player.level}`}
        seed={5}
      />
    </div>
  );
};
