import React, { useEffect, useRef } from 'react';

/**
 * PixelGridCanvas — the canvas host for authored texel grids.
 *
 * Paints a string grid (one char per cell, '.' = transparent) onto a
 * canvas whose backing store is exactly the grid — one canvas pixel
 * per texel — scaled by CSS with nearest-neighbour sampling. This is
 * the non-SVG rendering host for small authored pixel art converted
 * off vector shapes (keystone nodes, the consumable ring, spark
 * bursts, drop icons): the art is grid data under the pxl-craft
 * standard, the host is a plain canvas.
 *
 * `paintOver` runs after the grid paint in grid coordinates (1 unit
 * = 1 texel) for callers that composite existing grid data of their
 * own on top (e.g. PX_ICONS rect data inside a keystone node).
 */
export interface PixelGridPaletteEntry {
  color: string;
  alpha?: number;
}

export type PixelGridPalette = Record<string, PixelGridPaletteEntry>;

interface PixelGridCanvasProps extends Omit<React.CanvasHTMLAttributes<HTMLCanvasElement>, 'width' | 'height'> {
  rows: string[];
  palette: PixelGridPalette;
  paintOver?: (ctx: CanvasRenderingContext2D) => void;
}

export const PixelGridCanvas: React.FC<PixelGridCanvasProps> = ({ rows, palette, paintOver, style, ...rest }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const height = rows.length;
  const width = height > 0 ? rows[0].length : 0;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < height; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const key = row[x];
        if (key === '.') continue;
        const entry = palette[key];
        if (!entry) continue;
        ctx.globalAlpha = entry.alpha ?? 1;
        ctx.fillStyle = entry.color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    paintOver?.(ctx);
  });

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ imageRendering: 'pixelated', ...style }}
      {...rest}
    />
  );
};

export default PixelGridCanvas;
