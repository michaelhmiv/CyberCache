/**
 * AreaBackground — procedural SVG background banner for roaming area cards.
 *
 * Renders a wide 200×80 SVG with layered skylines, atmospheric particles,
 * and a faint area sigil watermark. Designed to sit absolutely positioned
 * behind card content at low opacity.
 *
 * All colors derive from the AreaVisual registry — nothing hardcoded.
 */
import React, { useId } from 'react';
import { getAreaVisual } from '@/constants/areaVisuals';

interface AreaBackgroundProps {
  areaId: string;
  className?: string;
  opacity?: number;
}

export const AreaBackground: React.FC<AreaBackgroundProps> = ({
  areaId,
  className = '',
  opacity = 0.15,
}) => {
  const visual = getAreaVisual(areaId);
  const uid = useId().replace(/[:]/g, '');
  const skyGradId = `areaSky-${uid}`;

  // Darken a hex color by blending toward black
  const darken = (hex: string, factor: number): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const dr = Math.floor(r * factor);
    const dg = Math.floor(g * factor);
    const db = Math.floor(b * factor);
    return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
  };

  const darkColor = darken(visual.color, 0.25);

  // Atmospheric particle scatter positions
  const particles: ReadonlyArray<{ cx: number; cy: number; r: number }> = [
    { cx: 20, cy: 12, r: 0.8 },
    { cx: 45, cy: 8, r: 1.0 },
    { cx: 72, cy: 14, r: 0.6 },
    { cx: 95, cy: 10, r: 0.9 },
    { cx: 128, cy: 6, r: 0.7 },
    { cx: 155, cy: 16, r: 1.1 },
    { cx: 180, cy: 9, r: 0.5 },
    { cx: 30, cy: 30, r: 0.6 },
    { cx: 110, cy: 28, r: 0.8 },
    { cx: 170, cy: 32, r: 0.5 },
  ];

  return (
    <svg
      className={className}
      viewBox="0 0 200 80"
      preserveAspectRatio="xMidYMid slice"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        opacity,
      }}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={skyGradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={visual.color} stopOpacity="0.6" />
          <stop offset="100%" stopColor={darkColor} stopOpacity="0.8" />
        </linearGradient>
      </defs>

      {/* 1 — Sky gradient background */}
      <rect x="0" y="0" width="200" height="80" fill={`url(#${skyGradId})`} />

      {/* 2 — Far skyline (jagged distant structures) */}
      <path
        d="M0 50 L15 42 L25 48 L40 38 L55 46 L70 40 L85 44 L100 36 L115 42 L130 38 L145 44 L160 40 L175 46 L190 42 L200 48 L200 80 L0 80 Z"
        fill={darkColor}
        fillOpacity="0.5"
      />

      {/* 3 — Mid skyline (closer towers, pipes, debris) */}
      <path
        d="M0 58 L10 52 L18 56 L18 44 L24 44 L24 54 L35 50 L42 58 L42 40 L50 40 L50 52 L62 48 L72 56 L72 42 L80 42 L80 54 L92 50 L102 56 L102 38 L108 38 L108 52 L120 48 L132 56 L132 44 L140 44 L140 54 L152 50 L164 58 L164 42 L172 42 L172 52 L184 48 L196 56 L200 54 L200 80 L0 80 Z"
        fill={darkColor}
        fillOpacity="0.7"
      />

      {/* 4 — Near ground line with texture strokes */}
      <rect x="0" y="68" width="200" height="12" fill={darkColor} fillOpacity="0.85" />
      <line x1="0" y1="72" x2="200" y2="72" stroke={visual.color} strokeWidth="0.3" strokeOpacity="0.3" />
      <line x1="0" y1="76" x2="200" y2="76" stroke={visual.color} strokeWidth="0.2" strokeOpacity="0.2" />

      {/* 5 — Atmospheric particles */}
      {particles.map((p, i) => (
        <circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r={p.r}
          fill={visual.accentColor}
          fillOpacity="0.6"
        />
      ))}

      {/* 6 — Area sigil watermark (large, faint, centered) */}
      <text
        x="100"
        y="48"
        textAnchor="middle"
        fontSize="36"
        fontWeight="900"
        fontFamily="monospace"
        fill={visual.color}
        fillOpacity="0.06"
        letterSpacing="2"
      >
        {visual.sigil}
      </text>
    </svg>
  );
};
