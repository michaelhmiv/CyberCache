import { CONSUMABLES } from '@/constants/consumables';
import { ConsumableType } from '@/types/game';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import {
  CONSUMABLE_ACTIVATORS,
  getConsumableMechanicKind,
  resolveConsumableDuration,
  type ActiveBuff,
} from './activeBuffs';

const isConsumableType = (id: string | null): id is ConsumableType => !!id && id in CONSUMABLE_ACTIVATORS;

export interface LoadoutCoverageRow {
  slot: keyof LoadoutConsumables;
  consumableId: ConsumableType;
  name: string;
  family: string;
  mechanicKind: ReturnType<typeof getConsumableMechanicKind>;
  armedDurationMs: number;
  decisionHint: string;
}

export function getLoadoutConsumableCoverage(
  consumables: LoadoutConsumables,
  qualityPercent = 100
): LoadoutCoverageRow[] {
  return (Object.entries(consumables) as Array<[keyof LoadoutConsumables, string | null]>).flatMap(([slot, maybeId]) => {
    if (!isConsumableType(maybeId)) return [];
    const id = maybeId as ConsumableType;
    const def = CONSUMABLES[id];
    const durationMs = resolveConsumableDuration(id, qualityPercent);
    const mechanicKind = getConsumableMechanicKind(id);
    return [{
      slot,
      consumableId: id,
      name: def?.name ?? id,
      family: def?.family ?? 'unknown',
      mechanicKind,
      armedDurationMs: durationMs,
      decisionHint: durationMs > 0
        ? `${slot} armed: ${mechanicKind.replace(/-/g, ' ')} for ${Math.ceil(durationMs / 1000)}s when consumed.`
        : `${slot} armed: ${mechanicKind.replace(/-/g, ' ')} triggers instantly when consumed.`,
    }];
  });
}

export function buildLoadoutArmedBuffs(
  consumables: LoadoutConsumables,
  now = Date.now(),
  qualityPercent = 100
): ActiveBuff[] {
  return getLoadoutConsumableCoverage(consumables, qualityPercent).map((row) => ({
    id: `armed:${row.slot}:${row.consumableId}`,
    consumableId: row.consumableId,
    family: CONSUMABLES[row.consumableId]?.family ?? 'tactical',
    source: 'loadout-armed',
    sourceId: row.slot,
    startedAt: now,
    expiresAt: Number.MAX_SAFE_INTEGER,
    durationMs: row.armedDurationMs,
    displayState: 'armed',
    qualityPercent,
  }));
}
