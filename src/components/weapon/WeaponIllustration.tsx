import React from 'react';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { buildWeaponVisualSpec, type WeaponVisualDecal, type WeaponVisualSpec } from '@/lib/weaponArt/buildWeaponVisualSpec';

export type WeaponIllustrationSize = 'thumb' | 'card' | 'showcase';

interface WeaponIllustrationProps {
  weapon?: Weapon;
  type?: WeaponType;
  manufacturer?: Manufacturer;
  element?: Element;
  rarity?: Rarity | string;
  visualSeed?: number;
  size?: WeaponIllustrationSize | number;
  className?: string;
  showBadges?: boolean;
  animate?: boolean;
}

const SIZE_PX: Record<WeaponIllustrationSize, number> = {
  thumb: 46,
  card: 70,
  showcase: 190,
};

const DETAIL_LEVEL: Record<WeaponIllustrationSize, number> = {
  thumb: 0,
  card: 1,
  showcase: 2,
};

function toSize(size: WeaponIllustrationProps['size']) {
  if (typeof size === 'number') return { px: size, level: size >= 120 ? 2 : size >= 60 ? 1 : 0 };
  const key = size || 'card';
  return { px: SIZE_PX[key], level: DETAIL_LEVEL[key] };
}

function fallbackSpec(props: WeaponIllustrationProps): WeaponVisualSpec {
  return buildWeaponVisualSpec({
    id: `preview-${props.type || WeaponType.Pistol}-${props.manufacturer || Manufacturer.Redline}-${props.element || Element.Kinetic}`,
    weaponType: props.type || WeaponType.Pistol,
    manufacturer: props.manufacturer || Manufacturer.Redline,
    element: props.element || Element.Kinetic,
    rarity: props.rarity || Rarity.Common,
    pixelSeed: props.visualSeed || 1,
    rollQuality: 50,
    parts: [],
    affixes: [],
  });
}

const innerStroke = {
  stroke: '#000000',
  strokeWidth: 3,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
};

const Shape: React.FC<{ d?: string; fill: string; opacity?: number; strokeWidth?: number }> = ({ d, fill, opacity = 1, strokeWidth = 5 }) => {
  if (!d) return null;
  return <path d={d} fill={fill} opacity={opacity} stroke="#000000" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />;
};

const StripeMotif: React.FC<{ spec: WeaponVisualSpec; detail: number }> = ({ spec, detail }) => {
  const style = spec.manufacturerStyle;
  if (detail === 0) return null;

  switch (style.motif) {
    case 'slashes':
      return (
        <g opacity="0.95">
          <path d="M72 43 L88 40 L78 67 L62 69 Z" fill={style.trim} stroke="#000" strokeWidth="2" />
          <path d="M103 39 L119 38 L109 66 L93 67 Z" fill={style.dark} stroke="#000" strokeWidth="2" />
        </g>
      );
    case 'bolts':
      return (
        <g fill={style.trim} stroke="#000" strokeWidth="2">
          {[62, 90, 119, 151].map((x) => <circle key={x} cx={x} cy="53" r="4" />)}
        </g>
      );
    case 'vents':
      return (
        <g stroke="#000" strokeWidth="2" fill={style.dark}>
          {[76, 91, 106, 121].map((x) => <path key={x} d={`M${x} 47 L${x + 10} 46 L${x + 6} 61 L${x - 4} 62 Z`} />)}
        </g>
      );
    case 'crystals':
      return (
        <g stroke="#000" strokeWidth="2">
          <path d="M79 43 L96 37 L112 47 L98 63 L80 60 Z" fill={style.light} />
          <path d="M134 42 L151 36 L166 48 L151 63 L136 59 Z" fill={style.trim} opacity="0.82" />
        </g>
      );
    case 'modules':
      return (
        <g stroke="#000" strokeWidth="2" fill={style.dark}>
          <rect x="70" y="42" width="24" height="19" />
          <rect x="122" y="43" width="22" height="18" />
          <circle cx="102" cy="52" r="5" fill={style.trim} />
        </g>
      );
    case 'coils':
      return (
        <g fill="none" stroke={style.trim} strokeWidth="4" opacity="0.9">
          <path d="M73 51 C82 36 96 70 106 50 C116 31 130 70 140 49" strokeLinecap="round" />
          {detail > 1 && <path d="M151 45 C160 32 172 67 181 51" strokeLinecap="round" />}
        </g>
      );
    default:
      return null;
  }
};

