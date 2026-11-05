import React, { useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { listEntranceProps } from '@/lib/animation/uiMotion';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelWalletIcon } from '@/components/pixelArt/PixelWalletIcon';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { bespokeSpriteIdForLegendaryEffect, getPixelSprite } from '@/lib/pixel/manifest';
import { bossArt } from '@/lib/pixel/bossIdentity';
import type { CollectionsPayload } from '@/lib/api/verifiedOps';
import {
  COLLECTION_FAMILIES,
  COLLECTION_TOTAL,
  collectionEntriesForFamily,
  type CollectionEntry,
  type CollectionFamily,
} from '@/content/collections';
import { AREA_VISUALS, type RoamingAreaId } from '@/content/areaPalettes';
import { WEAPON_TYPES } from '@/constants/weaponTypes';
import { MANUFACTURERS } from '@/constants/manufacturers';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { Manufacturer, Rarity, WeaponType } from '@/types/game';

/**
 * CollectionsWall — the collector's wall (DESIGN PASS prototype,
 * branch design/hunter-subpages-collections; the Arena Plates family
 * applied to the trophy shelf).
 *
 * The shipped shelf was one uniform 2-col card grid for all four
 * families — the same card the rest of the app uses, so the game's
 * record of everything you have ever found read like a settings
 * list. This composition gives the page its own furniture inside
 * the plate family the Hunter menu picked (pass 2, look A):
 *
 *  - a HERO PLATE over a dimmed arena painting carrying the shelf
 *    gauge — found/total as a machined numeral pair, completion as
 *    a segmented bar whose four segments are the families (each
 *    fills with its own family's found fraction), cores in a
 *    gauge well;
 *  - a FAMILY RAIL of plate stops (found/total gauges) that scrolls
 *    to each bay — navigation, not a filter;
 *  - four BAYS, each mounted the way its contents are actually
 *    handled: legendary effects as a wall of lit medallions,
 *    bosses as wide plates with a DOWNED / AT LARGE stamp,
 *    legendary frames as a maker's rack (weapon types as rack
 *    rows, manufacturers as tiles), named elites as bounty plates;
 *  - a DETAIL PLATE sheet: tap any mount and the trophy comes off
 *    the wall — big art well, the catalog hint (intel: tier,
 *    dedicated drops, where a frame comes from), and the server
 *    record that proved it (source + date).
 *
 * Truth rules are the shipped screen's, unchanged: an entry reads
 * FOUND only from a server discovery record; undiscovered entries
 * keep their names hidden (silhouette + family teaser only, QC
 * A11) — the detail sheet honors the same masking. Art derives
 * from the real catalog definitions through the shipped
 * compositors/sprites — no drawn substitutes.
 */

const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
const BONE_FAINT = '#968A78';
const STEEL = '#6B6257';
const AMBER = '#FF9000';
const PLATE_FONT = '"Chakra Petch", sans-serif';

const PLATE_CLIP =
  'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)';

const plateShell: React.CSSProperties = {
  clipPath: PLATE_CLIP,
  border: '2px solid #000',
  background: 'linear-gradient(158deg, #1D1811 0%, #12100C 58%, #0C0A08 100%)',
  boxShadow: '5px 5px 0 rgba(0,0,0,0.75), inset 0 0 0 1px rgba(163,152,134,0.28)',
};

const wellStyle: React.CSSProperties = {
  backgroundColor: 'rgba(6,5,4,0.82)',
  border: '2px solid #000',
  boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.22), inset 0 2px 6px rgba(0,0,0,0.8)',
};

/** Machined corner bolts — 5px squares, black with a steel top edge. */
const Bolts: React.FC = () => (
  <>
    {['left-[7px] top-[7px]', 'right-[7px] top-[7px]', 'bottom-[7px] left-[7px]', 'bottom-[7px] right-[7px]'].map(
      (pos) => (
        <span
          key={pos}
          aria-hidden="true"
          className={`absolute ${pos} h-[5px] w-[5px]`}
          style={{ backgroundColor: '#060504', boxShadow: 'inset 0 1px 0 rgba(201,187,166,0.5)' }}
        />
      ),
    )}
  </>
);

