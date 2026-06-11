import { useBossStore } from '@/store/slices/bossSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore, type LoadoutSlot } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { RiskSetting } from '@/types/game';
import type { BossAttemptResult } from '@/types/boss';
import type { GearItem } from '@/types/items';
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

export function syncBossAttemptResult(result: {
  profile?: RuntimeProfilePayload;
  items?: GearItem[];
  result?: BossAttemptResult;
}): void {
  syncRuntimeProfile(result.profile);
  if (result.items?.length) useInventoryStore.getState().receiveServerItems(result.items);
  if (result.result) useBossStore.getState().addAttempt(result.result);
}
