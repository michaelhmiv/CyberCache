/**
 * Painted gear renderer (Top-Choice integration INT-2, 2026-11-11).
 *
 * Executes the declared data in gearPaintedData.ts: resolves an item
 * to its adopted Top-Choice painting, applies the element colorway in
 * palette space (the same swap the wiki plates and the in-game card
 * both consume — one render signature per item), and for class mods
 * draws the LIVE node deck into the casing's measured window.
 *
 * Resolution reuses the grammars' own derivations — shield behavior
 * from shieldBehaviorOf, ordnance form from the effect string, class
 * mod tree + boosts from classModGrammar, relic form from the name —
 * so this layer can never disagree with the grammar about what an
 * item IS; it only changes how the item is PICTURED. An item whose
 * identity resolves to no painting (a class mod with an unknown
 * tree) returns undefined and the caller falls back to the grammar,
 * exactly as PixelGear fell back before bespoke art existed.
 *
 * Deck contract (Wave 5): the casings ship with their windows EMPTY.
 * The deck drawn here is the code's own field — 4 rows x 12 cols,
 * inset (4,4) of a 78x30 design window on a 6-unit pitch, home-row
 * marker on the mod's tree row, lit cores escalating with the rolled
 * boost — the grammar's paintNodeDeck semantics, mapped onto the
 * casing's MEASURED window rect (Wave 5's integration-time mapping
 * note) instead of its canonical design seat. Affix pips are NOT
 * drawn: the masters bake the affix rail's canonical roll, and pips
 * are instance furniture the painting already carries (Wave 6's
 * plaque note states the same disposition for ordnance).
 */
import type { ClassMod, GearItem, Shield } from '@/types/items';
import { Element, Rarity, SkillTreeType } from '@/types/game';
import { shieldBehaviorOf } from '@/lib/combat/shieldBehaviors';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { decodePng, encodePng, type RgbaImage } from './pngCodec';
import { getManifestEntry } from './gearManifestData';
import type { GearGrammar } from './gearCardCompositor';
import { classModInputFromItem } from './classModGrammar';
import { ordnanceFormForEffect } from './ordnanceGrammar';
import { RELIC_FORM_ROWS } from './relicGrammar';

/**
 * The production grammar IDS — id, not object identity or kind id,
 * gates the painted layer (see resolvePaintedGear). Compared by id
 * so the gate survives module-identity duplication in test runners
 * (the same grammar module loaded through two chunks is two objects
 * but one id).
 */
const PRODUCTION_GEAR_GRAMMAR_IDS: ReadonlySet<string> = new Set([
  'shield-behavior', 'relic-salvage-v2', 'class-mod', 'ordnance',
]);
import {
  PAINTED_CLASS_MOD_WINDOWS,
  PAINTED_GEAR_SPRITES,
  PAINTED_ORDNANCE_COLORWAYS,
  PAINTED_RELIC_FORM_BY_NAME,
  PAINTED_SHIELD_COLORWAYS,
  type PaintedGearKind,
  type PaletteSwapTable,
} from './gearPaintedData';

export interface PaintedGearResolution {
  kind: PaintedGearKind;
  /** Form key inside PAINTED_GEAR_SPRITES[kind]. */
  form: string;
  spriteId: string;
  /** The item's element colorway (null for element-less kinds). */
  element: Element | null;
  rarity: Rarity;
}

/**
 * Item → its painting, or undefined when the item's identity has no
 * adopted painting (unknown class-mod tree; a relic name outside the
 * closed pool throws in the grammar first and never reaches here).
 */
