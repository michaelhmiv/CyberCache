/**
 * Wiki image plates — rendered from the game's OWN art sources so the
 * illustrated tables can never drift from the game (docs/WIKI.md: "The game
 * is the source of truth"). W4 pilot: the 26 legendary weapon plates for
 * Reference — Legendary Effects.
 *
 * Sources of truth (nothing here invents art):
 *   - src/test/legendaryParityTable.ts — the pinned fixture enumerating the
 *     26 named legendaries (25 effects + Emberfall) with their art ids.
 *   - src/constants/legendaryEffects.ts — effect id -> display name.
 *   - src/lib/pixel/legendaryArt.ts — BESPOKE_LEGENDARY_SPRITES (name ->
 *     legendary art id). PARSED from source text, not imported, keeping
 *     this generator free of game-module loading (the same reason
 *     legendaryEffects.ts parses applyLegendaryEffects comments as text).
 *   - scripts/wiki-gen/assets/weapons/legendary/ — the adopted Top-Choice
 *     paintings for the 26, derived from the Wave 1 / Wave 1.5 masters by
 *     scripts/wiki-gen/derive-weapon-paintings.py (INT-1; see the painted
 *     plate section below).
 *   - src/lib/pixel/showcaseWeaponInput.ts + weaponCardCompositor.ts — the
 *     game's own representative-instance mapping and card renderer (still
 *     the source for the W5 element-read plates in images-w5.ts).
 *
 * Resolution order mirrors PixelWeapon.tsx / legendaryArt.ts exactly: a
 * weapon's own name wins, else its legendary effect's name decides. The
 * generator ASSERTS the painted source set equals the parity fixture's
 * pinned id set 1:1, so if the fixture and the paintings ever drift apart
 * the wiki build fails loudly instead of picturing the wrong gun.
 *
 * Plate treatment (INT-1, Wave 15 disposition A1): a legendary plate is
 * the adopted Top-Choice painting of that legendary, keyed and fitted
 * into the 480x176 plate box as a bare object on transparency (the card
 * frame/halo is presentation furniture and never enters a plate — the
 * Wave 15 derivation recipe). Before INT-1 the plates were the game's
 * V4 authored-data card renders; before V4, 2:1 box-downscales of the
 * retired 512px painted sprites. Byte-deterministic: same sources in,
 * same bytes out — wiki:gen:check byte-compares the committed plates.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { LEGENDARY_EFFECTS } from '../../src/constants/legendaryEffects';
import { decodePng, encodePalettePng, type RgbaImage } from '../../src/lib/pixel/pngCodec';
import { composeWeaponCard } from '../../src/lib/pixel/weaponCardCompositor';
import type { PixelWeaponInput } from '../../src/lib/pixel/weaponCompositor';
import type { GearRender } from '../../src/lib/pixel/gearCardCompositor';
import {
  LEGENDARY_ART_PARITY,
  type LegendaryArtParityRow,
} from '../../src/test/legendaryParityTable';
import { LEGENDARY_PAINTING_SLUGS } from '../../src/lib/pixel/weaponPaintingData';
import { REPO_ROOT, type GenAsset } from './lib';

export const LEGENDARY_PLATE_DIR = 'images/weapons/legendary';
/** Display width for plate <img> tags — the compositor's card width. */
export const PLATE_DISPLAY_WIDTH = 240;

/* ------------------------------------------------------------------ */
/* Bespoke legendary resolution (mirrors src/lib/pixel/legendaryArt)   */
/* ------------------------------------------------------------------ */

let bespokeMapCache: Record<string, string> | null = null;

