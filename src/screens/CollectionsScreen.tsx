import React, { useEffect, useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { usePlayerStore } from '@/store';
import { fetchCollections, type CollectionsPayload } from '@/lib/api/verifiedOps';
import { ResourceIcon } from '@/components/common/ResourceIcon';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { getPixelSprite } from '@/lib/pixel/manifest';
import {
  COLLECTION_FAMILIES,
  COLLECTION_TOTAL,
  collectionEntriesForFamily,
  type CollectionEntry,
  type CollectionFamily,
} from '@/content/collections';
import { AREA_VISUALS, type RoamingAreaId } from '@/content/areaPalettes';
import { Manufacturer, Rarity, WeaponType } from '@/types/game';

/**
 * Collections — the trophy shelf (migration 0026).
 *
 * The log of what this hunter has actually found and done: legendary
 * effects, bosses downed, legendary weapon frames, and the named
 * elites of every area. Every entry shown as FOUND was proven by a
 * server-side record (collection_discoveries, written by the Chef at
 * the moment the fact settled) — this screen is a pure consumer of
 * GET /api/collections/me plus the content catalog. Missing entries
 * read as silhouettes with their source hint: intel, never odds.
 *
 * Legendary cores (salvaged from Legendary gear) headline the shelf:
 * they are the sink-loop currency for core-catalyzed crafting today
 * and high-end rerolls next.
 */

const FAMILY_LABELS: Record<CollectionFamily, string> = {
  legendary_effect: 'Legendary Effects',
  boss: 'Bosses Downed',
  weapon_frame: 'Legendary Frames',
  named_elite: 'Named Elites',
};

const FAMILY_BLURBS: Record<CollectionFamily, string> = {
  legendary_effect: 'Effects rolled on legendary weapons you have held.',
  boss: 'Every boss in the wastes, beaten at least once.',
  weapon_frame: 'A Legendary of this frame has passed through your hands.',
  named_elite: 'The named elite of each roaming area, brought down.',
};

function seedFromKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function spriteIdFor(entry: CollectionEntry): string | undefined {
  if (entry.family === 'boss') return `boss-${entry.key.replace(/_/g, '-')}`;
  if (entry.family === 'legendary_effect') return `legendary-${entry.key.replace(/_/g, '-')}`;
  if (entry.family === 'named_elite') {
    return AREA_VISUALS[entry.key as RoamingAreaId]?.eliteSpriteId ?? 'enemy-elite';
  }
  return undefined;
}

const EntryArt: React.FC<{ entry: CollectionEntry; found: boolean }> = ({ entry, found }) => {
  const silhouette = !found ? { filter: 'brightness(0) contrast(1.2)', opacity: 0.5 } : undefined;
  if (entry.family === 'weapon_frame') {
    const [weaponType, manufacturer] = entry.key.split(':') as [WeaponType, Manufacturer];
    return (
      <div style={silhouette} className="flex h-full w-full items-center justify-center">
        <PixelWeapon
          input={{
            weaponType,
            manufacturer,
            rarity: Rarity.Legendary,
            pixelSeed: seedFromKey(entry.key),
            rollQuality: 88,
            id: `collection-${entry.key}`,
          }}
          size={104}
        />
      </div>
    );
  }
  const spriteId = spriteIdFor(entry);
  const sprite = spriteId ? getPixelSprite(spriteId) : undefined;
  if (!sprite) {
    return (
      <div className="flex h-full w-full items-center justify-center text-text-muted" style={silhouette}>
        <PxIcon name="star" size={26} />
      </div>
    );
  }
  return (
    <img
      src={sprite.url}
      alt={found ? entry.name : 'Undiscovered entry'}
      draggable={false}
      className="max-h-full max-w-full object-contain"
      style={{ imageRendering: 'pixelated', ...(silhouette ?? {}) }}
    />
  );
};

const EntryCard: React.FC<{ entry: CollectionEntry; found: boolean; source?: string }> = ({ entry, found, source }) => (
  <div
    className={`border-2 p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] ${
      found ? 'border-amber/80 bg-surface' : 'border-border bg-bg'
    }`}
    style={{ clipPath: 'polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%)' }}
    data-testid={`collection-entry-${entry.family}-${entry.key}`}
    data-found={found}
  >
    <div
      className={`flex h-20 items-center justify-center overflow-hidden ${
        found
          ? 'bg-[radial-gradient(ellipse_at_center,rgba(255,152,0,0.22),rgba(0,0,0,0.55)_75%)]'
          : 'bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.05),rgba(0,0,0,0.6)_75%)]'
      }`}
    >
      <EntryArt entry={entry} found={found} />
    </div>
    <div className={`mt-2 truncate text-[11px] font-black leading-tight ${found ? 'text-text-primary' : 'text-text-muted'}`}>
      {entry.name}
    </div>
    <div className="mt-0.5 line-clamp-2 min-h-[22px] text-[9px] leading-snug text-text-muted">
      {found ? `Logged · ${source ?? 'server record'}` : entry.hint}
    </div>
  </div>
);

export const CollectionsScreen: React.FC = () => {
  const playerCores = usePlayerStore((s) => s.legendaryCores);
  const [payload, setPayload] = useState<CollectionsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCollections()
      .then((data) => {
        if (!cancelled) {
          setPayload(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load collections');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const discovered = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of payload?.discoveries ?? []) map.set(`${d.family}:${d.entry_key}`, d.source);
    return map;
  }, [payload]);

  const foundTotal = discovered.size;
  const cores = payload?.legendary_cores ?? playerCores;

  return (
    <div className="bl-page space-y-4 p-4 pb-20">
      <div className="flex items-center justify-between">
        <div className="bl-title text-3xl leading-none text-text-primary">Collections</div>
        <div className="flex items-center gap-2 border-2 border-border bg-surface-raised px-2.5 py-1">
          <ResourceIcon id="legendaryCore" size={18} seed={6} />
          <span className="text-sm font-black text-text-primary">{cores}</span>
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-text-muted">cores</span>
        </div>
      </div>
      <div className="text-xs text-text-muted">
        The trophy shelf: every entry here was proven by a server record — a drop stored, a boss downed, an elite
        felled. Salvage Legendary gear to mint legendary cores; spend them on core-catalyzed frames at the Forge.
      </div>

      <div className="border-2 border-border bg-surface p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Shelf progress</span>
          <span className="text-sm font-black text-text-primary">
            {foundTotal}<span className="text-text-muted"> / {COLLECTION_TOTAL}</span>
          </span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden bg-bg">
          <div
            className="h-full bg-amber transition-all"
            style={{ width: `${COLLECTION_TOTAL ? (foundTotal / COLLECTION_TOTAL) * 100 : 0}%` }}
          />
        </div>
        {error && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-red">
            <span>{error}</span>
            <button
              type="button"
              className="bl-secondary px-2 py-1 text-[10px] font-black"
              onClick={() => { setError(null); setReloadKey((k) => k + 1); }}
            >
              Retry
            </button>
          </div>
        )}
        {!payload && !error && <div className="mt-2 text-[11px] text-text-muted">Reading the shelf…</div>}
      </div>

      {COLLECTION_FAMILIES.map((family) => {
        const entries = collectionEntriesForFamily(family);
        const found = entries.filter((e) => discovered.has(`${family}:${e.key}`)).length;
        return (
          <section key={family} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="bl-title text-xl leading-none text-text-primary">{FAMILY_LABELS[family]}</span>
                <span className="ml-2 text-[10px] text-text-muted">{FAMILY_BLURBS[family]}</span>
              </div>
              <span className="text-xs font-black text-text-secondary">
                {found}<span className="text-text-muted"> / {entries.length}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {entries.map((entry) => {
                const source = discovered.get(`${family}:${entry.key}`);
                return (
                  <EntryCard
                    key={entry.key}
                    entry={entry}
                    found={source !== undefined}
                    source={source}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
