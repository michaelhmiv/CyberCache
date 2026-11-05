import React, { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { PixelWalletIcon } from '@/components/pixelArt/PixelWalletIcon';
import { bespokeSpriteIdForLegendaryEffect, getPixelSprite } from '@/lib/pixel/manifest';
import { AREA_VISUALS, bossArena, type RoamingAreaId } from '@/content/areaPalettes';
import {
  COLLECTION_TOTAL,
  collectionEntriesForFamily,
  type CollectionEntry,
  type CollectionFamily,
} from '@/content/collections';
import type { CollectionsPayload } from '@/lib/api/verifiedOps';
import { WEAPON_TYPES } from '@/constants/weaponTypes';
import { Manufacturer, Rarity, WeaponType } from '@/types/game';

/**
 * CollectionsGallery — DESIGN PASS prototype (Variant C, "Showcase").
 *
 * The gallery register: the game's pixel art is the hero and the
 * interface recedes. Bosses hang as full-bleed arena canvases with
 * the boss standing on its own painting; elites hang on their home
 * area's zone painting; effects and frames hang in dark wells with
 * nothing around them but air and a caption. There are no cards, no
 * gauges, no dashboards — completion reads through the art itself:
 * a lit piece is in full color on a warm glow, an unlogged piece is
 * a dark silhouette on a drained painting. Tapping a piece opens
 * the viewing room (GalleryDetail): the art at full size, the
 * catalog hint as its exhibit caption, and the server record as its
 * provenance.
 *
 * Truth rules are the shipped page's (QC A11): found state comes
 * only from the GET /api/collections/me payload's discovery
 * records; undiscovered entries print neither name nor hint —
 * silhouettes and the family teaser only — on the wall and in the
 * viewing room alike.
 */

export interface DiscoveryInfo {
  source: string;
  discoveredAt?: string;
}

export type DiscoveryMap = Map<string, DiscoveryInfo>;

export const GALLERY_FAMILY_LABELS: Record<CollectionFamily, string> = {
  legendary_effect: 'Legendary Effects',
  boss: 'Bosses Downed',
  weapon_frame: 'Legendary Frames',
  named_elite: 'Named Elites',
};

/** What an UNLOGGED entry may say about itself: how its family is
 *  earned, never which entry it is. (Verbatim from the shipped
 *  screen — the A11 tests pin the boss line.) */
export const GALLERY_UNDISCOVERED_TEASERS: Record<CollectionFamily, string> = {
  legendary_effect: 'An unlogged legendary effect — own a weapon carrying it to log this entry.',
  boss: 'An undefeated boss — beat it to log this entry.',
  weapon_frame: 'An unlogged Legendary frame — own one to log this entry.',
  named_elite: 'An undowned named elite — fell it in its roaming area to log this entry.',
};

const ZONE_PAINTINGS: Record<string, string> = {
  dustwaste_frontier: 'zone-dustwaste-bg',
  redline_circuit: 'zone-redline-bg',
  ironwood_bastion: 'zone-ironwood-bg',
  blastforge_yards: 'zone-blastforge-bg',
  prismatek_reactor: 'zone-prismatek-bg',
  throwtech_dumpnet: 'zone-throwtech-bg',
  helixworks_labyrinth: 'zone-helixworks-bg',
};

function seedFromKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function gallerySpriteIdFor(entry: CollectionEntry): string | undefined {
  if (entry.family === 'boss') return `boss-${entry.key.replace(/_/g, '-')}`;
  if (entry.family === 'legendary_effect') return bespokeSpriteIdForLegendaryEffect(entry.key);
  if (entry.family === 'named_elite') {
    return AREA_VISUALS[entry.key as RoamingAreaId]?.eliteSpriteId ?? 'enemy-elite';
  }
  return undefined;
}

const SILHOUETTE: React.CSSProperties = { filter: 'brightness(0) contrast(1.2)', opacity: 0.45 };
const DRAINED: React.CSSProperties = { filter: 'grayscale(0.92) brightness(0.5) contrast(1.05)' };

/** The piece's art alone — sprite or composed weapon — lit or
 *  silhouetted. Used on the wall and, larger, in the viewing room. */
export const PieceArt: React.FC<{ entry: CollectionEntry; found: boolean; weaponSize?: number; className?: string }> = ({
  entry,
  found,
  weaponSize = 150,
  className = 'max-h-full max-w-full object-contain',
}) => {
  if (entry.family === 'weapon_frame') {
    const [weaponType, manufacturer] = entry.key.split(':') as [WeaponType, Manufacturer];
    return (
      <div style={found ? undefined : SILHOUETTE} className="flex items-center justify-center">
        <PixelWeapon
          input={{
            weaponType,
            manufacturer,
            rarity: Rarity.Legendary,
            pixelSeed: seedFromKey(entry.key),
            rollQuality: 88,
            id: `collection-${entry.key}`,
          }}
          size={weaponSize}
          density="card"
        />
      </div>
    );
  }
  const spriteId = gallerySpriteIdFor(entry);
  const sprite = spriteId ? getPixelSprite(spriteId) : undefined;
  if (!sprite) {
    return (
      <div className="flex items-center justify-center text-text-muted" style={found ? undefined : SILHOUETTE}>
        <PxIcon name="star" size={40} />
      </div>
    );
  }
  return (
    <img
      src={sprite.url}
      alt={found ? entry.name : 'Undiscovered entry'}
      draggable={false}
      className={className}
      style={{ imageRendering: 'pixelated', ...(found ? {} : SILHOUETTE) }}
    />
  );
};

/** The caption under a hung piece: name + provenance when logged;
 *  the mask when not. Shared by every hang so the truth reads the
 *  same way in every room. */
const PieceCaption: React.FC<{ entry: CollectionEntry; info?: DiscoveryInfo; align?: 'left' | 'center' }> = ({
  entry,
  info,
  align = 'left',
}) => {
  const found = info !== undefined;
  return (
    <div className={align === 'center' ? 'text-center' : 'text-left'}>
      <div className={`text-sm font-black leading-tight ${found ? 'text-text-primary' : 'text-text-muted'}`}>
        {found ? entry.name : 'Undiscovered'}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-text-muted">
        {found ? `Logged · ${info.source}` : GALLERY_UNDISCOVERED_TEASERS[entry.family]}
      </div>
    </div>
  );
};

const pieceButtonProps = (
  entry: CollectionEntry,
  found: boolean,
  onOpen: (entry: CollectionEntry) => void,
) => ({
  type: 'button' as const,
  onClick: () => onOpen(entry),
  'data-testid': `collection-entry-${entry.family}-${entry.key}`,
  'data-found': found,
  'aria-label': found ? entry.name : 'Undiscovered entry',
});

/* ─── The hangs — one per family, each composed for its art ────── */

/** Bosses: full-bleed arena canvases. The painting runs to the
 *  device's edge; the boss stands on its own ground; the caption
 *  sits in the quiet below the canvas, not on it. */
const BossHang: React.FC<{ entries: CollectionEntry[]; discovered: DiscoveryMap; onOpen: (e: CollectionEntry) => void }> = ({
  entries,
  discovered,
  onOpen,
}) => (
  <div className="space-y-8">
    {entries.map((entry) => {
      const info = discovered.get(`boss:${entry.key}`);
      const found = info !== undefined;
      const painting = getPixelSprite(bossArena(entry.key).backgroundId);
      return (
        <button key={entry.key} {...pieceButtonProps(entry, found, onOpen)} className="block w-full text-left">
          <div className="relative -mx-4 h-[188px] overflow-hidden bg-[#0d0906]">
            {painting && (
              <img
                src={painting.url}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ imageRendering: 'pixelated', ...(found ? {} : DRAINED) }}
              />
            )}
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 to-transparent" />
            <div className="absolute bottom-0 right-3 flex h-[172px] items-end">
              <PieceArt entry={entry} found={found} className="max-h-[172px] max-w-[290px] object-contain" />
            </div>
          </div>
          <div className="pt-2.5">
            <PieceCaption entry={entry} info={info} />
          </div>
        </button>
      );
    })}
  </div>
);

