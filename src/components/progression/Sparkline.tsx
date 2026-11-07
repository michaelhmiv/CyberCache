import React, { useEffect, useMemo, useRef } from 'react';
import { buildSparkline, sparklineTrend } from '@/lib/progression/sparkline';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fallbackColor?: string;
  strokeWidth?: number;
  className?: string;
}

/**
 * Sparkline — profile/progression trend line.
 *
 * Pixel conversion (2026-11-07, SVG closure): the trend geometry is
 * unchanged (buildSparkline in lib), but the line is now rasterized
 * as stepped texel blocks on a canvas instead of a smooth SVG
 * polyline — same points, same trend colors, same aria summary.
 */
export const Sparkline: React.FC<SparklineProps> = ({
  values,
  width = 120,
  height = 32,
  color = '#7CFC00',
  fallbackColor = '#4B5563',
  strokeWidth = 2,
  className,
}) => {
  const data = useMemo(
    () => buildSparkline(values, width, height),
    [values, width, height]
  );
  const trend = useMemo(() => sparklineTrend(values), [values]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stroke = trend === 'up' ? color : trend === 'down' ? '#FF4B5C' : fallbackColor;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = data.hasChange ? stroke : fallbackColor;
    const block = Math.max(1, Math.round(strokeWidth));
    const plot = (cx: number, cy: number) => {
      ctx.fillRect(Math.round(cx - block / 2), Math.round(cy - block / 2), block, block);
    };
    if (!data.hasChange) {
      // Flat series: the retired SVG drew one straight midline.
      const y = height / 2;
      for (let x = 2; x <= width - 2; x++) plot(x, y);
      return;
    }
    // Stepped line: walk each segment in 1px x-steps, plotting the
    // interpolated y as a texel block — the diagonal reads as steps,
    // never as a smoothed vector stroke.
    for (let i = 0; i < data.points.length - 1; i++) {
      const a = data.points[i];
      const b = data.points[i + 1];
      const steps = Math.max(1, Math.round(Math.abs(b.x - a.x)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        plot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }
    if (data.points.length === 1) plot(data.points[0].x, data.points[0].y);
  }, [data, stroke, fallbackColor, width, height, strokeWidth]);

  if (values.length === 0) {
    return <div className={`inline-block ${className ?? ''}`} style={{ width, height }} />;
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={width}
      height={height}
      role="img"
      aria-label={`Sparkline showing ${trend} trend from ${data.start} to ${data.end}`}
    />
  );
};

export default Sparkline;
