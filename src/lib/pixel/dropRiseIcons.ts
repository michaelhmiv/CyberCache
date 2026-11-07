import { hueLerp } from '@/lib/pixel/weaponCardCompositor';
import type { PixelGridPalette } from '@/components/pixelArt/PixelGridCanvas';

// ── Drop rise icons (pixel conversion, 2026-11-07) ──────────────────────────────
// The loot rise's icon vocabulary was DropVisualIcon — SVG shapes
// (crystal, orb, key-shard paths, SVG text tags) drawn inside the
// pixel stage. The forms are now authored 15×15 texel grids
// (K ink · D dark · B base · L light · W glint), shaded per drop
// through the shared hueLerp ramp root and painted on canvas; the
// 4-letter type tag rides as HTML text under the icon, where the
// SVG printed it under the shape.

export const DROP_RISE_GRIDS: Record<'material' | 'essence' | 'fragment' | 'scrap' | 'credits' | 'crate', string[]> = {
  material: [
    '...............',
    '...............',
    '.......L.......',
    '......LWL......',
    '.....LBBBD.....',
    '....LBBBBBD....',
    '..KLBBBBBBBDK..',
    '...KBBBBBBBK...',
    '....KBBBBBK....',
    '.....KBBBK.....',
    '......KBK......',
    '.......K.......',
    '...............',
    '...............',
    '...............',
  ],
  essence: [
    '...............',
    '...............',
    '.......L.......',
    '.....LLLLL.....',
    '....LWWWLBD....',
    '...LWWBBBBBD...',
    '...LWBBBBBBD...',
    '...LBBBBBBBD...',
    '....BBBBBBD....',
    '....DBBBBDK....',
    '.....DDDDK.....',
    '.......KK......',
    '...............',
    '...............',
    '...............',
  ],
  fragment: [
    '...............',
    '..LL...........',
    '...WL..........',
    '...LBB.........',
    '....LBBD.......',
    '.....LBBD......',
    '......LBBD.....',
    '.......BBD.....',
    '.......DBD.....',
    '........DD.....',
    '.........K.....',
    '...............',
    '...............',
    '...............',
    '...............',
  ],
  scrap: [
    '...............',
    '...............',
    '....LLLL.......',
    '...LBBBBL......',
    '..LBBBBBBD.....',
    '..LBBBBBDD.....',
    '...LBBBBD......',
    '...LBBBDK......',
    '....DDKK.......',
    '.....KK........',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
  ],
  credits: [
    '...............',
    '...............',
    '......LLL......',
    '....LLLLLLL....',
    '...LLBBBBBLD...',
    '..LLBBBBBBLD...',
    '..LLBLLLLBDD...',
    '..LLBBBBBBDD...',
    '...DBBBBBDD....',
    '....DDDDDD.....',
    '......KKK......',
    '...............',
    '...............',
    '...............',
    '...............',
  ],
  crate: [
    '...............',
    '...............',
    '...KKKKKKKKK...',
    '...KLLLLLLLK...',
    '...KLBBBBBLK...',
    '...KLBKKBBLK...',
    '...KLBBBBBLK...',
    '...KLBBBBBLK...',
    '...KLBKKBBLK...',
    '...KLBBBBBLK...',
    '...KKKKKKKKK...',
    '...............',
    '...............',
    '...............',
    '...............',
  ],
};

export function dropRisePalette(base: string): PixelGridPalette {
  return {
    K: { color: hueLerp(base, '#000000', 0.72) },
    D: { color: hueLerp(base, '#000000', 0.35) },
    B: { color: base },
    L: { color: hueLerp(base, '#FFFFFF', 0.35) },
    W: { color: hueLerp(base, '#FFFFFF', 0.75) },
  };
}
