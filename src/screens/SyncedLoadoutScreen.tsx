import React, { useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { useInventoryStore, useLoadoutStore } from '@/store';

const slots = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'heavy', label: 'Heavy' },
  { key: 'ordnance', label: 'Ordnance' },
  { key: 'shield', label: 'Shield' },
  { key: 'classMod', label: 'Class Mod' },
  { key: 'relic', label: 'Relic' },
] as const;

type SlotKey = (typeof slots)[number]['key'];

type AnyGear = { id: string; name?: string; level?: number; rarity?: string; weaponType?: string; hp?: number; treeBonus?: string; damage?: number; effect?: string; affixes?: unknown[] };

function accepts(slot: SlotKey, item: AnyGear): boolean {
  if (slot === 'primary' || slot === 'secondary' || slot === 'heavy') return 'weaponType' in item;
  if (slot === 'shield') return 'hp' in item && !('weaponType' in item);
  if (slot === 'classMod') return 'treeBonus' in item;
  if (slot === 'ordnance') return 'damage' in item && 'effect' in item && !('weaponType' in item);
  return 'affixes' in item && !('weaponType' in item) && !('hp' in item) && !('treeBonus' in item) && !('damage' in item);
}

function label(item: AnyGear): string {
  return `${item.name ?? 'Gear'} · Lv.${item.level ?? 1} · ${item.rarity ?? 'Unknown'}`;
}

export const SyncedLoadoutScreen: React.FC = () => {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    if (!activeSlot) return [];
    return (inventory.items as AnyGear[]).filter((item) => accepts(activeSlot, item));
  }, [activeSlot, inventory.items]);

  const equipped = (slot: SlotKey) => {
    const id = loadout.slots[slot];
    return id ? (inventory.getById(id) as AnyGear | undefined) : undefined;
  };

  const equip = async (slot: SlotKey, itemId: string) => {
    setBusy(true);
    setError(null);
    try {
      await verifiedOps.equipItem(itemId, slot);
      loadout.setSlot(slot, itemId);
      setActiveSlot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update loadout.');
    } finally {
      setBusy(false);
    }
  };

  const clearSlot = async (slot: SlotKey) => {
    setBusy(true);
    setError(null);
    try {
      await verifiedOps.unequipSlot(slot);
      loadout.setSlot(slot, null);
      setActiveSlot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to clear slot.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-4 pb-20">
      <div>
        <div className="text-lg font-black text-text-primary">Loadout</div>
        <div className="text-xs text-text-muted">Equipped items are saved to Supabase.</div>
      </div>
      {error && <div className="rounded-xl border border-red/30 bg-red/10 p-3 text-xs text-red-light">{error}</div>}
      <div className="space-y-2">
        {slots.map((slot) => {
          const item = equipped(slot.key);
          return (
            <MobileCard key={slot.key} onClick={() => setActiveSlot(slot.key)} className="flex items-center gap-3 cursor-pointer">
              <div className="w-10 h-10 rounded-lg bg-surface-raised border border-dashed border-border flex items-center justify-center"><Plus size={16} className="text-text-muted" /></div>
              <div className="flex-1 min-w-0"><div className="text-xs font-black text-text-primary">{slot.label}</div><div className="text-[10px] text-text-muted truncate">{item ? label(item) : 'Tap to equip'}</div></div>
              <ChevronRight size={14} className="text-text-muted" />
            </MobileCard>
          );
        })}
      </div>
      {activeSlot && (
        <div className="fixed inset-x-0 bottom-0 z-50 bg-surface rounded-t-2xl border-t border-border p-4 max-h-[70vh] overflow-y-auto" style={{ maxWidth: 480, margin: '0 auto' }}>
          <div className="flex items-center justify-between mb-3"><div className="text-sm font-bold text-text-primary">{slots.find((slot) => slot.key === activeSlot)?.label}</div><button onClick={() => setActiveSlot(null)} className="text-xs text-text-muted">Close</button></div>
          <div className="space-y-2">{candidates.map((item) => <button key={item.id} disabled={busy} onClick={() => equip(activeSlot, item.id)} className="w-full text-left rounded-xl border border-border bg-surface-raised p-3 text-xs text-text-primary disabled:opacity-50">{label(item)}</button>)}</div>
          <button disabled={busy} onClick={() => clearSlot(activeSlot)} className="w-full mt-3 py-2 rounded-lg bg-red/10 text-red text-xs font-bold border border-red/30 disabled:opacity-50">Clear Slot</button>
        </div>
      )}
    </div>
  );
};
