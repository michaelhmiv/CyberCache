import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore, type LoadoutSlot } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { serverItemRowToDisplayGear, type ServerItemRow } from './serverItemAdapter';

export type RuntimeProfilePayload = {
  id?: string;
  player_level?: number | string;
  player_xp?: number | string;
  credits?: number | string;
  scrap?: number | string;
  cache_tokens?: number | string;
  cache_token_parts?: number | string;
  materials?: Record<string, number>;
  essences?: Record<string, number>;
  consumables?: Record<string, number>;
};

const validSlots = new Set<LoadoutSlot>(['primary', 'secondary', 'heavy', 'ordnance', 'shield', 'classMod', 'relic']);

function numberValue(value: number | string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toLoadoutSlot(value: string | null | undefined): LoadoutSlot | null {
  if (!value) return null;
  return validSlots.has(value as LoadoutSlot) ? (value as LoadoutSlot) : null;
}

export function syncRuntimeProfile(profile: RuntimeProfilePayload | undefined): void {
  if (!profile) return;

  usePlayerStore.getState().setPlayer({
    id: profile.id ?? usePlayerStore.getState().id,
    level: numberValue(profile.player_level, usePlayerStore.getState().level),
    xp: numberValue(profile.player_xp, usePlayerStore.getState().xp),
    credits: numberValue(profile.credits, usePlayerStore.getState().credits),
    scrap: numberValue(profile.scrap, usePlayerStore.getState().scrap),
    cacheKeys: numberValue(profile.cache_tokens, usePlayerStore.getState().cacheKeys),
    cacheKeyFragments: numberValue(profile.cache_token_parts, usePlayerStore.getState().cacheKeyFragments),
    materials: profile.materials ?? usePlayerStore.getState().materials,
    essences: profile.essences ?? usePlayerStore.getState().essences,
    consumables: profile.consumables ?? usePlayerStore.getState().consumables,
  });
}

function syncRuntimeItem(row: ServerItemRow | undefined): void {
  if (!row?.id) return;
  if (row.runtime_state === 'salvaged' || row.runtime_state === 'consumed') {
    useInventoryStore.getState().removeItem(row.id);
    return;
  }
  useInventoryStore.getState().upsertItem(serverItemRowToDisplayGear(row));
  const slot = toLoadoutSlot(row.equipped_slot);
  if (slot) useLoadoutStore.getState().setSlot(slot, row.id);
}

export function syncVerifiedResult(result: Record<string, unknown>): void {
  syncRuntimeProfile(result.profile as RuntimeProfilePayload | undefined);
  syncRuntimeItem(result.item as ServerItemRow | undefined);
  const clearedSlot = toLoadoutSlot(result.slot_name as string | undefined);
  if (clearedSlot && result.action_type === 'cc_unequip_slot') {
    useLoadoutStore.getState().setSlot(clearedSlot, null);
  }
}
