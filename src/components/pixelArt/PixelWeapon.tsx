import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Weapon } from '@/types/items';
import {
  composePixelWeaponCached,
  paintPixelWeapon,
  pixelWeaponInputFromWeapon,
  PIXEL_WEAPON_HEIGHT,
  PIXEL_WEAPON_WIDTH,
  type PixelWeaponInput,
} from '@/lib/pixel/weaponCompositor';
import {
  composeWeaponCardCached,
  paintWeaponCard,
  CARD_WEAPON_HEIGHT,
  CARD_WEAPON_WIDTH,
} from '@/lib/pixel/weaponCardCompositor';
import {
  renderWeaponPainting,
  resolveWeaponPainting,
  weaponPaintingShell,
  type WeaponPaintingRender,
} from '@/lib/pixel/weaponPaintingRender';
import { getPixelSprite, hasManifestEntry } from '@/lib/pixel/manifest';
import { loadSpriteImage } from '@/lib/pixel/gearPaintedRender';
import type { RgbaImage } from '@/lib/pixel/pngCodec';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { useDeferredArt } from './useDeferredArt';

/**
 * PixelWeapon — renders a weapon. One renderer for every surface:
 * diorama, inventory/market/workshop, loot.
 *
 * - Painted renderer FIRST (Top-Choice renderer slice, 2026-11-11):
 *   every real weapon resolves to its adopted Top-Choice painting
 *   (weaponPaintingRender.ts) — the painting is the base render,
 *   with the instance's element re-lighting its authored glow
 *   zone, its affix decals, and its roll condition as overlays.
 *   The sprite loads async; the canvas mounts at final geometry
 *   immediately and paints when the render lands (the PixelGear
 *   painted-layer pattern). Renders cache module-wide by
 *   signature, so lists never repaint a weapon they already drew.
 * - The texel compositors (weaponCompositor 120×44 /
 *   weaponCardCompositor 240×88) remain the fallback for inputs
 *   that resolve to no painting — fixtures and malformed payloads;
 *   every real type×manufacturer and named legendary resolves.
 * - `density`: 'card' (240×88) is the inspect composition for
 *   inventory / gear detail / market / loot surfaces; 'held' is
 *   the same card grid as the in-scene held weapon on every stage
 *   (paintings carry no presentation furniture, so held and card
 *   are the same pixels at different signatures); 'stage' (120×44)
 *   is the detail-level-0 small grid for compact list rows and
 *   feed thumbs (DESIGN.md §8). All densities share the 30:11
 *   aspect, so swapping never shifts layout.
 */

const PAINT_SCALE = 3; // supersampled backing store; CSS size stays exact
const CARD_PAINT_SCALE = 2; // the card grid is already 2× the stage grid
const THUMB_PAINT_SCALE = 2; // thumb grid 60x22 -> 120x44 backing for a 46x17 display

/** Painting renders by signature (module-wide, like the compositor caches). */
const paintingRenderCache = new Map<string, WeaponPaintingRender>();

/** Paint an RGBA render into a 2D context at an integer scale. */
function paintRgbaImage(ctx: CanvasRenderingContext2D, image: RgbaImage, scale: number): void {
  const off = document.createElement('canvas');
  off.width = image.width;
  off.height = image.height;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;
  offCtx.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, image.width * scale, image.height * scale);
  ctx.drawImage(off, 0, 0, image.width * scale, image.height * scale);
}