const PartAttachments: React.FC<{ spec: WeaponVisualSpec; detail: number }> = ({ spec, detail }) => {
  const { partVariants: parts, manufacturerStyle: style, elementVisual } = spec;
  if (detail === 0) return null;

  return (
    <g>
      {parts.Barrel % 2 === 0 ? (
        <path d="M162 31 L187 27 L195 34 L169 39 Z" fill={style.light} {...innerStroke} />
      ) : (
        <path d="M160 61 L192 62 L185 72 L155 69 Z" fill={style.dark} {...innerStroke} />
      )}
      {parts.Sight > 1 && <path d="M101 23 L137 21 L146 31 L92 34 Z" fill={style.dark} {...innerStroke} />}
      {parts.Magazine > 2 && <path d="M108 67 L141 67 L134 107 L101 106 Z" fill={style.dark} {...innerStroke} />}
      {parts.Chamber > 1 && <circle cx="134" cy="53" r="13" fill={elementVisual.color} opacity="0.8" stroke="#000" strokeWidth="4" />}
      {parts.Grip > 2 && <path d="M60 82 L83 81 L79 112 L55 109 Z" fill={style.dark} {...innerStroke} />}
      {parts.Core > 2 && <path d="M83 45 L123 42 L132 52 L124 64 L82 65 L73 54 Z" fill={style.light} opacity="0.62" {...innerStroke} />}
    </g>
  );
};

const ElementEffect: React.FC<{ spec: WeaponVisualSpec; detail: number; animate: boolean }> = ({ spec, detail, animate }) => {
  const element = spec.element;
  const color = spec.elementVisual.color;
  const accent = spec.elementVisual.accentColor;
  const animatedClass = animate ? 'animate-pulse' : '';

  switch (element) {
    case Element.Fire:
      return (
        <g className={animatedClass} opacity="0.9">
          <path d="M198 39 L220 48 L199 57 C207 49 204 44 198 39 Z" fill={accent} stroke="#000" strokeWidth="2" />
          <path d="M189 43 L207 50 L190 56 C196 50 195 46 189 43 Z" fill={color} stroke="#000" strokeWidth="2" />
          {detail > 1 && <path d="M72 73 C82 83 100 82 108 71" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />}
        </g>
      );
    case Element.Shock:
      return (
        <g fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" className={animatedClass}>
          <path d="M172 33 L161 50 L178 48 L164 69" />
          {detail > 0 && <path d="M104 35 L96 51 L111 49 L100 66" />}
        </g>
      );
    case Element.Corrosive:
      return (
        <g className={animatedClass}>
          <circle cx="173" cy="62" r="7" fill={color} stroke="#000" strokeWidth="3" />
          <path d="M181 64 C187 75 178 80 172 71" fill={color} stroke="#000" strokeWidth="2" />
          {detail > 0 && <circle cx="101" cy="68" r="4" fill={accent} stroke="#000" strokeWidth="2" />}
        </g>
      );
    case Element.Cryo:
      return (
        <g className={animatedClass} fill={accent} stroke="#000" strokeWidth="2" opacity="0.9">
          <path d="M184 35 L196 42 L194 56 L181 62 L170 54 L172 40 Z" />
          {detail > 0 && <path d="M123 32 L132 38 L130 50 L119 54 L110 47 L112 36 Z" fill={color} />}
        </g>
      );
    case Element.Void:
      return (
        <g className={animatedClass} opacity="0.9">
          <ellipse cx="151" cy="53" rx="18" ry="11" fill={color} stroke="#000" strokeWidth="4" />
          <path d="M136 45 L165 62 M166 43 L139 64" stroke={accent} strokeWidth="3" strokeLinecap="round" />
          {detail > 1 && <path d="M67 40 L86 40 M73 70 L96 70 M178 30 L204 30" stroke={color} strokeWidth="3" />}
        </g>
      );
    case Element.Kinetic:
    default:
      return detail > 0 ? (
        <g stroke={accent} strokeWidth="2" opacity="0.42">
          <path d="M70 49 L119 45" />
          <path d="M80 61 L138 60" />
          <path d="M151 47 L192 48" />
        </g>
      ) : null;
  }
};

