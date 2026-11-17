/**
 * HunterPortrait (skins slice, 0053; portraits conversion, device-
 * pass Batch 3 / migration 0100) — a hunter rendered as a still
 * portrait on the public surfaces: Standings rows, the profile
 * sheet and panel, market rows.
 *
 * The portrait IS the hunter's painting — the same whole Cast B
 * painting the stage and the Hunter tab show (owner rulings
 * 2026-11-15 + 2026-11-17: paintings only, no equipped weapon in
 * hand anywhere). Which hunter is read from the look record's
 * hunter identity (migration 0100's `activeHunterId`, resolved
 * server-side); a record without one — pre-0100 data — falls back
 * to the default hunter's painting. The segmented parts figure
 * this component used to assemble does not render here anymore:
 * parts survive as collection pieces, never as a portrait.
 *
 * Presentation (Impeccable pass): the painting stands whole in
 * the caller's box, feet on the box's ground line, aspect-true at
 * the box's height — the Roster plate / SkinThumb grammar, no
 * crop, no distortion, no frame of its own (the surface owns the
 * frame). Pure render: the look comes from the server record;
 * this component owns no state.
 */
import React from 'react';
import { getPixelSprite, pixelHunterSpriteForHunter } from '@/lib/pixel/manifest';
import { DEFAULT_HUNTER_ID, isHunterId, type HunterId } from '@/lib/hunters/hunters';
import type { HunterLookView } from '@/content/skins';

/** The hunter a public portrait paints: the record's fielded
 *  hunter when it carries a valid one, else the default hunter. */
// eslint-disable-next-line react-refresh/only-export-components -- the fallback derivation is shared with its regression tests (hunterPortraitsBatch3.test.tsx); the portrait component stays the file's export surface
export function portraitHunterId(look: HunterLookView): HunterId {
  return isHunterId(look.activeHunterId) ? look.activeHunterId : DEFAULT_HUNTER_ID;
}

export const HunterPortrait: React.FC<{
  look: HunterLookView;
  className?: string;
  testId?: string;
}> = ({ look, className = 'h-28', testId }) => {
  const hunterId = portraitHunterId(look);
  const spriteId = pixelHunterSpriteForHunter(hunterId);
  const sprite = spriteId ? getPixelSprite(spriteId) : undefined;
  return (
    <div
      className={`relative flex items-end justify-center overflow-hidden ${className}`}
      data-testid={testId}
      data-hunter-id={hunterId}
      data-portrait-sprite={spriteId}
    >
      {sprite && (
        <img
          src={sprite.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="h-full w-auto max-w-none select-none"
          style={{ imageRendering: 'pixelated' }}
        />
      )}
    </div>
  );
};