export function resolvePaintedGear(item: GearItem, grammar: GearGrammar): PaintedGearResolution | undefined {
  // Paintings exist only for the four production grammars — a test
  // fixture grammar reusing a kind id must keep composing (the
  // slice-0 proof fixtures pin exactly that).
  if (!PRODUCTION_GEAR_GRAMMAR_IDS.has(grammar.id)) return undefined;
  const kind = grammar.kind as PaintedGearKind;
  if (kind === 'shield') {
    const shield = item as Shield;
    const form = shieldBehaviorOf(shield);
    const spriteId = PAINTED_GEAR_SPRITES.shield[form];
    if (!spriteId) return undefined;
    return { kind, form, spriteId, element: shield.element ?? Element.Kinetic, rarity: shield.rarity };
  }
  if (kind === 'ordnance') {
    const input = grammar.inputFromItem!(item);
    const form = input.variant ?? ordnanceFormForEffect('');
    const spriteId = PAINTED_GEAR_SPRITES.ordnance[form];
    if (!spriteId) return undefined;
    return { kind, form, spriteId, element: input.element ?? Element.Kinetic, rarity: input.rarity };
  }
  if (kind === 'classMod') {
    const input = classModInputFromItem(item as ClassMod);
    if (!input.tree) return undefined; // neutral housing — no painting exists
    const form = input.tree.toLowerCase();
    const spriteId = PAINTED_GEAR_SPRITES.classMod[form];
    if (!spriteId) return undefined;
    return { kind, form, spriteId, element: null, rarity: input.rarity };
  }
  // relic — name-keyed, the bespoke registry's native fit.
  const form = item.name ? PAINTED_RELIC_FORM_BY_NAME[item.name] ?? relicFormFromGrammarRow(item.name) : undefined;
  if (!form) return undefined;
  const spriteId = PAINTED_GEAR_SPRITES.relic[form];
  if (!spriteId) return undefined;
  return { kind, form, spriteId, element: null, rarity: item.rarity };
}

/* ------------------------------------------------------------------ */
/* Palette-space colorway application (PNG index space, pre-decode)    */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function readU32(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0;
}

function writeU32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 255;
  buf[offset + 1] = (value >>> 16) & 255;
  buf[offset + 2] = (value >>> 8) & 255;
  buf[offset + 3] = value & 255;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array, start: number, length: number): number {
  let c = 0xffffffff;
  for (let i = start; i < start + length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Rewrite a palette PNG's PLTE entries per a swap table, returning new
 * PNG bytes (CRC recomputed). Non-palette PNGs and empty tables pass
 * through untouched. This is the exact operation the waves' zone
 * proofs performed — palette entries only, indices never move — so
 * body and trim stay byte-identical by construction.
 */
export function applyPaletteSwap(pngBytes: Uint8Array, table: PaletteSwapTable | undefined): Uint8Array {
  if (!table || Object.keys(table).length === 0) return pngBytes;
  for (let i = 0; i < 8; i++) if (pngBytes[i] !== PNG_SIGNATURE[i]) return pngBytes;
  const out = new Uint8Array(pngBytes);
  let offset = 8;
  let swapped = false;
  while (offset + 8 <= out.length) {
    const length = readU32(out, offset);
    const type = String.fromCharCode(out[offset + 4], out[offset + 5], out[offset + 6], out[offset + 7]);
    if (type === 'PLTE') {
      const dataStart = offset + 8;
      for (const [idxText, rgb] of Object.entries(table)) {
        const at = dataStart + Number(idxText) * 3;
        if (at + 2 < dataStart + length) {
          out[at] = rgb[0];
          out[at + 1] = rgb[1];
          out[at + 2] = rgb[2];
          swapped = true;
        }
      }
      if (swapped) writeU32(out, offset + 8 + length, crc32(out, offset + 4, 4 + length));
    }
    if (type === 'IEND') break;
    offset += 8 + length + 4;
  }
  return swapped ? out : pngBytes;
}

/**
 * Relic form fallback through the grammar's own rows — the rows are
 * the source of truth for the name pool; PAINTED_RELIC_FORM_BY_NAME
 * mirrors them for the common path, and this lookup keeps the two
 * from ever disagreeing about a name both know.
 */
function relicFormFromGrammarRow(name: string): string | undefined {
  return RELIC_FORM_ROWS.find((row) => row.name === name)?.formId;
}

/**
 * Serialize a decoded (possibly deck-drawn) image to a PNG data
 * URL. Browser leg: canvas encode — pngCodec's encoder is
 * node:zlib code and the browser bundle stubs node:zlib to an
 * empty module, so encodePng can never run there (found by the
 * weapon-renderer slice's capture pass, 2026-11-11; the node
 * encoder below remains the leg for tests and tooling).
 */
export function paintedImageDataUrl(image: RgbaImage): string {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
        0,
        0,
      );
      return canvas.toDataURL('image/png');
    }
  }
  const bytes = encodePng(image);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/** The swap table for a resolution (undefined = the master's own colors). */
