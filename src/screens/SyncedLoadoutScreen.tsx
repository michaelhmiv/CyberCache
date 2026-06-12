import React, { useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { useInventoryStore, useLoadoutStore } from '@/store';
import { GearCompare } from '@/components/gear/GearCompare';
import {
  buildLoadoutRows,
  LOADOUT_SLOT_ORDER,
  loadoutSlotAccepts,
  type LoadoutSlotRow,
} from '@/lib/loadout/loadoutReadModel';
import type { GearItem } from '@/types/items';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

function label(row: LoadoutSlotRow): string {
  if (row.status === 'missing-item') return 'Server slot points at an item missing from inventory sync';
  if (row.status === 'wrong-slot-type') return 'Server slot item does not match this slot type';
  if (!row.item) return 'Tap to equip';
  return `${row.item.name} · Lv.${row.item.level ?? 1} · ${row.item.rarity ?? 'Unknown'}`;
}

export const SyncedLoadoutScreen: React.FC = () => {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const [activeSlot, setActiveSlot] = useState<LoadoutSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => buildLoadoutRows(loadout.slots, inventory.items), [loadout.slots, inventory.items]);
  const rowBySlot = useMemo(() => new Map(rows.map((row) => [row.slot, row])), [rows]);

  const candidates = useMemo(() => {
    if (!activeSlot) return [];
    return inventory.items.filter((item) => loadoutSlotAccepts(activeSlot, item));
  }, [activeSlot, inventory.items]);

  const activeRow = activeSlot ? rowBySlot.get(activeSlot) : undefined;

  const equip = async (slot: LoadoutSlot, itemId: string) => {
    setBusy(true);
    setError(null);
    try {
      await verifiedOps.equipItem(itemId, slot);
      setActiveSlot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update loadout.');
    } finally {
      setBusy(false);
    }
  };

  const clearSlot = async (slot: LoadoutSlot) => {
    setBusy(true);
    setError(null);
    try {
      await verifiedOps.unequipSlot(slot);
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
        <div className="text-xs text-text-muted">Every slot below is derived from the shared frontend loadout read model and saved through Supabase RPCs.</div>
      </div>
      {error && <div className="rounded-xl border border-red/30 bg-red/10 p-3 text-xs text-red-light">{error}</div>}
      <div className="space-y-2">
        {LOADOUT_SLOT_ORDER.map((slot) => {
          const row = rowBySlot.get(slot)!;
          const broken = row.status === 'missing-item' || row.status === 'wrong-slot-type';
          return (
            <MobileCard key={slot} onClick={() => setActiveSlot(slot)} className={`flex items-center gap-3 cursor-pointer ${broken ? 'border-red/40 bg-red/5' : ''}`}>
              <div className="w-10 h-10 rounded-lg bg-surface-raised border border-dashed border-border flex items-center justify-center"><Plus size={16} className={broken ? 'text-red' : 'text-text-muted'} /></div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-black text-text-primary">{row.label}</div>
                <div className={`text-[10px] truncate ${broken ? 'text-red-light' : 'text-text-muted'}`}>{label(row)}</div>
              </div>
              <ChevronRight size={14} className="text-text-muted" />
            </MobileCard>
          );
        })}
      </div>
      {activeSlot && activeRow && (
        <div className="fixed inset-x-0 bottom-0 z-50 bg-surface rounded-t-2xl border-t border-border p-4 max-h-[70vh] overflow-y-auto" style={{ maxWidth: 480, margin: '0 auto' }}>
          <div className="flex items-center justify-between mb-3"><div className="text-sm font-bold text-text-primary">{activeRow.label}</div><button onClick={() => setActiveSlot(null)} className="text-xs text-text-muted">Close</button></div>
          <div className="space-y-2">
            {candidates
              .filter((item) => item.id !== activeRow.itemId)
              .map((item) => {
                const fullItem = inventory.getById(item.id) as GearItem | undefined;
                const fullEquipped = activeRow.item ? (inventory.getById(activeRow.item.id) as GearItem | undefined) : undefined;
                return (
                  <button
                    key={item.id}
                    disabled={busy}
                    onClick={() => equip(activeSlot, item.id)}
                    className="w-full text-left rounded-xl border border-border bg-surface-raised p-3 disabled:opacity-50"
                  >
                    <div className="text-xs font-black text-text-primary">{item.name}</div>
                    <div className="text-[10px] text-text-muted">{item.rarity} · Lv.{item.level}</div>
                    {fullItem && fullEquipped && (
                      <GearCompare current={fullEquipped} candidate={fullItem} compact />
                    )}
                  </button>
                );
              })}
          </div>
          <button disabled={busy} onClick={() => clearSlot(activeSlot)} className="w-full mt-3 py-2 rounded-lg bg-red/10 text-red text-xs font-bold border border-red/30 disabled:opacity-50">Clear Slot</button>
        </div>
      )}
    </div>
  );
};
