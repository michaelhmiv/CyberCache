/**
 * CAPTURE-ONLY figure swap (branch dash/hunters-probe — NEVER merged).
 * With `?painting=<key>` in the URL, the real stage components render
 * the painting image INSTEAD of the segmented part-set rig, at the
 * exact placement the rig uses (xPct / heightPct / groundY anchors
 * unchanged; the figure's own feet anchor replaces the rig's 50%
 * centre). Without the param every component renders exactly as
 * shipped.
 */
import React from 'react';
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

/** The painting seated exactly where the rig sits: height as % of
 *  stage height, feet on the ground line, feet anchor on xPct. */
export const PaintedHunterFigure: React.FC<{
  painting: PaintingDef;
  xPct: number;
  heightPct: number;
  groundY: number;
  testId?: string;
}> = ({ painting, xPct, heightPct, groundY, testId }) => (
  <img
    src={painting.src}
    alt=""
    draggable={false}
    data-testid={testId}
    style={{
      position: 'absolute',
      left: `${xPct}%`,
      top: `${groundY * 100}%`,
      height: `${heightPct}%`,
      aspectRatio: `${painting.w} / ${painting.h}`,
      transform: `translate(${-painting.feetX * 100}%, -100%)`,
      imageRendering: 'pixelated',
      zIndex: 6,
    }}
  />
);
