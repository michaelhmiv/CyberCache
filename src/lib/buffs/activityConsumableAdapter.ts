import { CONSUMABLES, type ConsumableActivityScope } from '@/constants/consumables';
import { ConsumableType } from '@/types/game';
import { buildConsumableDisplayRows, buildConsumableTickEvents } from '@/lib/chef/bossResultAdapter';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';

export interface ActivityConsumableDisplayInput {
  activityId: string;
  activityScope: ConsumableActivityScope;
  consumedConsumables: Record<string, number>;
  now?: number;
  qualityPercent?: number;
}

export function filterConsumablesForActivity(
  consumedConsumables: Record<string, number>,
  activityScope: ConsumableActivityScope
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(consumedConsumables).filter(([id, count]) => {
      const def = CONSUMABLES[id as ConsumableType];
      return !!def && count > 0 && def.runtime.activityScopes.includes(activityScope);
    })
  );
}

export function applyActivityConsumableDisplayEvents(input: ActivityConsumableDisplayInput) {
  const now = input.now ?? Date.now();
  const scoped = filterConsumablesForActivity(input.consumedConsumables, input.activityScope);
  const rows = buildConsumableDisplayRows({
    attemptId: `activity:${input.activityId}:${input.activityScope}`,
    consumedConsumables: scoped,
    now,
    qualityPercent: input.qualityPercent,
    source: 'activity-result',
  });
  const activeStore = useActiveBuffsStore.getState();
  rows.forEach((row) => activeStore.upsert(row));
  useTickFeedStore.getState().push(buildConsumableTickEvents(rows, now));
  return rows;
}