/** BESPOKE_LEGENDARY_SPRITES, parsed from legendaryArt.ts source text. */
export function bespokeLegendarySprites(): Record<string, string> {
  if (bespokeMapCache) return bespokeMapCache;
  const src = readFileSync(join(REPO_ROOT, 'src/lib/pixel/legendaryArt.ts'), 'utf8');
  const block = /export const BESPOKE_LEGENDARY_SPRITES[^=]*= \{([\s\S]*?)\};/.exec(src);
  if (!block) throw new Error('images: BESPOKE_LEGENDARY_SPRITES not found in src/lib/pixel/legendaryArt.ts');
  const map: Record<string, string> = {};
  for (const m of block[1].matchAll(/(?:'([^']+)'|([A-Za-z][\w]*)):\s*'([^']+)'/g)) {
    map[(m[1] ?? m[2]).toLowerCase()] = m[3];
  }
  if (Object.keys(map).length === 0) throw new Error('images: BESPOKE_LEGENDARY_SPRITES parsed empty');
  bespokeMapCache = map;
  return map;
}

export function legendarySpriteIdForName(name: string): string {
  const id = bespokeLegendarySprites()[name.trim().toLowerCase()];
  if (!id) throw new Error(`images: no bespoke sprite mapped for legendary name "${name}"`);
  return id;
}

export function legendarySpriteIdForEffect(effectId: string): string {
  const effect = LEGENDARY_EFFECTS.find((entry) => entry.id === effectId);
  if (!effect) throw new Error(`images: unknown legendary effect id "${effectId}"`);
  return legendarySpriteIdForName(effect.name);
}

/* ------------------------------------------------------------------ */
/* Painted plate sources (Top-Choice integration INT-1)               */
/* ------------------------------------------------------------------ */

/**
 * The adopted Top-Choice paintings are the wiki's weapon art sources
 * (Wave 15 dispositions A1/A2): keyed, content-cropped, palette-256
 * files at the books' 1440 px card width, derived from the adopted
 * wave masters by scripts/wiki-gen/derive-weapon-paintings.py and
 * committed under scripts/wiki-gen/assets/weapons/. A plate is the
 * painting fitted into the published plate box by the Wave 15 recipe:
 * bare object on transparency, box minus a 28 px margin, centered,
 * published as a palette-256 PNG in the master's own palette.
 */
export const PAINTED_WEAPON_ASSETS = join(REPO_ROOT, 'scripts', 'wiki-gen', 'assets', 'weapons');
const PLATE_WIDTH = 480;
const PLATE_HEIGHT = 176;
const PLATE_MARGIN = 28;

export function paintedWeaponAssetBytes(kind: 'legendary' | 'frames', fileName: string): Uint8Array {
  const path = join(PAINTED_WEAPON_ASSETS, kind, fileName);
  if (!existsSync(path)) {
    throw new Error(
      `images: painted weapon source missing: scripts/wiki-gen/assets/weapons/${kind}/${fileName} — ` +
        're-derive it with scripts/wiki-gen/derive-weapon-paintings.py',
    );
  }
  return new Uint8Array(readFileSync(path));
}

/** The painted files present in one asset folder, sorted. */
export function paintedWeaponAssetNames(kind: 'legendary' | 'frames'): string[] {
  return readdirSync(join(PAINTED_WEAPON_ASSETS, kind))
    .filter((f) => f.endsWith('.png'))
    .sort();
}

/**
 * Area-average resample fitting `img` inside maxW x maxH, aspect kept.
 * Premultiplied-alpha accumulation (the boxDownscaleHalf discipline
 * generalized to an arbitrary fit): transparent pixels contribute
 * their alpha but not their RGB, so keyed edges never darken or bleed.
 * Pure float math in a fixed loop order — byte-deterministic.
 */
function fitImageInto(img: RgbaImage, maxW: number, maxH: number): RgbaImage {
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const data = new Uint8Array(width * height * 4);
  const stepX = img.width / width;
  const stepY = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * stepY;
    const y1 = y0 + stepY;
    for (let x = 0; x < width; x++) {
      const x0 = x * stepX;
      const x1 = x0 + stepX;
      let aSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let wSum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (yy * img.width + xx) * 4;
          const a = img.data[i + 3];
          aSum += a * w;
          rSum += img.data[i] * a * w;
          gSum += img.data[i + 1] * a * w;
          bSum += img.data[i + 2] * a * w;
          wSum += w;
        }
      }
      const o = (y * width + x) * 4;
      if (aSum > 0) {
        data[o] = Math.round(rSum / aSum);
        data[o + 1] = Math.round(gSum / aSum);
        data[o + 2] = Math.round(bSum / aSum);
        data[o + 3] = Math.round(aSum / wSum);
      }
    }
  }
  return { width, height, data };
}

/**
 * The source master's own palette: its unique RGBA colors in packed
 * order, with a fully transparent entry guaranteed for the plate
 * ground. Sources are palette-256 files by construction (at most 256
 * unique colors); if the transparent entry must be added to a full
 * palette, the least-used color gives up its slot.
 */
function sourcePalette(img: RgbaImage): [number, number, number, number][] {
  const byKey = new Map<number, { color: [number, number, number, number]; count: number }>();
  for (let i = 0; i < img.data.length; i += 4) {
    const color: [number, number, number, number] = [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
    const key = ((color[3] << 24) | (color[0] << 16) | (color[1] << 8) | color[2]) >>> 0;
    const entry = byKey.get(key);
    if (entry) entry.count++;
    else byKey.set(key, { color, count: 1 });
  }
  if (!byKey.has(0)) {
    if (byKey.size >= 256) {
      let rarestKey = -1;
      let rarestCount = Infinity;
      for (const [key, entry] of byKey) {
        if (entry.count < rarestCount) {
          rarestCount = entry.count;
          rarestKey = key;
        }
      }
      byKey.delete(rarestKey);
    }
    byKey.set(0, { color: [0, 0, 0, 0], count: 0 });
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, entry]) => entry.color);
}

