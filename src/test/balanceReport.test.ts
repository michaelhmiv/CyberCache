import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '../constants/bosses';
import { createMechanicsBalanceArchetypes, createMechanicsBalanceReport, formatMechanicsBalanceReport } from '../content/mechanicsBalanceReport';

describe('balance report utility', () => {
  it('creates the review archetypes', () => {
    const archetypes = createMechanicsBalanceArchetypes();
    expect(archetypes).toHaveLength(6);
  });

  it('creates one result per encounter and archetype', () => {
    const report = createMechanicsBalanceReport();
    const archetypes = createMechanicsBalanceArchetypes();
    expect(report.bossCount).toBe(REGION_1_BOSSES.length);
    expect(report.archetypeCount).toBe(archetypes.length);
    expect(report.results).toHaveLength(REGION_1_BOSSES.length * archetypes.length);
    for (const result of report.results) {
      expect(result.winChance).toBeGreaterThanOrEqual(0);
      expect(result.winChance).toBeLessThanOrEqual(1);
    }
  });

  it('formats a readable summary', () => {
    const text = formatMechanicsBalanceReport(createMechanicsBalanceReport());
    expect(text).toContain('CyberCache');
    expect(text).toContain('Bosses: 7');
    expect(text).toContain('Archetypes: 6');
  });
});
