/**
 * Sparkline helpers.
 *
 * Turns a numeric time series into a compact SVG polyline. Designed for
 * profile cards where we want a quick visual trend without heavy deps.
 */

export interface SparklinePoint {
  x: number;
  y: number;
  value: number;
}

export interface SparklineData {
  points: SparklinePoint[];
  min: number;
  max: number;
  start: number;
  end: number;
  hasChange: boolean;
}

export function buildSparkline(
  values: number[],
  width = 120,
  height = 32,
  padding = 2
): SparklineData {
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  if (values.length === 0) {
    return { points: [], min: 0, max: 0, start: 0, end: 0, hasChange: false };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const count = values.length;

  const points = values.map((value, index) => {
    const x = count === 1 ? padding + innerW / 2 : padding + (index / (count - 1)) * innerW;
    const normalized = (value - min) / range;
    const y = padding + innerH - normalized * innerH;
    return { x, y, value };
  });

  return {
    points,
    min,
    max,
    start: values[0],
    end: values[values.length - 1],
    hasChange: max !== min,
  };
}

export function sparklinePolyline(points: SparklinePoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

export function sparklineTrend(values: number[]): 'up' | 'down' | 'flat' {
  if (values.length < 2) return 'flat';
  const first = values[0];
  const last = values[values.length - 1];
  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'flat';
}
