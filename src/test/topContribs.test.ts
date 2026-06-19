/**
 * Tests for PR #5: top-3 source contribution strip.
 *
 * The strip sits under the HUNTER TOTALS headline chips and surfaces
 * the largest contributions across all metrics. The data layer
 * (`pickTopContributions`) is a pure helper in CharacterStatBar.tsx.
 *
 * These tests cover the helper exhaustively. The strip component
 * itself renders the slice and is covered by the visual test in
 * `characterStatsDiorama.test.ts` (the headline integration).
 */
import { describe, expect, it } from 'vitest';
import { pickTopContributions } from '../lib/stats/topContribs';
import type { CharacterStatSummary, StatContribution, StatMetric } from '../lib/stats/characterStats';

function makeContribution(overrides: Partial<StatContribution> = {}): StatContribution {
  return {
    source: 'Test Source',
    detail: 'Test detail',
    value: 100,
    display: '+100%',
    tone: 'red',
    ...overrides,
  };
}

function makeMetric(key: string, value: number, contributions: StatContribution[], tone: StatMetric['tone'] = 'red'): StatMetric {
  return {
    key,
    label: key,
    value,
    display: String(value),
    detail: 'detail',
    tone,
    contributions,
  };
}

function makeSummary(metrics: StatMetric[]): CharacterStatSummary {
  return { headline: metrics.slice(0, 4), all: metrics };
}

describe('pickTopContributions (PR #5)', () => {
  it('returns the top N contributions by absolute value, sorted descending', () => {
    const summary = makeSummary([
      makeMetric('dps', 1000, [
        makeContribution({ source: 'Big', value: 800 }),
        makeContribution({ source: 'Small', value: 100 }),
        makeContribution({ source: 'Medium', value: 400 }),
      ]),
    ]);
    const top3 = pickTopContributions(summary, 3);
    expect(top3.map((c) => c.source)).toEqual(['Big', 'Medium', 'Small']);
  });

  it('takes top N even when N exceeds the available contributions', () => {
    const summary = makeSummary([
      makeMetric('dps', 100, [makeContribution({ source: 'A', value: 100 })]),
    ]);
    const top3 = pickTopContributions(summary, 3);
    expect(top3).toHaveLength(1);
    expect(top3[0].source).toBe('A');
  });

  it('filters out contributions with value === 0', () => {
    // Zero-value contributions are not interesting in the strip and
    // would crowd out real values. They get filtered.
    const summary = makeSummary([
      makeMetric('dps', 100, [
        makeContribution({ source: 'A', value: 100 }),
        makeContribution({ source: 'B', value: 0 }),
        makeContribution({ source: 'C', value: -50, display: '-50%' }),
      ]),
    ]);
    const top3 = pickTopContributions(summary, 3);
    expect(top3.map((c) => c.source)).toEqual(['A', 'C']);
  });

  it('excludes contributions whose display does not contain a % sign', () => {
    // Only percentage-based modifiers (rareFind, scrap, offline,
    // activity modules, etc.) should appear in the strip. Raw
    // DPS/HP/damage numbers are excluded.
    const summary = makeSummary([
      makeMetric('dps', 500, [
        makeContribution({ source: 'Raw DPS', value: 500, display: '500' }),
        makeContribution({ source: 'Raw HP', value: 200, display: '200' }),
      ]),
      makeMetric('rareFind', 0.1, [
        makeContribution({ source: 'Rare Find +10%', value: 0.10, display: '+10%' }),
      ]),
    ]);
    const top3 = pickTopContributions(summary, 3);
    expect(top3).toHaveLength(1);
    expect(top3[0].source).toBe('Rare Find +10%');
  });

  it('sorts by absolute value, so negative contributions rank by magnitude', () => {
    // A large negative contribution (e.g. a debuff) should still rank
    // high because the player needs to know what's hurting them.
    const summary = makeSummary([
      makeMetric('dps', 100, [
        makeContribution({ source: 'A', value: 50 }),
        makeContribution({ source: 'B', value: -200 }),
        makeContribution({ source: 'C', value: 75 }),
      ]),
    ]);
    const top3 = pickTopContributions(summary, 3);
    expect(top3.map((c) => c.source)).toEqual(['B', 'C', 'A']);
  });

  it('flattens contributions across multiple metrics', () => {
    // The strip is *cross-metric* — it shows the largest contributions
    // regardless of which headline number they feed into.
    const summary = makeSummary([
      makeMetric('rareFind', 0.15, [makeContribution({ source: 'Weapon', value: 0.15, display: '+15%' })]),
      makeMetric('scrap', 0.10, [makeContribution({ source: 'Chassis', value: 0.10, display: '+10%' })]),
      makeMetric('offline', 0.05, [makeContribution({ source: 'Ordnance', value: 0.05, display: '+5%' })]),
    ]);
    const top3 = pickTopContributions(summary, 3);
    expect(top3.map((c) => c.source)).toEqual(['Weapon', 'Chassis', 'Ordnance']);
  });

  it('returns an empty array when the summary has no contributions', () => {
    const summary = makeSummary([makeMetric('dps', 0, [])]);
    expect(pickTopContributions(summary, 3)).toEqual([]);
  });

  it('returns an empty array when all contributions are zero', () => {
    const summary = makeSummary([
      makeMetric('dps', 0, [
        makeContribution({ source: 'A', value: 0 }),
        makeContribution({ source: 'B', value: 0 }),
      ]),
    ]);
    expect(pickTopContributions(summary, 3)).toEqual([]);
  });

  it('clamps N to a non-negative integer when given a negative or non-integer', () => {
    const summary = makeSummary([makeMetric('dps', 100, [makeContribution({ source: 'A', value: 100 })])]);
    // Negative N is clamped to 0 (returns empty)
    expect(pickTopContributions(summary, -5)).toEqual([]);
    // NaN → 0 (returns empty)
    expect(pickTopContributions(summary, NaN)).toEqual([]);
  });

  it('returns the same references (not copies), so the caller can map into markup', () => {
    const contrib = makeContribution({ source: 'Original', value: 100 });
    const summary = makeSummary([makeMetric('dps', 100, [contrib])]);
    const top3 = pickTopContributions(summary, 3);
    expect(top3[0]).toBe(contrib);
  });
});
