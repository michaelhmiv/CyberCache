import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelWalletIcon } from '@/components/pixelArt/PixelWalletIcon';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { bespokeSpriteIdForLegendaryEffect, getPixelSprite } from '@/lib/pixel/manifest';
import {
  COLLECTION_FAMILIES,
  COLLECTION_TOTAL,
  collectionEntriesForFamily,
  type CollectionEntry,
  type CollectionFamily,
} from '@/content/collections';
import { AREA_VISUALS, type RoamingAreaId } from '@/content/areaPalettes';
import { Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { CollectionsPayload } from '@/lib/api/verifiedOps';

/**
 * CollectionsPanel — VARIANT B (design prototype, never merged):
 * the collection as an INSTRUMENT CLUSTER.
 *
 * Where the shipped shelf and the Arena-Plates wall present the 81
 * proofs as objects on display, this register presents them as
 * MEASUREMENT: one master dial for total completion, a segmented
 * bar meter per family channel, cores as a counter readout, and
 * every entry as a dense telemetry row — status lamp, art sample,
 * source tag, log date. Found state is a signal: lit lamp, named
 * channel. No signal: dark lamp, the name stays masked and the row
 * carries only the family teaser — the same found-state truth rules
 * as the shipped screen (server records only, QC A11), restated in
 * instrument language.
 *
 * Tapping a row opens the SPEC SHEET: a readout card for that one
 * entry, including the catalog hint the shipped page computes but
 * never displays — printed here as acquisition intel for entries
 * already logged. Undiscovered entries open fully masked.
 */

const PANEL = '#0B0F14';
const PANEL_RAISED = '#10161E';
const HAIRLINE = '#232B36';
const SIGNAL = '#3FE0B8';
const AMBER = '#FF9000';

const FAMILY_LABELS: Record<CollectionFamily, string> = {
  legendary_effect: 'Legendary Effects',
  boss: 'Bosses Downed',
  weapon_frame: 'Legendary Frames',
  named_elite: 'Named Elites',
};

const FAMILY_SHORT: Record<CollectionFamily, string> = {
  legendary_effect: 'EFFECTS',
  boss: 'BOSSES',
  weapon_frame: 'FRAMES',
  named_elite: 'ELITES',
};

const FAMILY_HUE: Record<CollectionFamily, string> = {
  legendary_effect: '#FF9000',
  boss: '#FF4B5C',
  weapon_frame: '#5AA7FF',
  named_elite: '#7CFC00',
};

const FAMILY_BLURBS: Record<CollectionFamily, string> = {
  legendary_effect: 'Effects rolled on legendary weapons you have held.',
  boss: 'Every boss in the wastes, beaten at least once.',
  weapon_frame: 'A Legendary of this frame has passed through your hands.',
  named_elite: 'The named elite of each roaming area, brought down.',
};

/** What an UNLOGGED entry may say about itself: how its family is
 *  earned, never which entry it is. (Same contract as the shipped
 *  screen — the real hint is withheld; it names dedicated drops.) */
const UNDISCOVERED_TEASERS: Record<CollectionFamily, string> = {
  legendary_effect: 'An unlogged legendary effect — own a weapon carrying it to log this entry.',
  boss: 'An undefeated boss — beat it to log this entry.',
  weapon_frame: 'An unlogged Legendary frame — own one to log this entry.',
  named_elite: 'An undowned named elite — fell it in its roaming area to log this entry.',
};

interface Discovery {
  source: string;
  discovered_at: string;
}

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

function formatLogDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d
    .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    .toUpperCase();
}

const EntryArt: React.FC<{ entry: CollectionEntry; found: boolean; px: number }> = ({ entry, found, px }) => {
  const silhouette = !found ? { filter: 'brightness(0) contrast(1.2)', opacity: 0.45 } : undefined;
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
            id: `collection-b-${entry.key}`,
          }}
          size={px}
          density="card"
        />
      </div>
    );
  }
  const spriteId = spriteIdFor(entry);
  const sprite = spriteId ? getPixelSprite(spriteId) : undefined;
  if (!sprite) {
    return (
      <div className="flex h-full w-full items-center justify-center text-text-muted" style={silhouette}>
        <PxIcon name="star" size={Math.min(26, px)} />
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

/** Segmented LED bar meter — one segment per unit of scale, lit to
 *  the measured fraction. The segments ARE the data, not decoration:
 *  each channel's bar is drawn at its own entry count. */
const SegmentedMeter: React.FC<{ value: number; max: number; color: string; height?: number }> = ({
  value,
  max,
  color,
  height = 10,
}) => {
  const segments = Math.max(1, max);
  const lit = Math.round((value / Math.max(1, max)) * segments);
  return (
    <div className="flex w-full gap-[2px]" aria-hidden>
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          className="min-w-0 flex-1"
          style={{
            height,
            backgroundColor: i < lit ? color : '#1C242E',
            boxShadow: i < lit ? `0 0 5px ${color}55` : undefined,
          }}
        />
      ))}
    </div>
  );
};

