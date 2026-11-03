/**
 * Wiki image plates — rendered from the game's OWN art sources so the
 * illustrated tables can never drift from the game (docs/WIKI.md: "The game
 * is the source of truth"). W4 pilot: the 26 legendary weapon plates for
 * Reference — Legendary Effects.
 *
 * Sources of truth (nothing here invents art):
 *   - src/test/legendaryParityTable.ts — the pinned fixture enumerating the
 *     26 named legendaries (25 effects + Emberfall) with their sprite ids.
 *   - src/constants/legendaryEffects.ts — effect id -> display name.
 *   - src/lib/pixel/manifest.ts — BESPOKE_LEGENDARY_SPRITES (name -> sprite
 *     id). PARSED from source text, not imported: the module calls Vite's
 *     import.meta.glob at load time, which tsx cannot run (same reason
 *     legendaryEffects.ts parses applyLegendaryEffects comments as text).
 *   - src/assets/pixel/manifest.json — sprite id -> source file.
 *   - src/assets/pixel/sprites/*.png — the bespoke art itself.
 *   - src/lib/pixel/showcaseWeaponInput.ts + weaponCardCompositor.ts — the
 *     game's own representative-instance mapping and card renderer, used for
 *     the compositor fallback below.
 *
 * Resolution order mirrors PixelWeapon.tsx / manifest.ts exactly: a weapon's
 * own name wins, else its legendary effect's name decides, else the pixel
 * compositor renders it. Every legendary resolves bespoke; the generator
 * ASSERTS the resolved sprite id equals the parity fixture's pinned id, so
 * if the map, the fixture, and the game ever drift apart the wiki build
 * fails loudly instead of picturing the wrong gun.
 *
 * Representative instances are built the showcase way: a fixed
 * ShowcaseItemPayload per legendary (fixed display name, the definition /
 * depicted weapon type from the parity fixture, a fixed pixel seed hashed
 * from the sprite id, rollQuality 100, no affixes) run through
 * showcaseWeaponInput(). Manufacturer and element are presentation-only
 * picks derived from the same fixed seed — the bespoke path ignores them;
 * they exist so the compositor fallback renders a valid, stable card.
 *
 * Plate treatment: bespoke sprites ship at 512 px wide painted art. A plate
 * is the sprite decoded with the game's own pngCodec, box-downscaled 2:1
 * with premultiplied-alpha averaging (the same canonical downscale idea as
 * scripts/pixel-key.py; edge boxes average fewer samples, no row or column
 * is dropped), and re-encoded with pngCodec. Output is 256 px wide,
 * byte-deterministic: same sources in, same bytes out — the double-render
 * diff is the gate, and wiki:gen:check byte-compares the committed plates.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEGENDARY_EFFECTS } from '../../src/constants/legendaryEffects';
import type { ShowcaseItemPayload } from '../../src/lib/api/verifiedOps';
import { decodePng, encodePng, type RgbaImage } from '../../src/lib/pixel/pngCodec';
import { showcaseWeaponInput } from '../../src/lib/pixel/showcaseWeaponInput';
import { composeWeaponCard } from '../../src/lib/pixel/weaponCardCompositor';
import type { PixelWeaponInput } from '../../src/lib/pixel/weaponCompositor';
import type { GearRender } from '../../src/lib/pixel/gearCardCompositor';
import {
  LEGENDARY_ART_PARITY,
  type LegendaryArtParityRow,
} from '../../src/test/legendaryParityTable';
import { Element, Manufacturer } from '../../src/types/game';
import { hashString } from '../../src/lib/utils/rng';
import { REPO_ROOT, type GenAsset } from './lib';

export const LEGENDARY_PLATE_DIR = 'images/weapons/legendary';
/** Display width for plate <img> tags — the compositor's card width. */
export const PLATE_DISPLAY_WIDTH = 240;

/* ------------------------------------------------------------------ */
/* Bespoke sprite resolution (mirrors src/lib/pixel/manifest.ts)       */
/* ------------------------------------------------------------------ */

let bespokeMapCache: Record<string, string> | null = null;

