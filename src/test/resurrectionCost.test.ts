import { describe, it, expect } from 'vitest';
import { resurrectionCostForArea, formatCreditCost, RESURRECTION_FREE_TIMER_MS } from '@/lib/combat/resurrectionCost';
import { ROAMING_AREAS } from '@/constants/roamingAreas';

describe('resurrectionCostForArea', () => {
  it('returns 100 for an unknown area id', () => {
    expect(resurrectionCostForArea('not-a-real-area')).toBe(100);
  });

  it('returns 100 for null / undefined area id', () => {
    expect(resurrectionCostForArea(null)).toBe(100);
    expect(resurrectionCostForArea(undefined)).toBe(100);
  });

  it('scales linearly with area unlockLevel (Dustwaste Frontier = lv 1)', () => {
    const dustwaste = ROAMING_AREAS.find((a) => a.id === 'dustwaste_frontier');
    expect(dustwaste).toBeDefined();
    expect(resurrectionCostForArea('dustwaste_frontier')).toBe(100);
  });

  it('scales linearly with area unlockLevel (Redline Circuit = lv 4)', () => {
    const redline = ROAMING_AREAS.find((a) => a.id === 'redline_circuit');
    expect(redline).toBeDefined();
    expect(resurrectionCostForArea('redline_circuit')).toBe(400);
  });

  it('caps at 50,000 credits even for very high-tier areas', () => {
    expect(resurrectionCostForArea('helixworks_labyrinth')).toBeLessThanOrEqual(50_000);
  });
});

describe('formatCreditCost', () => {
  it('formats small amounts with comma separator', () => {
    expect(formatCreditCost(100)).toBe('100 cr');
    expect(formatCreditCost(2500)).toBe('2,500 cr');
  });

  it('formats large amounts in K', () => {
    expect(formatCreditCost(10_000)).toBe('10.0K cr');
    expect(formatCreditCost(50_000)).toBe('50.0K cr');
  });
});

describe('RESURRECTION_FREE_TIMER_MS', () => {
  it('is 5 minutes', () => {
    expect(RESURRECTION_FREE_TIMER_MS).toBe(5 * 60 * 1000);
  });
});
