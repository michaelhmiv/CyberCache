/**
 * Reference scene renderer (golden-image infrastructure) — a small
 * software rasterizer that draws the overhaul's stage compositions
 * (background, parallax tint, rigs in fixed poses, the real compositor
 * weapon, props, FX) into an RGBA buffer, phase-frozen: no clocks, no
 * RNG beyond the seeded inputs in the scene spec. The live stage is
 * React/framer; this renderer mirrors its layout math (placements,
 * grip anchoring, beam geometry) so a pixel diff here catches art,
 * palette, rig, and compositor regressions in CI. It renders nothing
 * in the app.
 */
import type { RgbaImage } from './pngCodec';
import { composePixelWeapon, weaponGripFraction, type PixelWeaponInput } from './weaponCompositor';
import { HUNTER_RIG, enemyRig, type RigDef, type RigPose } from './rig';
import { remapPixelData, type PaletteSpec } from './paletteSwap';

export type SpriteLoader = (spriteId: string) => RgbaImage | undefined;

export const SCENE_W = 384;
export const SCENE_H = 256;

function newCanvas(w = SCENE_W, h = SCENE_H): RgbaImage {
  return { width: w, height: h, data: new Uint8Array(w * h * 4) };
}

function blendPixel(img: RgbaImage, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height || a <= 0) return;
  const i = (y * img.width + x) * 4;
  const dstA = img.data[i + 3] / 255;
  const srcA = a / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  img.data[i] = Math.round((r * srcA + img.data[i] * dstA * (1 - srcA)) / outA);
  img.data[i + 1] = Math.round((g * srcA + img.data[i + 1] * dstA * (1 - srcA)) / outA);
  img.data[i + 2] = Math.round((b * srcA + img.data[i + 2] * dstA * (1 - srcA)) / outA);
  img.data[i + 3] = Math.round(outA * 255);
}

/** Nearest-neighbor blit with cover/contain scaling into a dest rect. */
export function blit(dst: RgbaImage, src: RgbaImage, dx: number, dy: number, dw: number, dh: number, flip = false): void {
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.width - 1, Math.max(0, Math.floor(((flip ? dw - 1 - x : x) / dw) * src.width)));
      const sy = Math.min(src.height - 1, Math.max(0, Math.floor((y / dh) * src.height)));
      const si = (sy * src.width + sx) * 4;
      blendPixel(dst, Math.round(dx) + x, Math.round(dy) + y, src.data[si], src.data[si + 1], src.data[si + 2], src.data[si + 3]);
    }
  }
}

/** Blit rotated around a pivot (pivot in source-normalized coords). */
export function blitRotated(
  dst: RgbaImage,
  src: RgbaImage,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  pivotX: number,
  pivotY: number,
  degrees: number,
): void {
  if (degrees === 0) {
    blit(dst, src, dx, dy, dw, dh);
    return;
  }
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const px = pivotX * dw;
  const py = pivotY * dh;
  const radius = Math.ceil(Math.hypot(dw, dh));
  for (let oy = -radius; oy < radius; oy++) {
    for (let ox = -radius; ox < radius; ox++) {
      // inverse-map the destination offset back into segment space
      const lx = cos * ox + sin * oy;
      const ly = -sin * ox + cos * oy;
      const sx = Math.floor(((lx + px) / dw) * src.width);
      const sy = Math.floor(((ly + py) / dh) * src.height);
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const si = (sy * src.width + sx) * 4;
      if (src.data[si + 3] === 0) continue;
      blendPixel(dst, Math.round(dx + px + ox), Math.round(dy + py + oy), src.data[si], src.data[si + 1], src.data[si + 2], src.data[si + 3]);
    }
  }
}

export function fillRect(img: RgbaImage, x: number, y: number, w: number, h: number, color: [number, number, number], alpha = 255): void {
  for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
    for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
      blendPixel(img, xx, yy, color[0], color[1], color[2], alpha);
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Thick line (square brush), for tracers. */
export function drawLine(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, color: [number, number, number], widthPx: number, alpha = 255): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps;
    const y = y0 + ((y1 - y0) * s) / steps;
    fillRect(img, x - widthPx / 2, y - widthPx / 2, widthPx, widthPx, color, alpha);
  }
}

/** G-1 loot beam: a rarity pillar with a bright core. */
export function drawBeam(img: RgbaImage, cx: number, groundYpx: number, widthPx: number, colorHex: string): void {
  const color = hexToRgb(colorHex);
  for (let y = 0; y < groundYpx; y++) {
    const fade = 0.35 + 0.65 * (y / Math.max(1, groundYpx));
    fillRect(img, cx - widthPx / 2, y, widthPx, 1, color, Math.round(120 * fade));
    fillRect(img, cx - widthPx / 6, y, widthPx / 3, 1, [255, 255, 255], Math.round(150 * fade));
  }
  fillRect(img, cx - widthPx * 0.8, groundYpx - 3, widthPx * 1.6, 3, color, 160);
}

