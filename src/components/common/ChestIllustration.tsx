/**
 * ChestIllustration — high-detail procedural SVG for loot chests.
 *
 * Renders a multi-layered 100×100 SVG: ground shadow, angular chest body
 * with panel lines and rivets, a lid that opens to reveal inner glow,
 * rarity-colored borders, corner accents, and rising loot particles when
 * open. All colors derive from the rarity tier — nothing hardcoded beyond
 * the tier color map.
 *
 * Used by ChestScreen and any loot-reward display where a rich visual
 * is preferred over a flat icon.
 */
import React, { useId } from 'react';

type ChestTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

interface ChestIllustrationProps {
  tier?: ChestTier;
  size?: number;
  className?: string;
  open?: boolean;
  animate?: boolean;
}

const TIER_COLORS: Record<ChestTier, string> = {
  common: '#A5A7B5',
  uncommon: '#7CFC00',
  rare: '#5AA7FF',
  epic: '#FF9DF5',
  legendary: '#FFEA3A',
};

// Rising particle positions when chest is open (relative to chest center ~50,40)
const PARTICLES: ReadonlyArray<{ cx: number; cy: number; r: number; delay: number }> = [
  { cx: 38, cy: 28, r: 1.8, delay: 0 },
  { cx: 48, cy: 22, r: 2.2, delay: 0.3 },
  { cx: 58, cy: 26, r: 1.5, delay: 0.6 },
  { cx: 44, cy: 16, r: 1.2, delay: 0.9 },
  { cx: 56, cy: 14, r: 1.6, delay: 1.2 },
  { cx: 62, cy: 20, r: 1.3, delay: 0.45 },
];

export const ChestIllustration: React.FC<ChestIllustrationProps> = ({
  tier = 'common',
  size = 100,
  className = '',
  open = false,
  animate = false,
}) => {
  const color = TIER_COLORS[tier];
  const uid = useId().replace(/[:]/g, '');
  const glowGradId = `chestGlow-${uid}`;
  const shadowGradId = `chestShadow-${uid}`;
  const pulseName = `chestPulse-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={`${tier} chest${open ? ' (open)' : ''}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Inner glow gradient for open chest */}
        <radialGradient id={glowGradId} cx="50%" cy="60%" r="55%">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="50%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>

        {/* Ground shadow gradient */}
        <radialGradient id={shadowGradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>

        {animate && (
          <style>{`
            @keyframes ${pulseName} {
              0%, 100% { opacity: 0.5; }
              50% { opacity: 1; }
            }
          `}</style>
        )}
      </defs>

      {/* 1 — Ground shadow */}
      <ellipse cx="50" cy="84" rx="34" ry="6" fill={`url(#${shadowGradId})`} />

      {/* 2 — Inner glow (visible when open) */}
      {open && (
        <ellipse
          cx="50"
          cy="48"
          rx="28"
          ry="22"
          fill={`url(#${glowGradId})`}
          style={animate ? { animation: `${pulseName} 2s ease-in-out infinite` } : undefined}
        />
      )}

      {/* 3 — Chest body (trapezoidal, angular sci-fi) */}
      <path
        d="M22 44 L78 44 L74 80 L26 80 Z"
        fill="#2a2a3e"
        stroke={color}
        strokeWidth="1.5"
        strokeOpacity="0.8"
      />

      {/* Panel line — horizontal seam across body */}
      <line x1="24" y1="60" x2="76" y2="60" stroke={color} strokeWidth="0.8" strokeOpacity="0.4" />

      {/* Panel line — vertical center */}
      <line x1="50" y1="44" x2="50" y2="80" stroke={color} strokeWidth="0.6" strokeOpacity="0.3" />

      {/* Rivets — 4 small circles at body corners */}
      <circle cx="28" cy="50" r="1.4" fill={color} fillOpacity="0.7" />
      <circle cx="72" cy="50" r="1.4" fill={color} fillOpacity="0.7" />
      <circle cx="30" cy="74" r="1.2" fill={color} fillOpacity="0.6" />
      <circle cx="70" cy="74" r="1.2" fill={color} fillOpacity="0.6" />

      {/* 4 — Lid */}
      {open ? (
        /* Open lid — rotated back, showing interior */
        <>
          <path
            d="M22 44 L78 44 L82 26 L18 26 Z"
            fill="#1a1a2e"
            stroke={color}
            strokeWidth="1.5"
            strokeOpacity="0.6"
            transform="rotate(-25 50 44)"
          />
          {/* Interior dark cavity */}
          <path d="M26 44 L74 44 L72 52 L28 52 Z" fill="#0d0d1a" />
          {/* Bright inner glow strip */}
          <rect x="28" y="45" width="44" height="3" fill={color} fillOpacity="0.9" rx="1" />
        </>
      ) : (
        /* Closed lid with locking mechanism */
        <>
          <path
            d="M22 44 L78 44 L74 26 L26 26 Z"
            fill="#2a2a3e"
            stroke={color}
            strokeWidth="1.5"
            strokeOpacity="0.8"
          />
          {/* Hex bolt lock */}
          <polygon
            points="50,34 54,36 54,40 50,42 46,40 46,36"
            fill={color}
            fillOpacity="0.85"
            stroke="#000"
            strokeWidth="0.5"
          />
          <circle cx="50" cy="38" r="1.5" fill="#0d0d1a" />
          {/* Lid panel lines */}
          <line x1="30" y1="30" x2="70" y2="30" stroke={color} strokeWidth="0.5" strokeOpacity="0.3" />
        </>
      )}

      {/* 5 — Rarity border accent (thin angular frame) */}
      <path
        d="M22 44 L78 44 L74 80 L26 80 Z"
        fill="none"
        stroke={color}
        strokeWidth="0.6"
        strokeOpacity="0.3"
      />

      {/* 6 — Corner accents (4 angular notches) */}
      <path
        d="M22 44 L18 40 M78 44 L82 40 M26 80 L22 84 M74 80 L78 84"
        stroke={color}
        strokeWidth="1.2"
        strokeOpacity="0.7"
        fill="none"
      />

      {/* 7 — Rising loot particles (only when open) */}
      {open && PARTICLES.map((p, i) => (
        <circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r={p.r}
          fill={color}
          fillOpacity="0.85"
          style={
            animate
              ? { animation: `${pulseName} 1.8s ease-in-out infinite`, animationDelay: `${p.delay}s` }
              : undefined
          }
        />
      ))}
    </svg>
  );
};
