/**
 * BossSigil — renders a compact procedural SVG sigil for a boss.
 *
 * Enhanced version: renders as a multi-layer SVG badge with angular frame,
 * accent border, inner glow, and bold sigil text with depth shadow. Used
 * in boss selection lists, fight modals, and the diorama at small sizes
 * (14–44px) where a full BossPortrait would be too heavy.
 *
 * All colors derive from the BossVisual registry — nothing hardcoded.
 */
import React, { useId } from 'react';
import { getBossVisual, type BossVisual } from '@/constants/bossVisuals';

interface BossSigilProps {
  bossId: string;
  size?: number;
  className?: string;
  showFrame?: boolean;
}

export const BossSigil: React.FC<BossSigilProps> = ({
  bossId,
  size = 40,
  className = '',
  showFrame = true,
}) => {
  const visual: BossVisual = getBossVisual(bossId);
  const uid = useId().replace(/[:]/g, '');
  const glowId = `sigilGlow-${uid}`;
  const bgGradId = `sigilBg-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={`inline-block ${className}`}
      role="img"
      aria-label={`Boss sigil: ${visual.id}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Inner glow filter */}
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Background radial gradient */}
        <radialGradient id={bgGradId} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={visual.color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={visual.color} stopOpacity="0.05" />
        </radialGradient>
      </defs>

      {/* Background fill with angular clip */}
      {showFrame && (
        <path
          d="M6 0 L34 0 L40 6 L40 34 L34 40 L6 40 L0 34 L0 6 Z"
          fill={`url(#${bgGradId})`}
        />
      )}

      {/* Accent border (inner) */}
      {showFrame && (
        <path
          d="M6 0 L34 0 L40 6 L40 34 L34 40 L6 40 L0 34 L0 6 Z"
          fill="none"
          stroke={visual.color}
          strokeWidth="1.5"
          strokeOpacity="0.85"
        />
      )}

      {/* Thin accent line (accentColor) just inside the border */}
      {showFrame && (
        <path
          d="M8 2 L32 2 L38 8 L38 32 L32 38 L8 38 L2 32 L2 8 Z"
          fill="none"
          stroke={visual.accentColor}
          strokeWidth="0.6"
          strokeOpacity="0.5"
        />
      )}

      {/* Sigil text — shadow layer for depth */}
      <text
        x="20.5"
        y="25.5"
        textAnchor="middle"
        fontSize={size * 0.36}
        fontWeight="900"
        fontFamily="monospace"
        fill="#000"
        fillOpacity="0.4"
        letterSpacing="0.5"
      >
        {visual.sigil}
      </text>

      {/* Sigil text — main with glow */}
      <text
        x="20"
        y="25"
        textAnchor="middle"
        fontSize={size * 0.36}
        fontWeight="900"
        fontFamily="monospace"
        fill={visual.color}
        filter={`url(#${glowId})`}
        letterSpacing="0.5"
      >
        {visual.sigil}
      </text>

      {/* Small accent dot at top (element indicator) */}
      {showFrame && (
        <circle cx="20" cy="3" r="1" fill={visual.accentColor} fillOpacity="0.8" />
      )}
    </svg>
  );
};
