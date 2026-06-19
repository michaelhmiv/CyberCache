import { ACTIVITY_MODULE_DEFS } from '@/content/activityModuleDefs';
import type { ActivityKind } from '@/types/activity';

function moduleDef(activity: ActivityKind) {
  return ACTIVITY_MODULE_DEFS[activity as keyof typeof ACTIVITY_MODULE_DEFS];
}

export function getActivityModuleStatKeys(activity: ActivityKind): readonly string[] {
  return moduleDef(activity)?.subStats.map((sub) => sub.key) ?? [];
}

export function getPrimaryActivityModuleStatKeys(activity: ActivityKind, limit = 4): readonly string[] {
  const def = moduleDef(activity);
  if (!def) return [];
  const primary = def.subStats.filter((sub) => sub.isPrimary).map((sub) => sub.key);
  const rest = def.subStats.filter((sub) => !sub.isPrimary).map((sub) => sub.key);
  return [...primary, ...rest].slice(0, limit);
}

export function getActivityModuleStatLabel(activity: ActivityKind, statKey: string): string {
  return moduleDef(activity)?.subStats.find((sub) => sub.key === statKey)?.label ?? statKey;
}

export function formatActivityModuleStat(activity: ActivityKind, statKey: string, value: number): string {
  const label = getActivityModuleStatLabel(activity, statKey);
  const integer = statKey === 'bulkListingSlots' || statKey === 'parallelQueueSlots';
  const display = integer ? `${Math.round(value)}` : `+${Math.round(value * 100)}%`;
  return `${label} ${display}`;
}
