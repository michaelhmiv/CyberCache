import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Lock, Unlock, ShoppingBag } from 'lucide-react';
import { useInventoryStore, usePlayerStore } from '@/store';
import { WeaponCard } from '@/components/common/WeaponCard';
import { Weapon } from '@/types/items';
import { Rarity } from '@/types/game';

const FILTERS = ['All', 'New', 'Legendary', 'Tradeable', 'Scrap'] as const;
type Filter = (typeof FILTERS)[number];

export const LootScreen: React.FC = () => {
  const inventory = useInventoryStore();
  const player = usePlayerStore();
  const [filter, setFilter] = useState<Filter>('All');
  const [selected, setSelected] = useState<Weapon | null>(null);

  const weapons = inventory.getWeapons();
  const filtered = weapons.filter((w) => {
    if (filter === 'Legendary') return w.rarity === Rarity.Legendary;
    if (filter === 'Tradeable') return !w.isLocked;
    if (filter === 'Scrap') return w.rarity === Rarity.Common || w.rarity === Rarity.Uncommon;
    return true;
  });

  const handleScrap = (id: string) => {
    const { scrapValue } = inventory.scrapItem(id);
    player.addScrap(scrapValue);
    setSelected(null);
  };

  const toggleLock = (id: string, locked: boolean) => {
    if (locked) inventory.unlockItem(id);
    else inventory.lockItem(id);
  };

  return (
    <div className="p-4 space-y-3">
      <div className="text-lg font-bold text-text-primary">Cache Inventory</div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
              filter === f ? 'bg-amber text-bg' : 'bg-surface-raised text-text-secondary border border-border'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Count */}
      <div className="text-[10px] text-text-muted font-medium">{filtered.length} items</div>

      {/* Grid */}
      <div className="space-y-2">
        <AnimatePresence>
          {filtered.map((w) => (
            <WeaponCard key={w.id} weapon={w} onClick={() => setSelected(w)} />
          ))}
        </AnimatePresence>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-surface w-full max-w-[480px] rounded-t-2xl p-4 space-y-4 border-t border-border max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-1.5 bg-border rounded-full mx-auto" />

              <WeaponCard weapon={selected} />

              <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
                <div>Base Dmg: <span className="text-text-primary font-bold">{selected.baseDamage}</span></div>
                <div>Attack Speed: <span className="text-text-primary font-bold">{selected.attackSpeed.toFixed(2)}</span></div>
                <div>Crit Chance: <span className="text-text-primary font-bold">{(selected.critChance * 100).toFixed(1)}%</span></div>
                <div>Crit Dmg: <span className="text-text-primary font-bold">{(selected.critDamage * 100).toFixed(0)}%</span></div>
                <div>Status Chance: <span className="text-text-primary font-bold">{(selected.statusChance * 100).toFixed(1)}%</span></div>
                <div>Boss Dmg: <span className="text-text-primary font-bold">{(selected.bossDamageMod * 100).toFixed(0)}%</span></div>
                <div>Shield Dmg: <span className="text-text-primary font-bold">{(selected.shieldDamageMod * 100).toFixed(0)}%</span></div>
                <div>Armor Dmg: <span className="text-text-primary font-bold">{(selected.armorDamageMod * 100).toFixed(0)}%</span></div>
              </div>

              {selected.affixes.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase font-bold text-text-muted">Affixes</div>
                  {selected.affixes.map((a) => (
                    <div key={a.id} className="text-xs text-amber">{a.displayText}</div>
                  ))}
                </div>
              )}

              {selected.legendaryEffectId && (
                <div className="bg-amber/10 border border-amber/30 rounded-lg p-2">
                  <div className="text-[10px] uppercase font-bold text-amber">Legendary Effect</div>
                  <div className="text-xs text-text-primary mt-0.5">{selected.legendaryEffectId}</div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 pt-2">
                <button
                  onClick={() => toggleLock(selected.id, selected.isLocked)}
                  className="flex flex-col items-center gap-1 py-2 rounded-lg bg-surface-raised border border-border active:scale-95 transition-transform"
                >
                  {selected.isLocked ? <Unlock size={16} /> : <Lock size={16} />}
                  <span className="text-[10px] font-bold">{selected.isLocked ? 'Unlock' : 'Lock'}</span>
                </button>
                <button
                  onClick={() => handleScrap(selected.id)}
                  className="flex flex-col items-center gap-1 py-2 rounded-lg bg-red/10 border border-red/30 text-red active:scale-95 transition-transform"
                >
                  <Trash2 size={16} />
                  <span className="text-[10px] font-bold">Scrap</span>
                </button>
                <button className="flex flex-col items-center gap-1 py-2 rounded-lg bg-green/10 border border-green/30 text-green active:scale-95 transition-transform">
                  <ShoppingBag size={16} />
                  <span className="text-[10px] font-bold">List</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