const Decal: React.FC<{ decal: WeaponVisualDecal }> = ({ decal }) => {
  const transform = `translate(${decal.x} ${decal.y}) rotate(${decal.rotate})`;
  if (decal.shape === 'tag') {
    return (
      <g transform={transform}>
        <path d="M-10 -7 L8 -7 L13 0 L8 7 L-10 7 Z" fill={decal.color} stroke="#000" strokeWidth="2" />
        <text x="0" y="4" textAnchor="middle" fontSize="9" fontWeight="900" fill="#000">{decal.label}</text>
      </g>
    );
  }
  if (decal.shape === 'diamond') return <rect x={decal.x - 6} y={decal.y - 6} width="12" height="12" transform={`rotate(45 ${decal.x} ${decal.y})`} fill={decal.color} stroke="#000" strokeWidth="2" />;
  if (decal.shape === 'triangle') return <path d={`M${decal.x} ${decal.y - 7} L${decal.x + 8} ${decal.y + 7} L${decal.x - 8} ${decal.y + 7} Z`} fill={decal.color} stroke="#000" strokeWidth="2" />;
  if (decal.shape === 'slash') return <path d={`M${decal.x - 8} ${decal.y + 8} L${decal.x + 8} ${decal.y - 8}`} stroke={decal.color} strokeWidth="5" strokeLinecap="round" />;
  return <circle cx={decal.x} cy={decal.y} r="5" fill={decal.color} stroke="#000" strokeWidth="2" />;
};

const RarityFrame: React.FC<{ spec: WeaponVisualSpec; detail: number }> = ({ spec, detail }) => {
  const frame = spec.rarityFrame;
  return (
    <g>
      <path d="M8 12 L226 12 L236 24 L232 96 L218 108 L12 108 L4 96 L8 12 Z" fill="rgba(5,6,8,0.92)" stroke="#000" strokeWidth="6" />
      <path d="M13 17 L221 17 L230 28 L226 92 L215 103 L16 103 L10 93 L13 17 Z" fill="none" stroke={frame.color} strokeWidth={frame.strokeWidth} opacity="0.95" />
      {detail > 0 && <path d="M20 24 L104 20 L94 27 L21 30 Z" fill={frame.color} opacity={frame.shineOpacity} />}
      {spec.rarity === Rarity.Legendary && (
        <g>
          <path d="M190 20 L218 20 L224 29 L213 39 L186 37 L181 27 Z" fill={frame.color} stroke="#000" strokeWidth="3" />
          <text x="203" y="33" textAnchor="middle" fontSize="10" fontWeight="900" fill="#000">LEG</text>
        </g>
      )}
    </g>
  );
};

const ConditionMarks: React.FC<{ spec: WeaponVisualSpec; detail: number }> = ({ spec, detail }) => {
  if (detail === 0) return null;
  if (spec.condition === 'godroll') {
    return <path d="M33 86 L52 78 L70 85 L53 94 Z" fill="#FFEA3A" stroke="#000" strokeWidth="3" />;
  }
  if (spec.condition === 'mint') {
    return <path d="M35 88 L76 81" stroke="#F5F5F5" strokeWidth="3" strokeLinecap="round" opacity="0.75" />;
  }
  if (spec.condition === 'beat-up' || spec.condition === 'field-used') {
    return (
      <g stroke="#000" strokeWidth="3" opacity="0.7">
        <path d="M71 42 L83 51" />
        <path d="M112 62 L126 54" />
        <path d="M158 43 L170 51" />
      </g>
    );
  }
  return null;
};

