import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore, type LoadoutSlot } from '@/store/slices/loadoutSlice';
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
    .not('runtime_state', 'in', '("salvaged","consumed")')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as ServerItemRow[];
  const items = rows.map(serverItemRowToDisplayGear);
  const slots: Partial<Record<LoadoutSlot, string | null>> = {};

  rows.forEach((row) => {
    const slot = toLoadoutSlot(row.equipped_slot);
    if (slot) slots[slot] = row.id;
  });

  useInventoryStore.getState().setItems(items);
  useLoadoutStore.getState().setSlots(slots);
}