/** Semicircular master dial — pure CSS conic sweep, no SVG. The
 *  needle rests at the measured completion; the digital readout
 *  under the hub is the authority, the dial is the glance. */
const MasterDial: React.FC<{ pct: number }> = ({ pct }) => {
  const sweep = Math.max(0, Math.min(180, pct * 1.8));
  return (
    <div className="relative shrink-0" style={{ width: 176, height: 100 }} aria-hidden>
      <div
        className="absolute left-0 top-0"
        style={{
          width: 176,
          height: 176,
          borderRadius: '50%',
          background: `conic-gradient(from 270deg, ${SIGNAL} 0deg ${sweep}deg, #1C242E ${sweep}deg 180deg, transparent 180deg 360deg)`,
        }}
      />
      <div
        className="absolute"
        style={{
          width: 136,
          height: 136,
          borderRadius: '50%',
          backgroundColor: PANEL,
          left: 20,
          top: 20,
        }}
      />
      {/* needle */}
      <div
        className="absolute"
        style={{
          width: 3,
          height: 66,
          backgroundColor: AMBER,
          left: 'calc(50% - 1.5px)',
          bottom: 12,
          transformOrigin: '50% 100%',
          transform: `rotate(${-90 + sweep}deg)`,
          boxShadow: `0 0 8px ${AMBER}88`,
        }}
      />
      <div
        className="absolute rounded-full"
        style={{ width: 13, height: 13, backgroundColor: '#2A333F', left: 'calc(50% - 6.5px)', bottom: 6 }}
      />
      <span className="absolute bottom-0 left-1 font-mono text-[11px] text-text-muted">0</span>
      <span className="absolute bottom-0 right-1 font-mono text-[11px] text-text-muted">{COLLECTION_TOTAL}</span>
    </div>
  );
};

const Readout: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent }) => (
  <div>
    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">{label}</div>
    <div
      className="mt-0.5 font-mono text-xl font-bold tabular-nums leading-none"
      style={{ color: accent ?? '#F5F5F5' }}
    >
      {value}
    </div>
  </div>
);

