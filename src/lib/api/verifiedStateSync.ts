import { useBossStore } from '@/store/slices/bossSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { emptySlots, useLoadoutStore, type LoadoutSlot } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { RiskSetting } from '@/types/game';
import type { BossAttemptResult } from '@/types/boss';
import type { GearItem } from '@/types/items';
import type { ConsumableBatch } from '@/types/player';
import { isVehicleRow, serverItemRowToDisplayGear, serverItemRowToVehicle, type ServerItemRow } from './serverItemAdapter';

export type RuntimeProfilePayload = {
  id?: string;
  player_level?: number | string;
  player_xp?: number | string;
  credits?: number | string;
  scrap?: number | string;
  cache_tokens?: number | string;
  cache_token_parts?: number | string;
  /** Legendary core balance (0026). */
  legendary_cores?: number | string;
  materials?: Record<string, number>;
  essences?: Record<string, number>;
  consumables?: Record<string, number>;
  consumable_batches?: ConsumableBatch[];
  /** Vehicle tank in fuel units (0021). */
  vehicle_fuel?: number | string;
  skill_spends?: Record<string, number>;
  boss_state?: Record<string, unknown>;
  /** Server-computed rematch-escalation state (UTC-day victory counts). */
  boss_victories_today?: Record<string, number>;
  last_idle_claim_at?: string;
  last_claimed_tick?: number | string;
  last_roaming_settled_at?: string;
  last_settlement_nonce?: string;
};

export type LoadoutSnapshotPayload = Partial<Record<LoadoutSlot, string | null>>;

const validSlots = new Set<LoadoutSlot>(['primary', 'secondary', 'heavy', 'ordnance', 'shield', 'classMod', 'relic', 'vehicle']);

function numberValue(value: number | string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timestampValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recordValue(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, number> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(parsed)) result[key] = parsed;
  });
  return result;
}

function consumableBatchArrayValue(value: unknown): ConsumableBatch[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const raw = entry as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const consumableType = typeof raw.consumable_type === 'string' ? raw.consumable_type : '';
    const quality = Number(raw.quality_percent);
    const quantity = Number(raw.quantity);
    const origin = typeof raw.origin === 'string' ? raw.origin : 'vendor';
    if (!id || !consumableType || !Number.isFinite(quality) || !Number.isFinite(quantity)) return [];
    return [{
      id,
      consumable_type: consumableType,
      quality_percent: quality,
      quantity,
      origin: origin === 'crafted' || origin === 'market' || origin === 'reward' ? origin : 'vendor',
      creator_user_id: typeof raw.creator_user_id === 'string' ? raw.creator_user_id : null,
      source_recipe_id: typeof raw.source_recipe_id === 'string' ? raw.source_recipe_id : null,
      metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata as Record<string, unknown> : {},
      created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
      updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
    } satisfies ConsumableBatch];
  });
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
}

function legacyBossIds(raw: Record<string, unknown>, prefix: string): string[] {
  return Object.entries(raw)
    .filter(([key, value]) => key.startsWith(prefix) && value === true)
    .map(([key]) => key.slice(prefix.length));
}

function legacyPityCounters(raw: Record<string, unknown>): Record<string, number> {
  return Object.entries(raw).reduce<Record<string, number>>((result, [key, value]) => {
    if (!key.startsWith('pity_')) return result;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) result[key.slice('pity_'.length)] = parsed;
    return result;
  }, {});
}

function toLoadoutSlot(value: string | null | undefined): LoadoutSlot | null {
  if (!value) return null;
  return validSlots.has(value as LoadoutSlot) ? (value as LoadoutSlot) : null;
}

function loadoutSnapshotValue(value: unknown): LoadoutSnapshotPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const result: LoadoutSnapshotPayload = {};
  Object.entries(value as Record<string, unknown>).forEach(([rawSlot, rawItemId]) => {
    const slot = toLoadoutSlot(rawSlot);
    if (!slot) return;
    result[slot] = typeof rawItemId === 'string' && rawItemId.length > 0 ? rawItemId : null;
  });

  return result;
}

function syncLoadoutSnapshot(value: unknown): void {
  const snapshot = loadoutSnapshotValue(value);
  if (!snapshot) return;
  useLoadoutStore.getState().setSlots({ ...emptySlots, ...snapshot });
}

function clearItemFromLoadout(itemId: string): void {
  const loadout = useLoadoutStore.getState();
  const slotsToClear = Object.entries(loadout.slots)
    .filter(([, equippedId]) => equippedId === itemId)
    .map(([slot]) => slot as LoadoutSlot);

  slotsToClear.forEach((slot) => loadout.setSlot(slot, null));
}

