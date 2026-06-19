import type { ActivityKind } from '@/types/activity';
import { getActivityModuleStatKeys, getPrimaryActivityModuleStatKeys } from '@/lib/activity/activityStatMetadata';

export const COMBAT_CORE_METRIC_KEYS = ['health', 'effectiveHp', 'dps', 'shieldBreak'] as const;

export const HEADLINE_METRIC_KEYS: Record<'universal' | ActivityKind, readonly string[]> = {
  universal: COMBAT_CORE_METRIC_KEYS,
  none: COMBAT_CORE_METRIC_KEYS,
  idle_standby: COMBAT_CORE_METRIC_KEYS,
  roaming_loot: ['rareFind', 'scrap', 'offline', 'dps'],
  boss_fight: ['boss', 'dps', 'shieldBreak', 'armorBreak'],
  crafting: getPrimaryActivityModuleStatKeys('crafting'),
  salvaging: getPrimaryActivityModuleStatKeys('salvaging'),
  workshop_service: getPrimaryActivityModuleStatKeys('workshop_service'),
  market_listing: getPrimaryActivityModuleStatKeys('market_listing'),
} as const;

export function getHeadlineMetricKeys(kind: ActivityKind | string | undefined): readonly string[] {
  if (!kind) return HEADLINE_METRIC_KEYS.universal;
  // @ts-expect-error - narrow at runtime
  return HEADLINE_METRIC_KEYS[kind] ?? HEADLINE_METRIC_KEYS.universal;
}

/**
 * The full set of metric keys to show in the Source Breakdown modal for a
 * given activity. This extends the 4-key headline set with the remaining
 * activity-module sub-stats and relevant economy stats so the player can
 * inspect all dimensions of their current activity — without seeing stats
 * from unrelated activities.
 *
 * Core combat stats (health, effectiveHp, dps, shieldBreak) are always
 * included so the player can reference their character power regardless
 * of context.
 */
export const BREAKDOWN_METRIC_KEYS: Record<'universal' | ActivityKind, readonly string[]> = {
  universal: COMBAT_CORE_METRIC_KEYS,
  none: COMBAT_CORE_METRIC_KEYS,
  idle_standby: [
    ...COMBAT_CORE_METRIC_KEYS,
    'offline', ...getActivityModuleStatKeys('idle_standby'),
  ],
  roaming_loot: [
    ...COMBAT_CORE_METRIC_KEYS,
    'rareFind', 'scrap', 'offline', ...getActivityModuleStatKeys('roaming_loot'),
  ],
  boss_fight: [
    ...COMBAT_CORE_METRIC_KEYS,
    'boss', 'armorBreak', 'rareFind',
  ],
  crafting: [
    ...COMBAT_CORE_METRIC_KEYS,
    ...getActivityModuleStatKeys('crafting'),
  ],
  salvaging: [
    ...COMBAT_CORE_METRIC_KEYS,
    'scrap', ...getActivityModuleStatKeys('salvaging'),
  ],
  workshop_service: [
    ...COMBAT_CORE_METRIC_KEYS,
    ...getActivityModuleStatKeys('workshop_service'),
  ],
  market_listing: [
    ...COMBAT_CORE_METRIC_KEYS,
    ...getActivityModuleStatKeys('market_listing'),
  ],
} as const;

export function getBreakdownMetricKeys(kind: ActivityKind | string | undefined): readonly string[] {
  if (!kind) return BREAKDOWN_METRIC_KEYS.universal;
  // @ts-expect-error - narrow at runtime
  return BREAKDOWN_METRIC_KEYS[kind] ?? BREAKDOWN_METRIC_KEYS.universal;
}
