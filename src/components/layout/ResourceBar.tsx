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
 */
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Plus, Play, X } from 'lucide-react';
import { ResourceIcon } from '@/components/common/ResourceIcon';
import { compactResourceValue } from '@/lib/ui/formatValue';
import { showRewardedCacheKeyAd, canUseRewardedCacheKeyAds } from '@/lib/ads/rewardedCacheKeyAd';
import { verifiedOps } from '@/lib/api/verifiedOps';
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
  action?: React.ReactNode;
}

const Chip: React.FC<ChipProps> = ({ resourceId, value, label, micro, seed = 0, action }) => (
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
      className={`pl-1.5 text-[15px] font-black leading-tight whitespace-nowrap text-text-primary ${action ? 'pr-6' : ''}`}
    >
      {value}
    </div>
    {action}
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
  const [rewardOpen, setRewardOpen] = useState(false);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const [rewardSuccess, setRewardSuccess] = useState<string | null>(null);

  const equippedCount = Object.values(loadout.slots).filter(Boolean).length;
  const nativeAdsReady = canUseRewardedCacheKeyAds();

  const openRewardDialog = () => {
    setRewardError(null);
    setRewardSuccess(null);
    setRewardOpen(true);
  };

  const claimRewardedKey = async () => {
    if (rewardLoading) return;
    setRewardLoading(true);
    setRewardError(null);
    setRewardSuccess(null);

    try {
      const reward = await showRewardedCacheKeyAd(player.id);
      await verifiedOps.claimRewardedCacheKey({
        adUnitId: reward.adUnitId,
        rewardSource: 'admob_rewarded',
      });
      setRewardSuccess('+1 cache key added.');
    } catch (error) {
      setRewardError(error instanceof Error ? error.message : 'Unable to claim rewarded cache key.');
    } finally {
      setRewardLoading(false);
    }
  };

  return (
    <>
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
          action={(
            <button
              type="button"
              aria-label="Watch ad for cache key"
              onClick={openRewardDialog}
              className="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full border border-amber/70 bg-amber text-bg shadow-[0_0_10px_rgba(247,210,11,0.35)] active:scale-95"
            >
              <Plus size={13} strokeWidth={3} />
            </button>
          )}
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

      <AnimatePresence>
        {rewardOpen && (
          <motion.div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-[360px] border-2 border-border bg-surface p-4 shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
              style={signClip}
              initial={{ y: 18, scale: 0.96 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 18, scale: 0.96 }}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="bl-title text-2xl leading-none text-amber">Cache Key</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted">Rewarded video</div>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setRewardOpen(false)}
                  className="bl-secondary flex h-8 w-8 items-center justify-center p-0"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="mb-3 border border-border bg-bg p-3 text-xs text-text-secondary" style={signClip}>
                Watch one rewarded ad to receive <span className="font-black text-amber">+1 cache key</span>. The key is granted by the server after the ad completes.
              </div>

              {!nativeAdsReady && (
                <div className="mb-3 border border-amber/40 bg-amber/10 p-2 text-[11px] font-bold text-amber" style={signClip}>
                  Rewarded ads are available in Android app builds.
                </div>
              )}

              {rewardError && (
                <div className="mb-3 border border-red/40 bg-red/10 p-2 text-[11px] font-bold text-red-light" style={signClip}>
                  {rewardError}
                </div>
              )}

              {rewardSuccess && (
                <div className="mb-3 border border-green/40 bg-green/10 p-2 text-[11px] font-bold text-green" style={signClip}>
                  {rewardSuccess}
                </div>
              )}

              <button
                type="button"
                onClick={claimRewardedKey}
                disabled={rewardLoading || !nativeAdsReady}
                className="flex w-full items-center justify-center gap-2 bg-amber px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-bg disabled:opacity-45 active:scale-95"
                style={signClip}
              >
                {rewardLoading ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" />}
                Watch Ad
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