export const WeaponIllustration: React.FC<WeaponIllustrationProps> = ({
  weapon,
  type,
  manufacturer,
  element,
  rarity,
  visualSeed,
  size = 'card',
  className = '',
  showBadges = true,
  animate = false,
}) => {
  const sizing = toSize(size);
  const spec = weapon ? buildWeaponVisualSpec(weapon) : fallbackSpec({ type, manufacturer, element, rarity, visualSeed });
  const silhouette = spec.silhouette;
  const style = spec.manufacturerStyle;
  const frame = spec.rarityFrame;
  const filterId = `weapon-glow-${spec.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: sizing.px, height: Math.round(sizing.px * 0.58), filter: frame.glow }}
      title={`${spec.rarity} ${spec.manufacturer} ${spec.element} ${spec.type}`}
    >
      <svg viewBox="0 0 240 120" width="100%" height="100%" role="img" aria-label={`${spec.rarity} ${spec.element} ${spec.type}`}>
        <defs>
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={frame.color} floodOpacity="0.55" />
          </filter>
          <linearGradient id={`${filterId}-body`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor={style.light} />
            <stop offset="42%" stopColor={style.primary} />
            <stop offset="100%" stopColor={style.dark} />
          </linearGradient>
          <linearGradient id={`${filterId}-element`} x1="0" x2="1">
            <stop offset="0%" stopColor={spec.elementVisual.color} />
            <stop offset="100%" stopColor={spec.elementVisual.accentColor} />
          </linearGradient>
        </defs>

        <RarityFrame spec={spec} detail={sizing.level} />
        <g filter={spec.rarity === Rarity.Legendary || spec.rarity === Rarity.Epic ? `url(#${filterId})` : undefined}>
          <Shape d={style.frameD} fill={style.dark} opacity={0.38} strokeWidth={4} />
          <Shape d={silhouette.stock} fill={style.dark} />
          <Shape d={silhouette.grip} fill={style.dark} />
          <Shape d={silhouette.magazine} fill={style.dark} />
          <Shape d={silhouette.body} fill={`url(#${filterId}-body)`} />
          <Shape d={silhouette.chamber} fill={spec.element === Element.Kinetic ? style.light : `url(#${filterId}-element)`} opacity={0.92} strokeWidth={4} />
          <Shape d={silhouette.barrel} fill={style.primary} />
          <Shape d={silhouette.muzzle} fill={style.dark} />
          <Shape d={silhouette.sight} fill={style.dark} strokeWidth={4} />
          <PartAttachments spec={spec} detail={sizing.level} />
          <StripeMotif spec={spec} detail={sizing.level} />
          <ElementEffect spec={spec} detail={sizing.level} animate={animate} />
          <ConditionMarks spec={spec} detail={sizing.level} />
          {sizing.level > 0 && spec.decals.slice(0, sizing.level === 1 ? 3 : 5).map((decal) => <Decal key={decal.id} decal={decal} />)}
        </g>

        {showBadges && sizing.level > 0 && (
          <g>
            <path d="M18 83 L55 83 L62 92 L55 101 L18 101 Z" fill={style.primary} stroke="#000" strokeWidth="3" />
            <text x="39" y="96" textAnchor="middle" fontSize="11" fontWeight="900" fill="#000">{style.mark}</text>
            <path d="M64 83 L101 83 L108 92 L101 101 L64 101 Z" fill={spec.elementVisual.color} stroke="#000" strokeWidth="3" />
            <text x="85" y="96" textAnchor="middle" fontSize="11" fontWeight="900" fill="#000">{spec.elementVisual.shortLabel}</text>
            {sizing.level > 1 && (
              <text x="205" y="101" textAnchor="middle" fontSize="9" fontWeight="900" fill={frame.color}>{frame.stamp}</text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
};
