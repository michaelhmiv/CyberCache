/**
 * ResourceBar — compact universal resource header for all tabs.
 *
 * Replaces the bl-title text-3xl heading + subtitle on every tab with a
 * dense 6-chip resource strip showing Credits, Scrap, Keys, Cores, Loot, Level.
 *
 * Phone-width contract (device feedback r2): at 360dp the six chips
 * lay out 3-across × 2 rows (6-across only from 560dp up). Six chips
 * in one row at phone width left ~27px for the number itself — the
 * value clipped and the label ellipsized ("85 cre…"). Each chip now
 * stacks: icon + full label on line 1 (with the secondary count —
 * key fragments, equipped fraction — right-aligned), the numeric
 * value on line 2 at full size. A value NEVER truncates or clips:
 * it carries no truncate/overflow treatment and the formatter below
 * bounds every output to ≤6 glyphs (src/lib/ui/formatValue.ts).
 *
 * Tapping any chip can optionally open a detail tooltip or navigate.
 * All icons rendered via ResourceIcon (central visualAssets registry).
 *
 * Placement law (0037): this bar is display-only. The rewarded-ad
 * offer used to live on the Keys chip's plus button — it moved to
 * the cache surface (ChestScreen) with the cache box lane: no ads
 * on the play screen, ever.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { ResourceIcon } from '@/components/common/ResourceIcon';
import { compactResourceValue } from '@/lib/ui/formatValue';
import { buildLoadoutRows, countEquippedLoadoutSlots } from '@/lib/loadout/loadoutReadModel';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const ACCENT_COLORS: Record<ChipProps['resourceId'], string> = {
  credits: 'bg-cyan',
  scrap: 'bg-amber',
  cacheKey: 'bg-green',
  cacheFragment: 'bg-green',
  loot: 'bg-red',
  level: 'bg-amber',
  legendaryCore: 'bg-amber',
};

interface ChipProps {
  resourceId: 'credits' | 'scrap' | 'cacheKey' | 'cacheFragment' | 'loot' | 'level' | 'legendaryCore';
  value: string | number;
  /** Full-word label (CREDITS / SCRAP / KEYS / CORES / LOOT / LEVEL). */
  label: string;
  /** Secondary count on the label line (key fragments, equipped fraction). */
  micro?: string;
  seed?: number;
}

const Chip: React.FC<ChipProps> = ({ resourceId, value, label, micro, seed = 0 }) => (
  <motion.div
    data-testid={`resource-chip-${resourceId}`}
    className="relative min-h-[46px] overflow-hidden border-2 border-border bg-bg px-1.5 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
    style={signClip}
    whileTap={{ scale: 0.97 }}
  >
    {/* Colored left-edge accent bar */}
    <div className={`absolute left-0 top-0 h-full w-1 ${ACCENT_COLORS[resourceId]}`} />
    <div className="flex items-center gap-1 pl-1.5">
      <ResourceIcon id={resourceId} size={13} seed={seed} className="shrink-0 opacity-80" />
      <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">{label}</span>
      {micro && <span className="ml-auto text-[8px] font-black text-text-secondary">{micro}</span>}
    </div>
    <div
      data-testid={`resource-value-${resourceId}`}
      className="pl-1.5 text-[15px] font-black leading-tight whitespace-nowrap text-text-primary"
    >
      {value}
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

  // CONS-04: gear slots only (7) via the shared loadout read model —
  // the vehicle slot in the raw map is not gear.
  const equippedCount = countEquippedLoadoutSlots(buildLoadoutRows(loadout.slots, inventory.items));

  return (
    <div className={`grid grid-cols-3 gap-1.5 min-[560px]:grid-cols-6 ${className}`}>
      <Chip
        resourceId="credits"
        value={compactResourceValue(player.credits)}
        label="Credits"
        seed={1}
      />
      <Chip
        resourceId="scrap"
        value={compactResourceValue(player.scrap)}
        label="Scrap"
        seed={2}
      />
      <Chip
        resourceId="cacheKey"
        value={player.cacheKeys}
        label="Keys"
        micro={`${player.cacheKeyFragments}/5`}
        seed={3}
      />
      <Chip
        resourceId="legendaryCore"
        value={player.legendaryCores}
        label="Cores"
        seed={6}
      />
      <Chip
        resourceId="loot"
        value={inventory.items.length}
        label="Loot"
        micro={`${equippedCount}/7`}
        seed={4}
      />
      <Chip
        resourceId="level"
        value={player.level}
        label="Level"
        seed={5}
      />
    </div>
  );
};
