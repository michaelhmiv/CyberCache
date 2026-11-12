/**
 * weaponPaintingRender — the painted weapon renderer (Top-Choice
 * renderer slice, 2026-11-11; owner rulings on the INT-1 closing
 * board, brief: cybercache-prep/top-choice/RENDERER-BRIEF.md).
 *
 * Weapons render from the adopted Top-Choice paintings INT-1
 * registered as production sprites (`legendary-painting-<slug>` /
 * `weapon-base-<stem>`, behind spriteProduction.ts). The painting
 * is the BASE render at both densities (120x44 stage grid, 240x88
 * card grid — held mode is the card grid; paintings carry no
 * presentation furniture to omit). Per-item identity rides as
 * OVERLAYS on top of the painting, re-implementing the marks the
 * texel compositors used to stamp into their geometry:
 *
 *   1. ELEMENT (zone-driven): the instance's element re-lights the
 *      painting's authored glow zone — the chamber window (beam:
 *      window + exposed spine channel) — by the zone proof's
 *      palette operation (weaponPaintingZones.ts, derived per base
 *      by scripts/derive-weapon-zones.py). Body and trim colors
 *      never appear in a swap table, so they survive byte-exact.
 *      Kinetic is the honest-absence grey ramp. Legendaries carry
 *      no swap: a named legendary's element is fixed in its
 *      painting, the V4 law for bespoke identities.
 *   2. AFFIX DECALS: the shared derivation (decalSpec.buildDecals,
 *      the same seed both compositors used) stamped over body
 *      pixels in grid space, in each decal's category color.
 *   3. CONDITION: conditionFromRoll's grade as wear — a seeded
 *      speckle erase of body pixels for beat-up / field-used,
 *      rarity sparkles for godroll, mint a no-op — the stage
 *      compositor's own rates and RNG streams.
 *
 * Seeded GEOMETRY variants (the compositors' part-variant
 * silhouettes) are retired by the painting base: one outline per
 * type x manufacturer is the Silhouette Law's shape, and the
 * variants were hash-of-modifier silhouettes, not a legible stat
 * read. The compositors stay in the tree as the fallback render
 * for any input that resolves to no painting (test fixtures and
 * malformed payloads; every real type x manufacturer and every
 * named legendary resolves) and as the S2 pxl-lint corpus.
 *
 * This module is deliberately manifest-data-only (gearManifestData
 * + weaponPaintingData — no Vite glob), so node tooling (golden
 * scenes, tests, the wiki generator) drives the same core the
 * components drive; sprite PIXELS arrive through a loader, the
 * sceneRenderer/partsCompositor pattern.
 */
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import {
  buildDecals,
  conditionFromRoll,
  seededRandom,
  weaponVisualSeed,
  type WeaponCondition,
  type WeaponVisualDecal,
} from '@/lib/weaponArt/decalSpec';
import { getManifestEntry } from './gearManifestData';
import { bespokeSpriteIdForWeapon } from './legendaryArt';
import {
  LEGENDARY_PAINTING_SLUGS,
  WEAPON_BASE_PAINTING_STEMS,
} from './weaponPaintingData';
import {
  legendaryPaintingSpriteId,
  weaponBaseSpriteId,
} from './spriteProduction';
import {
  normalizeManufacturer,
  normalizeRarity,
  normalizeType,
  PIXEL_WEAPON_HEIGHT,
  PIXEL_WEAPON_WIDTH,
  type PixelWeaponInput,
} from './weaponCompositor';
import { CARD_WEAPON_HEIGHT, CARD_WEAPON_WIDTH } from './weaponCardCompositor';
import { WEAPON_PAINTING_ZONES } from './weaponPaintingZones';
import type { RgbaImage } from './pngCodec';

export type WeaponPaintingDensity = 'stage' | 'card' | 'held' | 'thumb';