/**
 * Snap every pixel to the nearest palette color, distance measured on
 * premultiplied values so a keyed edge's coverage lands in alpha
 * rather than hue. The plate then carries the master's own palette —
 * no invented blends — and publishes as a palette-256 PNG, the form
 * Wave 15 priced for these classes.
 */
function snapToPalette(
  img: RgbaImage,
  palette: [number, number, number, number][],
): RgbaImage {
  const premultiplied = palette.map(([r, g, b, a]) => [(r * a) / 255, (g * a) / 255, (b * a) / 255, a]);
  const memo = new Map<number, [number, number, number, number]>();
  const data = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const a = img.data[i + 3];
    const key = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
    let snapped = memo.get(key);
    if (!snapped) {
      const pr = (r * a) / 255;
      const pg = (g * a) / 255;
      const pb = (b * a) / 255;
      let best = Infinity;
      let bestIdx = 0;
      for (let j = 0; j < premultiplied.length; j++) {
        const [cr, cg, cb, ca] = premultiplied[j];
        const d = (pr - cr) ** 2 + (pg - cg) ** 2 + (pb - cb) ** 2 + (a - ca) ** 2;
        if (d < best) {
          best = d;
          bestIdx = j;
        }
      }
      snapped = palette[bestIdx];
      memo.set(key, snapped);
    }
    data[i] = snapped[0];
    data[i + 1] = snapped[1];
    data[i + 2] = snapped[2];
    data[i + 3] = snapped[3];
  }
  return { width: img.width, height: img.height, data };
}

/** One painted source fitted into the 480x176 weapon plate box. */
export function fitPaintedPlate(sourcePng: Uint8Array): Uint8Array {
  const src = decodePng(sourcePng);
  const palette = sourcePalette(src);
  const fitted = snapToPalette(
    fitImageInto(src, PLATE_WIDTH - PLATE_MARGIN, PLATE_HEIGHT - PLATE_MARGIN),
    palette,
  );
  const canvas: RgbaImage = {
    width: PLATE_WIDTH,
    height: PLATE_HEIGHT,
    data: new Uint8Array(PLATE_WIDTH * PLATE_HEIGHT * 4),
  };
  const ox = Math.floor((PLATE_WIDTH - fitted.width) / 2);
  const oy = Math.floor((PLATE_HEIGHT - fitted.height) / 2);
  for (let y = 0; y < fitted.height; y++) {
    canvas.data.set(
      fitted.data.subarray(y * fitted.width * 4, (y + 1) * fitted.width * 4),
      ((oy + y) * PLATE_WIDTH + ox) * 4,
    );
  }
  return encodePalettePng(canvas, palette);
}

/* ------------------------------------------------------------------ */
/* Rasterizers                                                         */
/* ------------------------------------------------------------------ */

/**
 * 2:1 box downscale with premultiplied-alpha averaging: transparent pixels
 * contribute their alpha but not their (meaningless) RGB, so edges do not
 * darken or bleed chroma-key leftovers. Edge boxes average the samples that
 * exist. Pure integer math — byte-deterministic.
 */
export function boxDownscaleHalf(img: RgbaImage): RgbaImage {
  const width = Math.ceil(img.width / 2);
  const height = Math.ceil(img.height / 2);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let aSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let count = 0;
      for (let dy = 0; dy < 2; dy++) {
        const sy = y * 2 + dy;
        if (sy >= img.height) break;
        for (let dx = 0; dx < 2; dx++) {
          const sx = x * 2 + dx;
          if (sx >= img.width) break;
          const i = (sy * img.width + sx) * 4;
          const a = img.data[i + 3];
          aSum += a;
          rSum += img.data[i] * a;
          gSum += img.data[i + 1] * a;
          bSum += img.data[i + 2] * a;
          count++;
        }
      }
      const o = (y * width + x) * 4;
      if (aSum > 0) {
        data[o] = Math.round(rSum / aSum);
        data[o + 1] = Math.round(gSum / aSum);
        data[o + 2] = Math.round(bSum / aSum);
        data[o + 3] = Math.round(aSum / count);
      }
    }
  }
  return { width, height, data };
}

