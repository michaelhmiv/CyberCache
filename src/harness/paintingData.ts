// CAPTURE-ONLY (dash/hunters-castab, never merged): figure-swap data
// for the Cache Hunters CAST A/B looks decision. Each painting is a
// generated painterly illustration keyed with scripts/pixel-key.py at
// the canonical enemy height (384) — the same production route as the
// shipped enemy/boss sprites — NOT a hand-built texel grid.
import vesperSrc from './assets/vesper-cole-probe.png';
import vesperV1Src from './assets/vesper-v1-hat.png';
import vesperV2Src from './assets/vesper-v2-hood-goggles.png';
import vesperV3Src from './assets/vesper-v3-wrap-eyepiece.png';
import silasSrc from './assets/silas-boone.png';
import josieSrc from './assets/josie-lode.png';
import docSrc from './assets/doc-sutter.png';
import silasaSrc from './assets/silas-a.png';
import josieaSrc from './assets/josie-a.png';
import docaSrc from './assets/doc-a.png';
import vesperbSrc from './assets/vesper-b.png';
import silasbSrc from './assets/silas-b.png';
import josiebSrc from './assets/josie-b.png';
import docbSrc from './assets/doc-b.png';

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
  silas: { src: silasSrc, w: 193, h: 384, feetX: 0.4556 },
  josie: { src: josieSrc, w: 192, h: 384, feetX: 0.3798 },
  doc: { src: docSrc, w: 173, h: 384, feetX: 0.4913 },
  silasa: { src: silasaSrc, w: 190, h: 384, feetX: 0.4729 },
  josiea: { src: josieaSrc, w: 193, h: 384, feetX: 0.4043 },
  doca: { src: docaSrc, w: 165, h: 384, feetX: 0.4838 },
  vesperb: { src: vesperbSrc, w: 221, h: 384, feetX: 0.426 },
  silasb: { src: silasbSrc, w: 182, h: 384, feetX: 0.511 },
  josieb: { src: josiebSrc, w: 197, h: 384, feetX: 0.4242 },
  docb: { src: docbSrc, w: 163, h: 384, feetX: 0.4903 },
};
