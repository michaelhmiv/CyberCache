import React from 'react';
import type { Shield } from '@/types/items';
import { Element, Rarity } from '@/types/game';
import { buildShieldVisualSpec, type ShieldVisualSpec } from '@/lib/gearArt/buildShieldVisualSpec';
import { SharedDefs, surfaceFilterId } from '@/components/gearArt/SharedDefs';
import { Decal } from './Decal';

export type IllustrationSize = 'thumb' | 'card' | 'showcase';

interface ShieldIllustrationProps {
  shield?: Shield;
  element?: Element;
  rarity?: Rarity | string;
  size?: IllustrationSize | number;
  className?: string;
  showBadges?: boolean;
  animate?: boolean;
}

const SIZE_PX: Record<IllustrationSize, number> = {
  thumb: 46,
  card: 70,
  showcase: 190,
};

const DETAIL_LEVEL: Record<IllustrationSize, number> = {
  thumb: 0,
  card: 1,
  showcase: 2,
};

function toSize(size: ShieldIllustrationProps['size']) {
  if (typeof size === 'number') return { px: size, level: size >= 120 ? 2 : size >= 60 ? 1 : 0 };
  const key = size || 'card';
  return { px: SIZE_PX[key], level: DETAIL_LEVEL[key] };
}

function fallbackSpec(props: ShieldIllustrationProps): ShieldVisualSpec {
  return buildShieldVisualSpec({
    id: `shield-preview`,
    name: 'Preview Shield',
    element: props.element || Element.Kinetic,
    rarity: props.rarity ?? Rarity.Common,
    hp: 100,
    rechargeRate: 10,
  } as any);
}

export const ShieldIllustration: React.FC<ShieldIllustrationProps> = ({
  shield,
  element,
  rarity,
  size = 'card',
  className = '',
  showBadges = true,
  animate = false,
}) => {
  const sizing = toSize(size);
  const spec: ShieldVisualSpec = shield ? buildShieldVisualSpec(shield as any) : fallbackSpec({ element, rarity });
  const sil = spec.silhouette;
  const frame = spec.rarityFrame;
  const filterId = `shield-glow-${spec.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const surfFilter = surfaceFilterId(spec.texture);
  const animatedClass = animate ? 'animate-pulse' : '';

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: sizing.px, height: sizing.px, filter: frame.glow }}
      title={`${spec.rarity} ${spec.element} Shield`}
    >
      <svg viewBox="0 0 240 140" width="100%" height="100%" role="img" aria-label={`${spec.rarity} ${spec.element} Shield`}>
        <defs>
          <SharedDefs />
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={frame.color} floodOpacity="0.55" />
          </filter>
          <linearGradient id={`${filterId}-core`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={spec.elementVisual.accentColor} stopOpacity="0.9" />
            <stop offset="100%" stopColor={spec.elementVisual.color} stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {/* Rarity frame */}
        <path d="M12 14 L222 14 L232 26 L228 114 L214 126 L12 126 L4 114 L8 26 Z" fill="rgba(5,6,8,0.92)" stroke="#000" strokeWidth="6" />
        <path d="M16 18 L218 18 L226 28 L222 110 L212 120 L18 120 L10 110 L14 28 Z" fill="none" stroke={frame.color} strokeWidth={frame.strokeWidth} opacity="0.95" />

        <g filter={spec.rarity === Rarity.Legendary || spec.rarity === Rarity.Epic ? `url(#${filterId})` : undefined}>
          {/* Outer rim */}
          <path d={sil.rim} fill="rgba(0,0,0,0.5)" stroke="#000" strokeWidth="4" strokeLinejoin="round" />
          {/* Shield body with surface texture */}
          <path d={sil.body} fill={spec.elementVisual.color} opacity="0.85" stroke="#000" strokeWidth="4" strokeLinejoin="round" filter={surfFilter ? `url(#${surfFilter})` : undefined} />
          {/* Energy core glow */}
          <path d={sil.core} fill={`url(#${filterId}-core)`} stroke="#000" strokeWidth="2" strokeLinejoin="round" className={animatedClass} />
          {/* Panel lines */}
          {sizing.level > 0 && sil.panelLines && (
            <g fill="none" stroke="#000" strokeWidth="1.5" opacity="0.35">
              {sil.panelLines.split(' M').map((seg, i) => {
                const path = i === 0 ? seg : `M${seg}`;
                return <path key={i} d={path} />;
              })}
            </g>
          )}
          {/* Core pulse ring */}
          {sizing.level > 0 && (
            <ellipse cx="120" cy="78" rx="40" ry="24" fill="none" stroke={spec.elementVisual.accentColor} strokeWidth="1.5" opacity="0.4" className={animatedClass} />
          )}
        </g>

        {/* Badges */}
        {showBadges && sizing.level > 0 && (
          <g>
            <path d="M18 108 L55 108 L62 117 L55 126 L18 126 Z" fill={spec.elementVisual.color} stroke="#000" strokeWidth="3" />
            <text x="39" y="121" textAnchor="middle" fontSize="11" fontWeight="900" fill="#000">{spec.elementVisual.shortLabel}</text>
            {sizing.level > 1 && (
              <text x="205" y="121" textAnchor="middle" fontSize="9" fontWeight="900" fill={frame.color}>{frame.stamp}</text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
};