export interface WeaponPaintingResolution {
  kind: 'legendary' | 'base';
  spriteId: string;
  /** Base stem ('beam-helix-works') for kind 'base'. */
  stem?: string;
  /** Painting slug for kind 'legendary'. */
  slug?: string;
  element: Element;
  rarity: Rarity;
  weaponType: WeaponType;
  manufacturer: Manufacturer;
}

const TYPE_STEM: Record<WeaponType, string> = {
  [WeaponType.Pistol]: 'pistol',
  [WeaponType.SMG]: 'smg',
  [WeaponType.Shotgun]: 'shotgun',
  [WeaponType.Sniper]: 'sniper',
  [WeaponType.Launcher]: 'launcher',
  [WeaponType.Beam]: 'beam',
};

const MAKER_STEM: Record<Manufacturer, string> = {
  [Manufacturer.Redline]: 'redline',
  [Manufacturer.Ironwood]: 'ironwood',
  [Manufacturer.BlastForge]: 'blast-forge',
  [Manufacturer.Prismatek]: 'prismatek',
  [Manufacturer.ThrowTech]: 'throw-tech',
  [Manufacturer.HelixWorks]: 'helix-works',
};

/** The base painting stem for a type x manufacturer pair. */
export function weaponBaseStem(weaponType: WeaponType, manufacturer: Manufacturer): string {
  return `${TYPE_STEM[weaponType]}-${MAKER_STEM[manufacturer]}`;
}

function normalizeElement(element: Element | undefined): Element {
  return element && (Object.values(Element) as string[]).includes(element) ? element : Element.Kinetic;
}

/**
 * Input -> its adopted painting, or undefined when the input
 * resolves to none (the caller then falls back to the texel
 * compositors). Resolution order is the production law: a named
 * legendary's bespoke painting first, then the type x manufacturer
 * base painting. Manifest declaration is the existence test (the
 * PixelGear painted-layer pattern) — the declaration never varies
 * by environment, the asset glob can.
 */
export function resolveWeaponPainting(input: PixelWeaponInput): WeaponPaintingResolution | undefined {
  const weaponType = normalizeType(input.weaponType);
  const manufacturer = normalizeManufacturer(input.manufacturer);
  const rarity = normalizeRarity(input.rarity);
  const element = normalizeElement(input.element);
  const bespokeId = bespokeSpriteIdForWeapon(input);
  if (bespokeId) {
    const slug = bespokeId.replace(/^legendary-/, '');
    if ((LEGENDARY_PAINTING_SLUGS as readonly string[]).includes(slug)) {
      const spriteId = legendaryPaintingSpriteId(slug);
      if (getManifestEntry(spriteId)) {
        return { kind: 'legendary', spriteId, slug, element, rarity, weaponType, manufacturer };
      }
    }
  }
  const stem = weaponBaseStem(weaponType, manufacturer);
  if ((WEAPON_BASE_PAINTING_STEMS as readonly string[]).includes(stem)) {
    const spriteId = weaponBaseSpriteId(stem);
    if (getManifestEntry(spriteId)) {
      return { kind: 'base', spriteId, stem, element, rarity, weaponType, manufacturer };
    }
  }
  return undefined;
}

/** Grid dimensions for a density (held shares the card grid).
 *  Thumb is half the stage grid (60x22): the gear list row displays
 *  weapon art at 46x17 CSS px, so the thumb grid still oversamples
 *  the display ~1.3x per axis while quartering the per-item overlay
 *  work and backing-store pixels of the stage render (latency
 *  audit fix, 2026-11-12). */
export function weaponPaintingGrid(density: WeaponPaintingDensity): { width: number; height: number } {
  if (density === 'thumb') return { width: PIXEL_WEAPON_WIDTH / 2, height: PIXEL_WEAPON_HEIGHT / 2 };
  return density === 'stage'
    ? { width: PIXEL_WEAPON_WIDTH, height: PIXEL_WEAPON_HEIGHT }
    : { width: CARD_WEAPON_WIDTH, height: CARD_WEAPON_HEIGHT };
}

