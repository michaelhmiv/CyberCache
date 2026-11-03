import React, { useEffect, useMemo, useRef } from 'react';
import {
  composeMaterialCached,
  paintMaterial,
  type MaterialDensity,
} from '@/lib/pixel/materialArt';
import { getMaterialVisual, getResourceVisual } from '@/constants/visualAssets';

/**
 * PixelMaterial — renders a material / essence / the Scrap
 * resource as STUFF pixel art (src/lib/pixel/materialArt.ts), the
 * sibling of PixelGear for the goods economy. Replaces every
 * letter-mark improvisation the surfaces used to carry (the Belt &
 * Stacks glyph map, the Workshop's second map, the Market's
 * one-pack-for-everything, the MaterialBadge letter tile).
 *
 * - `density`: 'object' (24-grid formed object — rows, market
 *   boxes, sheet stages) or 'thumb' (12-grid detail level 0,
 *   composed on its own grid, never a downscale — the 13–16px
 *   inline mounts).
 * - The render is cached module-wide by signature, so lists never
 *   repaint texels.
 */

const PAINT_SCALE = 4;

interface PixelMaterialProps {
  /** Registry id: a MaterialType / EssenceType value, or 'Scrap'. */
  id: string;
  /** Display width in CSS px (the grid is square; height follows). */
  size?: number;
  density?: MaterialDensity;
  className?: string;
  testId?: string;
}

export const PixelMaterial: React.FC<PixelMaterialProps> = React.memo(({
  id,
  size = 26,
  density = 'object',
  className = '',
  testId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const render = useMemo(() => composeMaterialCached(id, density), [id, density]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported — element + signature still render
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintMaterial(ctx, render, PAINT_SCALE);
  }, [render]);

  const label = id === 'Scrap' ? getResourceVisual('scrap').label : getMaterialVisual(id).label;

  return (
    <canvas
      ref={canvasRef}
      width={render.width * PAINT_SCALE}
      height={render.height * PAINT_SCALE}
      className={className}
      style={{ width: size, height: size, imageRendering: 'pixelated', flex: 'none' }}
      role="img"
      aria-label={label}
      data-testid={testId}
      data-signature={render.signature}
      data-density={density}
      data-material-id={id}
    />
  );
});

export default PixelMaterial;
