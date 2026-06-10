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

const SIZE_PX: Record<IllustrationSize, number> = { thumb: 46, card: 70, showcase: 190 };
const DETAIL_LEVEL: Record<IllustrationSize, number> = { thumb: 0, card: 1, showcase: 2 };

function toSize(size: ShieldIllustrationProps['size']) {
  if (typeof size === 'number') return { px: size, level: size >= 120 ? 2 : size >= 60 ? 1 : 0 };
  const key = size || 'card';
  return { px: SIZE_PX[key], level: DETAIL_LEVEL[key] };
}

function fallbackSpec(props: ShieldIllustrationProps): ShieldVisualSpec {
  return buildShieldVisualSpec({
    id: 'shield-preview', name: 'Preview Shield',
    element: props.element || Element.Kinetic,
    rarity: props.rarity ?? Rarity.Common,
    hp: 100, rechargeRate: 10,
  } as any);
}

const innerStroke = {
  stroke: '#000000',
  strokeWidth: 3,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
};

export const ShieldIllustration: React.FC<ShieldIllustrationProps> = ({
  shield, element, rarity, size = 'card', className = '', showBadges = true, animate = false,
}) => {
  const sizing = toSize(size);
  const spec = shield ? buildShieldVisualSpec(shield as any) : fallbackSpec({ element, rarity });
  const sil = spec.silhouette;
  const frame = spec.rarityFrame;
  const el = spec.elementVisual;
  const filterId = `shield-glow-${spec.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const surfFilter = surfaceFilterId(spec.texture);
  const animatedClass = animate ? 'animate-pulse' : '';
  const decalCount = sizing.level === 0 ? 0 : sizing.level === 1 ? 3 : 5;

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
          <linearGradient id={`${filterId}-emitter`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={el.accentColor} stopOpacity="0.95" />
            <stop offset="50%" stopColor={el.color} stopOpacity="0.75" />
            <stop offset="100%" stopColor={el.color} stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id={`${filterId}-housing`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#2a2a35" />
            <stop offset="50%" stopColor="#1a1a22" />
            <stop offset="100%" stopColor="#0d0d14" />
          </linearGradient>
        </defs>

        {/* Rarity frame */}
        <path d="M8 12 L226 12 L236 24 L232 96 L218 108 L12 108 L4 96 L8 12 Z" fill="rgba(5,6,8,0.92)" stroke="#000" strokeWidth="6" />
        <path d="M13 17 L221 17 L230 28 L226 92 L215 103 L16 103 L10 93 L13 17 Z" fill="none" stroke={frame.color} strokeWidth={frame.strokeWidth} opacity="0.95" />

        <g filter={spec.rarity === Rarity.Legendary || spec.rarity === Rarity.Epic ? `url(#${filterId})` : undefined}>
          {/* Mount bracket — behind everything */}
          <path d={sil.mountBase} fill="#1a1a24" {...innerStroke} />

          {/* Capacitor banks (left + right power modules) */}
          <path d={sil.capLeft} fill="#2a2a35" {...innerStroke} filter="url(#bevel-sm)" />
          <path d={sil.capRight} fill="#2a2a35" {...innerStroke} filter="url(#bevel-sm)" />
          {/* Capacitor element glow dots */}
          {sizing.level > 0 && (
            <>
              <circle cx="30" cy="66" r="4" fill={el.color} opacity="0.7" stroke="#000" strokeWidth="2" className={animatedClass} />
              <circle cx="216" cy="66" r="4" fill={el.color} opacity="0.7" stroke="#000" strokeWidth="2" className={animatedClass} />
            </>
          )}

          {/* Heatsink fins — top */}
          <path d={sil.heatsink} fill="#3a3a48" {...innerStroke} filter="url(#bevel-sm)" />

          {/* Main housing / chassis */}
          <path d={sil.housing} fill={`url(#${filterId}-housing)`} {...innerStroke} filter={surfFilter ? `url(#${surfFilter})` : undefined} />

          {/* Structural reinforcement plates */}
          {sil.structural && (
            <path d={sil.structural} fill="#333340" opacity="0.6" {...innerStroke} filter="url(#bevel-sm)" />
          )}

          {/* Protective guard edge */}
          <path d={sil.guardEdge} fill="none" stroke={frame.color} strokeWidth="2" opacity="0.7" />

          {/* Energy field ring — containment around emitter */}
          <path d={sil.fieldRing} fill="none" stroke={el.accentColor} strokeWidth="1.5" opacity="0.5" className={animatedClass} />

          {/* Emitter plate — the actual shield energy face */}
          <path d={sil.emitter} fill={`url(#${filterId}-emitter)`} opacity="0.88" stroke="#000" strokeWidth="3" strokeLinejoin="round" />

          {/* Inner emitter glow pulse */}
          {sizing.level > 0 && (
            <path d={sil.fieldRing} fill={el.color} opacity={animate ? "0.12" : "0.08"} className={animatedClass} />
          )}

          {/* Panel lines */}
          {sizing.level > 0 && sil.panelLines && (
            <g fill="none" stroke="#000" strokeWidth="1.5" opacity="0.35">
              {sil.panelLines.split(' M').map((seg, i) => {
                const path = i === 0 ? seg : `M${seg}`;
                return <path key={i} d={path} />;
              })}
            </g>
          )}

          {/* Affix decals on the emitter face */}
          {sizing.level > 0 && spec.decals.slice(0, decalCount).map((d) => <Decal key={d.id} decal={d} />)}
        </g>

        {/* Manufacturer / element / rarity badges */}
        {showBadges && sizing.level > 0 && (
          <g>
            <path d="M18 108 L55 108 L62 117 L55 126 L18 126 Z" fill={el.color} stroke="#000" strokeWidth="3" />
            <text x="39" y="121" textAnchor="middle" fontSize="11" fontWeight="900" fill="#000">{el.shortLabel}</text>
            {sizing.level > 1 && (
              <text x="205" y="121" textAnchor="middle" fontSize="9" fontWeight="900" fill={frame.color}>{frame.stamp}</text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
};
