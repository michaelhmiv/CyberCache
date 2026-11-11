import React, { useEffect, useRef } from 'react';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { consumableSpriteId, itemSpriteSignature } from '@/lib/pixel/itemArt';
import { CONSUMABLES } from '@/constants/consumables';

/**
 * PixelConsumable — renders a consumable type as its adopted
 * Top-Choice painting (Wave 11 master, INT-4): the manifest
 * sprite registered for the type, drawn from itemArt.ts. One
 * render for every surface where a consumable appears AS AN
 * ITEM (vendor cards, market stack listings, the belt, stacks,
 * the picker, the inspect sheet) — the same sprite the wiki
 * plates derive from, so the one-render signature holds.
 *
 * History: this component painted the runtime texel compositor
 * (consumableArt.ts) until INT-4; the compositor stays in the
 * tree as the S2 lint corpus's data source and the fallback
 * below. `density` is retained on the props for call-site
 * compatibility — the adopted master is the single render at
 * every density now (the masters ship at 2× the largest display
 * size, so thumbs downscale the shipped sprite, never a
 * re-composition).
 *
 * Fallback: a type with no adopted master (an unlisted future
 * type) draws nothing here rather than resurrecting a glyph —
 * itemArt coverage is pinned by test (all 44 types).
 */

interface PixelConsumableProps {
  /** ConsumableType id (the def key in CONSUMABLES). */
  type: string;
  /** Display width in CSS px (the sprite is square; height follows). */
  size?: number;
  density?: 'object' | 'thumb';
  className?: string;
  testId?: string;
}

export const PixelConsumable: React.FC<PixelConsumableProps> = React.memo(({
  type,
  size = 26,
  density = 'object',
  className = '',
  testId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const spriteId = consumableSpriteId(type);
  const sprite = spriteId ? getPixelSprite(spriteId) : undefined;
  const signature = spriteId ? itemSpriteSignature(spriteId) : '';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / unsupported — element + signature still render
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = sprite.url;
  }, [sprite]);

  const label = CONSUMABLES[type]?.name ?? type;

  return (
    <canvas
      ref={canvasRef}
      width={sprite?.width ?? 104}
      height={sprite?.height ?? 104}
      className={className}
      style={{ width: size, height: size, flex: 'none' }}
      role="img"
      aria-label={label}
      data-testid={testId}
      data-signature={signature}
      data-density={density}
      data-consumable-id={type}
    />
  );
});

export default PixelConsumable;
