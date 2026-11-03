/**
 * SalvageToast — pop-up banner shown when an item is scrapped.
 * Displays the item name, rarity, and a full breakdown of gained materials.
 * Auto-dismisses after 6 seconds.
 */
import React, { useEffect } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useSalvageFeedStore } from '@/store/slices/salvageFeedSlice';
import { getVisualAsset } from '@/constants/visualAssets';
import type { SalvageBatchFeedEvent, SalvageFeedEvent } from '@/store/slices/salvageFeedSlice';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const RARITY_COLORS: Record<string, string> = {
  Common: '#A5A7B5',
  Uncommon: '#7CFC00',
  Rare: '#5AA7FF',
  Epic: '#FF9DF5',
  Legendary: '#FFEA3A',
};

const SalvageToastItem: React.FC<{ event: SalvageFeedEvent }> = ({ event }) => {
  const dismiss = useSalvageFeedStore((s) => s.dismiss);
  const accent = RARITY_COLORS[event.item.rarity] ?? '#A5A7B5';
  const { scrapValue, scrapAlloy, ballisticParts, reactiveComponents, techFragments, voidDust, essences, legendaryCores } = event.yield;

  useEffect(() => {
    const timer = setTimeout(() => dismiss(event.id), 6000);
    return () => clearTimeout(timer);
  }, [event.id, dismiss]);

  // Full display labels — a bonus material the server paid is named
  // as itself (Scrap, Ballistic Parts…), never an abbreviation
  // the player has to decode, and legendary cores print as cores.
  const parts: string[] = [];
  if (scrapValue > 0) parts.push(`+${scrapValue} Scrap`);
  if (scrapAlloy > 0) parts.push(`+${scrapAlloy} ${getVisualAsset('material', 'Scrap').label}`);
  if (ballisticParts > 0) parts.push(`+${ballisticParts} ${getVisualAsset('material', 'BallisticParts').label}`);
  if (reactiveComponents > 0) parts.push(`+${reactiveComponents} ${getVisualAsset('material', 'ReactiveComponents').label}`);
  if (techFragments > 0) parts.push(`+${techFragments} ${getVisualAsset('material', 'TechFragments').label}`);
  if (voidDust > 0) parts.push(`+${voidDust} ${getVisualAsset('material', 'VoidDust').label}`);
  if ((legendaryCores ?? 0) > 0) parts.push(`+${legendaryCores} Legendary Core${legendaryCores === 1 ? '' : 's'}`);
  for (const [key, count] of Object.entries(essences)) {
    if (count > 0) parts.push(`+${count} ${key.replace(/([A-Z])/g, ' $1').trim()}`);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.94 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-auto w-full border-2 border-border bg-surface/95 shadow-[0_10px_28px_rgba(0,0,0,0.75)]"
      style={{ ...signClip, borderColor: `${accent}60` }}
    >
      <div className="flex items-start gap-3 p-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-border"
          style={{ background: `${accent}18` }}
        >
          <PxIcon name="recycle" size={17} style={{ color: accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-xs font-black uppercase tracking-wide text-text-primary truncate">
              {event.item.name}
            </div>
            <div className="text-[9px] font-black uppercase tracking-wider" style={{ color: accent }}>
              {event.item.rarity}
            </div>
          </div>
          <div className="mt-0.5 text-[10px] font-black text-amber uppercase tracking-wide">
            SALVAGED
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            {parts.map((part, i) => (
              <span key={i} className="text-[9px] font-black text-green">
                {part}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => dismiss(event.id)}
          className="shrink-0 p-1 text-text-muted hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>
    </motion.div>
  );
};

/**
 * The ONE summary card for a batch settlement (0055): how many of
 * each rarity went in, and everything gained — totals only, with the
 * gains as the hero numbers (numbers law: big, bright, green). A
 * batch of 1,500 items produces exactly this one card.
 */
const SalvageBatchToastItem: React.FC<{ event: SalvageBatchFeedEvent }> = ({ event }) => {
  const dismiss = useSalvageFeedStore((s) => s.dismiss);
  const { summary } = event;

  useEffect(() => {
    const timer = setTimeout(() => dismiss(event.id), 10000);
    return () => clearTimeout(timer);
  }, [event.id, dismiss]);

  const rarityCounts = Object.entries(summary.countsByRarity)
    .filter(([, n]) => n > 0)
    .sort((a, b) => (RARITY_ORDER_INDEX[a[0]] ?? 0) - (RARITY_ORDER_INDEX[b[0]] ?? 0));
  const materials = Object.entries(summary.bonusMaterials).filter(([, n]) => n > 0);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.94 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-auto w-full border-2 border-amber/50 bg-surface/95 shadow-[0_10px_28px_rgba(0,0,0,0.75)]"
      style={signClip}
      data-testid="salvage-batch-summary"
    >
      <div className="flex items-start gap-3 p-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-border bg-amber/15">
          <PxIcon name="recycle" size={17} className="text-amber" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">
            Salvaged {summary.totalItems} item{summary.totalItems === 1 ? '' : 's'}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {rarityCounts.map(([rarity, n]) => (
              <span
                key={rarity}
                className="text-[11px] font-black uppercase tracking-wide"
                style={{ color: RARITY_COLORS[rarity] ?? '#A5A7B5' }}
              >
                {n} {rarity}
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-lg font-black leading-none text-green">+{summary.scrap} Scrap</span>
            {summary.cores > 0 && (
              <span className="text-sm font-black text-green">+{summary.cores} Legendary Cores</span>
            )}
            {materials.map(([key, n]) => (
              <span key={key} className="text-[11px] font-black text-green">
                +{n} {key.replace(/([A-Z])/g, ' $1').trim()}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => dismiss(event.id)}
          className="shrink-0 p-1 text-text-muted hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>
    </motion.div>
  );
};

const RARITY_ORDER_INDEX: Record<string, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
};

export const SalvageToastContainer: React.FC = () => {
  const events = useSalvageFeedStore((s) => s.events);

  return (
    <AnimatePresence>
      {events.length > 0 && (
        <motion.div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] max-w-[420px] space-y-2"
        >
          {events.map((event) =>
            event.kind === 'batch' ? (
              <SalvageBatchToastItem key={event.id} event={event} />
            ) : (
              <SalvageToastItem key={event.id} event={event} />
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
