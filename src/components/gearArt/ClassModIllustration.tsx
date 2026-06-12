import React from 'react';
import type { ClassMod } from '@/types/items';
import { Rarity } from '@/types/game';
import { buildClassModVisualSpec, type ClassModVisualSpec } from '@/lib/gearArt/buildClassModVisualSpec';
import { SharedDefs } from '@/components/gearArt/SharedDefs';
import { surfaceFilterId } from '@/lib/gearArt/surfaceFilter';
import { Decal } from './Decal';

interface ClassModIllustrationProps {
  mod?: ClassMod;
  rarity?: Rarity | string;
  size?: 'thumb' | 'card' | 'showcase' | number;
  className?: string;
  showBadges?: boolean;
  animate?: boolean;
}

const SIZE_PX = { thumb: 46, card: 70, showcase: 190 };
const DETAIL_LEVEL = { thumb: 0, card: 1, showcase: 2 };

function toSize(size: ClassModIllustrationProps['size']) {
  if (typeof size === 'number') return { px: size, level: size >= 120 ? 2 : size >= 60 ? 1 : 0 };
  const key = size || 'card';
  return { px: SIZE_PX[key], level: DETAIL_LEVEL[key] };
}

function fallbackSpec(props: ClassModIllustrationProps): ClassModVisualSpec {
  return buildClassModVisualSpec({ id: 'classmod-preview', name: 'Preview Class Mod', rarity: props.rarity ?? Rarity.Common, treeBonus: 'Balanced', nodeBoosts: {} });
}

const innerStroke = {
  stroke: '#000000', strokeWidth: 3,
  strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const,
};

export const ClassModIllustration: React.FC<ClassModIllustrationProps> = ({
  mod, rarity, size = 'card', className = '', showBadges = true, animate = false,
}) => {
  const sizing = toSize(size);
  const spec = mod ? buildClassModVisualSpec(mod) : fallbackSpec({ rarity });
  const sil = spec.silhouette;
  const frame = spec.rarityFrame;
  const filterId = `classmod-glow-${spec.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const surfFilter = surfaceFilterId(spec.texture);
  const animatedClass = animate ? 'animate-pulse' : '';
  const decalCount = sizing.level === 0 ? 0 : sizing.level === 1 ? 2 : 3;

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: sizing.px, height: Math.round(sizing.px * 0.85), filter: frame.glow }}
      title={`${spec.rarity} ${spec.treeBonus} Class Mod`}>
      <svg viewBox="0 0 240 120" width="100%" height="100%" role="img">
        <defs>
          <SharedDefs />
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={frame.color} floodOpacity="0.55" />
          </filter>
          <linearGradient id={`${filterId}-processor`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#06B6D4" />
            <stop offset="100%" stopColor="#A5F3FC" />
          </linearGradient>
        </defs>

        <path d="M8 12 L226 12 L236 24 L232 96 L218 108 L12 108 L4 96 L8 12 Z" fill="rgba(5,6,8,0.92)" stroke="#000" strokeWidth="6" />
        <path d="M13 17 L221 17 L230 28 L226 92 L215 103 L16 103 L10 93 L13 17 Z" fill="none" stroke={frame.color} strokeWidth={frame.strokeWidth} opacity="0.95" />

        <g filter={spec.rarity === Rarity.Legendary || spec.rarity === Rarity.Epic ? `url(#${filterId})` : undefined}>
          {/* Mounting bracket */}
          <path d={sil.bracket} fill="#2a2a35" {...innerStroke} filter="url(#bevel-sm)" />

          {/* Edge contacts */}
          <path d={sil.contacts} fill="#FFEA3A" opacity="0.5" {...innerStroke} />

          {/* Side capacitors */}
          <path d={sil.capacitors} fill="#2a2a35" {...innerStroke} filter="url(#bevel-sm)" />
          {sizing.level > 0 && (
            <>
              <circle cx="58" cy="68" r="3" fill="#06B6D4" opacity="0.7" stroke="#000" strokeWidth="1.5" />
              <circle cx="182" cy="68" r="3" fill="#06B6D4" opacity="0.7" stroke="#000" strokeWidth="1.5" />
            </>
          )}

          {/* Main PCB board */}
          <path d={sil.board} fill="#1e3a5f" opacity="0.92" {...innerStroke} filter={surfFilter ? `url(#${surfFilter})` : undefined} />

          {/* Heatsink top */}
          <path d={sil.heatsink} fill="#3a5068" {...innerStroke} filter="url(#bevel-sm)" />

          {/* Circuit traces */}
          {sizing.level > 0 && sil.traces && (
            <g fill="none" stroke="#06B6D4" strokeWidth="1.5" opacity="0.5">
              {sil.traces.split(' M').map((seg, i) => {
                const path = i === 0 ? seg : `M${seg}`;
                return <path key={i} d={path} />;
              })}
            </g>
          )}

          {/* Processor die */}
          <path d={sil.processor} fill={`url(#${filterId}-processor)`} opacity="0.88" stroke="#000" strokeWidth="2.5" strokeLinejoin="round" className={animatedClass} />
          {sizing.level > 0 && (
            <circle cx="120" cy="60" r="8" fill="none" stroke="#A5F3FC" strokeWidth="1" opacity="0.6" className={animatedClass} />
          )}

          {/* Affix decals */}
          {sizing.level > 0 && spec.decals.slice(0, decalCount).map((d) => <Decal key={d.id} decal={d} />)}
        </g>

        {showBadges && sizing.level > 0 && (
          <g>
            <path d="M18 83 L55 83 L62 92 L55 101 L18 101 Z" fill="#06B6D4" stroke="#000" strokeWidth="3" />
            <text x="39" y="96" textAnchor="middle" fontSize="11" fontWeight="900" fill="#000">MOD</text>
            {sizing.level > 1 && <text x="205" y="96" textAnchor="middle" fontSize="9" fontWeight="900" fill={frame.color}>{frame.stamp}</text>}
          </g>
        )}
      </svg>
    </div>
  );
};
