/**
 * ResourceBar — THE STRIP (DESIGN.md §1; drift-fix F1, 2026-11-02).
 *
 * One single-row resource bar on every tab: credits · scrap ·
 * keys/fragments · cores · loot, the XP bar fused as a hairline on
 * the bottom edge, the level chip at the right, and the settings
 * gear as the Strip's one allowed resident beside the wallet
 * (DESIGN.md §1; Settings' canonical home stays Hunter → Account).
 * The wallet prints exactly once anywhere in the app.
 *
 * This replaces the six-card grid the fidelity audit found still
 * standing in for the Strip (FIDELITY-AUDIT.md finding #1): two
 * rows of skewed 46px chips consumed ~20–25% of every screen
 * before any content. The anatomy follows the approved v2 mocks
 * (m25-home / m39-buy / m36-hunter — the Strip reads identically
 * on every tab): small pixel icons + values on one line, the
 * fragment count as a micro directly after the key value, the
 * equipped fraction as a micro after the loot value, SCRAP
 * carrying the one visible text label (its icon is the least
 * distinct), LV + the level value closing the row.
 *
 * Phone-width contract (device feedback r2 — the values on this
 * bar were the original "85 cre…" truncation report): a value
 * NEVER truncates, clips, or shrinks. Values render at 13px,
 * micro counts and labels at the 11px floor (DESIGN.md §5),
 * every segment is shrink-0 with whitespace-nowrap, and the
 * formatter bounds every value to ≤6 glyphs
 * (src/lib/ui/formatValue.ts) so the row fits at the 412px
 * reference width with ordinary balances. If an extreme balance
 * set still cannot fit honestly, the row SCROLLS horizontally
 * (the owner's scroll-don't-shrink law, DESIGN.md §6) — the type
 * never drops below the floor to force a fit.
 *
 * Every segment carries an aria-label naming the resource and
 * its full state ("Keys — 15 keys, 3 of 5 fragments"), so the
 * resource names are always present even where the mock language
 * lets the icon speak alone. Audit DISP-01's labeled-micro rule
 * is honored in that pairing: each micro sits directly after the
 * value it qualifies, on the same baseline, named in its label.
 *
 * Audit UX-04: until the first server profile lands
 * (playerSlice.profileLoaded), the bar renders a skeleton strip
 * with the same geometry — never the store's placeholder numbers,
 * which read as a fresh account's false zeros.
 *
 * Placement law (0037): this bar is display-only. The rewarded-ad
 * offer used to live on the Keys chip's plus button — it moved to
 * the cache surface (ChestScreen) with the cache box lane: no ads
 * on the play screen, ever. The level segment is likewise
 * display-only, exactly as the old LEVEL chip was; the tappable
 * level door lives in Home's claim row (DashboardTopBar).
 *
 * All icons rendered via ResourceIcon (central visualAssets
 * registry); the settings gear is the §7 pixel icon `cog`.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { ResourceIcon } from '@/components/common/ResourceIcon';
import { compactResourceValue } from '@/lib/ui/formatValue';
import { buildLoadoutRows, countEquippedLoadoutSlots } from '@/lib/loadout/loadoutReadModel';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import { xpToNextLevel } from '@/content/simulation';

type StripResourceId = 'credits' | 'scrap' | 'cacheKey' | 'legendaryCore' | 'loot';

interface SegmentProps {
  resourceId: StripResourceId;
  value: string | number;
  /** Visible text label (only SCRAP in the mock language). */
  label?: string;
  /** Secondary count riding the value (fragments, equipped). */
  micro?: string;
  /** Full spoken state for the segment (names the resource and
   *  what the micro counts, in words). */
  ariaText: string;
  seed?: number;
}

const Segment: React.FC<SegmentProps> = ({ resourceId, value, label, micro, ariaText, seed = 0 }) => (
  <span
    data-testid={`resource-chip-${resourceId}`}
    role="img"
    aria-label={ariaText}
    className="flex shrink-0 items-center gap-1 whitespace-nowrap"
  >
    <ResourceIcon id={resourceId} size={14} seed={seed} className="shrink-0" />
    <span
      data-testid={`resource-value-${resourceId}`}
      className="whitespace-nowrap text-[13px] font-black tabular-nums leading-none text-text-primary"
    >
      {value}
    </span>
    {micro && (
      <span className="whitespace-nowrap text-[11px] font-bold tabular-nums leading-none text-text-muted">
        {micro}
      </span>
    )}
    {label && (
      <span className="whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-wider text-text-muted">
        {label}
      </span>
    )}
  </span>
);

