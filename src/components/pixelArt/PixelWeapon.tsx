import React, { useEffect, useMemo, useRef } from 'react';
import type { Weapon } from '@/types/items';
import {
  composePixelWeaponCached,
  paintPixelWeapon,
  pixelWeaponInputFromWeapon,
  type PixelWeaponInput,
} from '@/lib/pixel/weaponCompositor';
import {
  composeWeaponCardCached,
  paintWeaponCard,
} from '@/lib/pixel/weaponCardCompositor';
import { bespokeSpriteIdForWeapon, getPixelSprite } from '@/lib/pixel/manifest';

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
 * - `density`: 'stage' (120×44) is the in-scene held weapon; 'card'
 *   (240×88, weaponCardCompositor) is the same composition at card
 *   density for inventory / gear detail / market / loot surfaces.
 *   Both densities share the 30:11 aspect, so swapping never shifts
 *   layout. Bespoke legendary resolution is identical at both.
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
  /** Composition density: 'stage' 120×44 (default) or 'card' 240×88. */
  density?: 'stage' | 'card';
}

export const PixelWeapon: React.FC<PixelWeaponProps> = React.memo(({ weapon, input, size = 120, fluid = false, className = '', testId, density = 'stage' }: PixelWeaponProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const resolved: PixelWeaponInput | undefined = useMemo(() => {
    if (input) return input;
    if (!weapon) return undefined;
    return pixelWeaponInputFromWeapon(weapon);
  }, [input, weapon]);

  const bespoke = resolved ? bespokeSpriteIdForWeapon(resolved) : undefined;
  const bespokeSprite = bespoke ? getPixelSprite(bespoke) : undefined;

  const paintScale = density === 'card' ? CARD_PAINT_SCALE : PAINT_SCALE;

  const stageRender = useMemo(
    () => (resolved && !bespokeSprite && density === 'stage' ? composePixelWeaponCached(resolved) : undefined),
    [resolved, bespokeSprite, density],
  );
  const cardRender = useMemo(
    () => (resolved && !bespokeSprite && density === 'card' ? composeWeaponCardCached(resolved) : undefined),
    [resolved, bespokeSprite, density],
  );
  const render = cardRender ?? stageRender;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported — element + signature still render
    if (cardRender) paintWeaponCard(ctx, cardRender, CARD_PAINT_SCALE);
    else if (stageRender) paintPixelWeapon(ctx, stageRender, PAINT_SCALE);
  }, [cardRender, stageRender]);

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

  if (!render) return null;
  const height = Math.round(size * (render.height / render.width));
  return (
    <canvas
      ref={canvasRef}
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
