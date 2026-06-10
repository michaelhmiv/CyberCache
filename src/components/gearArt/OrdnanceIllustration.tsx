import React from 'react';
import type { Ordnance } from '@/types/items';
import { Element, Rarity } from '@/types/game';
import { buildOrdnanceVisualSpec, type OrdnanceVisualSpec } from '@/lib/gearArt/buildOrdnanceVisualSpec';
import { SharedDefs, surfaceFilterId } from '@/components/gearArt/SharedDefs';
import { Decal } from './Decal';

export type IllustrationSize = 'thumb' | 'card' | 'showcase';

interface OrdnanceIllustrationProps {
  ordnance?: Ordnance;
  element?: Element;
  rarity?: Rarity | string;
  size?: IllustrationSize | number;
  className?: string;
  showBadges?: boolean;
  animate?: boolean;
}

const SIZE_PX: Record<IllustrationSize, number> = { thumb: 46, card: 70, showcase: 190 };
const DETAIL_LEVEL: Record<IllustrationSize, number> = { thumb: 0, card: 1, showcase: 2 };

function toSize(size: OrdnanceIllustrationProps['size']) {
  if (typeof size === 'number') return { px: size, level: size >= 120 ? 2 : size >= 60 ? 1 : 0 };
  const key = size || 'card';
  return { px: SIZE_PX[key], level: DETAIL_LEVEL[key] };
}

function fallbackSpec(props: OrdnanceIllustrationProps): OrdnanceVisualSpec {
  return buildOrdnanceVisualSpec({
    id: 'ordnance-preview',
    name: 'Preview Ordnance',
    element: props.element || Element.Kinetic,
    rarity: props.rarity ?? Rarity.Common,
    damage: 50,
    effect: 'frag',
  } as any);
}

export const OrdnanceIllustration: React.FC<OrdnanceIllustrationProps> = ({
  ordnance, element, rarity, size = 'card', className = '', showBadges = true, animate = false,
}) => {
  const sizing = toSize(size);
  const spec = ordnance ? buildOrdnanceVisualSpec(ordnance as any) : fallbackSpec({ element, rarity });
  const sil = spec.silhouette;
  const frame = spec.rarityFrame;
  const filterId = `ordnance-glow-${spec.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const surfFilter = surfaceFilterId(spec.texture);
  const animatedClass = animate ? 'animate-pulse' : '';

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: sizing.px, height: Math.round(sizing.px * 0.75), filter: frame.glow }}
      title={`${spec.rarity} ${spec.element} Ordnance`}>
      <svg viewBox="0 0 240 120" width="100%" height="100%" role="img">
        <defs>
          <SharedDefs />
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={frame.color} floodOpacity="0.55" />
          </filter>
          <linearGradient id={`${filterId}-element`} x1="0" x2="1">
            <stop offset="0%" stopColor={spec.elementVisual.color} />
            <stop offset="100%" stopColor={spec.elementVisual.accentColor} />
          </linearGradient>
        </defs>

        <path d="M8 12 L226 12 L236 24 L232 96 L218 108 L12 108 L4 96 L8 12 Z" fill="rgba(5,6,8,0.92)" stroke="#000" strokeWidth="6" />
        <path d="M13 17 L221 17 L230 28 L226 92 L215 103 L16 103 L10 93 L13 17 Z" fill="none" stroke={frame.color} strokeWidth={frame.strokeWidth} opacity="0.95" />

        <g filter={spec.rarity === Rarity.Legendary || spec.rarity === Rarity.Epic ? `url(#${filterId})` : undefined}>
          {/* Payload body */}
          <path d={sil.body} fill={spec.elementVisual.color} opacity="0.88" stroke="#000" strokeWidth="4" strokeLinejoin="round" filter={surfFilter ? `url(#${surfFilter})` : undefined} />
          {/* Fuse cap with element gradient */}
          <path d={sil.cap} fill={`url(#${filterId}-element)`} stroke="#000" strokeWidth="3" strokeLinejoin="round" className={animatedClass} />
          {/* Markings */}
          {sizing.level > 0 && sil.markings && (
            <g fill="none" stroke="#000" strokeWidth="1.5" opacity="0.4">
              {sil.markings.split(' M').map((seg, i) => {
                const path = i === 0 ? seg : `M${seg}`;
                return <path key={i} d={path} />;
              })}
            </g>
          )}
          {/* Affix decals */}
          {sizing.level > 0 && spec.decals.slice(0, sizing.level === 1 ? 2 : 3).map((d) => <Decal key={d.id} decal={d} />)}
        </g>

        {showBadges && sizing.level > 0 && (
          <g>
            <path d="M18 83 L55 83 L62 92 L55 101 L18 101 Z" fill={spec.elementVisual.color} stroke="#000" strokeWidth="3" />
            <text x="39" y="96" textAnchor="middle" fontSize="11" fontWeight="900" fill="#000">{spec.elementVisual.shortLabel}</text>
            {sizing.level > 1 && <text x="205" y="96" textAnchor="middle" fontSize="9" fontWeight="900" fill={frame.color}>{frame.stamp}</text>}
          </g>
        )}
      </svg>
    </div>
  );
};
