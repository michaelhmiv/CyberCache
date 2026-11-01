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
 * stacks: icon + full label on line 1, the numeric value on line 2 at
 * full size. A value NEVER truncates or clips: it carries no
 * truncate/overflow treatment and the formatter bounds every output
 * to ≤6 glyphs (src/lib/ui/formatValue.ts).
 *
 * Audit DISP-01: the secondary count (key fragments, equipped
 * fraction) used to sit unlabeled at the slanted top-right corner of
 * the label line, where the chip clip ate its tail ("KEYS 0/"). It
 * now rides the value line as a right-aligned stack — the fraction
 * over a micro-label naming the quantity ("frag" / "equipped") —
 * inset from both slants.
 *
 * Audit UX-04: until the first server profile lands
 * (playerSlice.profileLoaded), the bar renders skeleton chips with
 * the same geometry — never the store's placeholder numbers, which
 * read as a fresh account's false zeros.
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
  /** Secondary count on the value line (key fragments, equipped fraction). */
  micro?: string;
  /** Micro-label naming what `micro` counts (audit DISP-01). */
  microUnit?: string;
  seed?: number;
}

const Chip: React.FC<ChipProps> = ({ resourceId, value, label, micro, microUnit, seed = 0 }) => (
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
    </div>
    <div className="flex items-end gap-1 pl-1.5">
      <div
        data-testid={`resource-value-${resourceId}`}
        className="text-[15px] font-black leading-tight whitespace-nowrap text-text-primary"
      >
        {value}
      </div>
      {micro && (
        <div className="ml-auto shrink-0 whitespace-nowrap pr-1.5 text-right leading-none">
          <div className="text-[8px] font-black text-text-secondary">{micro}</div>
          {microUnit && (
            <div className="mt-[1px] text-[7px] font-black uppercase tracking-wide text-text-muted">{microUnit}</div>
          )}
        </div>
      )}
    </div>
  </motion.div>
);

/** Skeleton chip (audit UX-04): identical geometry, no numbers. */
const SkeletonChip: React.FC<{ resourceId: ChipProps['resourceId'] }> = ({ resourceId }) => (
  <div
    data-testid={`resource-chip-${resourceId}-skeleton`}
    className="relative min-h-[46px] overflow-hidden border-2 border-border bg-bg px-1.5 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
    style={signClip}
  >
    <div className={`absolute left-0 top-0 h-full w-1 ${ACCENT_COLORS[resourceId]}`} />
    <div className="animate-pulse pl-1.5">
      <div className="h-[9px] w-3/5 bg-surface-raised" />
      <div className="mt-[7px] h-[15px] w-2/5 bg-surface-raised" />
    </div>
  </div>
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

  // Audit UX-04: no profile yet — skeleton chips, never the store's
  // placeholder numbers (which read as a new account's false zeros).
  if (!player.profileLoaded) {
    return (
      <div data-testid="resource-bar-loading" className={`grid grid-cols-3 gap-1.5 min-[560px]:grid-cols-6 ${className}`}>
        <SkeletonChip resourceId="credits" />
        <SkeletonChip resourceId="scrap" />
        <SkeletonChip resourceId="cacheKey" />
        <SkeletonChip resourceId="legendaryCore" />
        <SkeletonChip resourceId="loot" />
        <SkeletonChip resourceId="level" />
      </div>
    );
  }

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
        microUnit="frag"
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
        microUnit="equipped"
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