export function syncRuntimeProfile(profile: RuntimeProfilePayload | undefined): void {
  if (!profile) return;

  const player = usePlayerStore.getState();
  usePlayerStore.getState().syncFromServer({
    id: profile.id ?? player.id,
    level: numberValue(profile.player_level, player.level),
    xp: numberValue(profile.player_xp, player.xp),
    credits: numberValue(profile.credits, player.credits),
    scrap: numberValue(profile.scrap, player.scrap),
    cacheKeys: numberValue(profile.cache_tokens, player.cacheKeys),
    cacheKeyFragments: numberValue(profile.cache_token_parts, player.cacheKeyFragments),
    legendaryCores: numberValue(profile.legendary_cores, player.legendaryCores),
    materials: profile.materials ?? player.materials,
    essences: profile.essences ?? player.essences,
    consumables: profile.consumables ?? player.consumables,
    consumableBatches: consumableBatchArrayValue(profile.consumable_batches) ?? player.consumableBatches,
    vehicleFuel: numberValue(profile.vehicle_fuel, player.vehicleFuel),
    lastClaimTime: timestampValue(profile.last_idle_claim_at, player.lastClaimTime),
    lastClaimedTick: numberValue(profile.last_claimed_tick, player.lastClaimedTick),
  });

  const skillSpends = recordValue(profile.skill_spends);
  if (skillSpends) useSkillStore.setState({ spent: skillSpends });

  const victoriesToday = recordValue(profile.boss_victories_today);
  if (victoriesToday) useBossStore.setState({ bossVictoriesToday: victoriesToday });

  const bossState = profile.boss_state;
  if (bossState && typeof bossState === 'object' && !Array.isArray(bossState)) {
    const raw = bossState as Record<string, unknown>;
    const legacyDefeated = legacyBossIds(raw, 'defeated_');
    const legacyPity = legacyPityCounters(raw);
    useBossStore.setState((state) => ({
      currentBossId: typeof raw.currentBossId === 'string' ? raw.currentBossId : state.currentBossId,
      unlockedBossIds: stringArrayValue(raw.unlockedBossIds) ?? state.unlockedBossIds,
      defeatedBossIds: stringArrayValue(raw.defeatedBossIds) ?? (legacyDefeated.length ? legacyDefeated : state.defeatedBossIds),
      pityCounters: recordValue(raw.pityCounters) ?? (Object.keys(legacyPity).length ? legacyPity : state.pityCounters),
      selectedRisk: typeof raw.selectedRisk === 'string' ? (raw.selectedRisk as RiskSetting) : state.selectedRisk,
    }));
  }
}

function syncRuntimeItem(row: ServerItemRow | undefined): void {
  if (!row?.id) return;
  // Vehicles (0021) route to the vehicle store — never the gear
  // inventory — with the same listed/gone handling.
  if (isVehicleRow(row)) {
    if (row.runtime_state === 'salvaged' || row.runtime_state === 'consumed' || row.runtime_state === 'listed') {
      useVehicleStore.getState().removeVehicle(row.id);
      clearItemFromLoadout(row.id);
      return;
    }
    const vehicle = serverItemRowToVehicle(row);
    if (!vehicle) {
      useVehicleStore.getState().removeVehicle(row.id);
      clearItemFromLoadout(row.id);
      return;
    }
    useVehicleStore.getState().upsertVehicle(vehicle);
    const slot = toLoadoutSlot(row.equipped_slot);
    if (slot) {
      clearItemFromLoadout(row.id);
      useLoadoutStore.getState().setSlot(slot, row.id);
      return;
    }
    clearItemFromLoadout(row.id);
    return;
  }
  if (row.runtime_state === 'salvaged' || row.runtime_state === 'consumed' || row.runtime_state === 'listed') {
    useInventoryStore.getState().removeItem(row.id);
    clearItemFromLoadout(row.id);
    return;
  }

  const item = serverItemRowToDisplayGear(row);
  if (!item) {
    useInventoryStore.getState().removeItem(row.id);
    clearItemFromLoadout(row.id);
    return;
  }

  useInventoryStore.getState().upsertItem(item);
  const slot = toLoadoutSlot(row.equipped_slot);
  if (slot) {
    clearItemFromLoadout(row.id);
    useLoadoutStore.getState().setSlot(slot, row.id);
    return;
  }

  clearItemFromLoadout(row.id);
}

function syncRuntimeItems(rows: unknown): void {
  if (!Array.isArray(rows)) return;
  rows.forEach((row) => syncRuntimeItem(row as ServerItemRow));
}

export function syncVerifiedResult(result: Record<string, unknown>): void {
  syncRuntimeProfile(result.profile as RuntimeProfilePayload | undefined);
  syncRuntimeItems(result.items);
  syncRuntimeItem(result.item as ServerItemRow | undefined);

  // Backward-compatible support for older cc_unequip_slot payloads that predate
  // the authoritative loadout snapshot contract.
  const clearedSlot = toLoadoutSlot(result.slot_name as string | undefined);
  if (clearedSlot && result.action_type === 'cc_unequip_slot') {
    useLoadoutStore.getState().setSlot(clearedSlot, null);
  }

  // Apply the server's final loadout snapshot last so any slot clears caused by
  // item movement, salvage, or replacement override local optimistic state.
  syncLoadoutSnapshot(result.loadout);
}

/**
 * Endless results (0028): the canonical profile snapshot plus any
 * milestone gear the Chef awarded (already stored server-side; the
 * client upserts the display copies). Escrow/run state itself is NOT
 * mirrored into a client store — the panel re-reads it from
 * GET /api/endless/me, keeping server facts the single source.
 */
export function syncEndlessResult(result: {
  profile?: RuntimeProfilePayload;
  items?: GearItem[];
}): void {
  syncRuntimeProfile(result.profile);
  if (result.items?.length) result.items.forEach((item) => useInventoryStore.getState().upsertItem(item));
}

export function syncBossAttemptResult(result: {
  profile?: RuntimeProfilePayload;
  items?: GearItem[];
  result?: BossAttemptResult;
  /** Post-attempt UTC-day victory count for the attempted boss. */
  bossVictoriesToday?: number;
}): void {
  syncRuntimeProfile(result.profile);
  if (result.items?.length) result.items.forEach((item) => useInventoryStore.getState().upsertItem(item));
  if (result.result) useBossStore.getState().addAttempt(result.result);
  const bossId = result.result?.bossId;
  const victories = result.bossVictoriesToday;
  if (bossId && typeof victories === 'number' && Number.isFinite(victories)) {
    useBossStore.setState((state) => ({
      bossVictoriesToday: { ...state.bossVictoriesToday, [bossId]: Math.max(0, Math.trunc(victories)) },
    }));
  }
}
