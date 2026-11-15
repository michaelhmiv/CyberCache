// CAPTURE-ONLY (dash/hunters-headgear, never merged): figure-swap data
// for the Cache Hunters HEADGEAR VARIANTS of the style-probe Vesper.
// Each painting is a generated painterly illustration keyed with
// scripts/pixel-key.py at the canonical enemy height (384) — the same
// production route as the shipped enemy/boss sprites — NOT a
// hand-built texel grid.
import vesperSrc from './assets/vesper-cole-probe.png';
import vesperV1Src from './assets/vesper-v1-hat.png';
import vesperV2Src from './assets/vesper-v2-hood-goggles.png';
import vesperV3Src from './assets/vesper-v3-wrap-eyepiece.png';

export interface PaintingDef {
  src: string;
  w: number;
  h: number;
  /** Feet anchor as a fraction of sprite width (pixel-key.py sidecar). */
  feetX: number;
}

export const PAINTINGS: Record<string, PaintingDef> = {
  vesper: { src: vesperSrc, w: 220, h: 384, feetX: 0.4267 },
  vesperv1: { src: vesperV1Src, w: 218, h: 384, feetX: 0.4268 },
  vesperv2: { src: vesperV2Src, w: 219, h: 384, feetX: 0.4284 },
  vesperv3: { src: vesperV3Src, w: 212, h: 384, feetX: 0.4035 },
};