export interface FitPlacement {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Contain-fit placement of a sprite inside a grid: the sprite's own
 * aspect, centered — the same placement the render and the stage
 * fractions read, so the raster and the grip/muzzle geometry can
 * never disagree about where the painting sits.
 */
export function weaponPaintingFit(
  spriteWidth: number,
  spriteHeight: number,
  gridWidth: number,
  gridHeight: number,
): FitPlacement {
  const scale = Math.min(gridWidth / spriteWidth, gridHeight / spriteHeight);
  const dw = spriteWidth * scale;
  const dh = spriteHeight * scale;
  return { dx: (gridWidth - dw) / 2, dy: (gridHeight - dh) / 2, dw, dh };
}

/**
 * Grip/muzzle fractions of the HELD (card-grid) painting render,
 * from the sprite's manifest anchors mapped through the fit — the
 * stages seat and flash from these (partsStage reads this instead
 * of the compositor's held render for painted weapons).
 */
export function weaponPaintingFractions(
  resolution: WeaponPaintingResolution,
): { gripFrac: { x: number; y: number }; muzzleFrac: { x: number; y: number }; aspect: number } | undefined {
  const entry = getManifestEntry(resolution.spriteId);
  if (!entry) return undefined;
  const { width: gridW, height: gridH } = weaponPaintingGrid('held');
  const fit = weaponPaintingFit(entry.width, entry.height, gridW, gridH);
  const map = (anchor: { x: number; y: number } | undefined, fallback: { x: number; y: number }) => {
    const a = anchor ?? fallback;
    return { x: (fit.dx + a.x * fit.dw) / gridW, y: (fit.dy + a.y * fit.dh) / gridH };
  };
  return {
    gripFrac: map(entry.anchors.grip, { x: 0.3, y: 0.64 }),
    muzzleFrac: map(entry.anchors.muzzle, { x: 1, y: 0.4 }),
    aspect: gridH / gridW,
  };
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface WeaponPaintingShell {
  resolution: WeaponPaintingResolution;
  width: number;
  height: number;
  signature: string;
  decals: WeaponVisualDecal[];
  condition: WeaponCondition;
  rarityColor: string;
  /** Anchors in grid texels. */
  anchors: {
    muzzle: { x: number; y: number };
    grip: { x: number; y: number };
    centerMass: { x: number; y: number };
    lootPoint: { x: number; y: number };
  };
}

/**
 * The synchronous half of a painting render — identity, signature,
 * overlay fields, anchors — everything a surface needs before the
 * sprite's pixels arrive. Anchors come from the manifest entry
 * mapped through the density's fit.
 */
export function weaponPaintingShell(
  input: PixelWeaponInput,
  resolution: WeaponPaintingResolution,
  density: WeaponPaintingDensity,
): WeaponPaintingShell {
  const { width, height } = weaponPaintingGrid(density);
  const seed = weaponVisualSeed({
    id: input.id,
    name: input.name,
    weaponType: resolution.weaponType,
    manufacturer: resolution.manufacturer,
    element: input.element,
    rarity: resolution.rarity,
    pixelSeed: input.pixelSeed,
  });
  const decals = buildDecals(input.affixes, seed, input.legendaryEffectId);
  const condition = conditionFromRoll(typeof input.rollQuality === 'number' ? input.rollQuality : 50);
  const entry = getManifestEntry(resolution.spriteId);
  const fit = entry ? weaponPaintingFit(entry.width, entry.height, width, height) : { dx: 0, dy: 0, dw: width, dh: height };
  const anchor = (name: string, fallback: { x: number; y: number }) => {
    const a = entry?.anchors[name] ?? fallback;
    return { x: Math.round(fit.dx + a.x * fit.dw), y: Math.round(fit.dy + a.y * fit.dh) };
  };
  const signature = hashString(
    `painting|${density}|${resolution.spriteId}|${resolution.element}|${resolution.rarity}|${condition}|${decals.map((d) => d.id).join(',')}|${seed}`,
  ).toString(16);
  return {
    resolution,
    width,
    height,
    signature,
    decals,
    condition,
    rarityColor: RARITY_FRAME_STYLES[resolution.rarity].color,
    anchors: {
      muzzle: anchor('muzzle', { x: 1, y: 0.4 }),
      grip: anchor('grip', { x: 0.3, y: 0.64 }),
      centerMass: anchor('centerMass', { x: 0.5, y: 0.5 }),
      lootPoint: anchor('lootPoint', { x: 0.42, y: 0 }),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pixel core                                                          */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Overlay step 1 — the element re-light. Applies the base's zone
 * swap for the instance's element to a COPY of the sprite: a pixel
 * re-lights iff its exact RGB is a swap key and (for the two
 * rect-gated bases) it sits inside the authored window rect.
 * Legendaries and zone-less inputs return the sprite untouched.
 */
export function applyWeaponElementSwap(sprite: RgbaImage, resolution: WeaponPaintingResolution): RgbaImage {
  if (resolution.kind !== 'base' || !resolution.stem) return sprite;
  const zone = WEAPON_PAINTING_ZONES[resolution.stem];
  const table = zone?.swaps[resolution.element];
  if (!zone || !table) return sprite;
  const map = new Map<string, [number, number, number]>(Object.entries(table));
  if (map.size === 0) return sprite;
  const out: RgbaImage = { width: sprite.width, height: sprite.height, data: new Uint8Array(sprite.data) };
  const rect = zone.rect;
  const rx0 = rect ? Math.floor(rect[0] * sprite.width) : 0;
  const ry0 = rect ? Math.floor(rect[1] * sprite.height) : 0;
  const rx1 = rect ? Math.ceil(rect[2] * sprite.width) : sprite.width;
  const ry1 = rect ? Math.ceil(rect[3] * sprite.height) : sprite.height;
  for (let y = ry0; y < ry1; y += 1) {
    for (let x = rx0; x < rx1; x += 1) {
      const i = (y * sprite.width + x) * 4;
      if (out.data[i + 3] <= 8) continue;
      const dst = map.get(`${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`);
      if (dst) {
        out.data[i] = dst[0];
        out.data[i + 1] = dst[1];
        out.data[i + 2] = dst[2];
      }
    }
  }
  return out;
}

/**
 * Premultiplied-alpha area-average fit of a sprite into a grid —
 * the wiki plate recipe (Wave 15) at render size: transparent
 * pixels contribute nothing, keyed edges land their coverage in
 * alpha instead of fringing.
 */
export function fitSpriteToGrid(sprite: RgbaImage, gridWidth: number, gridHeight: number): RgbaImage {
  const fit = weaponPaintingFit(sprite.width, sprite.height, gridWidth, gridHeight);
  const out: RgbaImage = { width: gridWidth, height: gridHeight, data: new Uint8Array(gridWidth * gridHeight * 4) };
  const sx = sprite.width / fit.dw;
  const sy = sprite.height / fit.dh;
  for (let gy = 0; gy < gridHeight; gy += 1) {
    const srcY0 = (gy - fit.dy) * sy;
    const srcY1 = (gy + 1 - fit.dy) * sy;
    if (srcY1 <= 0 || srcY0 >= sprite.height) continue;
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const srcX0 = (gx - fit.dx) * sx;
      const srcX1 = (gx + 1 - fit.dx) * sx;
      if (srcX1 <= 0 || srcX0 >= sprite.width) continue;
      const x0 = Math.max(0, Math.floor(srcX0));
      const x1 = Math.min(sprite.width, Math.ceil(srcX1));
      const y0 = Math.max(0, Math.floor(srcY0));
      const y1 = Math.min(sprite.height, Math.ceil(srcY1));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        const wy = Math.min(srcY1, yy + 1) - Math.max(srcY0, yy);
        if (wy <= 0) continue;
        for (let xx = x0; xx < x1; xx += 1) {
          const wx = Math.min(srcX1, xx + 1) - Math.max(srcX0, xx);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const i = (yy * sprite.width + xx) * 4;
          const alpha = sprite.data[i + 3] / 255;
          r += sprite.data[i] * alpha * wgt;
          g += sprite.data[i + 1] * alpha * wgt;
          b += sprite.data[i + 2] * alpha * wgt;
          a += sprite.data[i + 3] * wgt;
          wsum += wgt;
        }
      }
      if (wsum <= 0 || a <= 0) continue;
      const o = (gy * gridWidth + gx) * 4;
      // Unpremultiply: r/g/b accumulated premultiplied by alpha/255,
      // so the straight color is sum * 255 / alphaSum.
      out.data[o] = Math.min(255, Math.round((r * 255) / a));
      out.data[o + 1] = Math.min(255, Math.round((g * 255) / a));
      out.data[o + 2] = Math.min(255, Math.round((b * 255) / a));
      out.data[o + 3] = Math.round(a / wsum);
    }
  }
  return out;
}

/**
 * Overlay steps 2 + 3 — decals and condition, stamped in grid
 * space over body pixels (alpha > 8), the compositors' own rule.
 * Legendaries skip both: a fixed identity is never stamped or worn
 * (V4 law) — their shell still carries the fields.
 */
export function applyWeaponOverlays(
  image: RgbaImage,
  shell: WeaponPaintingShell,
  input: PixelWeaponInput,
): void {
  if (shell.resolution.kind === 'legendary') return;
  const { width: W, height: H } = image;
  const body = (x: number, y: number) =>
    x >= 0 && x < W && y >= 0 && y < H && image.data[(y * W + x) * 4 + 3] > 8;
  // Decal view positions were authored against the compositors'
  // filled view; a painting's silhouette is thinner than its box,
  // so a stamp cell that misses the body snaps to the nearest body
  // pixel within a bounded radius (5 texels per grid step) — the
  // mark stays at its intended relative spot, on the weapon. A
  // cell with no body in reach is skipped, the compositors' rule.
  const SNAP = 5 * Math.max(1, Math.round(W / 120));
  const snapToBody = (x: number, y: number): { x: number; y: number } | undefined => {
    if (body(x, y)) return { x, y };
    for (let r = 1; r <= SNAP; r += 1) {
      for (let yy = y - r; yy <= y + r; yy += 1) {
        for (let xx = x - r; xx <= x + r; xx += 1) {
          if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== r) continue;
          if (body(xx, yy)) return { x: xx, y: yy };
        }
      }
    }
    return undefined;
  };
  const setPx = (x: number, y: number, rgb: [number, number, number]) => {
    const target = snapToBody(x, y);
    if (!target) return;
    const i = (target.y * W + target.x) * 4;
    image.data[i] = rgb[0];
    image.data[i + 1] = rgb[1];
    image.data[i + 2] = rgb[2];
    image.data[i + 3] = 255;
  };
  // Decals: the 200x80 decal view space maps onto the grid exactly
  // as both compositors mapped it; shape offsets scale with the
  // grid (the card path's x2 at 240 wide, x1 at 120).
  const OS = Math.max(1, Math.round(W / 120));
  for (const decal of shell.decals) {
    const gx = Math.round((decal.x / 200) * W);
    const gy = Math.round((decal.y / 80) * H);
    const rgb = hexToRgb(decal.color);
    setPx(gx, gy, rgb);
    if (decal.shape === 'slash') {
      setPx(gx + OS, gy - OS, rgb);
      setPx(gx - OS, gy + OS, rgb);
      setPx(gx + 1, gy - 1, rgb);
      setPx(gx - 1, gy + 1, rgb);
    } else if (decal.shape === 'diamond') {
      setPx(gx, gy - OS, rgb);
      setPx(gx, gy + OS, rgb);
      setPx(gx - OS, gy, rgb);
      setPx(gx + OS, gy, rgb);
    } else if (decal.shape === 'triangle') {
      setPx(gx - OS, gy + OS, rgb);
      setPx(gx + OS, gy + OS, rgb);
    } else if (decal.shape === 'tag') {
      setPx(gx + OS, gy, rgb);
      setPx(gx, gy + OS, rgb);
      setPx(gx + OS, gy + OS, rgb);
    }
  }
  // Condition: the stage compositor's wear streams verbatim —
  // same seeds, same rates, body = the painting's opaque pixels.
  const seed = weaponVisualSeed({
    id: input.id,
    name: input.name,
    weaponType: shell.resolution.weaponType,
    manufacturer: shell.resolution.manufacturer,
    element: input.element,
    rarity: shell.resolution.rarity,
    pixelSeed: input.pixelSeed,
  });
  const condition = shell.condition;
  if (condition === 'beat-up' || condition === 'field-used') {
    const wearRate = condition === 'beat-up' ? 0.06 : 0.025;
    const wearRng = seededRandom(seed ^ 0x51ab3);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        if (image.data[i + 3] > 8 && wearRng() < wearRate) {
          image.data[i + 3] = 0;
        }
      }
    }
  } else if (condition === 'godroll') {
    const sparkleRng = seededRandom(seed ^ 0x90d15);
    const rgb = hexToRgb(shell.rarityColor);
    let placed = 0;
    for (let y = 0; y < H && placed < 5; y += 1) {
      for (let x = 0; x < W && placed < 5; x += 1) {
        const i = (y * W + x) * 4;
        if (image.data[i + 3] > 200 && sparkleRng() < 0.05) {
          image.data[i] = rgb[0];
          image.data[i + 1] = rgb[1];
          image.data[i + 2] = rgb[2];
          placed += 1;
        }
      }
    }
  }
}