export function paletteSwapFor(resolution: PaintedGearResolution): PaletteSwapTable | undefined {
  if (!resolution.element) return undefined;
  if (resolution.kind === 'shield') return PAINTED_SHIELD_COLORWAYS[resolution.form][resolution.element];
  if (resolution.kind === 'ordnance') return PAINTED_ORDNANCE_COLORWAYS[resolution.form][resolution.element];
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Decode + deck overlay (canvas-free: wiki generator shares this)     */
/* ------------------------------------------------------------------ */

const decodedSpriteCache = new Map<string, Promise<RgbaImage | undefined>>();

/**
 * Decode PNG bytes through the environment's leg (see
 * loadSpriteImage): platform decoder in the browser, pngCodec in
 * node. Exported for PixelGear's palette-swap leg, which produces
 * NEW PNG bytes (applyPaletteSwap) that need the same decode.
 */
export async function decodeSpriteBytes(buf: Uint8Array): Promise<RgbaImage | undefined> {
  if (typeof document !== 'undefined' && typeof createImageBitmap !== 'undefined') {
    try {
      return await decodeWithPlatform(buf);
    } catch {
      return undefined;
    }
  }
  try {
    return decodePng(buf);
  } catch {
    return undefined;
  }
}

/**
 * Fetch + decode a manifest sprite's bytes (the URL comes from
 * the caller's getPixelSprite, which owns the Vite glob; this
 * module stays loadable by node tooling — the wiki generator
 * imports the pure pipeline above and never calls this).
 *
 * Decode legs, because the pixels must be identical in kind, not
 * in path: in the BROWSER the platform decoder (createImageBitmap
 * -> canvas -> ImageData) does the work — pngCodec is node:zlib
 * code and the browser bundle stubs node:zlib to an empty module,
 * so decodePng can never run there (found by the weapon-renderer
 * slice's capture pass, 2026-11-11: INT-2's swap/deck leg had
 * silently no-opped in the shipped app since it landed — the
 * no-swap <img> path masked it). In NODE (tests, wiki generator,
 * golden renderer) decodePng runs as before. Canvas round-trip is
 * exact for opaque pixels; semi-transparent AA edges can drift a
 * step, which the render fits average over anyway.
 */
export function loadSpriteImage(spriteId: string, url: string): Promise<RgbaImage | undefined> {
  let pending = decodedSpriteCache.get(spriteId);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return undefined;
        return await decodeSpriteBytes(new Uint8Array(await res.arrayBuffer()));
      } catch {
        return undefined;
      }
    })();
    decodedSpriteCache.set(spriteId, pending);
  }
  return pending;
}

/** Platform PNG decode (browser leg of loadSpriteImage). */
async function decodeWithPlatform(buf: Uint8Array): Promise<RgbaImage | undefined> {
  const bitmap = await createImageBitmap(new Blob([buf as BlobPart], { type: 'image/png' }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(pixels.data) };
  } finally {
    bitmap.close();
  }
}

