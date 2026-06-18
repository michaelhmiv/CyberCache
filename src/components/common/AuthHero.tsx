/**
 * AuthHero — high-detail procedural SVG hero banner for the auth/login screen.
 *
 * Renders a 300×120 SVG composition: dark gradient background, central
 * power-core with hexagonal and circular rings, faction glyphs for the
 * three skill trees, scan lines, corner brackets, title text, and a
 * particle field. Replaces the static logo image with a rich procedural
 * identity.
 *
 * Brand colors (amber #FFEA3A) and background tones are fixed brand
 * identity — not derived from a registry.
 */
import React, { useId } from 'react';

interface AuthHeroProps {
  className?: string;
  height?: number;
}

// Faction glyph colors for the 3 skill trees
const FACTION_COLORS = ['#FF4B5C', '#FF9000', '#7CFC00'];

// Background particle scatter
const PARTICLES: ReadonlyArray<{ cx: number; cy: number; r: number; opacity: number }> = [
  { cx: 25, cy: 15, r: 0.8, opacity: 0.4 },
  { cx: 55, cy: 22, r: 0.6, opacity: 0.3 },
  { cx: 85, cy: 12, r: 1.0, opacity: 0.5 },
  { cx: 120, cy: 18, r: 0.5, opacity: 0.25 },
  { cx: 155, cy: 25, r: 0.7, opacity: 0.35 },
  { cx: 185, cy: 14, r: 0.9, opacity: 0.45 },
  { cx: 220, cy: 20, r: 0.6, opacity: 0.3 },
  { cx: 255, cy: 16, r: 0.8, opacity: 0.4 },
  { cx: 280, cy: 24, r: 0.5, opacity: 0.25 },
  { cx: 40, cy: 95, r: 0.7, opacity: 0.35 },
  { cx: 100, cy: 100, r: 0.5, opacity: 0.25 },
  { cx: 200, cy: 98, r: 0.8, opacity: 0.4 },
  { cx: 265, cy: 95, r: 0.6, opacity: 0.3 },
  { cx: 15, cy: 60, r: 0.5, opacity: 0.2 },
  { cx: 285, cy: 65, r: 0.6, opacity: 0.25 },
];

export const AuthHero: React.FC<AuthHeroProps> = ({
  className = '',
  height = 120,
}) => {
  const uid = useId().replace(/[:]/g, '');
  const bgGradId = `authBg-${uid}`;
  const coreGradId = `authCore-${uid}`;

  return (
    <svg
      width="100%"
      height={height}
      viewBox="0 0 300 120"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role="img"
      aria-label="CyberCache"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Background gradient — dark sci-fi void */}
        <linearGradient id={bgGradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1a1a2e" />
          <stop offset="100%" stopColor="#2d2d4e" />
        </linearGradient>

        {/* Power core radial gradient */}
        <radialGradient id={coreGradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFEA3A" stopOpacity="1" />
          <stop offset="40%" stopColor="#FFEA3A" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#FFEA3A" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 1 — Background gradient */}
      <rect x="0" y="0" width="300" height="120" fill={`url(#${bgGradId})`} />

      {/* 2 — Power core (central CyberCache logo motif) */}
      {/* Outer hexagonal ring */}
      <polygon
        points="150,35 172,47 172,71 150,83 128,71 128,47"
        fill="none"
        stroke="#FFEA3A"
        strokeWidth="1.5"
        strokeOpacity="0.3"
      />
      {/* Middle circular ring */}
      <circle cx="150" cy="59" r="18" fill="none" stroke="#FFEA3A" strokeWidth="1" strokeOpacity="0.5" />
      {/* Inner core with radial gradient */}
      <circle cx="150" cy="59" r="12" fill={`url(#${coreGradId})`} />
      {/* Bright center dot */}
      <circle cx="150" cy="59" r="4" fill="#FFEA3A" fillOpacity="0.95" />

      {/* Energy lines — 6 radiating from core */}
      <line x1="150" y1="35" x2="150" y2="28" stroke="#FFEA3A" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="172" y1="47" x2="178" y2="43" stroke="#FFEA3A" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="172" y1="71" x2="178" y2="75" stroke="#FFEA3A" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="150" y1="83" x2="150" y2="90" stroke="#FFEA3A" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="128" y1="71" x2="122" y2="75" stroke="#FFEA3A" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="128" y1="47" x2="122" y2="43" stroke="#FFEA3A" strokeWidth="1" strokeOpacity="0.4" />

      {/* 3 — Faction glyphs (3 skill tree sigils at bottom) */}
      {/* Left — Gunslinger (angular blade shape) */}
      <path
        d="M80 100 L88 92 L90 104 L82 108 Z"
        fill={FACTION_COLORS[0]}
        fillOpacity="0.7"
      />
      {/* Center — Demolition (explosion burst) */}
      <path
        d="M150 96 L153 102 L159 103 L154 107 L156 113 L150 110 L144 113 L146 107 L141 103 L147 102 Z"
        fill={FACTION_COLORS[1]}
        fillOpacity="0.7"
      />
      {/* Right — Scavenger (recycle triangle) */}
      <path
        d="M220 92 L228 106 L212 106 Z"
        fill={FACTION_COLORS[2]}
        fillOpacity="0.7"
      />

      {/* 4 — Scan lines (subtle horizontal tech lines) */}
      <line x1="0" y1="30" x2="300" y2="30" stroke="#FFEA3A" strokeWidth="0.5" strokeOpacity="0.04" />
      <line x1="0" y1="60" x2="300" y2="60" stroke="#FFEA3A" strokeWidth="0.5" strokeOpacity="0.04" />
      <line x1="0" y1="90" x2="300" y2="90" stroke="#FFEA3A" strokeWidth="0.5" strokeOpacity="0.04" />

      {/* 5 — Corner brackets (4 L-shaped accents) */}
      {/* Top-left */}
      <path d="M4 4 L20 4 M4 4 L4 20" stroke="#FFEA3A" strokeWidth="1.5" strokeOpacity="0.4" fill="none" />
      {/* Top-right */}
      <path d="M296 4 L280 4 M296 4 L296 20" stroke="#FFEA3A" strokeWidth="1.5" strokeOpacity="0.4" fill="none" />
      {/* Bottom-left */}
      <path d="M4 116 L20 116 M4 116 L4 100" stroke="#FFEA3A" strokeWidth="1.5" strokeOpacity="0.4" fill="none" />
      {/* Bottom-right */}
      <path d="M296 116 L280 116 M296 116 L296 100" stroke="#FFEA3A" strokeWidth="1.5" strokeOpacity="0.4" fill="none" />

      {/* 6 — Title text */}
      <text
        x="150"
        y="78"
        textAnchor="middle"
        fontSize="14"
        fontWeight="900"
        fontFamily="monospace"
        fill="#FFEA3A"
        fillOpacity="0.9"
        letterSpacing="4"
      >
        CYBERCACHE
      </text>

      {/* 7 — Particle field */}
      {PARTICLES.map((p, i) => (
        <circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r={p.r}
          fill="#FFEA3A"
          fillOpacity={p.opacity}
        />
      ))}
    </svg>
  );
};