/** Named elites: their home area's painting as a band, the elite
 *  standing at its left — each piece is a place, not a portrait. */
const EliteHang: React.FC<{ entries: CollectionEntry[]; discovered: DiscoveryMap; onOpen: (e: CollectionEntry) => void }> = ({
  entries,
  discovered,
  onOpen,
}) => (
  <div className="space-y-8">
    {entries.map((entry) => {
      const info = discovered.get(`named_elite:${entry.key}`);
      const found = info !== undefined;
      const painting = getPixelSprite(ZONE_PAINTINGS[entry.key] ?? 'zone-dustwaste-bg');
      return (
        <button key={entry.key} {...pieceButtonProps(entry, found, onOpen)} className="block w-full text-left">
          <div className="relative -mx-4 h-[168px] overflow-hidden bg-[#0d0906]">
            {painting && (
              <img
                src={painting.url}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ imageRendering: 'pixelated', ...(found ? {} : DRAINED) }}
              />
            )}
            <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/55 to-transparent" />
            <div className="absolute bottom-0 left-4 flex h-[150px] items-end">
              <PieceArt entry={entry} found={found} className="max-h-[150px] max-w-[190px] object-contain" />
            </div>
          </div>
          <div className="pt-2.5">
            <PieceCaption entry={entry} info={info} />
          </div>
        </button>
      );
    })}
  </div>
);