/** BESPOKE_LEGENDARY_SPRITES, parsed from manifest.ts source text. */
export function bespokeLegendarySprites(): Record<string, string> {
  if (bespokeMapCache) return bespokeMapCache;
  const src = readFileSync(join(REPO_ROOT, 'src/lib/pixel/manifest.ts'), 'utf8');
  const block = /export const BESPOKE_LEGENDARY_SPRITES[^=]*= \{([\s\S]*?)\};/.exec(src);
  if (!block) throw new Error('images: BESPOKE_LEGENDARY_SPRITES not found in src/lib/pixel/manifest.ts');
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

/**
 * bespokeSpriteIdForWeapon's order, re-implemented because manifest.ts is
 * Vite-only under tsx: the weapon's own name wins, else its effect's name.
 */
function resolveBespokeSpriteId(input: PixelWeaponInput): string | undefined {
  const map = bespokeLegendarySprites();
  if (input.name) {
    const byName = map[input.name.trim().toLowerCase()];
    if (byName) return byName;
  }
  if (input.legendaryEffectId) {
    const effect = LEGENDARY_EFFECTS.find((entry) => entry.id === input.legendaryEffectId);
    if (effect) return map[effect.name.trim().toLowerCase()];
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Representative instances (the showcaseWeaponInput way, fixed seeds) */
/* ------------------------------------------------------------------ */

const MANUFACTURERS = Object.values(Manufacturer);
const ELEMENTS = Object.values(Element);

function representativeInput(row: LegendaryArtParityRow): PixelWeaponInput {
  const seed = hashString(row.spriteId);
  const item: ShowcaseItemPayload = {
    id: `wiki-plate-${row.spriteId}`,
    item_level: null,
    rarity: 'Legendary',
    is_locked: false,
    runtime_state: 'inventory',
    equipped_slot: null,
    kind: 'weapon',
    condition_current: null,
    condition_max: null,
    created_at: '2026-01-01T00:00:00.000Z',
    payload: {
      name: row.name,
      weaponType: row.defType ?? row.depictedType,
      manufacturer: MANUFACTURERS[seed % MANUFACTURERS.length],
      element: ELEMENTS[Math.floor(seed / MANUFACTURERS.length) % ELEMENTS.length],
      pixelSeed: seed,
      rollQuality: 100,
      affixes: [],
      ...(row.effectId ? { legendaryEffectId: row.effectId } : {}),
    },
  };
  return showcaseWeaponInput(item);
}

/* ------------------------------------------------------------------ */
/* Rasterizers                                                         */
/* ------------------------------------------------------------------ */

interface SpriteManifestFile {
  sprites: Record<string, { src: string; width: number; height: number }>;
}

let spriteManifestCache: SpriteManifestFile | null = null;

function spriteFileBytes(spriteId: string): Uint8Array {
  if (!spriteManifestCache) {
    spriteManifestCache = JSON.parse(
      readFileSync(join(REPO_ROOT, 'src/assets/pixel/manifest.json'), 'utf8'),
    ) as SpriteManifestFile;
  }
  const entry = spriteManifestCache.sprites[spriteId];
  if (!entry) throw new Error(`images: sprite "${spriteId}" missing from src/assets/pixel/manifest.json`);
  return new Uint8Array(readFileSync(join(REPO_ROOT, 'src/assets/pixel', entry.src)));
}

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

/** The compositor fallback: a weapon card rendered to pixels at 2x paint scale. */
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
  const input = representativeInput(row);
  const spriteId = resolveBespokeSpriteId(input);
  if (spriteId !== undefined && spriteId !== row.spriteId) {
    throw new Error(
      `images: ${row.name} resolved to sprite "${spriteId}" but the parity fixture pins "${row.spriteId}" — ` +
        'the bespoke map, the fixture, and the game disagree; fix the source, not the wiki.',
    );
  }
  const image =
    spriteId !== undefined
      ? boxDownscaleHalf(decodePng(spriteFileBytes(spriteId)))
      : rasterizeWeaponCard(input);
  return {
    path: `${LEGENDARY_PLATE_DIR}/${legendaryPlateFileName(row.spriteId)}`,
    bytes: encodePng(image),
  };
}

/** All 26 legendary plates, sorted by path. Deterministic. */
export function legendaryPlates(): GenAsset[] {
  return LEGENDARY_ART_PARITY.map(renderLegendaryPlate).sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
