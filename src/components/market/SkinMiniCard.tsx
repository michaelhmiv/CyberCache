/**
 * SkinMiniCard (reshape slice (d)) — a WHOLE skin's market card:
 * the painting itself beside its facts (its hunter, its finish,
 * its set when it paints one). Used by the Sell lane from an owned
 * skin view; the Buy lane's ListingRow thumb renders the same
 * painting. Pure render — a skin is one painted whole, never a
 * composite of parts.
 */
import React from 'react';
import { FINISH_LABELS, finishTierForQuality, skinSetById } from '@/content/skins';
import { hunterById } from '@/lib/hunters/hunters';
import { skinById } from '@/lib/hunters/hunterSkins';
import { getPixelSprite } from '@/lib/pixel/manifest';

export const SkinMiniCard: React.FC<{
  skinId: string | null;
  name: string;
  qualityPercent: number | null;
  right?: React.ReactNode;
  testId?: string;
}> = ({ skinId, name, qualityPercent, right, testId }) => {
  const def = skinId ? skinById(skinId) : undefined;
  const sprite = def ? getPixelSprite(def.spriteId) : undefined;
  const hunter = def ? hunterById(def.hunterId) : undefined;
  const setName = def?.setId ? (skinSetById(def.setId)?.name ?? def.setId) : null;
  return (
    <div className="flex items-center gap-2" data-testid={testId ?? 'skin-mini-card'}>
      {sprite ? (
        <div className="flex h-16 w-14 shrink-0 items-end justify-center overflow-hidden border border-border bg-bg">
          <img
            src={sprite.url}
            alt=""
            className="max-h-full object-contain [image-rendering:pixelated]"
            draggable={false}
          />
        </div>
      ) : (
        <div className="grid h-16 w-14 shrink-0 place-items-center border border-border bg-bg text-[11px] text-text-muted">
          ?
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold text-text-primary">{name}</div>
        <div className="text-[11px] text-text-muted">
          {def ? `Whole skin · ${hunter?.name ?? def.hunterId}` : 'Whole skin'}
          {setName ? ` · ${setName}` : ''}
          {qualityPercent !== null && qualityPercent !== undefined
            ? ` · ${FINISH_LABELS[finishTierForQuality(qualityPercent)]} Q${Math.round(qualityPercent)}`
            : ''}
        </div>
        <div className="text-[11px] text-text-muted">Pure cosmetic — zero stats</div>
      </div>
      {right}
    </div>
  );
};
