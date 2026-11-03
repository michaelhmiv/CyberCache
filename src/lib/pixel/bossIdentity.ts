/**
 * Boss identity — the Arena Plate system (audit census C-4).
 *
 * Every boss identity slot in the game renders the boss's OWN shipped
 * art: its bespoke sprite standing on its own arena painting (plate),
 * a deterministic detail crop of that sprite (cell), or its alpha
 * silhouette quantized to a two-tone texel stamp (micro mounts). No
 * archetypes, no initials, no invented marks — the presentation layer
 * the exploration specced, implemented against the generated data in
 * bossIdentityData.ts (scripts/generate-boss-identity.py).
 *
 * Data flow: boss id -> sprite + arena (pixel manifest / areaPalettes),
 * first weakness -> ELEMENT_VISUALS colorway, crop window + stamp grid
 * -> the generated module. A new boss needs only its sprite, arena,
 * and def row; identity follows by re-running the generator.
 */
import { BOSS_IDENTITY_DATA, type BossIdentityData } from './bossIdentityData';
import { getPixelSprite, pixelBossSpriteForBoss } from './manifest';
import { bossArena } from '@/content/areaPalettes';
import { ELEMENT_VISUALS, type VisualAsset } from '@/constants/visualAssets';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { Element } from '@/types/game';
import type { BossDef } from '@/types/boss';

/** Warm near-black frame tone (DESIGN.md §8 plate language). */
export const BOSS_PLATE_FRAME = '#17110C';

const FALLBACK_BOSS_ID = 'dune_tyrant';

export function bossDefForId(bossId: string | undefined): BossDef | undefined {
  return REGION_1_BOSSES.find((b) => b.id === bossId);
}

/** Generated crop/stamp data for a boss (falls back to the first boss). */
export function bossIdentityData(bossId: string | undefined): BossIdentityData {
  return (bossId && BOSS_IDENTITY_DATA[bossId]) || BOSS_IDENTITY_DATA[FALLBACK_BOSS_ID];
}

/** The boss's first-weakness element colorway — the plate's accent. */
export function bossElementVisual(bossId: string | undefined): VisualAsset {
  const def = bossDefForId(bossId);
  const element = def?.weaknesses[0] ?? Element.Kinetic;
  return ELEMENT_VISUALS[element] ?? ELEMENT_VISUALS[Element.Kinetic];
}

export interface BossArt {
  spriteUrl: string;
  spriteWidth: number;
  spriteHeight: number;
  arenaUrl: string;
  arenaWidth: number;
  arenaHeight: number;
}

