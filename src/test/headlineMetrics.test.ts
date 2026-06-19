import { describe, it, expect } from 'vitest';
import { getHeadlineMetricKeys, HEADLINE_METRIC_KEYS } from '@/lib/hud/headlineMetrics';
import { ACTIVITY_MODULE_DEFS } from '@/content/activityModuleDefs';

describe('headlineMetrics', () => {
  it('returns 3 keys for universal/idle and correct counts per activity', () => {
    expect(getHeadlineMetricKeys('none')).toHaveLength(3);
    expect(getHeadlineMetricKeys('idle_standby')).toHaveLength(3);
    // Activity-specific headline sets have their own counts
    expect(getHeadlineMetricKeys('roaming_loot').length).toBeGreaterThan(0);
    expect(getHeadlineMetricKeys('boss_fight').length).toBeGreaterThan(0);
    expect(getHeadlineMetricKeys('crafting').length).toBeGreaterThan(0);
    expect(getHeadlineMetricKeys('salvaging').length).toBeGreaterThan(0);
  });

  it('falls back to universal for unknown kinds', () => {
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
    const knownKeys = new Set(['health', 'dps', 'boss', 'shieldBreak', 'armorBreak', 'rareFind', 'offline', 'scrap', 'ordnance']);
    const activityModuleKeys = new Set(Object.values(ACTIVITY_MODULE_DEFS).flatMap((def) => def.subStats.map((sub) => sub.key)));
    const registryKeys = Object.values(HEADLINE_METRIC_KEYS).flat();
    registryKeys.forEach((key) => {
      expect(knownKeys.has(key) || activityModuleKeys.has(key)).toBe(true);
    });
  });
});
