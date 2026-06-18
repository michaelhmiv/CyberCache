/**
 * BossPortrait — high-detail procedural SVG portrait for boss displays.
 *
 * Renders a multi-layered 120×120 SVG: elemental aura, angular containment
 * frame with corner notches, archetype-specific body silhouette, glowing inner
 * core/eye, elemental particles, the boss sigil, and tier indicator pips.
 *
 * Replaces the simple BossSigil div+text in contexts where a rich visual
 * identity is wanted (fight modals, boss detail panels, victory screens).
 *
 * All colors derive from the BossVisual registry — nothing is hardcoded.
 * Visible element count is kept under 40 for mobile performance. Surface
 * bevels reuse the shared `bevel-sm` / `bevel-lg` filters from SharedDefs
 * (coordinate-agnostic, unlike the fixed-light surface-* filters).
 */
import React, { useId } from 'react';
import { getBossVisual, BOSS_VISUALS, type BossVisual } from '@/constants/bossVisuals';
import { SharedDefs } from '@/components/gearArt/SharedDefs';

interface BossPortraitProps {
  bossId: string;
  /** Rendered size in pixels (default 120). */
  size?: number;
  className?: string;
  /** Elemental aura ring behind the body (default true). */
  showAura?: boolean;
  /** Tier indicator pips along the bottom edge (default true). */
  showTier?: boolean;
  /** Subtle pulsing animation on the aura (default false). */
  animate?: boolean;
}

type Archetype = BossVisual['archetype'];

interface BodyArt {
  /** Main silhouette path (archetype-specific). */
  body: string;
  /** Inner core / eye path, rendered in accent color with a soft glow. */
  inner: string;
  /** Extra detail strokes — panel lines, veins, or tendrils. */
  detail: string;
}

/**
 * Hand-crafted archetype silhouettes in the 120×120 viewBox, centered around
 * (60, 52). Each tells a distinct visual story:
 *   - organic    — flowing, asymmetrical body with tendril extensions
 *   - mechanical — angular armored torso with panel lines
 *   - hybrid     — mechanical core wrapped in organic growth tendrils
 */
const BODY_ART: Record<Archetype, BodyArt> = {
  organic: {
    body:
      'M58 24 L48 16 L44 26 Q34 36 36 50 Q30 64 40 74 Q50 82 60 78 ' +
      'L66 86 L70 78 Q82 74 81 60 Q88 46 80 34 Q75 24 62 22 Q60 16 58 24 Z',
    inner: 'M60 38 Q52 48 60 62 Q68 48 60 38 Z',
    detail: 'M50 50 Q60 54 70 48 M52 60 Q60 62 68 56',
  },
  mechanical: {
    body:
      'M60 24 L73 30 L80 42 L78 58 L72 72 L62 80 L58 80 L48 72 ' +
      'L42 58 L40 42 L47 30 Z',
    inner: 'M49 43 L71 43 L73 51 L69 55 L51 55 L47 51 Z',
    detail: 'M43 60 L77 60 M60 58 L60 74 M48 66 L72 66',
  },
  hybrid: {
    body:
      'M60 26 L71 34 L73 50 L66 60 L66 74 L60 80 L54 74 L54 60 ' +
      'L47 50 L49 34 Z',
    inner: 'M60 39 L67 48 L60 57 L53 48 Z',
    detail: 'M49 34 Q40 28 35 36 M71 34 Q80 28 85 36 M54 74 Q46 80 41 73',
  },
};

/** Elemental particle positions — small accent shards around the body. */
const PARTICLES: ReadonlyArray<{ cx: number; cy: number }> = [
  { cx: 60, cy: 14 },
  { cx: 25, cy: 31 },
  { cx: 95, cy: 31 },
  { cx: 27, cy: 75 },
  { cx: 93, cy: 75 },
];

const PARTICLE_R = 2.6;
const PIP_CY = 106;
const PIP_R = 1.6;
const PIP_SPACING = 4.5;

/** Tier = 1-based position in the boss registry; 0 for unknown bosses. */
function tierForBoss(bossId: string): number {
  return Object.keys(BOSS_VISUALS).indexOf(bossId) + 1;
}

