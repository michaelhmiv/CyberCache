import React from 'react';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { buildWeaponVisualSpec, type WeaponVisualSpec } from '@/lib/weaponArt/buildWeaponVisualSpec';
import { SharedDefs, surfaceFilterId } from '@/components/gearArt/SharedDefs';
import { computeAttachPoints, barrelAttachments, sightAttachments, gripAttachments } from '@/lib/gearArt/partPlacement';

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
  const rar: Rarity | string = props.rarity ?? Rarity.Common;
  return buildWeaponVisualSpec({
    id: `preview-${props.type || WeaponType.Pistol}-${props.manufacturer || Manufacturer.Redline}-${props.element || Element.Kinetic}`,
    weaponType: props.type || WeaponType.Pistol,
    manufacturer: props.manufacturer || Manufacturer.Redline,
    element: props.element || Element.Kinetic,
    rarity: rar,
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

const Shape: React.FC<{ d?: string; fill: string; opacity?: number; strokeWidth?: number; filter?: string }> = ({ d, fill, opacity = 1, strokeWidth = 5, filter }) => {
  if (!d) return null;
  return <path d={d} fill={fill} opacity={opacity} stroke="#000000" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" filter={filter} />;
};

// ============================================================================
// PANEL LINES — thin seam / panel-gap lines that make weapons look constructed
// ============================================================================
const PanelLines: React.FC<{ spec: WeaponVisualSpec; detail: number }> = ({ spec, detail }) => {
  const panelLines = spec.silhouette.panelLines;
  if (!panelLines || detail === 0) return null;
  return (
    <g fill="none" stroke="#000000" strokeWidth="1.5" opacity="0.45" strokeLinecap="round">
      {panelLines.split(' M').map((segment, i) => {
        const path = i === 0 ? segment : `M${segment}`;
        return <path key={i} d={path} />;
      })}
    </g>
  );
};

// ============================================================================
// STRUCTURAL DETAIL — raised plates, rail mounts, reinforcement
// ============================================================================
const StructuralDetail: React.FC<{ spec: WeaponVisualSpec; detail: number }> = ({ spec, detail }) => {
  const structural = spec.silhouette.structural;
  if (!structural || detail === 0) return null;
  const style = spec.manufacturerStyle;
  return (
    <g>
      {structural.split(' M').map((segment, i) => {
        const path = i === 0 ? segment : `M${segment}`;
        return (
          <path
            key={i}
            d={path}
            fill={style.light}
            opacity="0.55"
            stroke="#000000"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            filter="url(#bevel-sm)"
          />
        );
      })}
    </g>
  );
};

// ============================================================================
// MANUFACTURER MOTIF — decorative pattern on weapon body
// ============================================================================
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

// ============================================================================
// PART ATTACHMENTS — parameterized by silhouette geometry
// ============================================================================
const PartAttachments: React.FC<{ spec: WeaponVisualSpec; detail: number }> = ({ spec, detail }) => {
  const { partVariants: parts, manufacturerStyle: style, elementVisual } = spec;
  if (detail === 0) return null;

  const barrels = barrelAttachments(spec);
  const sights = sightAttachments(spec);
  const grips = gripAttachments(spec);

  return (
    <g>
      {/* Barrel attachment — 3 variants */}
      {parts.Barrel % 3 < barrels.length && (
        <path d={barrels[parts.Barrel % 3].d} fill={style.light} {...innerStroke} filter="url(#bevel-sm)" />
      )}

      {/* Sight attachment — 3 variants */}
      {parts.Sight > 1 && parts.Sight % 3 < sights.length && (
        <path d={sights[parts.Sight % 3].d} fill={style.dark} {...innerStroke} filter="url(#bevel-sm)" />
      )}

      {/* Magazine variant */}
      {parts.Magazine > 2 && (
        <path d={`M${spec.silhouette.anchor.x + 88} ${spec.silhouette.anchor.y + 37} L${spec.silhouette.anchor.x + 121} ${spec.silhouette.anchor.y + 37} L${spec.silhouette.anchor.x + 114} ${spec.silhouette.anchor.y + 74} L${spec.silhouette.anchor.x + 81} ${spec.silhouette.anchor.y + 73} Z`} fill={style.dark} {...innerStroke} />
      )}

      {/* Chamber glow — element-colored */}
      {parts.Chamber > 1 && (
        <circle cx={spec.silhouette.anchor.x + 116} cy={spec.silhouette.anchor.y + 23} r="13" fill={elementVisual.color} opacity="0.8" stroke="#000" strokeWidth="4" />
      )}

      {/* Grip variants */}
      {parts.Grip > 2 && parts.Grip % 3 < grips.length && (
        <path d={grips[parts.Grip % 3].d} fill={style.dark} {...innerStroke} filter="url(#bevel-sm)" />
      )}

      {/* Core plate — raised center reinforcement */}
      {parts.Core > 2 && (
        <path d={`M${spec.silhouette.anchor.x + 65} ${spec.silhouette.anchor.y + 15} L${spec.silhouette.anchor.x + 105} ${spec.silhouette.anchor.y + 12} L${spec.silhouette.anchor.x + 114} ${spec.silhouette.anchor.y + 22} L${spec.silhouette.anchor.x + 106} ${spec.silhouette.anchor.y + 34} L${spec.silhouette.anchor.x + 64} ${spec.silhouette.anchor.y + 35} L${spec.silhouette.anchor.x + 55} ${spec.silhouette.anchor.y + 24} Z`} fill={style.light} opacity="0.62" {...innerStroke} filter="url(#bevel-sm)" />
      )}
    </g>
  );
};

// ============================================================================
// INTEGRATED ELEMENT EFFECTS — element bleeds into weapon body, not just muzzle
// ============================================================================
const ElementEffect: React.FC<{ spec: WeaponVisualSpec; detail: number; animate: boolean }> = ({ spec, detail, animate }) => {
  const element = spec.element;
  const color = spec.elementVisual.color;
  const accent = spec.elementVisual.accentColor;
  const animatedClass = animate ? 'animate-pulse' : '';
  const pts = computeAttachPoints(spec);
  const cx = pts.chamberCenter.x;
  const cy = pts.chamberCenter.y;

  switch (element) {
    case Element.Fire: {
      // Fire bleeds from chamber forward along top rail, with heat vent glow
      return (
        <g className={animatedClass} opacity="0.92">
          {/* Chamber heat core */}
          <circle cx={cx} cy={cy} r="10" fill={color} stroke="#000" strokeWidth="2" opacity="0.7" />
          <circle cx={cx} cy={cy} r="5" fill={accent} opacity="0.9" />
          {/* Heat veins along body toward barrel */}
          <path d={`M${cx + 10} ${cy - 3} Q${cx + 30} ${cy - 14} ${pts.barrelTip.x - 20} ${pts.barrelTip.y - 8}`} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
          <path d={`M${cx + 10} ${cy + 5} Q${cx + 28} ${cy + 18} ${pts.barrelTip.x - 16} ${pts.barrelTip.y}`} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
          {/* Muzzle heat flare */}
          <path d={`M${pts.barrelTip.x - 10} ${pts.barrelTip.y - 6} L${pts.barrelTip.x + 12} ${pts.barrelTip.y + 3} L${pts.barrelTip.x - 8} ${pts.barrelTip.y + 8} C${pts.barrelTip.x} ${pts.barrelTip.y - 1} ${pts.barrelTip.x - 4} ${pts.barrelTip.y - 2} ${pts.barrelTip.x - 10} ${pts.barrelTip.y - 6} Z`} fill={accent} stroke="#000" strokeWidth="2" />
          {detail > 1 && <path d={`M${cx - 25} ${cy + 15} Q${cx - 10} ${cy + 28} ${cx + 15} ${cy + 22}`} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.5" />}
        </g>
      );
    }
    case Element.Shock: {
      // Shock: circuit traces along body + arcing at chamber and muzzle
      return (
        <g fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" className={animatedClass}>
          {/* Chamber node */}
          <circle cx={cx} cy={cy} r="6" fill={color} stroke="#000" strokeWidth="2" />
          <circle cx={cx} cy={cy} r="3" fill={accent} />
          {/* Arc paths from chamber to barrel */}
          <path d={`M${cx + 5} ${cy - 4} L${cx + 25} ${cy - 12} L${pts.barrelTip.x - 18} ${pts.barrelTip.y - 10}`} />
          <path d={`M${cx + 5} ${cy + 6} L${cx + 22} ${cy + 15} L${pts.barrelTip.x - 22} ${pts.barrelTip.y + 5}`} />
          {detail > 0 && (
            <>
              <path d={`M${cx - 20} ${cy - 2} L${cx - 10} ${cy + 10}`} />
              <path d={`M${pts.barrelTip.x - 8} ${pts.barrelTip.y - 6} L${pts.barrelTip.x + 6} ${pts.barrelTip.y + 4} L${pts.barrelTip.x - 2} ${pts.barrelTip.y + 12}`} />
            </>
          )}
        </g>
      );
    }
    case Element.Corrosive: {
      // Corrosive: acid drip marks from chamber, green staining on body
      return (
        <g className={animatedClass}>
          {/* Chamber acid pool */}
          <ellipse cx={cx} cy={cy + 2} rx="10" ry="5" fill={color} stroke="#000" strokeWidth="2" opacity="0.6" />
          {/* Drip trails down from chamber */}
          <path d={`M${cx - 5} ${cy + 6} Q${cx - 7} ${cy + 18} ${cx - 4} ${cy + 22}`} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
          <path d={`M${cx + 4} ${cy + 8} Q${cx + 6} ${cy + 20} ${cx + 3} ${cy + 26}`} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
          {/* Acid-etched barrel ring */}
          <ellipse cx={pts.barrelTip.x - 12} cy={pts.barrelTip.y} rx="6" ry="4" fill="none" stroke={color} strokeWidth="2" opacity="0.5" />
          {detail > 0 && (
            <>
              <circle cx={cx - 20} cy={cy + 5} r="3" fill={accent} stroke="#000" strokeWidth="1.5" opacity="0.7" />
              <circle cx={pts.barrelTip.x - 20} cy={pts.barrelTip.y - 3} r="2" fill={color} stroke="#000" strokeWidth="1.5" opacity="0.6" />
            </>
          )}
        </g>
      );
    }
    case Element.Cryo: {
      // Cryo: frost creeping from chamber outward, ice crystal formations
      return (
        <g className={animatedClass} fill={accent} stroke="#000" strokeWidth="2" opacity="0.9">
          {/* Frost core at chamber */}
          <path d={`M${cx - 8} ${cy - 6} L${cx + 8} ${cy - 8} L${cx + 10} ${cy + 6} L${cx - 6} ${cy + 8} Z`} fill={color} />
          {/* Ice crystal spikes on body */}
          <path d={`M${cx - 18} ${cy - 4} L${cx - 8} ${cy - 10} L${cx - 12} ${cy}`} />
          <path d={`M${cx + 14} ${cy - 10} L${cx + 6} ${cy - 2} L${cx + 18} ${cy + 2}`} />
          {/* Frost on barrel */}
          <path d={`M${pts.barrelTip.x - 24} ${pts.barrelTip.y - 6} L${pts.barrelTip.x - 16} ${pts.barrelTip.y - 12} L${pts.barrelTip.x - 20} ${pts.barrelTip.y} Z`} opacity="0.7" />
          {detail > 0 && (
            <path d={`M${cx - 5} ${cy + 10} L${cx + 12} ${cy + 14} L${cx + 8} ${cy + 20}`} fill={color} opacity="0.8" />
          )}
        </g>
      );
    }
    case Element.Void: {
      // Void: distortion ripples from chamber, glitch lines across body
      return (
        <g className={animatedClass} opacity="0.9">
          {/* Chamber void core */}
          <ellipse cx={cx} cy={cy} rx="12" ry="8" fill={color} stroke="#000" strokeWidth="3" />
          {/* Distortion rings around chamber */}
          <ellipse cx={cx} cy={cy - 1} rx="8" ry="5" fill="none" stroke={accent} strokeWidth="2" opacity="0.6" />
          {/* Glitch lines radiating outward */}
          <path d={`M${cx + 12} ${cy - 3} L${pts.barrelTip.x - 15} ${pts.barrelTip.y - 5} M${cx - 12} ${cy + 2} L${cx - 30} ${cy + 8}`} stroke={color} strokeWidth="3" strokeLinecap="round" />
          <path d={`M${cx + 5} ${cy + 8} L${cx + 18} ${cy + 15} M${cx - 8} ${cy - 6} L${cx - 22} ${cy - 10}`} stroke={accent} strokeWidth="2" strokeLinecap="round" />
          {detail > 1 && (
            <>
              <path d={`M${pts.barrelTip.x - 20} ${pts.barrelTip.y - 8} L${pts.barrelTip.x - 5} ${pts.barrelTip.y + 6}`} stroke={color} strokeWidth="2" />
              <path d={`M${cx - 15} ${cy + 12} L${cx - 25} ${cy + 2}`} stroke={accent} strokeWidth="1.5" />
            </>
          )}
        </g>
      );
    }
    case Element.Kinetic:
    default:
      return detail > 0 ? (
        <g stroke={accent} strokeWidth="2" opacity="0.42">
          {/* Ballistic striations along barrel */}
          <path d={`M${pts.topRail.x1} ${pts.topRail.y1} L${pts.topRail.x2 - 20} ${pts.topRail.y2}`} />
          <path d={`M${pts.topRail.x1 + 8} ${pts.topRail.y1 + 8} L${pts.topRail.x2 - 15} ${pts.topRail.y2 + 5}`} />
          <path d={`M${pts.barrelBase.x + 2} ${pts.barrelBase.y + 2} L${pts.barrelTip.x - 10} ${pts.barrelTip.y + 2}`} />
        </g>
      ) : null;
  }
};

import { Decal } from '@/components/gearArt/Decal';

// ============================================================================
// RARITY FRAME — border, glow, rarity badge
// ============================================================================
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

// ============================================================================
// CONDITION MARKS — visual wear based on rollQuality
// ============================================================================
const ConditionMarks: React.FC<{ spec: WeaponVisualSpec; detail: number }> = ({ spec, detail }) => {
  if (detail === 0) return null;
  if (spec.condition === 'godroll') {
    return (
      <g>
        <path d="M33 86 L52 78 L70 85 L53 94 Z" fill="#FFEA3A" stroke="#000" strokeWidth="3" />
        <path d="M160 82 L178 76 L192 83 L176 90 Z" fill="#FFEA3A" stroke="#000" strokeWidth="2.5" />
      </g>
    );
  }
  if (spec.condition === 'mint') {
    return <path d="M35 88 L76 81" stroke="#F5F5F5" strokeWidth="3" strokeLinecap="round" opacity="0.75" />;
  }
  if (spec.condition === 'clean') {
    return <path d="M35 88 L60 83" stroke="#F5F5F5" strokeWidth="2" strokeLinecap="round" opacity="0.4" />;
  }
  if (spec.condition === 'field-used' || spec.condition === 'beat-up') {
    const opacity = spec.condition === 'beat-up' ? 0.7 : 0.35;
    return (
      <g stroke="#000" strokeWidth="3" opacity={opacity}>
        <path d="M71 42 L83 51" />
        <path d="M112 62 L126 54" />
        <path d="M158 43 L170 51" />
        {spec.condition === 'beat-up' && (
          <>
            <path d="M90 44 L98 52" />
            <path d="M138 60 L148 52" />
          </>
        )}
      </g>
    );
  }
  return null;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
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
  const surfFilter = surfaceFilterId(spec.manufacturerVisual.texture);
  const decalCount = sizing.level === 0 ? 0 : sizing.level === 1 ? 3 : 5;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: sizing.px, height: Math.round(sizing.px * 0.58), filter: frame.glow }}
      title={`${spec.rarity} ${spec.manufacturer} ${spec.element} ${spec.type}`}
    >
      <svg viewBox="0 0 240 120" width="100%" height="100%" role="img" aria-label={`${spec.rarity} ${spec.element} ${spec.type}`}>
        <defs>
          {/* Shared surface texture filters */}
          <SharedDefs />

          {/* Per-instance drop shadow for legendary/epic */}
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={frame.color} floodOpacity="0.55" />
          </filter>

          {/* Body gradient (fallback when no surface filter applies) */}
          <linearGradient id={`${filterId}-body`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor={style.light} />
            <stop offset="42%" stopColor={style.primary} />
            <stop offset="100%" stopColor={style.dark} />
          </linearGradient>

          {/* Element gradient */}
          <linearGradient id={`${filterId}-element`} x1="0" x2="1">
            <stop offset="0%" stopColor={spec.elementVisual.color} />
            <stop offset="100%" stopColor={spec.elementVisual.accentColor} />
          </linearGradient>
        </defs>

        {/* Rarity frame behind everything */}
        <RarityFrame spec={spec} detail={sizing.level} />

        {/* Glow filter wrapper for legendary/epic */}
        <g filter={spec.rarity === Rarity.Legendary || spec.rarity === Rarity.Epic ? `url(#${filterId})` : undefined}>
          {/* Manufacturer frame outline */}
          <Shape d={style.frameD} fill={style.dark} opacity={0.38} strokeWidth={4} />

          {/* Silhouette layers — back to front */}
          <Shape d={silhouette.stock} fill={style.dark} />
          <Shape d={silhouette.grip} fill={style.dark} />
          <Shape d={silhouette.magazine} fill={style.dark} />

          {/* Body with surface texture filter if applicable */}
          <Shape
            d={silhouette.body}
            fill={surfFilter ? style.primary : `url(#${filterId}-body)`}
            opacity={surfFilter ? 0.95 : 1}
            filter={surfFilter ? `url(#${surfFilter})` : undefined}
          />

          {/* Apply surface texture to chamber if same material */}
          <Shape
            d={silhouette.chamber}
            fill={spec.element === Element.Kinetic ? style.light : (surfFilter ? spec.elementVisual.color : `url(#${filterId}-element)`)}
            opacity={0.92}
            strokeWidth={4}
            filter={spec.element === Element.Kinetic && surfFilter ? `url(#${surfFilter})` : undefined}
          />

          <Shape d={silhouette.barrel} fill={style.primary} filter={surfFilter ? `url(#${surfFilter})` : undefined} />
          <Shape d={silhouette.muzzle} fill={style.dark} />
          <Shape d={silhouette.sight} fill={style.dark} strokeWidth={4} />

          {/* Detail layers */}
          <PanelLines spec={spec} detail={sizing.level} />
          <StructuralDetail spec={spec} detail={sizing.level} />
          <PartAttachments spec={spec} detail={sizing.level} />
          <StripeMotif spec={spec} detail={sizing.level} />

          {/* Element effect — now integrated into the body */}
          <ElementEffect spec={spec} detail={sizing.level} animate={animate} />

          {/* Condition marks */}
          <ConditionMarks spec={spec} detail={sizing.level} />

          {/* Affix decals */}
          {sizing.level > 0 && spec.decals.slice(0, decalCount).map((decal) => (
            <Decal key={decal.id} decal={decal} />
          ))}
        </g>

        {/* Manufacturer / element / rarity badges */}
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
