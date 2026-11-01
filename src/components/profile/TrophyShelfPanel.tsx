import React, { useEffect, useState } from 'react';
import { MobileCard } from '@/components/layout/MobileCard';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import {
  fetchProfileLifetime,
  type ProfileLifetimePayload,
  type ShowcaseItemPayload,
} from '@/lib/api/verifiedOps';
import { COLLECTION_TOTAL } from '@/content/collections';
import { RARITIES } from '@/constants/rarities';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';

/**
 * Trophy Shelf (Profile showcase, 0034) — the player's brag surface.
 *
 * The shelf is the SERVER's top-3 weapons (rarity → level → newest)
 * from GET /api/profile/stats, rendered as the real item instances
 * through the shipped compositor (real-item invariant: the payload
 * IS the instance the generators minted — seed, parts, affixes and
 * roll quality all ride it). Alongside: best endless depth, Cache
 * Rank standing, and collection completion — all folded server-side
 * from server records; this panel computes nothing. There is no pin
 * choice in v1: the shelf is the server's top-N (see the slice PR).
 * Renders nothing until the Chef answers, so an unreachable Chef
 * simply omits the panel (the CacheRankPanel pattern).
 */

function weaponInput(item: ShowcaseItemPayload): PixelWeaponInput {
  const payload = item.payload ?? {};
  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value !== '' ? value : undefined;
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    id: item.id,
    name: str(payload.name),
    weaponType: (str(payload.weaponType) ?? WeaponType.Pistol) as WeaponType,
    manufacturer: (str(payload.manufacturer) ?? Manufacturer.HelixWorks) as Manufacturer,
    element: str(payload.element) as Element | undefined,
    rarity: (item.rarity ?? str(payload.rarity) ?? Rarity.Common) as Rarity,
    pixelSeed: num(payload.pixelSeed),
    rollQuality: num(payload.rollQuality),
    affixes: Array.isArray(payload.affixes) ? (payload.affixes as PixelWeaponInput['affixes']) : undefined,
    parts: Array.isArray(payload.parts) ? (payload.parts as PixelWeaponInput['parts']) : undefined,
  };
}

function rarityColor(rarity: string | null): string {
  return RARITIES[rarity as Rarity]?.color ?? '#A5A7B5';
}

const FactChip: React.FC<{ label: string; value: string; tone: string }> = ({ label, value, tone }) => (
  <div className="bl-card flex-1 px-2 py-2 text-center" style={{ borderTopColor: tone, borderTopWidth: 3 }}>
    <div className="truncate text-sm font-black text-text-primary">{value}</div>
    <div className="truncate text-[9px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
  </div>
);

export const TrophyShelfPanel: React.FC = () => {
  const [data, setData] = useState<ProfileLifetimePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProfileLifetime()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        // Chef unreachable: the shelf stays hidden (Profile renders
        // the rest from its own services).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;
  const { showcase } = data;
  const weapons = showcase.top_weapons;

  return (
    <div data-testid="trophy-shelf">
    <MobileCard className="space-y-3" rarityColor="#FFD166">
      <div className="flex items-center gap-2">
        <span className="font-black text-amber" style={{ fontSize: '16px' }}>🏆</span>
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Trophy Shelf</div>
        <div className="ml-auto text-[10px] text-text-muted">Best gear, server-ranked</div>
      </div>

      {weapons.length === 0 ? (
        <div className="text-[11px] text-text-muted">
          No trophies yet — the first weapon worth shelving is still out there.
        </div>
      ) : (
        <div className="space-y-2">
          {weapons.map((item, index) => {
            const payload = item.payload ?? {};
            const name = typeof payload.name === 'string' && payload.name !== '' ? payload.name : 'Weapon';
            const rarity = item.rarity ?? (typeof payload.rarity === 'string' ? payload.rarity : 'Common');
            const level = item.item_level ?? (typeof payload.level === 'number' ? payload.level : 1);
            const color = rarityColor(rarity);
            return (
              <div
                key={item.id}
                data-testid="trophy-weapon"
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
                  <PixelWeapon input={weaponInput(item)} size={104} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-black text-text-primary">{name}</div>
                  <div className="truncate text-[10px] font-bold" style={{ color }}>
                    {rarity} · Lv {level}
                    {item.equipped_slot === 'weapon' ? ' · Equipped' : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        <FactChip label="Best Depth" value={String(showcase.best_endless_depth)} tone="#FF4B5C" />
        <FactChip
          label="Cache Rank"
          value={`${showcase.cache_rank_total_ranks} ranks · ${showcase.cache_rank_tokens} tokens`}
          tone="#F2C063"
        />
        <FactChip
          label="Collections"
          value={`${showcase.collections_discovered} / ${COLLECTION_TOTAL}`}
          tone="#FF9800"
        />
      </div>
    </MobileCard>
    </div>
  );
};