export const BossPortrait: React.FC<BossPortraitProps> = ({
  bossId,
  size = 120,
  className = '',
  showAura = true,
  showTier = true,
  animate = false,
}) => {
  const visual = getBossVisual(bossId);
  const art = BODY_ART[visual.archetype] ?? BODY_ART.organic;
  const tier = tierForBoss(bossId);

  // Unique, collision-free IDs for the per-instance gradient/filter/animation.
  const uid = useId().replace(/[:]/g, '');
  const auraGradId = `bossAuraGrad-${uid}`;
  const glowId = `bossGlow-${uid}`;
  const auraAnimName = `bossAuraPulse-${uid}`;

  const pipCount = tier > 0 ? tier : 0;
  const pipStartX = 60 - ((pipCount - 1) * PIP_SPACING) / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      role="img"
      aria-label={`Boss portrait: ${visual.id}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <SharedDefs />

        {/* Elemental aura — radial gradient in accent color */}
        <radialGradient id={auraGradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={visual.accentColor} stopOpacity="0.55" />
          <stop offset="55%" stopColor={visual.accentColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={visual.accentColor} stopOpacity="0" />
        </radialGradient>

        {/* Soft glow for the inner core/eye */}
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {animate && (
          <style>{`
            @keyframes ${auraAnimName} {
              0%, 100% { opacity: 0.4; transform: scale(1); }
              50% { opacity: 0.72; transform: scale(1.06); }
            }
          `}</style>
        )}
      </defs>

      {/* 1 — Background aura (elemental) */}
      {showAura && (
        <circle
          cx="60"
          cy="58"
          r="50"
          fill={`url(#${auraGradId})`}
          style={
            animate
              ? {
                  animation: `${auraAnimName} 3.2s ease-in-out infinite`,
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                }
              : { opacity: 0.6 }
          }
        />
      )}

      {/* 2 — Outer containment frame (angular octagon, notched sci-fi aesthetic) */}
      <path
        d="M48 8 L72 8 L104 28 L104 86 L72 110 L48 110 L16 86 L16 28 Z"
        fill={visual.color}
        fillOpacity={0.07}
        stroke={visual.color}
        strokeOpacity={0.85}
        strokeWidth={1.5}
        filter="url(#bevel-lg)"
      />
      {/* Corner notch accents — single combined path (4 subpaths) */}
      <path
        d="M48 8 L52 14 M72 8 L68 14 M72 110 L68 104 M48 110 L52 104"
        stroke={visual.accentColor}
        strokeWidth={1.2}
        strokeOpacity={0.7}
        fill="none"
      />

      {/* 3 — Body silhouette (archetype-specific) */}
      <path
        d={art.body}
        fill={visual.color}
        fillOpacity={0.82}
        stroke={visual.accentColor}
        strokeOpacity={0.55}
        strokeWidth={1}
        filter="url(#bevel-sm)"
      />

      {/* 4 — Inner detail (core / eye) with glow */}
      <path
        d={art.inner}
        fill={visual.accentColor}
        fillOpacity={0.9}
        filter={`url(#${glowId})`}
      />

      {/* Extra detail strokes — panel lines / veins / tendrils */}
      <path
        d={art.detail}
        fill="none"
        stroke={visual.accentColor}
        strokeOpacity={0.5}
        strokeWidth={0.9}
      />

      {/* 5 — Elemental particles */}
      {PARTICLES.map((p, i) => (
        <circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r={PARTICLE_R}
          fill={visual.accentColor}
          fillOpacity={0.7}
        />
      ))}

      {/* 6 — Sigil text (bold monospace, offset shadow for depth) */}
      <text
        x="61"
        y="99"
        textAnchor="middle"
        fontSize="11"
        fontWeight={900}
        fontFamily="monospace"
        fill="#000"
        fillOpacity={0.5}
        letterSpacing="0.5"
      >
        {visual.sigil}
      </text>
      <text
        x="60"
        y="98"
        textAnchor="middle"
        fontSize="11"
        fontWeight={900}
        fontFamily="monospace"
        fill={visual.color}
        letterSpacing="0.5"
      >
        {visual.sigil}
      </text>

      {/* 7 — Tier indicator pips (1..7 along the bottom edge) */}
      {showTier &&
        pipCount > 0 &&
        Array.from({ length: pipCount }, (_, i) => (
          <circle
            key={i}
            cx={pipStartX + i * PIP_SPACING}
            cy={PIP_CY}
            r={PIP_R}
            fill={visual.accentColor}
            fillOpacity={0.95}
          />
        ))}
    </svg>
  );
};
