import React from 'react';
import { PX_ICONS, PX_ICON_TONE_FILLS, type PxIconName, type PxIconSize } from '@/lib/pixel/icons';

export type { PxIconName, PxIconSize };

interface PxIconProps {
  name: PxIconName;
  /** Token sizes only (v2 size ramp): 13 inline, 17 default, 26 rows, 40 display. */
  size?: PxIconSize;
  className?: string;
  style?: React.CSSProperties;
  /** Accessible label; omit for decorative icons (aria-hidden). */
  title?: string;
}

/**
 * The one way icons render in this UI. Draws the 16x16 duotone pixel icon
 * from `src/lib/pixel/icons.ts` as inline SVG with crisp edges; the mass
 * rects take `currentColor`, so tint with text color exactly where the old
 * glyph span took a color. Nearest-neighbour look at every token size —
 * never rasterized, never an emoji.
 */
export const PxIcon: React.FC<PxIconProps> = ({ name, size = 17, className, style, title }) => {
  const rects = PX_ICONS[name];
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block', flex: 'none', verticalAlign: '-2px', ...style }}
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {rects.map((r, i) => {
        const tone = r[4];
        const toneFill = tone ? PX_ICON_TONE_FILLS[tone] : undefined;
        return (
          <rect
            key={i}
            x={r[0]}
            y={r[1]}
            width={r[2]}
            height={r[3]}
            fill={toneFill ? toneFill.fill : 'currentColor'}
            opacity={toneFill ? toneFill.opacity : undefined}
          />
        );
      })}
    </svg>
  );
};

export default PxIcon;

/**
 * The icon's rect group on its own, for embedding inside a larger SVG
 * (keystone art, stage decorations). Position/scale with a wrapping
 * <g transform={...}>; rects occupy the 16x16 grid.
 */
export const PxIconGlyph: React.FC<{ name: PxIconName; color?: string }> = ({ name, color }) => (
  <g fill={color ?? 'currentColor'}>
    {PX_ICONS[name].map((r, i) => {
      const tone = r[4];
      const toneFill = tone ? PX_ICON_TONE_FILLS[tone] : undefined;
      return (
        <rect
          key={i}
          x={r[0]}
          y={r[1]}
          width={r[2]}
          height={r[3]}
          fill={toneFill ? toneFill.fill : undefined}
          opacity={toneFill ? toneFill.opacity : undefined}
        />
      );
    })}
  </g>
);