const EntryRow: React.FC<{
  entry: CollectionEntry;
  discovery?: Discovery;
  onSelect: (entry: CollectionEntry) => void;
}> = ({ entry, discovery, onSelect }) => {
  const found = discovery !== undefined;
  const hue = FAMILY_HUE[entry.family];
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors active:bg-white/5"
      style={{ minHeight: 52, borderTop: `1px solid ${HAIRLINE}` }}
      data-testid={`collection-entry-${entry.family}-${entry.key}`}
      data-found={found}
    >
      <span
        className="shrink-0 rounded-full"
        style={{
          width: 9,
          height: 9,
          backgroundColor: found ? hue : '#39424E',
          boxShadow: found ? `0 0 7px ${hue}` : undefined,
        }}
      />
      <span
        className="flex shrink-0 items-center justify-center overflow-hidden"
        style={{ width: 44, height: 40, backgroundColor: 'rgba(0,0,0,0.45)' }}
      >
        <EntryArt entry={entry} found={found} px={40} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[12px] font-bold uppercase tracking-[0.08em] ${
            found ? 'text-text-primary' : 'text-text-muted'
          }`}
        >
          {found ? entry.name : 'Undiscovered'}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[11px] leading-snug text-text-muted">
          {found
            ? `Logged · ${discovery.source} · ${formatLogDate(discovery.discovered_at)}`
            : UNDISCOVERED_TEASERS[entry.family]}
        </span>
      </span>
      <span
        className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
        style={{ color: found ? hue : '#55606C' }}
      >
        {found ? 'Logged' : 'No signal'}
      </span>
    </button>
  );
};

interface SpecTarget {
  entry: CollectionEntry;
  discovery?: Discovery;
}

const SpecSheet: React.FC<{ target: SpecTarget; onClose: () => void }> = ({ target, onClose }) => {
  const { entry, discovery } = target;
  const found = discovery !== undefined;
  const hue = FAMILY_HUE[entry.family];
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <button type="button" aria-label="Close spec sheet" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-[430px] px-4 pb-5 pt-3"
        style={{ backgroundColor: PANEL_RAISED, borderTop: `2px solid ${hue}` }}
        initial={reduceMotion ? false : { y: 48 }}
        animate={{ y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { y: 48 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        data-testid="collection-spec-sheet"
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: hue }}>
            Spec · {FAMILY_LABELS[entry.family]}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center text-text-secondary"
          >
            <PxIcon name="cross" size={17} />
          </button>
        </div>

        <div
          className="mt-1 flex h-44 items-center justify-center overflow-hidden"
          style={{
            background: found
              ? `radial-gradient(ellipse at center, ${hue}26, rgba(0,0,0,0.6) 78%)`
              : 'radial-gradient(ellipse at center, rgba(255,255,255,0.05), rgba(0,0,0,0.6) 78%)',
          }}
        >
          <EntryArt entry={entry} found={found} px={150} />
        </div>

        <div className="bl-title mt-3 text-[26px] leading-none text-text-primary">
          {found ? entry.name : 'Undiscovered'}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Readout label="Status" value={found ? 'LOGGED' : 'NO SIGNAL'} accent={found ? hue : '#55606C'} />
          <Readout label="Channel" value={FAMILY_SHORT[entry.family]} />
          <Readout label="Source" value={found ? discovery.source : '—'} />
          <Readout label="Logged on" value={found ? formatLogDate(discovery.discovered_at) : '—'} />
        </div>

        <div className="mt-4 px-3 py-2.5" style={{ backgroundColor: PANEL, border: `1px solid ${HAIRLINE}` }}>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
            {found ? 'Acquisition intel' : 'How this channel logs'}
          </div>
          <div className="mt-1 text-[12px] leading-snug text-text-secondary">
            {found ? entry.hint : UNDISCOVERED_TEASERS[entry.family]}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export interface CollectionsPanelProps {
  payload: CollectionsPayload | null;
  cores: number;
  error?: string | null;
  onRetry?: () => void;
}

export const CollectionsPanel: React.FC<CollectionsPanelProps> = ({ payload, cores, error, onRetry }) => {
  const [selected, setSelected] = useState<SpecTarget | null>(null);

  const discovered = useMemo(() => {
    const map = new Map<string, Discovery>();
    for (const d of payload?.discoveries ?? []) {
      map.set(`${d.family}:${d.entry_key}`, { source: d.source, discovered_at: d.discovered_at });
    }
    return map;
  }, [payload]);

  const foundTotal = discovered.size;
  const pct = COLLECTION_TOTAL ? Math.round((foundTotal / COLLECTION_TOTAL) * 100) : 0;

  const lastLogged = useMemo(() => {
    let latest: string | undefined;
    for (const d of payload?.discoveries ?? []) {
      if (!latest || d.discovered_at > latest) latest = d.discovered_at;
    }
    return latest;
  }, [payload]);

  const familyStats = useMemo(
    () =>
      COLLECTION_FAMILIES.map((family) => {
        const entries = collectionEntriesForFamily(family);
        const found = entries.filter((e) => discovered.has(`${family}:${e.key}`)).length;
        return { family, entries, found, total: entries.length };
      }),
    [discovered],
  );

  return (
    <div className="space-y-4">
      {/* ── Instrument cluster header ─────────────────────────────── */}
      <section className="px-4 pb-4 pt-3" style={{ backgroundColor: PANEL, border: `1px solid ${HAIRLINE}` }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="bl-title text-[30px] leading-none text-text-primary">Collections</h2>
            <div className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
              Hoard telemetry · {COLLECTION_TOTAL} channels
            </div>
          </div>
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ backgroundColor: PANEL_RAISED, border: `1px solid ${HAIRLINE}` }}
          >
            <PixelWalletIcon id="legendaryCore" size={18} />
            <span className="font-mono text-lg font-bold tabular-nums leading-none text-text-primary">{cores}</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">cores</span>
          </div>
        </div>

        <div className="mt-3 flex items-end gap-4">
          <MasterDial pct={pct} />
          <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-3 pb-1">
            <Readout
              label="Logged"
              value={`${foundTotal} / ${COLLECTION_TOTAL}`}
              accent={SIGNAL}
            />
            <Readout label="Complete" value={`${pct}%`} accent={SIGNAL} />
            <Readout label="Outstanding" value={`${COLLECTION_TOTAL - foundTotal}`} />
            <Readout label="Last entry" value={formatLogDate(lastLogged)} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {familyStats.map(({ family, found, total }) => (
            <div key={family} className="px-2.5 py-2" style={{ backgroundColor: PANEL_RAISED }}>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: FAMILY_HUE[family] }}>
                  {FAMILY_SHORT[family]}
                </span>
                <span className="font-mono text-[12px] font-bold tabular-nums text-text-primary">
                  {found}
                  <span className="text-text-muted"> / {total}</span>
                </span>
              </div>
              <div className="mt-1.5">
                <SegmentedMeter value={found} max={total} color={FAMILY_HUE[family]} height={7} />
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-red">
            <span>SIGNAL FAULT · {error}</span>
            {onRetry && (
              <button type="button" className="bl-secondary px-2 py-1 text-[11px] font-black" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        )}
        {!payload && !error && (
          <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
            Acquiring signal…
          </div>
        )}
      </section>

      {/* ── Channels ──────────────────────────────────────────────── */}
      {familyStats.map(({ family, entries, found, total }, channelIdx) => {
        const hue = FAMILY_HUE[family];
        const channelBody = (
          <>
            <div className="flex items-end justify-between gap-2 px-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] font-bold tracking-[0.16em]" style={{ color: hue }}>
                  CH-0{channelIdx + 1}
                </span>
                <h3 className="bl-title text-[21px] leading-none text-text-primary">{FAMILY_LABELS[family]}</h3>
              </div>
              <span className="font-mono text-[13px] font-bold tabular-nums text-text-primary">
                {found}
                <span className="text-text-muted"> / {total}</span>
                <span className="ml-2 text-text-secondary">{total ? Math.round((found / total) * 100) : 0}%</span>
              </span>
            </div>
            <div className="mt-1 px-1 text-[11px] leading-snug text-text-muted">{FAMILY_BLURBS[family]}</div>
            <div className="mt-2 px-1">
              <SegmentedMeter value={found} max={total} color={hue} height={9} />
            </div>
            <div className="mt-1" style={{ backgroundColor: PANEL, borderBottom: `1px solid ${HAIRLINE}` }}>
              {family === 'weapon_frame'
                ? (() => {
                    const byType = new Map<string, CollectionEntry[]>();
                    for (const e of entries) {
                      const type = e.key.split(':')[0];
                      byType.set(type, [...(byType.get(type) ?? []), e]);
                    }
                    return [...byType.entries()].map(([type, group]) => {
                      const groupFound = group.filter((e) => discovered.has(`${family}:${e.key}`)).length;
                      return (
                        <div key={type}>
                          <div
                            className="flex items-center justify-between px-3 py-1.5"
                            style={{ borderTop: `1px solid ${HAIRLINE}`, backgroundColor: PANEL_RAISED }}
                          >
                            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-secondary">
                              {type.replace(/_/g, ' ')}
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-text-muted">
                              {groupFound} / {group.length}
                            </span>
                          </div>
                          {group.map((entry) => (
                            <EntryRow
                              key={entry.key}
                              entry={entry}
                              discovery={discovered.get(`${family}:${entry.key}`)}
                              onSelect={(e) => setSelected({ entry: e, discovery: discovered.get(`${family}:${e.key}`) })}
                            />
                          ))}
                        </div>
                      );
                    });
                  })()
                : entries.map((entry) => (
                    <EntryRow
                      key={entry.key}
                      entry={entry}
                      discovery={discovered.get(`${family}:${entry.key}`)}
                      onSelect={(e) => setSelected({ entry: e, discovery: discovered.get(`${family}:${e.key}`) })}
                    />
                  ))}
            </div>
          </>
        );
        return (
          <section key={family} aria-label={FAMILY_LABELS[family]}>
            {channelBody}
          </section>
        );
      })}

      <AnimatePresence>
        {selected && <SpecSheet target={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
};
