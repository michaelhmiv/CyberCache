import React from 'react';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import type { ShowcaseItemPayload } from '@/lib/api/verifiedOps';
import { showcaseRarityColor, showcaseWeaponInput } from '@/lib/pixel/showcaseWeaponInput';

/**
 * Showcase rows (0034 shelf; shared since 0058) — one shelved
 * weapon rendered as the real item instance through the shipped
 * compositor (real-item invariant: the payload IS the instance the
 * generators minted). The owner's Trophy Shelf, the public-profile
 * pop-up, and the full player profile all render the shelf through
 * this one row so a hunter's trophies read identically everywhere.
 */

export const ShowcaseWeaponRow: React.FC<{
  item: ShowcaseItemPayload;
  index: number;
  /** The owner pinned this one (0058) — the row says so in words. */
  pinned?: boolean;
  /** Owner controls (pin / unpin / reorder) ride at the row's end. */
  actions?: React.ReactNode;
  testId?: string;
}> = ({ item, index, pinned = false, actions, testId = 'showcase-weapon' }) => {
  const payload = item.payload ?? {};
  const name = typeof payload.name === 'string' && payload.name !== '' ? payload.name : 'Weapon';
  const rarity = item.rarity ?? (typeof payload.rarity === 'string' ? payload.rarity : 'Common');
  const level = item.item_level ?? (typeof payload.level === 'number' ? payload.level : 1);
  const color = showcaseRarityColor(rarity);
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-3 border-2 bg-bg px-2 py-1.5"
      style={{
        borderColor: `${color}90`,
        clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)',
      }}
    >
      <div className="flex h-9 w-6 shrink-0 items-center justify-center text-base font-black" style={{ color }}>
        {index + 1}
      </div>
      <div className="flex w-[104px] shrink-0 items-center justify-center">
        <PixelWeapon input={showcaseWeaponInput(item)} size={104} density="card" />
      </div>
      <div className="min-w-0 flex-1">
        {/* The trophy's name prints whole — a shelved legendary
            never ellipsizes (values-wrap law). */}
        <div className="break-words text-xs font-black leading-snug text-text-primary">{name}</div>
        <div className="break-words text-[11px] font-bold leading-snug" style={{ color }}>
          {rarity} · Lv {level}
          {item.equipped_slot === 'weapon' ? ' · Equipped' : ''}
        </div>
        {pinned && (
          <div className="mt-0.5 inline-block border border-amber/60 bg-amber/10 px-1.5 py-px text-[11px] font-black uppercase tracking-wide text-amber">
            Pinned
          </div>
        )}
      </div>
      {actions}
    </div>
  );
};
