/**
 * PartSpriteThumb (portraits conversion, device-pass Batch 3) — a
 * cosmetic PART rendered as itself: its own sprite, swapped to the
 * part's tint + finish palette (the same effectivePartPalette the
 * look resolution used). Used where a surface shows a part as an
 * item — the market's cosmetic listing thumb and the sell lane's
 * mini card — the way every other market thumb shows the item for
 * sale (SkinThumb paints the skin's painting; StackThumb the
 * stack's render).
 *
 * This replaces the synthesized one-part mannequin those surfaces
 * used to build (a parts figure wearing just the listed part, head
 * hard-coded): the segmented figure no longer renders on market
 * surfaces, and a part preview's job is to show the part, not a
 * person. Parts remain grandfathered collection pieces — as items
 * they render exactly like this in Collections.
 *
 * Pure render: part id + tint + quality in, sprite out.
 */
import React from 'react';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { skinPartDef } from '@/lib/pixel/skinParts';
import { paletteSpriteUrl } from '@/lib/pixel/paletteSwap';
import { effectivePartPalette } from '@/content/skins';

export const PartSpriteThumb: React.FC<{
  partId: string;
  tintPaletteId?: string | null;
  quality?: number | null;
  className?: string;
  testId?: string;
}> = ({ partId, tintPaletteId, quality, className = 'h-16', testId }) => {
  const def = skinPartDef(partId);
  const sprite = def ? getPixelSprite(def.spriteId) : undefined;
  if (!def || !sprite) return null;
  const palette = effectivePartPalette(tintPaletteId ?? null, quality ?? 50);
  const url = palette ? paletteSpriteUrl(def.spriteId, sprite.url, palette.paletteId, palette.spec) : sprite.url;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      data-testid={testId}
      data-part-id={partId}
    >
      <img
        src={url}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="max-h-full w-auto max-w-full select-none object-contain"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
};
