import { describe, it, expect } from 'vitest';
import { buildSparkline, sparklinePolyline, sparklineTrend } from '../lib/progression/sparkline';

describe('buildSparkline', () => {
  it('scales values to the requested box', () => {
    const data = buildSparkline([0, 50, 100], 120, 32, 2);
    expect(data.points).toHaveLength(3);
    expect(data.min).toBe(0);
    expect(data.max).toBe(100);
    expect(data.points[0].y).toBe(30); // bottom (padding + innerH)
    expect(data.points[2].y).toBe(2); // top (padding)
  });

  it('centers a single value', () => {
    const data = buildSparkline([42], 100, 20);
    expect(data.points).toHaveLength(1);
    expect(data.points[0].x).toBe(50);
    expect(data.hasChange).toBe(false);
  });

  it('returns empty data for empty input', () => {
    const data = buildSparkline([]);
    expect(data.points).toHaveLength(0);
    expect(data.hasChange).toBe(false);
  });

  it('reports trend start and end', () => {
    const data = buildSparkline([10, 20, 30]);
    expect(data.start).toBe(10);
    expect(data.end).toBe(30);
    expect(data.hasChange).toBe(true);
  });
});

describe('sparklinePolyline', () => {
  it('produces an M/L path', () => {
    const data = buildSparkline([0, 100], 100, 20);
    const path = sparklinePolyline(data.points);
    expect(path.startsWith('M')).toBe(true);
    expect(path.includes('L')).toBe(true);
  });
});

describe('sparklineTrend', () => {
  it('detects up, down, and flat trends', () => {
    expect(sparklineTrend([1, 2, 3])).toBe('up');
    expect(sparklineTrend([3, 2, 1])).toBe('down');
    expect(sparklineTrend([2, 2, 2])).toBe('flat');
    expect(sparklineTrend([5])).toBe('flat');
  });
});