/** Skeleton segment (audit UX-04): same geometry, no numbers. */
const SkeletonSegment: React.FC<{ resourceId: StripResourceId | 'level' }> = ({ resourceId }) => (
  <span
    data-testid={`resource-chip-${resourceId}-skeleton`}
    className="flex shrink-0 animate-pulse items-center gap-1.5"
    aria-hidden
  >
    <span className="h-[15px] w-[15px] bg-surface-raised" />
    <span className="h-[13px] w-8 bg-surface-raised" />
  </span>
);

interface ResourceBarProps {
  /** Optional extra class for the wrapper */
  className?: string;
  /** Opens Settings — the Strip's gear resident (DESIGN.md §1).
   *  When omitted, no gear renders. */
  onOpenSettings?: () => void;
}

export const ResourceBar: React.FC<ResourceBarProps> = ({ className = '', onOpenSettings }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();

  // CONS-04: gear slots only (7) via the shared loadout read model —
  // the vehicle slot in the raw map is not gear.
  const equippedCount = countEquippedLoadoutSlots(buildLoadoutRows(loadout.slots, inventory.items));

  // The XP hairline fused to the Strip's bottom edge (DESIGN.md
  // §1): the same shipped curve the claim row's level pill reads —
  // no second XP truth.
  const xpNeeded = xpToNextLevel(player.level);
  const xpProgress = xpNeeded > 0 ? Math.min(100, (player.xp / xpNeeded) * 100) : 100;

  const gear = onOpenSettings ? (
    <button
      type="button"
      data-testid="strip-settings-button"
      aria-label="Settings"
      onClick={onOpenSettings}
      className="flex h-9 w-9 shrink-0 items-center justify-center text-text-muted transition-transform active:scale-[0.96]"
    >
      <PxIcon name="cog" size={17} />
    </button>
  ) : null;

  const rightEnd = (children: React.ReactNode) => (
    <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
      {gear}
      {children}
    </span>
  );

  if (!player.profileLoaded) {
    // Audit UX-04: no profile yet — a skeleton strip, never the
    // store's placeholder numbers (which read as a new account's
    // false zeros). Same one-row geometry as the loaded Strip.
    return (
      <div data-testid="resource-bar-loading" className={`relative border-2 border-border bg-bg ${className}`}>
        <div data-testid="resource-bar-strip" className="flex items-center gap-2 overflow-hidden px-2 py-1">
          <SkeletonSegment resourceId="credits" />
          <SkeletonSegment resourceId="scrap" />
          <SkeletonSegment resourceId="cacheKey" />
          <SkeletonSegment resourceId="legendaryCore" />
          <SkeletonSegment resourceId="loot" />
          {rightEnd(<SkeletonSegment resourceId="level" />)}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="resource-bar" className={`relative border-2 border-border bg-bg ${className}`}>
      <div
        data-testid="resource-bar-strip"
        className="flex items-center gap-2 overflow-x-auto px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Segment
          resourceId="credits"
          value={compactResourceValue(player.credits)}
          ariaText={`Credits — ${player.credits}`}
          seed={1}
        />
        <Segment
          resourceId="scrap"
          value={compactResourceValue(player.scrap)}
          label="Scrap"
          ariaText={`Scrap — ${player.scrap}`}
          seed={2}
        />
        <Segment
          resourceId="cacheKey"
          value={player.cacheKeys}
          micro={`${player.cacheKeyFragments}/5`}
          ariaText={`Keys — ${player.cacheKeys} keys, ${player.cacheKeyFragments} of 5 fragments`}
          seed={3}
        />
        <Segment
          resourceId="legendaryCore"
          value={player.legendaryCores}
          ariaText={`Cores — ${player.legendaryCores} legendary cores`}
          seed={6}
        />
        <Segment
          resourceId="loot"
          value={inventory.items.length}
          micro={`${equippedCount}/7`}
          ariaText={`Loot — ${inventory.items.length} items, ${equippedCount} of 7 gear slots equipped`}
          seed={4}
        />
        {rightEnd(
          <span
            data-testid="resource-chip-level"
            role="img"
            aria-label={`Level — ${player.level}`}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap"
          >
            <span className="whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-wider text-amber">
              LV
            </span>
            <span
              data-testid="resource-value-level"
              className="whitespace-nowrap text-[13px] font-black tabular-nums leading-none text-text-primary"
            >
              {player.level}
            </span>
          </span>,
        )}
      </div>
      {/* The fused XP hairline: a faint full-width track with the
          amber fill riding the Strip's bottom edge. It tracks the
          bar's own width, not the scrolling row above it. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
        <motion.div
          className="h-full bg-amber"
          initial={false}
          animate={{ width: `${xpProgress}%` }}
          transition={{ type: 'spring', damping: 20 }}
        />
      </div>
    </div>
  );
};