export interface WeaponPaintingRender extends WeaponPaintingShell {
  image: RgbaImage;
}

/**
 * Fitted-base cache (latency audit fix, 2026-11-12): the swap + fit
 * half of a painting render depends ONLY on (sprite, element,
 * density) — never on the instance's decals, condition, or seed.
 * Before this cache, every list row re-ran the element swap over
 * the full ~1,400x450 sprite and the area-average fit (~630k source
 * samples) for EVERY item, because the per-render signature keys
 * on per-instance fields and almost never repeats across a real
 * inventory. The fitted bases are bounded (36 base paintings x 6
 * elements + the legendary portraits, per density) and shared by
 * every surface; the per-instance overlays still run per render,
 * on a copy, so rendered pixels are unchanged.
 */
const fittedBaseCache = new Map<string, RgbaImage>();

function fittedBase(
  resolution: WeaponPaintingResolution,
  density: WeaponPaintingDensity,
  sprite: RgbaImage,
  width: number,
  height: number,
): RgbaImage {
  const key = `${density}|${resolution.spriteId}|${resolution.kind === 'base' ? resolution.element : ''}|${sprite.width}x${sprite.height}`;
  const cached = fittedBaseCache.get(key);
  if (cached) return cached;
  const swapped = applyWeaponElementSwap(sprite, resolution);
  const fitted = fitSpriteToGrid(swapped, width, height);
  if (fittedBaseCache.size > 256) fittedBaseCache.clear();
  fittedBaseCache.set(key, fitted);
  return fitted;
}

/**
 * The full painting render for a density: element swap (sprite
 * space) -> fit (grid space) -> decals + condition (grid space).
 * The ORDER is the law the slice's tests pin: painting base first,
 * overlays on top, geometry never.
 */
export function renderWeaponPainting(
  input: PixelWeaponInput,
  resolution: WeaponPaintingResolution,
  density: WeaponPaintingDensity,
  sprite: RgbaImage,
): WeaponPaintingRender {
  const shell = weaponPaintingShell(input, resolution, density);
  const base = fittedBase(resolution, density, sprite, shell.width, shell.height);
  const image: RgbaImage = { width: base.width, height: base.height, data: new Uint8Array(base.data) };
  applyWeaponOverlays(image, shell, input);
  return { ...shell, image };
}
