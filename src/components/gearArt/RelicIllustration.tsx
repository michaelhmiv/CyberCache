import React from 'react';
import type { Relic } from '@/types/items';
import { Rarity } from '@/types/game';
import { buildRelicVisualSpec, type RelicVisualSpec } from '@/lib/gearArt/buildRelicVisualSpec';
import { SharedDefs, surfaceFilterId } from '@/components/gearArt/SharedDefs';
import { Decal } from './Decal';

interface RelicIllustrationProps {
  relic?: Relic;
  rarity?: Rarity | string;
  size?: 'thumb' | 'card' | 'showcase' | number;
  className?: string;
  showBadges?: boolean;
  animate?: boolean;
}

const SIZE_PX = { thumb: 46, card: 70, showcase: 190 };
const DETAIL_LEVEL = { thumb: 0, card: 1, showcase: 2 };

function toSize(size: RelicIllustrationProps['size']) {
  if (typeof size === 'number') return { px: size, level: size >= 120 ? 2 : size >= 60 ? 1 : 0 };
  const key = size || 'card';
  return { px: SIZE_PX[key], level: DETAIL_LEVEL[key] };
}

function fallbackSpec(props: RelicIllustrationProps): RelicVisualSpec {
  return buildRelicVisualSpec({
    id: 'relic-preview',
    name: 'Preview Relic',
    rarity: props.rarity ?? Rarity.Common,
  } as any);
}

export const RelicIllustration: React.FC<RelicIllustrationProps> = ({
  relic, rarity, size = 'card', className = '', showBadges = true, animate = false,
}) => {
  const sizing = toSize(size);
  const spec = relic ? buildRelicVisualSpec(relic as any) : fallbackSpec({ rarity });
  const sil = spec.silhouette;
  const frame = spec.rarityFrame;
  const filterId = `relic-glow-${spec.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const surfFilter = surfaceFilterId(spec.texture);
  const animatedClass = animate ? 'animate-pulse' : '';

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: sizing.px, height: sizing.px, filter: frame.glow }}
      title={`${spec.rarity} Relic`}>
      <svg viewBox="0 0 240 140" width="100%" height="100%" role="img">
        <defs>
          <SharedDefs />
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={frame.color} floodOpacity="0.55" />
          </filter>
          <linearGradient id={`${filterId}-core`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFEA3A" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#FF9000" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        <path d="M12 14 L222 14 L232 26 L228 114 L214 126 L12 126 L4 114 L8 26 Z" fill="rgba(5,6,8,0.92)" stroke="#000" strokeWidth="6" />
        <path d="M16 18 L218 18 L226 28 L222 110 L212 120 L18 120 L10 110 L14 28 Z" fill="none" stroke={frame.color} strokeWidth={frame.strokeWidth} opacity="0.95" />

        <g filter={spec.rarity === Rarity.Legendary || spec.rarity === Rarity.Epic ? `url(#${filterId})` : undefined}>
          {/* Relic body */}
          <path d={sil.body} fill="#A855F7" opacity="0.9" stroke="#000" strokeWidth="4" strokeLinejoin="round" filter={surfFilter ? `url(#${surfFilter})` : undefined} />
          {/* Glowing core */}
          <path d={sil.core} fill={`url(#${filterId}-core)`} stroke="#000" strokeWidth="2" strokeLinejoin="round" className={animatedClass} />
          {/* Rune markings */}
          {sizing.level > 0 && sil.runes && (
            <g fill="none" stroke="#FFEA3A" strokeWidth="1.5" opacity="0.6">
              {sil.runes.split(' M').map((seg, i) => {
                const path = i === 0 ? seg : `M${seg}`;
                return <path key={i} d={path} />;
              })}
            </g>
          )}
          {/* Affix decals */}
          {sizing.level > 0 && spec.decals.slice(0, sizing.level === 1 ? 2 : 4).map((d) => <Decal key={d.id} decal={d} />)}
        </g>

        {showBadges && sizing.level > 0 && (
          <g>
            <path d="M18 108 L55 108 L62 117 L55 126 L18 126 Z" fill="#A855F7" stroke="#000" strokeWidth="3" />
            <text x="39" y="121" textAnchor="middle" fontSize="11" fontWeight="900" fill="#000">RLC</text>
            {sizing.level > 1 && <text x="205" y="121" textAnchor="middle" fontSize="9" fontWeight="900" fill={frame.color}>{frame.stamp}</text>}
          </g>
        )}
      </svg>
    </div>
  );
};
