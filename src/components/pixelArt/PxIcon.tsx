import React from 'react';
import { PX_ICONS, PX_ICON_TONE_FILLS, type PxIconName, type PxIconSize } from '@/lib/pixel/icons';
import { colorFromClassName, normalizeIconColor, paintedIconFor } from '@/lib/pixel/iconPaintings';

export type { PxIconName, PxIconSize };

interface PxIconProps {
  name: PxIconName;
  /** Render size in px; the v2 ramp (13 inline, 17 default, 26 rows, 40 display) is preferred. */
  size?: PxIconSize;
  className?: string;
  style?: React.CSSProperties;
  /** Accessible label; omit for decorative icons (aria-hidden). */
  title?: string;
  /**
   * The deliberate state color this site resolves (hex), when the site
   * carries it in a variable the renderer cannot see (a wrapper's style,
   * a registry value). Painted glyphs select their BAKED variant for
   * this color (INT-10); stencil glyphs ignore it (tint via
   * currentColor as before).
   */
  color?: string;
}

/**
 * The one way icons render in this UI.
 *
 * Painted glyphs (INT-9's big slots + INT-10's functional set, owner
 * REBUILD ruling 2026-11-11) render their shipped painting: FIXED
 * glyphs as-is, VARIANT glyphs as the baked variant matching the color
 * this site resolves — the explicit `color` prop first, then
 * style.color, then the className's theme token. No painting is ever
 * tinted at runtime; selection is the whole mechanism.
 *
 * Everything else — the element badges' stencils (permanent, owner
 * ruling), the wallet sheet, and any glyph without a painting — draws
 * the 16x16 duotone pixel icon from `src/lib/pixel/icons.ts` as inline
 * SVG with crisp edges; the mass rects take `currentColor`, so tint
 * with text color exactly where the old glyph span took a color.
 * Nearest-neighbour look at every token size — never an emoji.
 */
export const PxIcon: React.FC<PxIconProps> = ({ name, size = 17, className, style, title, color }) => {
  const styleColor = typeof style?.color === 'string' ? style.color : undefined;
  const resolved = normalizeIconColor(color) ?? normalizeIconColor(styleColor) ?? colorFromClassName(className);
  const painting = paintedIconFor(name, resolved);
  if (painting) {
    return (
      <img
        src={painting}
        width={size}
        height={size}
        className={className}
        style={{ display: 'inline-block', flex: 'none', verticalAlign: '-2px', ...style }}
        alt={title ?? ''}
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        draggable={false}
      />
    );
  }
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
