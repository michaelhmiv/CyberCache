import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Sparkles, Info } from 'lucide-react';
import { usePlayerStore, useInventoryStore } from '@/store';
import { WeaponCard } from '@/components/common/WeaponCard';
import { RARITIES } from '@/constants/rarities';
import { DropSource } from '@/types/game';

export const ChestScreen: React.FC = () => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState<ReturnType<typeof inventory.generateAndAdd>[] | null>(null);

  const handleOpen = () => {
    if (player.cacheKeys <= 0) return;
    player.removeCacheKeys(1);
    setOpening(true);
    setTimeout(() => {
      const drops: ReturnType<typeof inventory.generateAndAdd>[] = [];
      // Cache guarantees Rare+
      const r = Math.random();
      let forcedRarity = 'Rare' as any;
      if (r > 0.6) forcedRarity = 'Epic';
      if (r > 0.92) forcedRarity = 'Legendary';
      drops.push(inventory.generateAndAdd({ source: DropSource.CacheForged, level: player.level, forcedRarity }));
      if (Math.random() < 0.4) {
        drops.push(inventory.generateAndAdd({ source: DropSource.CacheForged, level: player.level, forcedRarity: Math.random() > 0.5 ? 'Rare' : 'Epic' }));
      }
      if (Math.random() < 0.15) {
        drops.push(inventory.generateAndAdd({ source: DropSource.CacheForged, level: player.level, forcedRarity: 'Epic' }));
      }
      setRevealed(drops);
      setOpening(false);
    }, 2000);
  };

  const close = () => setRevealed(null);

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="text-lg font-black text-text-primary">Data Cache</div>

      <div className="bg-surface-raised border border-border rounded-2xl p-6 text-center space-y-3">
        <div className="w-20 h-20 mx-auto rounded-full bg-amber/10 border-2 border-amber flex items-center justify-center">
          <Box size={36} className="text-amber" />
        </div>
        <div className="text-sm text-text-secondary">Cache Keys: <span className="text-amber font-bold text-lg">{player.cacheKeys}</span></div>
        <button
          onClick={handleOpen}
          disabled={player.cacheKeys <= 0 || opening}
          className="w-full py-3 rounded-xl bg-amber text-bg font-black text-sm uppercase tracking-wider disabled:opacity-40 active:scale-95 transition-transform"
        >
          {opening ? 'Decrypting...' : 'OPEN CACHE'}
        </button>
        <div className="flex items-center justify-center gap-1 text-[10px] text-text-muted">
          <Info size={10} />
          Guarantees Rare or better
        </div>
      </div>

      {/* Odds */}
      <div className="space-y-1">
        <div className="text-xs font-bold text-text-muted uppercase">Cache Odds</div>
        {Object.values(RARITIES).map((r) => (
          <div key={r.id} className="flex items-center justify-between text-xs">
            <span style={{ color: r.color }} className="font-bold">{r.name}</span>
            <span className="text-text-muted">
              {r.id === 'Common' ? '0%' : r.id === 'Uncommon' ? '0%' : r.id === 'Rare' ? '~55%' : r.id === 'Epic' ? '~35%' : '~10%'}
            </span>
          </div>
        ))}
      </div>

      {/* Opening Animation */}
      <AnimatePresence>
        {opening && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          >
            <motion.div
              animate={{ rotate: [0, -10, 10, -10, 0], scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 0.4 }}
              className="text-amber"
            >
              <Box size={80} />
            </motion.div>
            <div className="absolute bottom-20 text-amber font-bold text-sm animate-pulse">DECRYPTING CACHE...</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reveal */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.1 }}
              className="text-amber mb-4"
            >
              <Sparkles size={48} />
            </motion.div>
            <div className="text-xl font-black text-amber mb-4">CACHE DECRYPTED</div>
            <div className="w-full max-w-[480px] space-y-2 max-h-[60vh] overflow-y-auto">
              {revealed.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.15 }}
                >
                  <WeaponCard weapon={item} />
                </motion.div>
              ))}
            </div>
            <button
              onClick={close}
              className="mt-4 px-6 py-2 rounded-xl bg-amber text-bg font-bold text-sm"
            >
              Collect
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
