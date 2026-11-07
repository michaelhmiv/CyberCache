/**
 * SkillKeystoneArt — skill tree node art (pixel conversion, 2026-11-07).
 *
 * Was a procedural SVG (hexagon/octagon/12-point star paths, gradient
 * glow, stroke stubs). Under the owner's SVG-closure ruling it is now
 * authored texel data: the three node shapes are checked-in 30×30
 * grids (outline key 'E' takes the form's own border color — selout;
 * fill 'F', connection stubs 'S', inner marks 'A', radiating ticks
 * 'T', glow bands 'G'/'g'/'h'), painted on canvas by PixelGridCanvas.
 * The tree sigil and the lock mark are the game's PX_ICONS rect data,
 * composited over the grid exactly where the SVG embedded them.
 *
 * All colors derive from the SkillTreeVisual registry — nothing hardcoded
 * except the locked-state greys, as before.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { PixelGridCanvas, type PixelGridPalette } from '@/components/pixelArt/PixelGridCanvas';
import { PX_ICONS, PX_ICON_TONE_FILLS, type PxIconName } from '@/lib/pixel/icons';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import { buildKeystoneGrid } from '@/lib/pixel/keystoneArt';
import type { SkillTreeType } from '@/types/game';

type NodeType = 'small' | 'major' | 'keystone';

interface SkillKeystoneArtProps {
  tree: SkillTreeType;
  nodeType?: NodeType;
  unlocked?: boolean;
  locked?: boolean;
  /** Points actually spent in the node. The aria state distinguishes
   *  "available" (prerequisites met, nothing spent yet) from
   *  "unlocked" (points spent) — at 0 spent a node is available, not
   *  unlocked (QC 2026-11-02, A6). Absent = legacy two-state label. */
  spentPoints?: number;
  size?: number;
  className?: string;
  animate?: boolean;
}


/** Paint PX_ICONS rect data onto a canvas in grid coordinates. */
function paintGlyph(
  ctx: CanvasRenderingContext2D,
  name: PxIconName,
  originX: number,
  originY: number,
  scale: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const r of PX_ICONS[name]) {
    const tone = r[4];
    const toneFill = tone ? PX_ICON_TONE_FILLS[tone] : undefined;
    ctx.globalAlpha = alpha * (toneFill ? toneFill.opacity : 1);
    ctx.fillStyle = toneFill ? toneFill.fill : color;
    ctx.fillRect(originX + r[0] * scale, originY + r[1] * scale, r[2] * scale, r[3] * scale);
  }
  ctx.restore();
}

export const SkillKeystoneArt: React.FC<SkillKeystoneArtProps> = ({
  tree,
  nodeType = 'small',
  unlocked = false,
  locked = !unlocked,
  spentPoints,
  size = 40,
  className = '',
  animate = false,
}) => {
  const visual = getSkillTreeVisual(tree);
  const { rows, glowRows } = buildKeystoneGrid(nodeType, unlocked);

  const palette: PixelGridPalette = unlocked
    ? {
        F: { color: visual.color, alpha: 0.25 },
        E: { color: visual.color, alpha: 0.9 },
        S: { color: visual.color, alpha: 0.6 },
        A: { color: visual.accentColor, alpha: 0.8 },
        T: { color: visual.accentColor, alpha: 0.6 },
      }
    : {
        F: { color: '#3a3a4e', alpha: 0.5 },
        E: { color: '#666666', alpha: 0.5 },
        S: { color: '#555555', alpha: 0.3 },
        A: { color: '#888888', alpha: 0.8 },
        T: { color: '#888888', alpha: 0.6 },
      };
  const glowPalette: PixelGridPalette = {
    G: { color: visual.accentColor, alpha: 0.5 },
    g: { color: visual.accentColor, alpha: 0.3 },
    h: { color: visual.accentColor, alpha: 0.15 },
  };

  const paintOver = (ctx: CanvasRenderingContext2D) => {
    if (nodeType === 'keystone') {
      // Tree sigil: the SVG embedded the glyph at translate(22 22)
      // in the 60-box — grid origin (11, 11), half a texel per unit.
      paintGlyph(ctx, visual.sigil, 11, 11, 0.5, unlocked ? visual.accentColor : '#888888', 0.95);
    }
    if (locked) {
      // Lock mark: was the 'x' glyph at translate(23 23) scale(.875).
      paintGlyph(ctx, 'x', 11.5, 11.5, 0.4375, '#999999', 0.6);
    }
  };

  const glow = unlocked ? (
    <PixelGridCanvas rows={glowRows} palette={glowPalette} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
  ) : null;

  return (
    <span
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${visual.label} ${nodeType} node${spentPoints !== undefined ? (spentPoints > 0 ? ' (unlocked)' : unlocked ? ' (available)' : ' (locked)') : unlocked ? ' (unlocked)' : ' (locked)'}`}
    >
      {animate && unlocked ? (
        <motion.span
          className="absolute inset-0 block"
          animate={{ opacity: [0.55, 1, 0.55], scale: [1, 1.1, 1] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          {glow}
        </motion.span>
      ) : (
        glow
      )}
      <PixelGridCanvas
        rows={rows}
        palette={palette}
        paintOver={paintOver}
        className="absolute inset-0 block h-full w-full"
        aria-hidden="true"
      />
    </span>
  );
};

export default SkillKeystoneArt;
