import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Plus } from 'lucide-react';
import { useInventoryStore, useLoadoutStore } from '@/store';
import { Weapon } from '@/types/items';
import { WeaponCanvas } from '@/components/pixelArt/WeaponCanvas';
import { WeaponCard } from '@/components/common/WeaponCard';
import { MobileCard } from '@/components/layout/MobileCard';

const SLOTS = [
  { key: 'primary', label: 'Primary Weapon', desc: 'Main combat weapon' },
  { key: 'secondary', label: 'Secondary Weapon', desc: 'Support / passive stats' },
  { key: 'heavy', label: 'Heavy Weapon', desc: 'Burst / phase break' },
  { key: 'ordnance', label: 'Ordnance', desc: 'Grenades / deployables' },
  { key: 'shield', label: 'Shield', desc: 'Survivability' },
  { key: 'classMod', label: 'Class Mod', desc: 'Skill tree boost' },
  { key: 'relic', label: 'Relic', desc: 'Global modifiers' },
] as const;

export const LoadoutScreen: React.FC = () => {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const [activeSlot, setActiveSlot] = useState<string | null>(null);

  const weapons = inventory.getWeapons();

  const getEquippedName = (slot: string) => {
    const id = loadout.slots[slot as keyof typeof loadout.slots];
    if (!id) return null;
    const item = inventory.getById(id);
    return item ? (item as Weapon).name : 'Unknown';
  };

  const equipItem = (itemId: string) => {
    if (activeSlot) {
      loadout.setSlot(activeSlot as any, itemId);
      setActiveSlot(null);
    }
  };

  const unequip = (slot: string) => {
    loadout.setSlot(slot as any, null);
  };

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="text-lg font-black text-text-primary">Loadout</div>
      <div className="text-xs text-text-muted">Tap a slot to equip gear from your cache.</div>

      <div className="space-y-2">
        {SLOTS.map((slot) => {
          const equippedId = loadout.slots[slot.key as keyof typeof loadout.slots];
          const equippedItem = equippedId ? inventory.getById(equippedId) as Weapon | undefined : undefined;
          return (
            <MobileCard
              key={slot.key}
              onClick={() => setActiveSlot(slot.key)}
              className="flex items-center gap-3 cursor-pointer"
            >
              {equippedItem ? (
                <WeaponCanvas
                  type={equippedItem.weaponType}
                  manufacturer={equippedItem.manufacturer}
                  element={equippedItem.element}
                  rarity={equippedItem.rarity}
                  size={48}
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-surface-raised border border-dashed border-border flex items-center justify-center">
                  <Plus size={20} className="text-text-muted" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-text-primary">{slot.label}</div>
                <div className="text-[10px] text-text-muted">{equippedItem ? equippedItem.name : slot.desc}</div>
              </div>
              <ChevronRight size={16} className="text-text-muted" />
            </MobileCard>
          );
        })}
      </div>

      {/* Equip Drawer */}
      <AnimatePresence>
        {activeSlot && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 bg-surface rounded-t-2xl border-t border-border p-4 max-h-[70vh] overflow-y-auto"
            style={{ maxWidth: 480, margin: '0 auto' }}
          >
            <div className="w-12 h-1.5 bg-border rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-text-primary">Equip {SLOTS.find((s) => s.key === activeSlot)?.label}</div>
              <button onClick={() => setActiveSlot(null)} className="text-xs text-text-muted">Close</button>
            </div>
            <div className="space-y-2">
              {weapons
                .filter((w) => {
                  if (activeSlot === 'primary' || activeSlot === 'secondary') return true;
                  if (activeSlot === 'heavy') return w.weaponType === 'Launcher' || w.weaponType === 'Shotgun';
                  return false; // simplified for MVP
                })
                .map((w) => (
                  <WeaponCard key={w.id} weapon={w} onClick={() => equipItem(w.id)} />
                ))}
            </div>
            <button
              onClick={() => unequip(activeSlot)}
              className="w-full mt-3 py-2 rounded-lg bg-red/10 text-red text-xs font-bold border border-red/30"
            >
              Unequip Slot
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