const FootStrip: React.FC<{ color: string; height?: number }> = ({ color, height = 4 }) => (
  <div aria-hidden="true" className="absolute inset-x-0 bottom-0" style={{ height, backgroundColor: color }} />
);

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

const UNDISCOVERED_TEASERS: Record<CollectionFamily, string> = {
  legendary_effect: 'An unlogged legendary effect — own a weapon carrying it to log this entry.',
  boss: 'An undefeated boss — beat it to log this entry.',
  weapon_frame: 'An unlogged Legendary frame — own one to log this entry.',
  named_elite: 'An undowned named elite — fell it in its roaming area to log this entry.',
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
  if (entry.family === 'legendary_effect') return bespokeSpriteIdForLegendaryEffect(entry.key);
  if (entry.family === 'named_elite') {
    return AREA_VISUALS[entry.key as RoamingAreaId]?.eliteSpriteId ?? 'enemy-elite';
  }
  return undefined;
}

const EntryArt: React.FC<{ entry: CollectionEntry; found: boolean; weaponSize?: number }> = ({
  entry,
  found,
  weaponSize = 104,
}) => {
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
          size={weaponSize}
          density="card"
        />
      </div>
    );
  }
  const spriteId = spriteIdFor(entry);
  const sprite = spriteId ? getPixelSprite(spriteId) : undefined;
  if (!sprite) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ color: BONE_FAINT, ...silhouette }}>
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

interface DiscoveryInfo {
  source: string;
  discoveredAt: string;
}

interface SelectedEntry {
  entry: CollectionEntry;
  found: boolean;
  info?: DiscoveryInfo;
}

const artWell = (found: boolean): React.CSSProperties => ({
  background: found
    ? 'radial-gradient(ellipse at center, rgba(255,152,0,0.22), rgba(0,0,0,0.55) 75%)'
    : 'radial-gradient(ellipse at center, rgba(255,255,255,0.05), rgba(0,0,0,0.6) 75%)',
  boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.18), inset 0 2px 8px rgba(0,0,0,0.7)',
});

/** Effects bay mount — a medallion: square art well, name riveted
 *  under it, the log state as the foot strip's light. */
const Medallion: React.FC<{
  entry: CollectionEntry;
  found: boolean;
  index: number;
  onSelect: (s: SelectedEntry) => void;
  info?: DiscoveryInfo;
}> = ({ entry, found, index, onSelect, info }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      {...listEntranceProps(index, reduceMotion)}
      onClick={() => onSelect({ entry, found, info })}
      className="relative overflow-hidden p-2 pb-3 text-left"
      style={plateShell}
      data-testid={`collection-entry-${entry.family}-${entry.key}`}
      data-found={found}
    >
      <Bolts />
      <div className="relative flex h-[74px] items-center justify-center overflow-hidden" style={artWell(found)}>
        <EntryArt entry={entry} found={found} />
      </div>
      <div
        className="mt-2 text-[12px] font-black uppercase leading-tight tracking-wide"
        style={{ color: found ? BONE : BONE_FAINT, fontFamily: PLATE_FONT }}
      >
        {found ? entry.name : 'Undiscovered'}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
        {found ? `Logged · ${info?.source ?? 'server record'}` : 'Not logged'}
      </div>
      <FootStrip color={found ? AMBER : '#3A342B'} height={3} />
    </motion.button>
  );
};

/** Boss / elite bay mount — a wide plate: sprite standing at the
 *  left, fitted name + intel line, verdict stamped at the right. */
