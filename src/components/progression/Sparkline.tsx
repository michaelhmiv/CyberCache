import React, { useMemo } from 'react';
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
  const path = useMemo(() => sparklinePolyline(data.points), [data.points]);
  const trend = useMemo(() => sparklineTrend(values), [values]);

  const stroke = trend === 'up' ? color : trend === 'down' ? '#FF4B5C' : fallbackColor;

  if (values.length === 0) {
    return <div className={`inline-block ${className ?? ''}`} style={{ width, height }} />;
  }

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Sparkline showing ${trend} trend from ${data.start} to ${data.end}`}
    >
      {data.hasChange ? (
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={data.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        />
      ) : (
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke={fallbackColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
};

export default Sparkline;
