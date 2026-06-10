/**
 * SlotGearPicker — modal bottom sheet for equipping a specific loadout slot.
 *
 * Filters the player's inventory to items compatible with the target slot:
 *   - primary / secondary / heavy → all weapons
 *   - shield → shields
 *   - classMod → class mods
 *   - relic → relics
 *   - ordnance → ordnance
 *
 * Shows the currently equipped item at the top (if any) with an unequip option.
 */
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useInventoryStore } from '@/store';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';
import type { GearItem } from '@/types/items';

const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

interface SlotGearPickerProps {
  slot: LoadoutSlot;
  currentItemId: string | null;
  onClose: () => void;
  onEquip: (itemId: string) => void;
  onUnequip: () => void;
}

function isSlotCompatible(item: GearItem, slot: LoadoutSlot): boolean {
  switch (slot) {
    case 'primary':
    case 'secondary':
    case 'heavy':
      return 'weaponType' in item;
    case 'shield':
      return 'hp' in item && !('weaponType' in item) && !('effect' in item);
    case 'classMod':
      return 'treeBonus' in item;
    case 'relic':
      return 'affixes' in item && !('weaponType' in item) && !('hp' in item) && !('treeBonus' in item) && !('effect' in item);
    case 'ordnance':
      return 'damage' in item && 'effect' in item;
    default:
      return false;
  }
}

const slotLabel: Record<LoadoutSlot, string> = {
  primary: 'Primary Weapon',
  secondary: 'Secondary Weapon',
  heavy: 'Heavy Weapon',
  shield: 'Shield',
  classMod: 'Class Mod',
  relic: 'Relic',
  ordnance: 'Ordnance',
};

const valueLabel = (item: GearItem): string => {
  if ('weaponType' in item) return `${item.combatPower} combat power`;
  if ('hp' in item) return `${item.hp} HP`;
  if ('treeBonus' in item) return `${item.treeBonus} tree`;
  if ('damage' in item && 'effect' in item) return `${item.damage} damage`;
  return '';
};

export const SlotGearPicker: React.FC<SlotGearPickerProps> = ({
  slot,
  currentItemId,
  onClose,
  onEquip,
  onUnequip,
}) => {
  const inventory = useInventoryStore();
  const allItems = inventory.items;

  const candidates = useMemo(
    () => allItems.filter((item) => isSlotCompatible(item, slot)),
    [allItems, slot],
  );

  const currentItem = useMemo(
    () => (currentItemId ? allItems.find((i) => i.id === currentItemId) ?? null : null),
    [allItems, currentItemId],
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end bg-black/70"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl border-t-2 border-border bg-bg p-4"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="bl-title text-2xl text-text-primary">{slotLabel[slot]}</div>
            <div className="text-[10px] text-text-muted">
              {candidates.length} compatible item{candidates.length !== 1 ? 's' : ''} in inventory
            </div>
          </div>
          <button type="button" onClick={onClose} className="bl-secondary p-2 text-text-muted">
            <ChevronDown size={16} />
          </button>
        </div>

        {/* Currently equipped */}
        {currentItem && (
          <div className="mb-3">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber mb-1">Currently Equipped</div>
            <div className="border-2 border-amber/50 bg-amber/5 p-3 flex items-center justify-between gap-2" style={signClip}>
              <div className="min-w-0">
                <div className="text-sm font-black text-text-primary truncate">{currentItem.name}</div>
                <div className="text-[10px] text-amber">{currentItem.rarity} · {valueLabel(currentItem)}</div>
              </div>
              <button
                type="button"
                onClick={onUnequip}
                className="bl-secondary px-2 py-1 text-[9px] font-black text-red shrink-0"
              >
                Unequip
              </button>
            </div>
          </div>
        )}

        {/* Candidate list */}
        {candidates.length === 0 ? (
          <div className="border border-border bg-bg/70 p-4 text-center text-xs text-text-muted">
            No compatible {slotLabel[slot].toLowerCase()} items in your inventory.
          </div>
        ) : (
          <div className="space-y-2">
            {candidates
              .filter((item) => item.id !== currentItemId)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onEquip(item.id)}
                  className="w-full border-2 border-border bg-surface p-3 text-left active:scale-[0.99] transition-transform"
                  style={signClip}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-text-primary truncate">{item.name}</div>
                      <div className="text-[10px] text-text-muted">
                        {item.rarity} · {valueLabel(item)}
                        {'weaponType' in item && <> · Level {item.level}</>}
                      </div>
                    </div>
                    <div className="bl-secondary px-2 py-1 text-[9px] font-black text-amber shrink-0">
                      Equip
                    </div>
                  </div>
                </button>
              ))}
          </div>
        )}

        {/* Safety padding for bottom */}
        <div className="h-4" />
      </motion.div>
    </motion.div>
  );
};