const WidePlate: React.FC<{
  entry: CollectionEntry;
  found: boolean;
  index: number;
  onSelect: (s: SelectedEntry) => void;
  info?: DiscoveryInfo;
  subLine: string;
  stamp: string;
}> = ({ entry, found, index, onSelect, info, subLine, stamp }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.button
      type="button"
      {...listEntranceProps(index, reduceMotion)}
      onClick={() => onSelect({ entry, found, info })}
      className="relative flex w-full items-stretch gap-3 overflow-hidden p-2.5 pb-3.5 text-left"
      style={plateShell}
      data-testid={`collection-entry-${entry.family}-${entry.key}`}
      data-found={found}
    >
      <Bolts />
      <div className="relative flex h-[72px] w-[96px] shrink-0 items-center justify-center overflow-hidden" style={artWell(found)}>
        <EntryArt entry={entry} found={found} />
      </div>
      <div className="relative min-w-0 flex-1 py-0.5">
        <div
          className="font-black uppercase leading-tight tracking-wide"
          style={{
            color: found ? BONE : BONE_FAINT,
            fontFamily: PLATE_FONT,
            // Fitted type, plate law: long names step down a size
            // instead of truncating (the ellipsis is a backstop,
            // never the design).
            fontSize: found && entry.name.length > 14 ? 13 : 15,
          }}
        >
          {found ? entry.name : 'Undiscovered'}
        </div>
        <div className="mt-1 text-[11px] leading-snug" style={{ color: BONE_MUTED }}>
          {subLine}
        </div>
        {found && (
          <div className="mt-0.5 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
            {`Logged · ${info?.source ?? 'server record'}`}
          </div>
        )}
      </div>
      <div className="relative flex shrink-0 items-center pr-1">
        <span
          className="px-1.5 py-1 text-[11px] font-black uppercase tracking-[0.14em]"
          style={{
            transform: 'rotate(-3deg)',
            border: `2px solid ${found ? AMBER : '#4A4238'}`,
            color: found ? AMBER : BONE_FAINT,
            backgroundColor: 'rgba(6,5,4,0.6)',
          }}
        >
          {stamp}
        </span>
      </div>
      <FootStrip color={found ? AMBER : '#3A342B'} height={3} />
    </motion.button>
  );
};

/** Frames bay tile — one maker on the rack: the frame's own render
 *  over the maker's name. Lit well = logged; silhouette = the gap. */
const RackTile: React.FC<{
  entry: CollectionEntry;
  found: boolean;
  index: number;
  onSelect: (s: SelectedEntry) => void;
  info?: DiscoveryInfo;
}> = ({ entry, found, index, onSelect, info }) => {
  const reduceMotion = useReducedMotion();
  const [, manufacturer] = entry.key.split(':') as [WeaponType, Manufacturer];
  const makerName = MANUFACTURERS[manufacturer]?.name ?? manufacturer;
  return (
    <motion.button
      type="button"
      {...listEntranceProps(index, reduceMotion)}
      onClick={() => onSelect({ entry, found, info })}
      className="relative overflow-hidden p-1.5 pb-2.5 text-left"
      style={plateShell}
      data-testid={`collection-entry-${entry.family}-${entry.key}`}
      data-found={found}
      aria-label={found ? entry.name : `Undiscovered ${makerName} frame`}
    >
      <div className="relative flex h-[52px] items-center justify-center overflow-hidden" style={artWell(found)}>
        <EntryArt entry={entry} found={found} weaponSize={86} />
      </div>
      <div
        className="mt-1.5 truncate text-center text-[11px] font-bold leading-tight"
        style={{ color: found ? BONE_MUTED : BONE_FAINT }}
      >
        {makerName}
      </div>
      <FootStrip color={found ? AMBER : '#3A342B'} height={3} />
    </motion.button>
  );
};

