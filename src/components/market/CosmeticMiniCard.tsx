/**
 * CosmeticMiniCard (skins slice, 0053; portraits conversion,
 * device-pass Batch 3) — a skin part's market card: the part
 * rendered as itself (its own sprite, its tint + finish applied)
 * beside its facts. Used by the Buy lane (from a Listing) and the
 * Sell lane (from an owned part view) so a part reads identically
 * on both sides of the market. Pure render.
 *
 * The card used to dress a parts figure in just this part; the
 * segmented figure no longer renders on market surfaces, so the
 * thumb shows the item itself — the same read as every other
 * market thumb.
 */
import React from 'react';
import { PartSpriteThumb } from '@/components/pixelArt/PartSpriteThumb';
import {
  FINISH_LABELS,
  finishTierForQuality,
  skinPartCatalog,
  skinSetById,
  tintPaletteById,
} from '@/content/skins';

export const CosmeticMiniCard: React.FC<{
  partId: string | null;
  name: string;
  qualityPercent: number | null;
  tintPaletteId: string | null;
  right?: React.ReactNode;
  testId?: string;
}> = ({ partId, name, qualityPercent, tintPaletteId, right, testId }) => {
  const def = partId ? skinPartCatalog(partId) : undefined;
  const tint = tintPaletteById(tintPaletteId);
  return (
    <div className="flex items-center gap-2" data-testid={testId ?? 'cosmetic-mini-card'}>
      {def ? (
        <div className="w-14 shrink-0 border border-border bg-bg">
          <PartSpriteThumb partId={def.id} tintPaletteId={tintPaletteId} quality={qualityPercent} className="h-16" />
        </div>
      ) : (
        <div className="grid h-16 w-14 shrink-0 place-items-center border border-border bg-bg text-[11px] text-text-muted">
          ?
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold text-text-primary">{name}</div>
        <div className="text-[11px] text-text-muted">
          {def ? `${skinSetById(def.setId)?.name ?? def.setId} · ${def.slot}` : 'Skin part'}
          {qualityPercent !== null && qualityPercent !== undefined
            ? ` · ${FINISH_LABELS[finishTierForQuality(qualityPercent)]} Q${Math.round(qualityPercent)}`
            : ''}
          {tint ? ` · ${tint.name} tint` : ''}
        </div>
        <div className="text-[11px] text-text-muted">Pure cosmetic — zero stats</div>
      </div>
      {right}
    </div>
  );
};
