/**
 * Runtime item sync (Route B, slice B4) — transport swap onto the
 * Chef read route (own item_instances, salvaged/consumed/listed
 * excluded server-side, newest first — the same set the PostgREST
 * query produced). Signature unchanged; the userId argument is
 * retained for call-site compatibility (identity is the Chef JWT).
 */
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { emptySlots, useLoadoutStore, type LoadoutSlot } from '@/store/slices/loadoutSlice';
import type { GearItem } from '@/types/items';
import { apiRequest } from './http';
import { serverItemRowToDisplayGear, type ServerItemRow } from './serverItemAdapter';

const validSlots = new Set<LoadoutSlot>(['primary', 'secondary', 'heavy', 'ordnance', 'shield', 'classMod', 'relic']);

function toLoadoutSlot(value: string | null | undefined): LoadoutSlot | null {
  if (!value) return null;
  return validSlots.has(value as LoadoutSlot) ? (value as LoadoutSlot) : null;
}

export async function syncRuntimeItemsForUser(_userId: string): Promise<void> {
  let rows: ServerItemRow[];
  try {
    rows = (await apiRequest<ServerItemRow[]>('/runtime/items')) ?? [];
  } catch (error) {
    console.warn('Runtime item sync skipped:', error instanceof Error ? error.message : error);
    return;
  }

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

  // The server is the authoritative loadout source. Clear any local slot that the
  // server did not return; otherwise stale local slots can make Action/Loadout
  // tabs disagree after refreshes, equipment moves, or item salvage.
  useLoadoutStore.getState().setSlots({ ...emptySlots, ...serverSlots });
}
