import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { bespokeSpriteIdForWeapon, getPixelSprite } from '@/lib/pixel/manifest';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { useDeferredArt } from './useDeferredArt';

/**
 * PixelWeapon — renders a weapon as pixel art through the parts-kit
 * compositor (src/lib/pixel/weaponCompositor.ts). One renderer for every
 * surface: diorama now, inventory/market/workshop in P5.
 *
 * - Procedural weapons compose deterministically from their rolled parts.
 * - Named legendaries with bespoke art (manifest BESPOKE_LEGENDARY_SPRITES)
 *   render their fixed sprite instead.
 * - Painting happens once per unique weapon signature; the composed render
 *   is cached module-wide, so re-renders and lists never repaint texels.
 * - `density`: 'card' (240×88, weaponCardCompositor) is the
 *   inspect composition for inventory / gear detail / market /
 *   loot surfaces; 'held' is the SAME card grammar in held mode
 *   (One Grammar, 2026-11-06) — the card composition minus its
 *   presentation furniture — and is the in-scene held weapon on
 *   every stage; 'stage' (120×44, weaponCompositor) survives only
 *   as the detail-level-0 small grid for compact list rows and
 *   feed thumbs (DESIGN.md §8; the card compose is too heavy to
 *   run per row). All densities share the 30:11 aspect, so
 *   swapping never shifts layout. Bespoke legendary resolution
 *   is identical at every density.
 */

const PAINT_SCALE = 3; // supersampled backing store; CSS size stays exact
const CARD_PAINT_SCALE = 2; // the card grid is already 2× the stage grid

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
   *  list rows / feed thumbs), 'card' 240×88 inspect, or 'held'
   *  240×88 held mode (the stage's in-hand render). */
  density?: 'stage' | 'card' | 'held';
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

  const bespoke = resolved ? bespokeSpriteIdForWeapon(resolved) : undefined;
  const bespokeSprite = bespoke ? getPixelSprite(bespoke) : undefined;

  const paintScale = density === 'stage' ? PAINT_SCALE : CARD_PAINT_SCALE;

  const stageRender = useMemo(
    () => (active && resolved && !bespokeSprite && density === 'stage' ? composePixelWeaponCached(resolved) : undefined),
    [active, resolved, bespokeSprite, density],
  );
  const cardRender = useMemo(
    () => (active && resolved && !bespokeSprite && density === 'card' ? composeWeaponCardCached(resolved) : undefined),
    [active, resolved, bespokeSprite, density],
  );
  const heldRender = useMemo(
    () => (active && resolved && !bespokeSprite && density === 'held' ? composeWeaponCardCached(resolved, undefined, { held: true }) : undefined),
    [active, resolved, bespokeSprite, density],
  );
  const render = heldRender ?? cardRender ?? stageRender;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported — element + signature still render
    if (heldRender) paintWeaponCard(ctx, heldRender, CARD_PAINT_SCALE);
    else if (cardRender) paintWeaponCard(ctx, cardRender, CARD_PAINT_SCALE);
    else if (stageRender) paintPixelWeapon(ctx, stageRender, PAINT_SCALE);
  }, [heldRender, cardRender, stageRender]);

  if (bespokeSprite) {
    const height = Math.round(size * (bespokeSprite.height / bespokeSprite.width));
    return (
      <img
        src={bespokeSprite.url}
        alt={resolved?.name ?? 'Legendary weapon'}
        width={fluid ? undefined : size}
        height={fluid ? undefined : height}
        className={className}
        style={{ imageRendering: 'pixelated', width: fluid ? '100%' : undefined, height: fluid ? 'auto' : undefined }}
        data-testid={testId}
        data-pixel-sprite={bespokeSprite.id}
        draggable={false}
      />
    );
  }

  if (!render) {
    // Deferred and not yet activated: mount the canvas at its FINAL
    // geometry (the density grids are fixed — 120×44 / 240×88 — so
    // this box is exactly the box the painted canvas will occupy)
    // with the compose + paint still pending. No layout shift when
    // the art lands; the rarity glow is rarity-derived, so it can
    // ride the placeholder unchanged.
    if (defer && !active && resolved && !bespokeSprite) {
      const gridW = density === 'stage' ? PIXEL_WEAPON_WIDTH : CARD_WEAPON_WIDTH;
      const gridH = density === 'stage' ? PIXEL_WEAPON_HEIGHT : CARD_WEAPON_HEIGHT;
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
    return null;
  }
  const height = Math.round(size * (render.height / render.width));
  return (
    <canvas
      ref={setCanvasRef}
      width={render.width * paintScale}
      height={render.height * paintScale}
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
