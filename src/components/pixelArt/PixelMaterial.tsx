import React, { useEffect, useRef } from 'react';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { materialSpriteId, itemSpriteSignature } from '@/lib/pixel/itemArt';
import { getMaterialVisual, getResourceVisual } from '@/constants/visualAssets';

/**
 * PixelMaterial — renders a material / essence / the Scrap
 * resource as its adopted Top-Choice painting (Wave 12 master,
 * INT-4): the manifest sprite registered for the id, drawn from
 * itemArt.ts. One render for every surface (rows, market boxes,
 * sheet stages, the diorama's rising finds) — the same sprite
 * the wiki plates derive from.
 *
 * History: this component painted the runtime STUFF compositor
 * (materialArt.ts) until INT-4; the family shipped at ZERO
 * sprite payload and now carries real sprites. The compositor
 * stays in the tree as the S2 lint corpus's data source.
 * `density` is retained on the props for call-site
 * compatibility — the adopted master is the single render at
 * every density (masters ship at 2× the largest display size).
 */

interface PixelMaterialProps {
  /** Registry id: a MaterialType / EssenceType value, or 'Scrap'. */
  id: string;
  /** Display width in CSS px (the sprite is square; height follows). */
  size?: number;
  density?: 'object' | 'thumb';
  className?: string;
  testId?: string;
}

export const PixelMaterial: React.FC<PixelMaterialProps> = React.memo(({
  id,
  size = 26,
  density = 'object',
  className = '',
  testId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const spriteId = materialSpriteId(id);
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

  const label = id === 'Scrap' ? getResourceVisual('scrap').label : getMaterialVisual(id).label;

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
      data-material-id={id}
    />
  );
});

export default PixelMaterial;
