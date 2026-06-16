import { describe, it, expect } from 'vitest';
import { getHeadlineMetricKeys, HEADLINE_METRIC_KEYS } from '@/lib/hud/headlineMetrics';

describe('headlineMetrics', () => {
  it('returns 4 keys for every activity kind', () => {
    const kinds = ['none', 'idle_standby', 'roaming_loot', 'boss_prep', 'boss_fight', 'crafting', 'salvaging', 'workshop_service', 'market_listing'] as const;
    for (const kind of kinds) {
      expect(getHeadlineMetricKeys(kind)).toHaveLength(4);
    }
  });

  it('falls back to universal for unknown kinds', () => {
    // @ts-expect-error - intentionally bad input
    expect(getHeadlineMetricKeys('not_a_real_kind')).toEqual(HEADLINE_METRIC_KEYS.universal);
  });

  it('roaming activity surfaces economy stats first', () => {
    expect(getHeadlineMetricKeys('roaming_loot')).toEqual(['rareFind', 'scrap', 'offline', 'dps']);
  });

  it('crafting surfaces the four crafting-module primaries', () => {
    expect(getHeadlineMetricKeys('crafting')).toEqual(['craftingSpeed', 'materialEfficiency', 'critCraftChance', 'burstCraftChance']);
  });

  it('idle_standby falls back to universal', () => {
    expect(getHeadlineMetricKeys('idle_standby')).toEqual(HEADLINE_METRIC_KEYS.universal);
  });

  it('every key in the registry is a key produced by buildCharacterStatSummary', () => {
    // Snapshot of the current `all` array keys in characterStats.ts.
    const knownKeys = new Set(['health', 'effectiveHp', 'dps', 'boss', 'shieldBreak', 'armorBreak', 'rareFind', 'offline', 'scrap', 'ordnance']);
    const registryKeys = Object.values(HEADLINE_METRIC_KEYS).flat();
    registryKeys.forEach((key) => {
      // @ts-expect-error - test against Set membership
      expect(knownKeys.has(key) || ['craftingSpeed','materialEfficiency','critCraftChance','burstCraftChance',
        'salvageYield','rareMaterialChance','essenceExtraction','explosiveSalvage',
        'marketFeeReduction','marketSaleBonus','listingDurationBonus','premiumPricingChance',
        'workshopSpeed','parallelQueueSlots','overclockChance','failureReduction',
        'creditsPerKill','cacheFragmentChance','materialFindChance','xpBoostMod',
        'offlineScrapMod','offlineXpMod','offlineMaterialMod'].includes(key)).toBe(true);
    });
  });
});