export interface SceneActorRig {
  rig: RigDef;
  pose: RigPose;
  xPct: number;
  heightPct: number;
  feetX: number;
  palette?: PaletteSpec;
  /** Segment sprite overrides (head variants). */
  spriteOverrides?: Record<string, string>;
}

/**
 * Draw a rig into the scene. Segment pixels are (optionally) palette
 * remapped in-memory — the same pure core the live stage's canvas swap
 * uses, so the golden pins the palette math too.
 */
export function drawRig(img: RgbaImage, load: SpriteLoader, actor: SceneActorRig, groundYPct: number): void {
  const boxH = (actor.heightPct / 100) * img.height;
  const boxW = boxH * (actor.rig.frameWidth / actor.rig.frameHeight);
  const boxX = (actor.xPct / 100) * img.width - actor.feetX * boxW;
  const boxY = groundYPct * img.height - boxH;
  const sorted = [...actor.rig.segments].sort((a, b) => a.z - b.z);
  for (const seg of sorted) {
    const spriteId = actor.spriteOverrides?.[seg.id] ?? seg.spriteId;
    const src = load(spriteId);
    if (!src) continue;
    let pixels = src;
    if (actor.palette) {
      pixels = { width: src.width, height: src.height, data: new Uint8Array(src.data) };
      remapPixelData(pixels.data as unknown as Uint8ClampedArray, actor.palette);
    }
    const dw = (seg.width / actor.rig.frameWidth) * boxW;
    const dh = (seg.height / actor.rig.frameHeight) * boxH;
    const dx = boxX + (seg.frameX / actor.rig.frameWidth) * boxW;
    const dy = boxY + (seg.frameY / actor.rig.frameHeight) * boxH;
    const pose = actor.pose[seg.id] ?? {};
    // Pivot from the segment's own geometry: rig pivots are authored
    // per segment id in the manifest at runtime; the renderer uses the
    // canonical pivot table baked into rig.ts poses' coordinate frame —
    // approximated here by the segment centers for head/arm segments.
    const pivotX = seg.id === 'head' ? 0.55 : seg.id.startsWith('arm') ? 0.12 : 0.5;
    const pivotY = seg.id === 'head' ? 0.9 : seg.id.startsWith('arm') ? 0.3 : 0.1;
    blitRotated(img, pixels, dx, dy, dw, dh, pivotX, pivotY, pose.rotate ?? 0);
  }
}

/** Draw the compositor weapon at the hunter's grip (mirrors the
 *  diorama's anchor math). */
export function drawHeldWeapon(img: RgbaImage, weapon: PixelWeaponInput, hunterBox: { x: number; y: number; w: number; h: number }): void {
  const render = composePixelWeapon(weapon);
  const grip = weaponGripFraction(weapon.weaponType);
  const gripFrame = { x: 0.55, y: 0.37 }; // hunter manifest grip anchor
  const wW = hunterBox.w * 0.78;
  const wH = wW * (render.height / render.width);
  const dx = hunterBox.x + gripFrame.x * hunterBox.w - grip.x * wW;
  const dy = hunterBox.y + gripFrame.y * hunterBox.h - grip.y * wH;
  const cellW = wW / render.width;
  const cellH = wH / render.height;
  for (let y = 0; y < render.height; y++) {
    const row = render.rows[y];
    for (let x = 0; x < render.width; x++) {
      const shade = row[x];
      if (shade === '.') continue;
      const color = hexToRgb(render.colors[shade as keyof typeof render.colors] ?? '#FFFFFF');
      fillRect(img, dx + x * cellW, dy + y * cellH, Math.ceil(cellW), Math.ceil(cellH), color);
    }
  }
}

/** Rasterize a compositor render into an arbitrary rect (item cards). */
export function drawWeaponRender(img: RgbaImage, weapon: PixelWeaponInput, dx: number, dy: number, w: number, h: number): void {
  const render = composePixelWeapon(weapon);
  const cellW = w / render.width;
  const cellH = h / render.height;
  for (let y = 0; y < render.height; y++) {
    const row = render.rows[y];
    for (let x = 0; x < render.width; x++) {
      const shade = row[x];
      if (shade === '.') continue;
      const color = hexToRgb(render.colors[shade as keyof typeof render.colors] ?? '#FFFFFF');
      fillRect(img, dx + x * cellW, dy + y * cellH, Math.ceil(cellW), Math.ceil(cellH), color);
    }
  }
}

export function hunterBox(img: RgbaImage, xPct: number, heightPct: number, groundYPct: number): { x: number; y: number; w: number; h: number } {
  const h = (heightPct / 100) * img.height;
  const w = h * (HUNTER_RIG.frameWidth / HUNTER_RIG.frameHeight);
  return { x: (xPct / 100) * img.width - 0.2717 * w, y: groundYPct * img.height - h, w, h };
}

export { hexToRgb, newCanvas };
export type { RigDef };
export { enemyRig };
