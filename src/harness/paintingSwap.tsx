/**
 * CAPTURE-ONLY figure swap (branch dash/hunters-r2 — NEVER merged).
 * When the URL carries ?painting=vesper|silas|josie|doc|parade, the
 * hunter seat in the real stage components renders the Cache Hunters
 * painting (a 60x110 texel grid, code-side like all game art) INSTEAD
 * of the segmented part-set rig, at the exact placement the rig uses
 * (xPct / heightPct / groundY anchors unchanged). Without the param
 * every component renders exactly as shipped.
 */
import React, { useEffect, useRef } from 'react';
import { PAINTINGS, type PaintingDef } from './paintingData';

export type { PaintingDef };

export function activePainting(): PaintingDef | null {
  try {
    const p = new URLSearchParams(window.location.search).get('painting');
    return p ? PAINTINGS[p] ?? null : null;
  } catch {
    return null;
  }
}

export function paintingCanvas(def: PaintingDef): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 60;
  c.height = 110;
  const ctx = c.getContext('2d');
  if (ctx) {
    def.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch !== '.') {
          ctx.fillStyle = def.palette[ch.charCodeAt(0) - 65];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });
  }
  return c;
}

/** The painting seated exactly where PixelPartsActor sits: height as
 *  % of stage height, feet on the ground line, feet-centre on xPct. */
export const PaintedHunterFigure: React.FC<{
  painting: PaintingDef;
  xPct: number;
  heightPct: number;
  groundY: number;
  testId?: string;
}> = ({ painting, xPct, heightPct, groundY, testId }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (cv && ctx) {
      ctx.clearRect(0, 0, 60, 110);
      ctx.drawImage(paintingCanvas(painting), 0, 0);
    }
  }, [painting]);
  return (
    <canvas
      ref={ref}
      width={60}
      height={110}
      data-testid={testId}
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${groundY * 100}%`,
        height: `${heightPct}%`,
        aspectRatio: '60 / 110',
        transform: 'translate(-50%, -100%)',
        imageRendering: 'pixelated',
        zIndex: 6,
      }}
    />
  );
};
