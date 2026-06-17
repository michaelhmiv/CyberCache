import type { ActivityKind } from '@/types/activity';

export const HEADLINE_METRIC_KEYS: Record<'universal' | ActivityKind, readonly string[]> = {
  universal: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  none: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  idle_standby: ['health', 'effectiveHp', 'dps', 'shieldBreak'],
  roaming_loot: ['rareFind', 'scrap', 'offline', 'dps'],
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
const COMBAT_CORE = ['health', 'effectiveHp', 'dps', 'shieldBreak'] as const;

export const BREAKDOWN_METRIC_KEYS: Record<'universal' | ActivityKind, readonly string[]> = {
  universal: COMBAT_CORE,
  none: COMBAT_CORE,
  idle_standby: [
    ...COMBAT_CORE,
    'offline', 'offlineEarningsMod', 'offlineScrapMod', 'offlineXpMod', 'offlineMaterialMod',
  ],
  roaming_loot: [
    ...COMBAT_CORE,
    'rareFind', 'scrap', 'offline',
    'creditsPerKill', 'rareDropChanceMod', 'scrapYieldMod', 'materialFindChance', 'xpBoostMod', 'cacheFragmentChance',
  ],
  boss_fight: [
    ...COMBAT_CORE,
    'boss', 'armorBreak', 'rareFind',
  ],
  crafting: [
    ...COMBAT_CORE,
    'craftingSpeed', 'materialEfficiency', 'critCraftChance', 'burstCraftChance', 'elementalCraftBonus', 'droneAssistSpeed',
  ],
  salvaging: [
    ...COMBAT_CORE,
    'scrap',
    'salvageYield', 'rareMaterialChance', 'essenceExtraction', 'explosiveSalvage', 'precisionExtraction', 'autoCollectChance',
  ],
  workshop_service: [
    ...COMBAT_CORE,
    'workshopSpeed', 'parallelQueueSlots', 'overclockChance', 'droneAssistSpeed', 'failureReduction', 'qualityTierBonus',
  ],
  market_listing: [
    ...COMBAT_CORE,
    'marketFeeReduction', 'marketSaleBonus', 'listingDurationBonus', 'premiumPricingChance', 'affinityPricing', 'bulkListingSlots',
  ],
} as const;

export function getBreakdownMetricKeys(kind: ActivityKind | string | undefined): readonly string[] {
  if (!kind) return BREAKDOWN_METRIC_KEYS.universal;
  // @ts-expect-error - narrow at runtime
  return BREAKDOWN_METRIC_KEYS[kind] ?? BREAKDOWN_METRIC_KEYS.universal;
}
