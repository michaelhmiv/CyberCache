import { describe, it, expect } from 'vitest';
import { getBreakdownMetricKeys, BREAKDOWN_METRIC_KEYS } from '@/lib/hud/headlineMetrics';

describe('getBreakdownMetricKeys', () => {
  it('returns combat core for none/idle', () => {
    const keys = getBreakdownMetricKeys('none');
    expect(keys).toContain('health');
    expect(keys).toContain('dps');
    expect(keys).toContain('shieldBreak');
    // Should NOT include activity-specific stats
    expect(keys).not.toContain('craftingSpeed');
    expect(keys).not.toContain('salvageYield');
  });

  it('returns crafting stats for crafting activity', () => {
    const keys = getBreakdownMetricKeys('crafting');
    expect(keys).toContain('craftingSpeed');
    expect(keys).toContain('materialEfficiency');
    expect(keys).toContain('critCraftChance');
    expect(keys).toContain('burstCraftChance');
    expect(keys).toContain('elementalCraftBonus');
    expect(keys).toContain('droneAssistSpeed');
    // Combat core always present
    expect(keys).toContain('health');
    expect(keys).toContain('dps');
    // Should NOT include salvaging stats
    expect(keys).not.toContain('salvageYield');
    expect(keys).not.toContain('rareMaterialChance');
  });

  it('returns roaming stats for roaming_loot activity', () => {
    const keys = getBreakdownMetricKeys('roaming_loot');
    expect(keys).toContain('rareFind');
    expect(keys).toContain('scrap');
    expect(keys).toContain('creditsPerKill');
    expect(keys).toContain('rareDropChanceMod');
    expect(keys).toContain('cacheFragmentChance');
    // Should NOT include crafting stats
    expect(keys).not.toContain('craftingSpeed');
  });

  it('returns boss stats for boss_fight activity', () => {
    const keys = getBreakdownMetricKeys('boss_fight');
    expect(keys).toContain('boss');
    expect(keys).toContain('armorBreak');
    expect(keys).toContain('rareFind');
    expect(keys).toContain('dps');
    // Should NOT include activity module stats
    expect(keys).not.toContain('craftingSpeed');
    expect(keys).not.toContain('salvageYield');
  });

  it('falls back to universal for unknown activity', () => {
    const keys = getBreakdownMetricKeys('unknown_activity');
    expect(keys).toContain('health');
    expect(keys).toContain('dps');
  });

  it('falls back to universal for undefined', () => {
    const keys = getBreakdownMetricKeys(undefined);
    expect(keys).toContain('health');
    expect(keys).toContain('dps');
  });

  it('all activity key sets are <= 14 metrics (no scrollbar)', () => {
    const allKinds = Object.keys(BREAKDOWN_METRIC_KEYS) as Array<keyof typeof BREAKDOWN_METRIC_KEYS>;
    for (const kind of allKinds) {
      const keys = BREAKDOWN_METRIC_KEYS[kind];
      expect(keys.length).toBeLessThanOrEqual(14);
    }
  });

  it('droneAssistSpeed appears in both crafting and workshop key sets', () => {
    // This is expected — the disambiguation happens via sourceActivity
    // on the metric, not via the key set alone.
    expect(getBreakdownMetricKeys('crafting')).toContain('droneAssistSpeed');
    expect(getBreakdownMetricKeys('workshop_service')).toContain('droneAssistSpeed');
  });
});