/** Legendary effects: dark wells, generous air, the bespoke sprite
 *  floating on a warm glow when lit and a black shape when not.
 *  Two columns — the sprites are wide, the wall stays quiet. */
const EffectHang: React.FC<{ entries: CollectionEntry[]; discovered: DiscoveryMap; onOpen: (e: CollectionEntry) => void }> = ({
  entries,
  discovered,
  onOpen,
}) => (
  <div className="grid grid-cols-2 gap-x-5 gap-y-9">
    {entries.map((entry) => {
      const info = discovered.get(`legendary_effect:${entry.key}`);
      const found = info !== undefined;
      return (
        <button key={entry.key} {...pieceButtonProps(entry, found, onOpen)} className="block text-left">
          <div
            className="flex h-[104px] items-center justify-center overflow-hidden"
            style={{
              background: found
                ? 'radial-gradient(ellipse at center, rgba(255,160,31,0.20), rgba(13,9,6,0) 72%)'
                : 'radial-gradient(ellipse at center, rgba(255,255,255,0.04), rgba(13,9,6,0) 72%)',
            }}
          >
            <PieceArt entry={entry} found={found} className="max-h-[92px] max-w-full object-contain" />
          </div>
          <div className="pt-2">
            <PieceCaption entry={entry} info={info} />
          </div>
        </button>
      );
    })}
  </div>
);

/** Legendary frames: the long wall — one weapon per stretch,
 *  grouped under its type, rendered at card density so the
 *  silhouette and colorway carry the whole read. */