/** A weapon card rendered to pixels at 2x paint scale — since V4 this
 *  is THE legendary plate rasterizer (the authored sets render through
 *  the compositor; there is no painted sprite left to photograph). */
export function rasterizeWeaponCard(input: PixelWeaponInput): RgbaImage {
  const card = composeWeaponCard(input);
  const scale = 2;
  const width = card.width * scale;
  const height = card.height * scale;
  const data = new Uint8Array(width * height * 4);
  const rgbByShade = new Map<string, [number, number, number] | null>();
  for (const [shade, color] of Object.entries(card.colors)) {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    rgbByShade.set(
      shade,
      hex
        ? [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)]
        : null,
    );
  }
  for (let y = 0; y < card.height; y++) {
    const row = card.rows[y];
    for (let x = 0; x < card.width; x++) {
      const rgb = rgbByShade.get(row[x]);
      if (!rgb) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o = ((y * scale + dy) * width + (x * scale + dx)) * 4;
          data[o] = rgb[0];
          data[o + 1] = rgb[1];
          data[o + 2] = rgb[2];
          data[o + 3] = 255;
        }
      }
    }
  }
  return { width, height, data };
}

/**
 * Rasterize a composed gear render (gearCardCompositor's GearRender)
 * at 2x nearest — the gear-plate twin of rasterizeWeaponCard, same
 * treatment: shade chars through the render's own color table,
 * unknown shades transparent. Gear marriage slice 5 re-pointed the
 * W5 gear plates at the pixel compositor; this is their renderer.
 */
export function rasterizeGearRender(render: GearRender): RgbaImage {
  const scale = 2;
  const width = render.width * scale;
  const height = render.height * scale;
  const data = new Uint8Array(width * height * 4);
  const rgbByShade = new Map<string, [number, number, number] | null>();
  for (const [shade, color] of Object.entries(render.colors)) {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    rgbByShade.set(
      shade,
      hex
        ? [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)]
        : null,
    );
  }
  for (let y = 0; y < render.height; y++) {
    const row = render.rows[y];
    for (let x = 0; x < render.width; x++) {
      const rgb = rgbByShade.get(row[x]);
      if (!rgb) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o = ((y * scale + dy) * width + (x * scale + dx)) * 4;
          data[o] = rgb[0];
          data[o + 1] = rgb[1];
          data[o + 2] = rgb[2];
          data[o + 3] = 255;
        }
      }
    }
  }
  return { width, height, data };
}

/* ------------------------------------------------------------------ */
/* Plates                                                              */
/* ------------------------------------------------------------------ */

export function legendaryPlateFileName(spriteId: string): string {
  return `${spriteId.replace(/^legendary-/, '')}.png`;
}

export function legendaryPlateImgTag(name: string, spriteId: string): string {
  return `<img src="${LEGENDARY_PLATE_DIR}/${legendaryPlateFileName(spriteId)}" alt="${name}" width="${PLATE_DISPLAY_WIDTH}">`;
}

function renderLegendaryPlate(row: LegendaryArtParityRow): GenAsset {
  return {
    path: `${LEGENDARY_PLATE_DIR}/${legendaryPlateFileName(row.spriteId)}`,
    bytes: fitPaintedPlate(paintedWeaponAssetBytes('legendary', legendaryPlateFileName(row.spriteId))),
  };
}

/** All 26 legendary plates, sorted by path. Deterministic. */
export function legendaryPlates(): GenAsset[] {
  // INT-1: three sets must agree 1:1 — the parity fixture's pinned
  // slugs, the production data's painting slugs (weaponPaintingData.ts,
  // the manifest sprites' own record), and the painted source files.
  // Any drift fails the build instead of picturing the wrong gun (the
  // V4-era assertion, carried onto the new sources).
  const paritySlugs = LEGENDARY_ART_PARITY.map((row) => row.spriteId.replace(/^legendary-/, '')).sort();
  const productionSlugs = [...LEGENDARY_PAINTING_SLUGS].sort();
  if (JSON.stringify(paritySlugs) !== JSON.stringify(productionSlugs)) {
    throw new Error(
      `images: production painting slugs drifted from the parity fixture — fixture [${paritySlugs.join(', ')}], production [${productionSlugs.join(', ')}]`,
    );
  }
  const expected = paritySlugs.map((slug) => `${slug}.png`);
  const present = paintedWeaponAssetNames('legendary');
  if (JSON.stringify(expected) !== JSON.stringify(present)) {
    throw new Error(
      `images: painted legendary sources drifted from the parity fixture — expected [${expected.join(', ')}], found [${present.join(', ')}]`,
    );
  }
  return LEGENDARY_ART_PARITY.map(renderLegendaryPlate).sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