/** Manifest-declared geometry for a sprite (node-safe). */
export function paintedSpriteSize(spriteId: string): { width: number; height: number } | undefined {
  const entry = getManifestEntry(spriteId);
  return entry ? { width: entry.width, height: entry.height } : undefined;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [184, 176, 168];
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

/**
 * The live node deck, drawn over a decoded class-mod casing at the
 * casing's measured window. Geometry mirrors the grammar's field:
 * the 78x30 design window holds a field inset (4,4) on a 6-unit
 * pitch; each cell is a 4x4 socket with a 2x2 hole/core at (+1,+1).
 * Colors mirror gearColorsFor for a class mod: sockets in the tree
 * ramp (deep seat, base/pale/white core steps), holes in ink.
 */
export function drawPaintedNodeDeck(image: RgbaImage, item: GearItem): void {
  const input = classModInputFromItem(item as ClassMod);
  if (!input.tree) return;
  const win = PAINTED_CLASS_MOD_WINDOWS[input.tree.toLowerCase()];
  if (!win) return;
  const rampBase = hexToRgb(getSkillTreeVisual(input.tree).color);
  const seat: [number, number, number] = [
    Math.round(rampBase[0] * 0.45), Math.round(rampBase[1] * 0.45), Math.round(rampBase[2] * 0.45),
  ];
  const coreSteps: [number, number, number][] = [
    rampBase,
    [Math.min(255, Math.round(rampBase[0] * 1.35)), Math.min(255, Math.round(rampBase[1] * 1.35)), Math.min(255, Math.round(rampBase[2] * 1.35))],
    [Math.min(255, Math.round(rampBase[0] * 1.35)), Math.min(255, Math.round(rampBase[1] * 1.35)), Math.min(255, Math.round(rampBase[2] * 1.35))],
    [255, 255, 255],
  ];
  const ink: [number, number, number] = [11, 11, 14];
  const wx = win.x0 * image.width;
  const wy = win.y0 * image.height;
  const ww = (win.x1 - win.x0) * image.width;
  const wh = (win.y1 - win.y0) * image.height;
  const ux = ww / 78;
  const uy = wh / 30;
  const setRect = (dx: number, dy: number, dw: number, dh: number, rgb: [number, number, number]) => {
    const x0 = Math.round(wx + dx * ux);
    const y0 = Math.round(wy + dy * uy);
    const x1 = Math.round(wx + (dx + dw) * ux);
    const y1 = Math.round(wy + (dy + dh) * uy);
    for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x++) {
        const o = (y * image.width + x) * 4;
        image.data[o] = rgb[0];
        image.data[o + 1] = rgb[1];
        image.data[o + 2] = rgb[2];
        image.data[o + 3] = 255;
      }
    }
  };
  const lit = new Map<string, number>();
  for (const m of input.boosts) lit.set(`${m.row}:${m.col}`, m.value);
  const homeRow = input.tree ? CLASS_MOD_TREE_ORDER_INDEX[input.tree] : -1;
  for (let row = 0; row < 4; row++) {
    const sy = 4 + row * 6;
    if (row === homeRow) setRect(1, sy + 1, 2, 2, rampBase); // home-row marker
    for (let col = 0; col < 12; col++) {
      const sx = 4 + col * 6;
      const value = lit.get(`${row}:${col}`);
      if (!value) {
        setRect(sx + 1, sy + 1, 2, 2, ink); // unlit socket hole
        continue;
      }
      setRect(sx, sy, 4, 4, seat); // lit socket's deep seat
      const litTexels = value === 1 ? 1 : value === 2 ? 2 : 4;
      const coreCells: [number, number, number][] = [[1, 1, 0], [2, 1, 1], [1, 2, 2], [2, 2, 3]];
      for (let i = 0; i < litTexels; i++) {
        const [dx, dy, step] = coreCells[i];
        setRect(sx + dx, sy + dy, 1, 1, coreSteps[step]);
      }
    }
  }
}

const CLASS_MOD_TREE_ORDER_INDEX: Record<SkillTreeType, number> = {
  [SkillTreeType.Gunslinger]: 0,
  [SkillTreeType.Demolition]: 1,
  [SkillTreeType.Scavenger]: 2,
  [SkillTreeType.Fixer]: 3,
};

/** Rarity glow color for a painted render (the frame styles' own hex). */
export function paintedRarityColor(rarity: Rarity): string {
  return RARITY_FRAME_STYLES[rarity].color;
}