interface PixelWeaponProps {
  weapon?: Weapon;
  input?: PixelWeaponInput;
  /** Display width in CSS px; height follows the kit aspect (120x44).
   *  Ignored when `fluid` is set. */
  size?: number;
  /** Fill the parent width (height follows aspect) — for in-scene placement. */
  fluid?: boolean;
  className?: string;
  testId?: string;
  /** Composition density: 'stage' 120×44 small grid (default,
   *  list rows / feed thumbs), 'card' 240×88 inspect, 'held'
   *  240×88 held mode (the stage's in-hand render), or 'thumb'
   *  60×22 half-stage grid for the gear list's 46px rows (latency
   *  audit fix, 2026-11-12 — the stage backing store was ~61x the
   *  row's displayed pixels). */
  density?: 'stage' | 'card' | 'held' | 'thumb';
  /**
   * Viewport-deferred composition (Gear cold-load fix): when set,
   * the canvas mounts at its final geometry immediately but the
   * compose + paint wait until the element is near the viewport
   * (useDeferredArt). List surfaces opt in; on-screen surfaces
   * (loadout, inspect, diorama) leave it off and compose at once.
   */
  defer?: boolean;
}

export const PixelWeapon: React.FC<PixelWeaponProps> = React.memo(({ weapon, input, size = 120, fluid = false, className = '', testId, density = 'stage', defer = false }: PixelWeaponProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { ref: deferRef, active } = useDeferredArt<HTMLCanvasElement>(defer);
  const setCanvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      canvasRef.current = el;
      deferRef.current = el;
    },
    [deferRef],
  );

  const resolved: PixelWeaponInput | undefined = useMemo(() => {
    if (input) return input;
    if (!weapon) return undefined;
    return pixelWeaponInputFromWeapon(weapon);
  }, [input, weapon]);

  const paintScale = density === 'stage' ? PAINT_SCALE : density === 'thumb' ? THUMB_PAINT_SCALE : CARD_PAINT_SCALE;
  // The texel-compositor fallback has no thumb composition of its
  // own: a thumb request falls back to the stage render painted at
  // 1x (120x44 — the same backing box the thumb painting occupies).
  const fallbackScale = density === 'thumb' ? 1 : paintScale;

  // Painted layer: resolution is decided by the MANIFEST
  // declaration (never by whether the asset glob resolved), the
  // same gate PixelGear's painted layer uses.
  const painting = useMemo(
    () => (resolved ? resolveWeaponPainting(resolved) : undefined),
    [resolved],
  );
  const paintingDeclared = painting ? hasManifestEntry(painting.spriteId) : false;
  const shell = useMemo(
    () => (resolved && painting && paintingDeclared ? weaponPaintingShell(resolved, painting, density) : undefined),
    [resolved, painting, paintingDeclared, density],
  );
  const [paintingRender, setPaintingRender] = useState<WeaponPaintingRender | undefined>(undefined);
  useEffect(() => {
    if (!active || !resolved || !painting || !shell) {
      setPaintingRender(undefined);
      return;
    }
    const cached = paintingRenderCache.get(shell.signature);
    if (cached) {
      setPaintingRender(cached);
      return;
    }
    const sprite = getPixelSprite(painting.spriteId);
    if (!sprite) {
      setPaintingRender(undefined);
      return;
    }
    let cancelled = false;
    void loadSpriteImage(painting.spriteId, sprite.url).then((image) => {
      if (cancelled || !image) return;
      const render = renderWeaponPainting(resolved, painting, density, image);
      paintingRenderCache.set(shell.signature, render);
      setPaintingRender(render);
    });
    return () => {
      cancelled = true;
    };
  }, [active, resolved, painting, shell, density]);

  const stageRender = useMemo(
    () => (active && resolved && !paintingDeclared && (density === 'stage' || density === 'thumb') ? composePixelWeaponCached(resolved) : undefined),
    [active, resolved, paintingDeclared, density],
  );
  const cardRender = useMemo(
    () => (active && resolved && !paintingDeclared && density === 'card' ? composeWeaponCardCached(resolved) : undefined),
    [active, resolved, paintingDeclared, density],
  );
  const heldRender = useMemo(
    () => (active && resolved && !paintingDeclared && density === 'held' ? composeWeaponCardCached(resolved, undefined, { held: true }) : undefined),
    [active, resolved, paintingDeclared, density],
  );
  const render = heldRender ?? cardRender ?? stageRender;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported — element + signature still render
    if (paintingRender) paintRgbaImage(ctx, paintingRender.image, paintScale);
    else if (heldRender) paintWeaponCard(ctx, heldRender, CARD_PAINT_SCALE);
    else if (cardRender) paintWeaponCard(ctx, cardRender, CARD_PAINT_SCALE);
    else if (stageRender) paintPixelWeapon(ctx, stageRender, density === 'thumb' ? 1 : PAINT_SCALE);
  }, [paintingRender, heldRender, cardRender, stageRender, paintScale, density]);

  if (defer && !active && resolved) {
    // Deferred and not yet activated: mount the canvas at its FINAL
    // geometry (the density grids are fixed — 120×44 / 240×88 — so
    // this box is exactly the box the painted canvas will occupy)
    // with the compose + paint still pending. No layout shift when
    // the art lands; the rarity glow is rarity-derived, so it can
    // ride the placeholder unchanged. This branch precedes the
    // painted branch on purpose: a deferred row must not expose a
    // signature (i.e. a composition) before it activates.
    const gridW = density === 'stage' ? PIXEL_WEAPON_WIDTH : density === 'thumb' ? PIXEL_WEAPON_WIDTH / 2 : CARD_WEAPON_WIDTH;
    const gridH = density === 'stage' ? PIXEL_WEAPON_HEIGHT : density === 'thumb' ? PIXEL_WEAPON_HEIGHT / 2 : CARD_WEAPON_HEIGHT;
    const height = Math.round(size * (gridH / gridW));
    return (
      <canvas
        ref={setCanvasRef}
        width={gridW * paintScale}
        height={gridH * paintScale}
        className={className}
        style={{
          width: fluid ? '100%' : size,
          height: fluid ? 'auto' : height,
          imageRendering: 'pixelated',
          filter:
            resolved.rarity === 'Epic' || resolved.rarity === 'Legendary'
              ? `drop-shadow(0 0 6px ${RARITY_FRAME_STYLES[resolved.rarity].color})`
              : undefined,
        }}
        role="img"
        aria-label={resolved.name ?? `${resolved.rarity ?? ''} ${resolved.weaponType ?? ''}`}
        data-testid={testId}
        data-density={density}
        data-deferred-art="pending"
      />
    );
  }
  if (!render && !shell) {
    return null;
  }
  if (shell && painting) {
    const height = Math.round(size * (shell.height / shell.width));
    return (
      <canvas
        ref={setCanvasRef}
        width={shell.width * paintScale}
        height={shell.height * paintScale}
        className={className}
        style={{
          width: fluid ? '100%' : size,
          height: fluid ? 'auto' : height,
          imageRendering: 'pixelated',
          filter:
            resolved && (resolved.rarity === 'Epic' || resolved.rarity === 'Legendary')
              ? `drop-shadow(0 0 6px ${shell.rarityColor})`
              : undefined,
        }}
        role="img"
        aria-label={resolved?.name ?? `${resolved?.rarity ?? ''} ${resolved?.weaponType ?? 'weapon'}`}
        data-testid={testId}
        data-signature={shell.signature}
        data-density={density}
        data-painted-sprite={painting.spriteId}
      />
    );
  }
  if (!render) return null;
  const height = Math.round(size * (render.height / render.width));
  return (
    <canvas
      ref={setCanvasRef}
      width={render.width * fallbackScale}
      height={render.height * fallbackScale}
      className={className}
      style={{
        width: fluid ? '100%' : size,
        height: fluid ? 'auto' : height,
        imageRendering: 'pixelated',
        filter:
          resolved && (resolved.rarity === 'Epic' || resolved.rarity === 'Legendary')
            ? `drop-shadow(0 0 6px ${render.rarityColor})`
            : undefined,
      }}
      role="img"
      aria-label={resolved?.name ?? `${resolved?.rarity ?? ''} ${resolved?.weaponType ?? 'weapon'}`}
      data-testid={testId}
      data-signature={render.signature}
      data-density={density}
    />
  );
});
