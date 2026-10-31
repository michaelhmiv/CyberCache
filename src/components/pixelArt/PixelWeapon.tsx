import React, { useEffect, useMemo, useRef } from 'react';
import type { Weapon } from '@/types/items';
import {
  composePixelWeaponCached,
  paintPixelWeapon,
  type PixelWeaponInput,
} from '@/lib/pixel/weaponCompositor';
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
 */

const PAINT_SCALE = 3; // supersampled backing store; CSS size stays exact

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
}

export const PixelWeapon: React.FC<PixelWeaponProps> = ({ weapon, input, size = 120, fluid = false, className = '', testId }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const resolved: PixelWeaponInput | undefined = useMemo(() => {
    if (input) return input;
    if (!weapon) return undefined;
    return {
      weaponType: weapon.weaponType,
      manufacturer: weapon.manufacturer,
      rarity: weapon.rarity,
      element: weapon.element,
      parts: weapon.parts,
      name: weapon.name,
      id: weapon.id,
      pixelSeed: weapon.pixelSeed,
      affixes: weapon.affixes,
      rollQuality: weapon.rollQuality,
      legendaryEffectId: weapon.legendaryEffectId,
    };
  }, [input, weapon]);

  const bespoke = resolved ? bespokeSpriteIdForWeapon(resolved) : undefined;
  const bespokeSprite = bespoke ? getPixelSprite(bespoke) : undefined;

  const render = useMemo(
    () => (resolved && !bespokeSprite ? composePixelWeaponCached(resolved) : undefined),
    [resolved, bespokeSprite],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !render) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported — element + signature still render
    paintPixelWeapon(ctx, render, PAINT_SCALE);
  }, [render]);

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
      width={render.width * PAINT_SCALE}
      height={render.height * PAINT_SCALE}
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
    />
  );
};