/** Sprite + arena art for a boss, resolved through the pixel manifest. */
export function bossArt(bossId: string | undefined): BossArt | undefined {
  const spriteId = pixelBossSpriteForBoss(bossId) ?? pixelBossSpriteForBoss(FALLBACK_BOSS_ID);
  const sprite = spriteId ? getPixelSprite(spriteId) : undefined;
  const arena = getPixelSprite(bossArena(bossId).backgroundId);
  if (!sprite || !arena) return undefined;
  return {
    spriteUrl: sprite.url,
    spriteWidth: sprite.width,
    spriteHeight: sprite.height,
    arenaUrl: arena.url,
    arenaWidth: arena.width,
    arenaHeight: arena.height,
  };
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * CSS background props that show exactly `crop` of an image, filling
 * the element — the runtime counterpart of the exploration renderer's
 * PIL crop+resize, with no canvas and no new image bytes.
 */
export function bgCropStyle(
  url: string,
  imgW: number,
  imgH: number,
  crop: CropRect,
): { backgroundImage: string; backgroundSize: string; backgroundPosition: string } {
  const sizeX = (imgW / crop.w) * 100;
  const sizeY = (imgH / crop.h) * 100;
  const posX = imgW === crop.w ? 0 : (crop.x / (imgW - crop.w)) * 100;
  const posY = imgH === crop.h ? 0 : (crop.y / (imgH - crop.h)) * 100;
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${sizeX}% ${sizeY}%`,
    backgroundPosition: `${posX}% ${posY}%`,
  };
}

/**
 * The cell's arena slice (exploration rule): the center square of the
 * painting, anchored 30% down when the square fits there, else at the
 * top. A procedure over the arena's own dims — never per-boss data.
 */
export function arenaCellSlice(arenaW: number, arenaH: number): CropRect {
  const side = Math.min(arenaW, arenaH);
  const x = (arenaW - side) / 2;
  const y30 = Math.floor(arenaH * 0.3);
  const y = y30 + side <= arenaH ? y30 : 0;
  return { x, y, w: side, h: side };
}

/* ------------------------------------------------------------------ */
/* Stamp rendering — the generated grid as a cached data URL.          */
/* ------------------------------------------------------------------ */

const stampUrlCache = new Map<string, string>();

/**
 * Render a boss's stamp grid to a data URL (one canvas pixel per grid
 * cell; CSS scales it with pixelated rendering). Browser only — returns
 * '' where canvas is unavailable (SSR/tests), mirroring paletteSwap's
 * progressive-enhancement contract.
 */
export function bossStampUrl(bossId: string | undefined): string {
  const data = bossIdentityData(bossId);
  const key = bossId && BOSS_IDENTITY_DATA[bossId] ? bossId : FALLBACK_BOSS_ID;
  const cached = stampUrlCache.get(key);
  if (cached !== undefined) return cached;
  let url = '';
  try {
    if (typeof document !== 'undefined') {
      const { cols, rows, cells, bodyTone, coreTone } = data.stamp;
      const canvas = document.createElement('canvas');
      canvas.width = cols;
      canvas.height = rows;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        for (let y = 0; y < rows; y++) {
          const row = cells[y] ?? '';
          for (let x = 0; x < cols; x++) {
            const cell = row[x];
            if (cell !== 'B' && cell !== 'C') continue;
            ctx.fillStyle = cell === 'C' ? coreTone : bodyTone;
            ctx.fillRect(x, y, 1, 1);
          }
        }
        url = canvas.toDataURL('image/png');
      }
    }
  } catch {
    url = '';
  }
  stampUrlCache.set(key, url);
  return url;
}

/* ------------------------------------------------------------------ */
/* Plate type fitting — scrim text NEVER leaves its panel.             */
/*                                                                     */
/* The exploration sheet let several tier lines run under the art      */
/* edge; the production rule (owner) is that scrim text stays inside   */
/* the scrim, shrinking along a fixed ladder and splitting the name    */
/* at its own seams before anything clips.                             */
/* ------------------------------------------------------------------ */

export type PlateMeasure = (text: string, fontSizePx: number) => number;

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Canvas-backed measure for Chakra Petch 900; approximation off-browser. */
export const measurePlateText: PlateMeasure = (text, fontSizePx) => {
  try {
    if (typeof document !== 'undefined') {
      if (measureCtx === undefined) {
        measureCtx = document.createElement('canvas').getContext('2d');
      }
      if (measureCtx) {
        measureCtx.font = `900 ${fontSizePx}px "Chakra Petch", sans-serif`;
        return measureCtx.measureText(text).width;
      }
    }
  } catch {
    /* fall through to the approximation */
  }
  return text.length * fontSizePx * 0.62;
};

export interface PlateNameFit {
  lines: string[];
  fontSize: number;
}

/**
 * Fit a boss name into the plate scrim: one line at Poster size,
 * shrinking; else split at the name's own ", " seam; else split at a
 * word boundary (most balanced split that fits). Floor sizes keep the
 * DESIGN.md §5 floor for poster text (the last-resort split renders at
 * the smallest ladder size and the scrim clips nothing — every ladder
 * step is chosen only when the measured width fits).
 */
export function fitPlateName(
  name: string,
  maxWidth: number,
  measure: PlateMeasure = measurePlateText,
): PlateNameFit {
  const upper = name.toUpperCase();
  for (let size = 23; size >= 15; size -= 1) {
    if (measure(upper, size) <= maxWidth) return { lines: [upper], fontSize: size };
  }
  const fits = (lines: string[], size: number) =>
    lines.every((line) => measure(line, size) <= maxWidth);
  if (upper.includes(', ')) {
    const idx = upper.indexOf(', ');
    const lines = [upper.slice(0, idx + 1), upper.slice(idx + 2)];
    for (let size = 20; size >= 13; size -= 1) {
      if (fits(lines, size)) return { lines, fontSize: size };
    }
    return { lines, fontSize: 13 };
  }
  const words = upper.split(' ');
  if (words.length > 1) {
    for (let size = 20; size >= 13; size -= 1) {
      let best: string[] | null = null;
      let bestMax = Infinity;
      for (let i = 1; i < words.length; i++) {
        const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
        const widest = Math.max(measure(lines[0], size), measure(lines[1], size));
        if (widest <= maxWidth && widest < bestMax) {
          best = lines;
          bestMax = widest;
        }
      }
      if (best) return { lines: best, fontSize: size };
    }
    const mid = Math.ceil(words.length / 2);
    return { lines: [words.slice(0, mid).join(' '), words.slice(mid).join(' ')], fontSize: 13 };
  }
  return { lines: [upper], fontSize: 15 };
}

/**
 * The plate's tier line — the same three facts the panel prints today
 * (tier, level, phases), compacted along a fixed ladder until the
 * measured width fits the scrim at the §5 Label size.
 */
export function fitPlateTierLine(
  tier: number,
  level: number,
  phases: number,
  maxWidth: number,
  measure: PlateMeasure = measurePlateText,
): string {
  const phaseWord = phases === 1 ? 'PHASE' : 'PHASES';
  const candidates = [
    `TIER ${tier} · LV ${level} · ${phases} ${phaseWord}`,
    `TIER ${tier} · LV${level} · ${phases} ${phaseWord}`,
    `T${tier} · LV${level} · ${phases} ${phaseWord}`,
  ];
  for (const candidate of candidates) {
    if (measure(candidate, 11) <= maxWidth) return candidate;
  }
  return candidates[candidates.length - 1];
}
