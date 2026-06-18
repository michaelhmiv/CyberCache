/**
 * SalvageToast — pop-up banner shown when an item is scrapped.
 * Displays the item name, rarity, and a full breakdown of gained materials.
 * Auto-dismisses after 6 seconds.
 */
import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useSalvageFeedStore } from '@/store/slices/salvageFeedSlice';
import type { SalvageFeedEvent } from '@/store/slices/salvageFeedSlice';

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
  const { scrapValue, scrapAlloy, ballisticParts, reactiveComponents, techFragments, voidDust, essences } = event.yield;

  useEffect(() => {
    const timer = setTimeout(() => dismiss(event.id), 6000);
    return () => clearTimeout(timer);
  }, [event.id, dismiss]);

  const parts: string[] = [];
  if (scrapValue > 0) parts.push(`+${scrapValue} Scrap`);
  if (scrapAlloy > 0) parts.push(`+${scrapAlloy} Alloy`);
  if (ballisticParts > 0) parts.push(`+${ballisticParts} Parts`);
  if (reactiveComponents > 0) parts.push(`+${reactiveComponents} Reactive`);
  if (techFragments > 0) parts.push(`+${techFragments} Tech`);
  if (voidDust > 0) parts.push(`+${voidDust} Void Dust`);
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
          <span className="font-black" style={{ color: accent, fontSize: '16px' }}>♻</span>
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

export const SalvageToastContainer: React.FC = () => {
  const events = useSalvageFeedStore((s) => s.events);

  return (
    <AnimatePresence>
      {events.length > 0 && (
        <motion.div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] max-w-[420px] space-y-2"
        >
          {events.map((event) => (
            <SalvageToastItem key={event.id} event={event} />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
