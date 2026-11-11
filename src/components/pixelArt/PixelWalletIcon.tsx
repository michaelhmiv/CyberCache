import React, { useEffect, useRef } from 'react';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { walletSpriteId, itemSpriteSignature } from '@/lib/pixel/itemArt';
import { getResourceVisual, type ResourceVisualId } from '@/constants/visualAssets';

/**
 * PixelWalletIcon — the wallet resources (credits, scrap, keys,
 * cores, XP…) rendered as their adopted Top-Choice paintings
 * (Wave 12 masters, INT-4): the manifest sprite registered for
 * the resource, drawn from itemArt.ts. The Wave 13 icons book
 * closed the wallet class on exactly this ground — its glyphs
 * were already covered by Wave 12's full masters — so the
 * wallet's tinted §7 glyphs retire here and the masters go in.
 *
 * Cache Fragment has no entry: the fragment currency was
 * abolished and its registry entry + glyph mapping are deleted
 * with this slice (owner ruling 2026-11-11). The map below is
 * total over the surviving ResourceVisualId union — a deleted
 * id is a compile error, never a silent fallback.
 */

interface PixelWalletIconProps {
  id: ResourceVisualId;
  /** §7 size ramp only: 13 inline, 17 rails/rows, 26 doors, 40 heroes. */
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const PixelWalletIcon: React.FC<PixelWalletIconProps> = ({ id, size = 17, className, style }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visual = getResourceVisual(id);
  const spriteId = walletSpriteId(id);
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

  return (
    <canvas
      ref={canvasRef}
      width={sprite?.width ?? 80}
      height={sprite?.height ?? 80}
      className={className}
      style={{ width: size, height: size, flex: 'none', ...style }}
      role="img"
      aria-label={visual.label}
      title={visual.label}
      data-signature={signature}
      data-wallet-id={id}
    />
  );
};

export default PixelWalletIcon;
