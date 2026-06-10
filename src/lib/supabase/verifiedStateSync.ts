import { useBossStore } from '@/store/slices/bossSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore, type LoadoutSlot } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { RiskSetting } from '@/types/game';
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
  skill_spends?: Record<string, number>;
  boss_state?: Record<string, unknown>;
  last_idle_claim_at?: string;
};

const validSlots = new Set<LoadoutSlot>(['primary', 'secondary', 'heavy', 'ordnance', 'shield', 'classMod', 'relic']);

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

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
}

function toLoadoutSlot(value: string | null | undefined): LoadoutSlot | null {
  if (!value) return null;
  return validSlots.has(value as LoadoutSlot) ? (value as LoadoutSlot) : null;
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
    materials: profile.materials ?? player.materials,
    essences: profile.essences ?? player.essences,
    consumables: profile.consumables ?? player.consumables,
    lastClaimTime: timestampValue(profile.last_idle_claim_at, player.lastClaimTime),
  });

  const skillSpends = recordValue(profile.skill_spends);
  if (skillSpends) useSkillStore.setState({ spent: skillSpends });

  const bossState = profile.boss_state;
  if (bossState && typeof bossState === 'object' && !Array.isArray(bossState)) {
    const raw = bossState as Record<string, unknown>;
    useBossStore.setState((state) => ({
      currentBossId: typeof raw.currentBossId === 'string' ? raw.currentBossId : state.currentBossId,
      unlockedBossIds: stringArrayValue(raw.unlockedBossIds) ?? state.unlockedBossIds,
      defeatedBossIds: stringArrayValue(raw.defeatedBossIds) ?? state.defeatedBossIds,
      pityCounters: recordValue(raw.pityCounters) ?? state.pityCounters,
      selectedRisk: typeof raw.selectedRisk === 'string' ? (raw.selectedRisk as RiskSetting) : state.selectedRisk,
    }));
  }
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
