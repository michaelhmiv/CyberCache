// CAPTURE-ONLY (dash/hunters-probe, never merged): figure-swap data for
// the Cache Hunters STYLE PROBE. The painting is a generated painterly
// illustration keyed with scripts/pixel-key.py at the canonical enemy
// height (384) — the same production route as the shipped enemy/boss
// sprites — NOT a hand-built texel grid.
import vesperSrc from './assets/vesper-cole-probe.png';

export interface PaintingDef {
  src: string;
  w: number;
  h: number;
  /** Feet anchor as a fraction of sprite width (pixel-key.py sidecar). */
  feetX: number;
}

export const PAINTINGS: Record<string, PaintingDef> = {
  vesper: { src: vesperSrc, w: 220, h: 384, feetX: 0.4267 },
};
