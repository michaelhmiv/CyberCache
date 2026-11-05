import React, { useEffect, useMemo, useRef } from 'react';
import {
  composeConsumableCached,
  paintConsumable,
  type ConsumableDensity,
} from '@/lib/pixel/consumableArt';
import { CONSUMABLES } from '@/constants/consumables';

/**
 * PixelConsumable — renders a consumable type as its formed-object
 * pixel art (src/lib/pixel/consumableArt.ts), the sibling of
 * PixelMaterial / PixelGear for the consumable family. Replaces
 * the §7 sheet glyph on every surface where a consumable appears
 * AS AN ITEM (vendor cards, market stack listings, the belt,
 * stacks, the picker, the inspect sheet). Glyphs remain the
 * correct render for UI chrome — tabs, chevrons, category tags.
 *
 * - `density`: 'object' (24-grid formed object — cards, rows,
 *   sheet stages) or 'thumb' (12-grid detail level 0, composed on
 *   its own grid, never a downscale — inline mounts).
 * - The render is cached module-wide by signature, so lists never
 *   repaint texels.
 */

const PAINT_SCALE = 4;

interface PixelConsumableProps {
  /** ConsumableType id (the def key in CONSUMABLES). */
  type: string;
  /** Display width in CSS px (the grid is square; height follows). */
  size?: number;
  density?: ConsumableDensity;
  className?: string;
  testId?: string;
}

export const PixelConsumable: React.FC<PixelConsumableProps> = React.memo(({
  type,
  size = 26,
  density = 'object',
  className = '',
  testId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const render = useMemo(() => composeConsumableCached(type, density), [type, density]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported — element + signature still render
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintConsumable(ctx, render, PAINT_SCALE);
  }, [render]);

  const label = CONSUMABLES[type]?.name ?? type;

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
      data-consumable-id={type}
    />
  );
});

export default PixelConsumable;
