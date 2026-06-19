import { describe, expect, it } from 'vitest';
import { formatMultiplierOrWhole, formatPct, formatSignedPct, formatWhole } from '@/lib/stats/formatStat';

describe('stat formatting helpers', () => {
  it('formats whole numbers with locale separators', () => {
    expect(formatWhole(1210)).toBe('1,210');
  });

  it('formats percentages', () => {
    expect(formatPct(0.156)).toBe('16%');
    expect(formatSignedPct(0.156)).toBe('+16%');
    expect(formatSignedPct(-0.156)).toBe('-16%');
  });

  it('formats small values as multipliers and large values as whole', () => {
    expect(formatMultiplierOrWhole(1.25)).toBe('1.25×');
    expect(formatMultiplierOrWhole(150)).toBe('150');
  });
});