/** The detail plate — the trophy off the wall. */
const DetailSheet: React.FC<{ selected: SelectedEntry; onClose: () => void }> = ({ selected, onClose }) => {
  const { entry, found, info } = selected;
  const areaName =
    entry.family === 'named_elite'
      ? ROAMING_AREAS.find((a) => a.id === entry.key)?.name
      : undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" data-testid="collection-detail-sheet">
      <button
        type="button"
        aria-label="Close detail"
        className="absolute inset-0 h-full w-full"
        style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}
        onClick={onClose}
      />
      <div className="relative max-h-[86vh] w-full max-w-[430px] overflow-y-auto" style={plateShell}>
        <Bolts />
        <div className="relative px-4 pb-5 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div
              className="text-[11px] font-black uppercase tracking-[0.18em]"
              style={{ color: BONE_FAINT }}
            >
              {FAMILY_LABELS[entry.family]}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 shrink-0 items-center justify-center"
              style={{ ...wellStyle, color: BONE }}
            >
              <PxIcon name="chevD" size={17} />
            </button>
          </div>
          <div className="relative mt-1 flex h-[168px] items-center justify-center overflow-hidden" style={artWell(found)}>
            <EntryArt entry={entry} found={found} weaponSize={190} />
          </div>
          <div
            className="mt-3 text-[22px] font-black uppercase leading-tight tracking-wide"
            style={{ color: found ? BONE : BONE_FAINT, fontFamily: PLATE_FONT }}
          >
            {found ? entry.name : 'Undiscovered'}
          </div>
          {areaName && found && (
            <div className="mt-0.5 text-[12px] font-bold" style={{ color: BONE_MUTED }}>
              {areaName}
            </div>
          )}
          <div className="mt-3 flex">
            <span
              className="px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.14em]"
              style={{
                transform: 'rotate(-2deg)',
                border: `2px solid ${found ? AMBER : '#4A4238'}`,
                color: found ? AMBER : BONE_FAINT,
                backgroundColor: 'rgba(6,5,4,0.6)',
              }}
            >
              {found ? 'Logged — server record' : 'Not logged'}
            </span>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
            {found ? entry.hint : UNDISCOVERED_TEASERS[entry.family]}
          </p>
          {found && info && (
            <div className="mt-3 px-3 py-2.5" style={wellStyle}>
              <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: BONE_FAINT }}>
                Proven by
              </div>
              <div className="mt-0.5 text-[13px] font-black" style={{ color: BONE }}>
                {`Logged · ${info.source}`}
              </div>
              <div className="text-[11px]" style={{ color: BONE_MUTED }}>
                {new Date(info.discoveredAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
            </div>
          )}
        </div>
        <FootStrip color={found ? AMBER : STEEL} />
      </div>
    </div>
  );
};

export interface CollectionsWallProps {
  payload: CollectionsPayload | null;
  /** Core balance to show before the payload lands (store fallback). */
  coresFallback?: number;
  error?: string | null;
  onRetry?: () => void;
  embedded?: boolean;
}

