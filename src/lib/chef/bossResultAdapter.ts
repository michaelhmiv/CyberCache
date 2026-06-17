import { CONSUMABLES } from '@/constants/consumables';
import { ConsumableType } from '@/types/game';
import {
  CONSUMABLE_ACTIVATORS,
  getConsumableDisplayState,
  getConsumableMechanicKind,
  getConsumableVisualTtl,
  resolveConsumableDuration,
  type ActiveBuff,
} from '@/lib/buffs/activeBuffs';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { useTickFeedStore, type TickEvent } from '@/store/slices/tickSlice';

export interface BossConsumableDisplayInput {
  attemptId: string;
  consumedConsumables: Record<string, number>;
  now?: number;
  qualityPercent?: number;
  source?: ActiveBuff['source'];
}

const isConsumableType = (id: string): id is ConsumableType => id in CONSUMABLE_ACTIVATORS;

export function buildConsumableDisplayRows({
  attemptId,
  consumedConsumables,
  now = Date.now(),
  qualityPercent,
  source,
}: BossConsumableDisplayInput): ActiveBuff[] {
  const rows: ActiveBuff[] = [];
  for (const [id, count] of Object.entries(consumedConsumables)) {
    if (!isConsumableType(id) || count <= 0) continue;
    const def = CONSUMABLES[id];
    if (!def) continue;
    for (let index = 0; index < count; index += 1) {
      const durationMs = resolveConsumableDuration(id, qualityPercent ?? def.quality.vendorQuality);
      const displayState = getConsumableDisplayState(id, durationMs);
      const visualTtlMs = getConsumableVisualTtl(id, durationMs);
      rows.push({
        id: `${id}:${attemptId}:${index}`,
        consumableId: id,
        family: def.family,
        source: source ?? (durationMs > 0 ? 'boss-result' : 'instant-event'),
        sourceId: attemptId,
        startedAt: now,
        expiresAt: now + (durationMs > 0 ? durationMs : visualTtlMs ?? 0),
        durationMs,
        displayState,
        visualTtlMs,
        value: CONSUMABLE_ACTIVATORS[id].defaultValue,
        qualityPercent,
      });
    }
  }
  return rows;
}

export function buildConsumableTickEvents(rows: ActiveBuff[], now = Date.now()): TickEvent[] {
  return rows.map((row) => {
    const def = CONSUMABLES[row.consumableId];
    const kind = getConsumableMechanicKind(row.consumableId).replace(/-/g, ' ');
    const detail = row.durationMs > 0
      ? `${kind} active for ${Math.ceil(row.durationMs / 1000)}s.`
      : `${kind} triggered instantly.`;
    return {
      id: '',
      at: now,
      tone: 'consumable',
      label: def?.name ?? row.consumableId,
      detail,
      value: row.value,
    };
  });
}

export function applyBossConsumableDisplayEvents(input: BossConsumableDisplayInput): ActiveBuff[] {
  const now = input.now ?? Date.now();
  const rows = buildConsumableDisplayRows({ ...input, now });
  const activeStore = useActiveBuffsStore.getState();
  rows.forEach((row) => activeStore.upsert(row));
  useTickFeedStore.getState().push(buildConsumableTickEvents(rows, now));
  return rows;
}
