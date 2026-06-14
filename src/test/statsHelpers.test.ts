import { describe, expect, it } from 'vitest';
import { formatDuration, topBreakdown } from '../lib/stats/statsHelpers';

describe('statsHelpers', () => {
  it('returns top entries sorted by count', () => {
    expect(topBreakdown({ a: 5, b: 10, c: 2 }, 2)).toEqual([
      { name: 'b', count: 10 },
      { name: 'a', count: 5 },
    ]);
  });

  it('filters zero counts', () => {
    expect(topBreakdown({ a: 0, b: 3 })).toEqual([{ name: 'b', count: 3 }]);
  });

  it('handles null/undefined', () => {
    expect(topBreakdown(null)).toEqual([]);
    expect(topBreakdown(undefined)).toEqual([]);
  });

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(3665)).toBe('1h 1m');
  });
});
