import type { ActivityKind } from '@/types/activity';

export const HEADLINE_METRIC_KEYS: Record<'universal' | ActivityKind, readonly string[]> = {
  universal: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  none: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  idle_standby: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  roaming_loot: ['rareFind', 'scrap', 'offline', 'dps'],
  boss_prep: ['boss', 'dps', 'shieldBreak', 'armorBreak'],
  boss_fight: ['boss', 'dps', 'shieldBreak', 'armorBreak'],
  crafting: ['craftingSpeed', 'materialEfficiency', 'critCraftChance', 'burstCraftChance'],
  salvaging: ['salvageYield', 'rareMaterialChance', 'essenceExtraction', 'explosiveSalvage'],
  workshop_service: ['workshopSpeed', 'parallelQueueSlots', 'overclockChance', 'failureReduction'],
  market_listing: ['marketFeeReduction', 'marketSaleBonus', 'listingDurationBonus', 'premiumPricingChance'],
} as const;

export function getHeadlineMetricKeys(kind: ActivityKind | string | undefined): readonly string[] {
  if (!kind) return HEADLINE_METRIC_KEYS.universal;
  // @ts-expect-error - narrow at runtime
  return HEADLINE_METRIC_KEYS[kind] ?? HEADLINE_METRIC_KEYS.universal;
}
