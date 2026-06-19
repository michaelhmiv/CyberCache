import { useInventoryStore } from '@/store/slices/inventorySlice';
import { emptySlots, useLoadoutStore, type LoadoutSlot } from '@/store/slices/loadoutSlice';
import type { GearItem } from '@/types/items';
import { supabase } from './client';
import { serverItemRowToDisplayGear, type ServerItemRow } from './serverItemAdapter';

const validSlots = new Set<LoadoutSlot>(['primary', 'secondary', 'heavy', 'ordnance', 'shield', 'classMod', 'relic']);

function toLoadoutSlot(value: string | null | undefined): LoadoutSlot | null {
  if (!value) return null;
  return validSlots.has(value as LoadoutSlot) ? (value as LoadoutSlot) : null;
}

export async function syncRuntimeItemsForUser(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('item_instances')
    .select('id,item_level,rarity,is_locked,runtime_state,equipped_slot,payload,created_at')
    .eq('owner_user_id', userId)
    .neq('runtime_state', 'salvaged')
    .neq('runtime_state', 'consumed')
    .neq('runtime_state', 'listed')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Runtime item sync skipped:', error.message);
    return;
  }

  const rows = (data ?? []) as ServerItemRow[];
  const serverItems = rows.map(serverItemRowToDisplayGear).filter((item): item is GearItem => item !== null);
  const serverSlots: Partial<Record<LoadoutSlot, string | null>> = {};

  rows.forEach((row) => {
    const slot = toLoadoutSlot(row.equipped_slot);
    if (slot) serverSlots[slot] = row.id;
  });

  // item_instances is the ownership ledger. Do not preserve local-only items
  // across authenticated hydration; generated items must arrive through Chef/RPC
  // persistence before becoming inventory truth.
  useInventoryStore.getState().setItems(serverItems);

  // Supabase is the authoritative loadout source. Clear any local slot that the
  // server did not return; otherwise stale local slots can make Action/Loadout
  // tabs disagree after refreshes, equipment moves, or item salvage.
  useLoadoutStore.getState().setSlots({ ...emptySlots, ...serverSlots });
}