export const CollectionsWall: React.FC<CollectionsWallProps> = ({ payload, coresFallback, error, onRetry, embedded = false }) => {
  const [selected, setSelected] = useState<SelectedEntry | null>(null);
  const bayRefs = useRef<Partial<Record<CollectionFamily, HTMLElement | null>>>({});

  const discovered = useMemo(() => {
    const map = new Map<string, DiscoveryInfo>();
    for (const d of payload?.discoveries ?? []) {
      map.set(`${d.family}:${d.entry_key}`, { source: d.source, discoveredAt: d.discovered_at });
    }
    return map;
  }, [payload]);

  const foundTotal = discovered.size;
  const cores = payload?.legendary_cores ?? coresFallback ?? 0;

  const familyStats = useMemo(
    () =>
      COLLECTION_FAMILIES.map((family) => {
        const entries = collectionEntriesForFamily(family);
        const found = entries.filter((e) => discovered.has(`${family}:${e.key}`)).length;
        return { family, entries, found, total: entries.length };
      }),
    [discovered],
  );

  const scrollToBay = (family: CollectionFamily) => {
    bayRefs.current[family]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const frameGroups = useMemo(() => {
    const entries = collectionEntriesForFamily('weapon_frame');
    const groups = new Map<string, CollectionEntry[]>();
    for (const e of entries) {
      const type = e.key.split(':')[0];
      const list = groups.get(type) ?? [];
      list.push(e);
      groups.set(type, list);
    }
    return [...groups.entries()].map(([type, list]) => ({
      type,
      label: WEAPON_TYPES[type as WeaponType]?.name ?? type,
      entries: list,
      found: list.filter((e) => discovered.has(`weapon_frame:${e.key}`)).length,
    }));
  }, [discovered]);

  const arena = bossArt('dune_tyrant');

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 p-4 pb-20'} data-testid="collections-wall">
      {/* ── Hero plate: the wall's nameplate + shelf gauge ─────── */}
      <div className="relative overflow-hidden" style={plateShell}>
        {arena && (
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${arena.arenaUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: '50% 30%',
              filter: 'brightness(0.5)',
            }}
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(10,7,5,0.88) 30%, rgba(10,7,5,0.72) 100%)' }}
        />
        <Bolts />
        <div className="relative px-4 pb-4 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div
              className="text-[26px] font-black uppercase leading-none tracking-wide"
              style={{ color: BONE, fontFamily: PLATE_FONT }}
            >
              Collections
            </div>
            <div className="flex shrink-0 items-center gap-2 px-2.5 py-1.5" style={wellStyle}>
              <PixelWalletIcon id="legendaryCore" size={17} />
              <span className="text-[15px] font-black leading-none" style={{ color: BONE }}>
                {cores}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: BONE_FAINT }}>
                cores
              </span>
            </div>
          </div>
          <p className="mt-2 max-w-[300px] text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
            The trophy wall: every mount here was proven by a server record — a drop stored, a boss
            downed, an elite felled. Salvage Legendary gear to mint cores.
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-[24px] font-black leading-none" style={{ color: BONE }}>
                {`${foundTotal} / ${COLLECTION_TOTAL}`}
                <span className="ml-2 text-[13px] font-black" style={{ color: AMBER }}>
                  {`${COLLECTION_TOTAL ? Math.round((foundTotal / COLLECTION_TOTAL) * 100) : 0}%`}
                </span>
              </div>
              <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: BONE_FAINT }}>
                Shelf logged
              </div>
            </div>
          </div>
          {/* Completion as gauges: one segment per family, each
              filling with that family's own found fraction. */}
          <div className="mt-2.5 flex gap-1" aria-hidden="true">
            {familyStats.map(({ family, found, total }) => (
              <div key={family} className="h-[10px] overflow-hidden" style={{ flexGrow: total, flexBasis: 0, backgroundColor: 'rgba(6,5,4,0.85)', boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.25)' }}>
                <div
                  className="h-full transition-all"
                  style={{ width: `${total ? (found / total) * 100 : 0}%`, backgroundColor: AMBER }}
                />
              </div>
            ))}
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: '#FF8A94' }}>
              <span>{error}</span>
              {onRetry && (
                <button
                  type="button"
                  className="px-2.5 py-2 text-[11px] font-black uppercase"
                  style={{ ...wellStyle, color: BONE }}
                  onClick={onRetry}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {!payload && !error && (
            <div className="mt-2 text-[11px]" style={{ color: BONE_MUTED }}>
              Reading the shelf…
            </div>
          )}
        </div>
        <FootStrip color={STEEL} />
      </div>

      {/* ── Family rail: plate stops that ride to each bay ─────── */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="navigation" aria-label="Collection families">
        {familyStats.map(({ family, found, total }) => (
          <button
            key={family}
            type="button"
            onClick={() => scrollToBay(family)}
            className="relative min-h-[44px] shrink-0 overflow-hidden px-3 pb-2.5 pt-2 text-left"
            style={plateShell}
          >
            <div className="whitespace-nowrap text-[12px] font-black uppercase tracking-wide" style={{ color: BONE, fontFamily: PLATE_FONT }}>
              {FAMILY_LABELS[family]}
            </div>
            <div className="text-[11px] font-bold" style={{ color: BONE_FAINT }}>
              {`${found} / ${total} logged`}
            </div>
            <FootStrip color={found === total && total > 0 ? AMBER : '#3A342B'} height={3} />
          </button>
        ))}
      </div>

      {/* ── Bays ─────────────────────────────────────────────────── */}
      {familyStats.map(({ family, entries, found, total }) => (
        <section
          key={family}
          ref={(el) => {
            bayRefs.current[family] = el;
          }}
          className="scroll-mt-3 space-y-2"
          data-testid={`collections-bay-${family}`}
        >
          <div className="relative overflow-hidden px-3.5 pb-3 pt-3" style={plateShell}>
            <Bolts />
            <div className="relative flex items-baseline justify-between gap-3">
              <div
                className="text-[17px] font-black uppercase leading-none tracking-wide"
                style={{ color: BONE, fontFamily: PLATE_FONT }}
              >
                {FAMILY_LABELS[family]}
              </div>
              <div className="text-[15px] font-black" style={{ color: BONE }}>
                {`${found} / ${total}`}
              </div>
            </div>
            <div className="relative mt-1.5 flex items-center justify-between gap-3">
              <p className="text-[11px] leading-snug" style={{ color: BONE_MUTED }}>
                {FAMILY_BLURBS[family]}
              </p>
              <span className="shrink-0 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: found === total ? AMBER : BONE_FAINT }}>
                {found === total ? 'Bay complete' : `${total - found} to find`}
              </span>
            </div>
            <FootStrip color={found === total ? AMBER : STEEL} height={3} />
          </div>

          {family === 'legendary_effect' && (
            <div className="grid grid-cols-3 gap-2">
              {entries.map((entry, index) => {
                const info = discovered.get(`${family}:${entry.key}`);
                return (
                  <Medallion
                    key={entry.key}
                    entry={entry}
                    found={info !== undefined}
                    info={info}
                    index={index}
                    onSelect={setSelected}
                  />
                );
              })}
            </div>
          )}

          {family === 'boss' && (
            <div className="space-y-2">
              {entries.map((entry, index) => {
                const info = discovered.get(`${family}:${entry.key}`);
                const isFound = info !== undefined;
                return (
                  <WidePlate
                    key={entry.key}
                    entry={entry}
                    found={isFound}
                    info={info}
                    index={index}
                    onSelect={setSelected}
                    subLine={isFound ? entry.hint : UNDISCOVERED_TEASERS.boss}
                    stamp={isFound ? 'Downed' : 'At large'}
                  />
                );
              })}
            </div>
          )}

          {family === 'weapon_frame' && (
            <div className="space-y-2">
              {frameGroups.map((group) => (
                <div key={group.type} className="relative overflow-hidden px-2.5 pb-3 pt-2.5" style={plateShell}>
                  <div className="relative mb-2 flex items-baseline justify-between px-0.5">
                    <span
                      className="text-[13px] font-black uppercase tracking-wide"
                      style={{ color: BONE, fontFamily: PLATE_FONT }}
                    >
                      {group.label}
                    </span>
                    <span className="text-[11px] font-bold" style={{ color: BONE_FAINT }}>
                      {`${group.found} / ${group.entries.length} makers`}
                    </span>
                  </div>
                  <div className="relative grid grid-cols-3 gap-1.5">
                    {group.entries.map((entry, index) => {
                      const info = discovered.get(`weapon_frame:${entry.key}`);
                      return (
                        <RackTile
                          key={entry.key}
                          entry={entry}
                          found={info !== undefined}
                          info={info}
                          index={index}
                          onSelect={setSelected}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {family === 'named_elite' && (
            <div className="space-y-2">
              {entries.map((entry, index) => {
                const info = discovered.get(`${family}:${entry.key}`);
                const isFound = info !== undefined;
                const areaName = ROAMING_AREAS.find((a) => a.id === entry.key)?.name ?? '';
                return (
                  <WidePlate
                    key={entry.key}
                    entry={entry}
                    found={isFound}
                    info={info}
                    index={index}
                    onSelect={setSelected}
                    subLine={isFound ? areaName : UNDISCOVERED_TEASERS.named_elite}
                    stamp={isFound ? 'Downed' : 'At large'}
                  />
                );
              })}
            </div>
          )}
        </section>
      ))}

      {selected && <DetailSheet selected={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};