const FrameHang: React.FC<{ entries: CollectionEntry[]; discovered: DiscoveryMap; onOpen: (e: CollectionEntry) => void }> = ({
  entries,
  discovered,
  onOpen,
}) => {
  const groups = new Map<string, CollectionEntry[]>();
  for (const entry of entries) {
    const type = entry.key.split(':')[0];
    groups.set(type, [...(groups.get(type) ?? []), entry]);
  }
  return (
    <div className="space-y-9">
      {[...groups.entries()].map(([type, group]) => (
        <div key={type} className="space-y-6">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-text-muted">
            {WEAPON_TYPES[type as WeaponType]?.name ?? type}
          </div>
          {group.map((entry) => {
            const info = discovered.get(`weapon_frame:${entry.key}`);
            const found = info !== undefined;
            return (
              <button key={entry.key} {...pieceButtonProps(entry, found, onOpen)} className="block w-full text-left">
                <div
                  className="flex h-[92px] items-center justify-center overflow-hidden"
                  style={{
                    background: found
                      ? 'radial-gradient(ellipse at center, rgba(255,160,31,0.16), rgba(13,9,6,0) 75%)'
                      : 'radial-gradient(ellipse at center, rgba(255,255,255,0.03), rgba(13,9,6,0) 75%)',
                  }}
                >
                  <PieceArt entry={entry} found={found} weaponSize={168} />
                </div>
                <div className="pt-2">
                  <PieceCaption entry={entry} info={info} />
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export const FamilyHang: React.FC<{
  family: CollectionFamily;
  entries: CollectionEntry[];
  discovered: DiscoveryMap;
  onOpen: (e: CollectionEntry) => void;
}> = ({ family, entries, discovered, onOpen }) => {
  switch (family) {
    case 'boss':
      return <BossHang entries={entries} discovered={discovered} onOpen={onOpen} />;
    case 'named_elite':
      return <EliteHang entries={entries} discovered={discovered} onOpen={onOpen} />;
    case 'legendary_effect':
      return <EffectHang entries={entries} discovered={discovered} onOpen={onOpen} />;
    case 'weapon_frame':
      return <FrameHang entries={entries} discovered={discovered} onOpen={onOpen} />;
  }
};

/* ─── The viewing room ─────────────────────────────────────────── */

function formatLoggedDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Detail: the piece alone in a dark room. Paintings run full-bleed
 *  at the top with the subject standing on them; the name is the
 *  biggest type on the page; the catalog hint is the exhibit
 *  caption; the server record is the provenance line. Undiscovered
 *  pieces open fully masked — silhouette, drained painting, no
 *  name, no hint. */
export const GalleryDetail: React.FC<{
  entry: CollectionEntry;
  info?: DiscoveryInfo;
  onClose: () => void;
}> = ({ entry, info, onClose }) => {
  const reduceMotion = useReducedMotion();
  const found = info !== undefined;
  const paintingId =
    entry.family === 'boss'
      ? bossArena(entry.key).backgroundId
      : entry.family === 'named_elite'
        ? (ZONE_PAINTINGS[entry.key] ?? 'zone-dustwaste-bg')
        : undefined;
  const painting = paintingId ? getPixelSprite(paintingId) : undefined;
  const loggedDate = formatLoggedDate(info?.discoveredAt);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="fixed inset-0 z-50 overflow-y-auto bg-[#0d0906]"
      role="dialog"
      aria-modal="true"
      aria-label={found ? entry.name : 'Undiscovered entry'}
      data-testid="collections-gallery-detail"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center border border-white/25 bg-black/55 text-text-primary"
      >
        <X size={20} />
      </button>

      {painting ? (
        <div className="relative h-[300px] overflow-hidden">
          <img
            src={painting.url}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ imageRendering: 'pixelated', ...(found ? {} : DRAINED) }}
          />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0d0906] to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-center">
            <PieceArt entry={entry} found={found} className="max-h-[248px] max-w-[86%] object-contain" />
          </div>
        </div>
      ) : (
        <div
          className="flex h-[300px] items-center justify-center"
          style={{
            background: found
              ? 'radial-gradient(ellipse at center, rgba(255,160,31,0.22), rgba(13,9,6,0) 70%)'
              : 'radial-gradient(ellipse at center, rgba(255,255,255,0.04), rgba(13,9,6,0) 70%)',
          }}
        >
          <PieceArt
            entry={entry}
            found={found}
            weaponSize={300}
            className="max-h-[190px] max-w-[86%] object-contain"
          />
        </div>
      )}

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: 'easeOut', delay: reduceMotion ? 0 : 0.08 }}
        className="px-5 pb-16 pt-5"
      >
        <div className="bl-title text-3xl leading-tight text-text-primary">
          {found ? entry.name : 'Undiscovered'}
        </div>
        {found ? (
          <>
            <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-text-secondary">{entry.hint}</p>
            <div className="mt-6 text-[11px] font-black uppercase tracking-[0.22em] text-text-muted">
              Proven by server record
            </div>
            <div className="mt-1.5 text-sm font-bold text-text-primary">Logged · {info.source}</div>
            {loggedDate && <div className="mt-0.5 text-[11px] text-text-muted">{loggedDate}</div>}
          </>
        ) : (
          <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-text-secondary">
            {GALLERY_UNDISCOVERED_TEASERS[entry.family]}
          </p>
        )}
        <div className="mt-8 text-[11px] uppercase tracking-[0.18em] text-text-muted">
          {GALLERY_FAMILY_LABELS[entry.family]}
        </div>
      </motion.div>
    </motion.div>
  );
};

/* ─── The gallery page ─────────────────────────────────────────── */

/** Room order: the paintings lead. Bosses and elites hang on their
 *  full-bleed canvases first — the biggest art in the game — then
 *  the quiet wells of effects, then the long frame wall. */
const ROOM_ORDER: CollectionFamily[] = ['boss', 'named_elite', 'legendary_effect', 'weapon_frame'];

const ROOM_NOTES: Record<CollectionFamily, string> = {
  boss: 'Every boss in the wastes, beaten at least once.',
  named_elite: 'The named elite of each roaming area, brought down.',
  legendary_effect: 'Effects rolled on legendary weapons you have held.',
  weapon_frame: 'A Legendary of this frame has passed through your hands.',
};

export function discoveryMapFromPayload(payload: CollectionsPayload): DiscoveryMap {
  const map: DiscoveryMap = new Map();
  for (const d of payload.discoveries ?? []) {
    map.set(`${d.family}:${d.entry_key}`, { source: d.source, discoveredAt: d.discovered_at });
  }
  return map;
}

/** The Showcase page: a quiet masthead, the completion told as one
 *  sentence (no gauge — the lit and dark pieces ARE the progress),
 *  then the four rooms. Tapping any piece opens the viewing room. */
export const CollectionsShowcase: React.FC<{ payload: CollectionsPayload }> = ({ payload }) => {
  const discovered = useMemo(() => discoveryMapFromPayload(payload), [payload]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const openEntry = useMemo(() => {
    if (!openKey) return null;
    for (const family of ROOM_ORDER) {
      const hit = collectionEntriesForFamily(family).find((e) => `${family}:${e.key}` === openKey);
      if (hit) return hit;
    }
    return null;
  }, [openKey]);

  return (
    <div className="px-4 pb-20 pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="bl-title text-3xl leading-none text-text-primary">Collections</div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <PixelWalletIcon id="legendaryCore" size={17} />
          <span className="text-sm font-black text-text-primary">{payload.legendary_cores}</span>
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">cores</span>
        </div>
      </div>
      <p className="mt-3 max-w-[52ch] text-[13px] leading-relaxed text-text-secondary">
        {discovered.size} of {COLLECTION_TOTAL} pieces hang lit. The rest are still out there — a dark
        painting is a boss unbeaten, a black shape is a name you have not earned yet. Every lit piece was
        proven by a server record; tap one to read it.
      </p>

      {ROOM_ORDER.map((family) => {
        const entries = collectionEntriesForFamily(family);
        const lit = entries.filter((e) => discovered.has(`${family}:${e.key}`)).length;
        return (
          <section key={family} className="mt-14">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-base font-black uppercase tracking-wide text-text-primary">
                {GALLERY_FAMILY_LABELS[family]}
              </div>
              <div className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
                {lit} of {entries.length} lit
              </div>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-text-muted">{ROOM_NOTES[family]}</p>
            <div className="mt-5">
              <FamilyHang
                family={family}
                entries={entries}
                discovered={discovered}
                onOpen={(e) => setOpenKey(`${e.family}:${e.key}`)}
              />
            </div>
          </section>
        );
      })}

      {openEntry && (
        <GalleryDetail
          entry={openEntry}
          info={discovered.get(`${openEntry.family}:${openEntry.key}`)}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
};
