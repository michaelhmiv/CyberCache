import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelWalletIcon } from '@/components/pixelArt/PixelWalletIcon';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { bespokeSpriteIdForLegendaryEffect, getPixelSprite } from '@/lib/pixel/manifest';
import type { CollectionsPayload } from '@/lib/api/verifiedOps';
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
 * CollectionsDossier — the claims file (DESIGN PASS prototype,
 * branch design/hunter-subpages-collections-d; variant D of the
 * Hunter subpage pass — "field paperwork").
 *
 * Where variant A hung the collection on a trophy wall, this
 * register files it: the 81 entries are a dossier of claim forms
 * kept by a frontier registry clerk. The composition is documents,
 * not furniture —
 *
 *  - a DOSSIER COVER at the top: form number, registry desk, and
 *    the claim ledger ruled as a table (filed / open per schedule,
 *    cores on account), closed by a rotated PARTIAL FILE stamp;
 *  - four SCHEDULES (A–D, one per family), each a manifest of
 *    ruled rows: a tabular record number, the exhibit thumb, the
 *    entry as filed, and the verdict as a stamp — LOGGED in amber
 *    ink for proven entries, UNFILED in faded red for the rest;
 *  - undiscovered entries are REDACTED the way a clerk blacks out
 *    a line: the name line prints "Undiscovered" over a black bar,
 *    the family teaser stands as the only releasable note, and no
 *    hint (a boss's hint names its dedicated drops) is released;
 *  - a RECORD SHEET for a tapped row: the claim form itself —
 *    exhibit art in a captioned evidence box, the intel as a filed
 *    field, and the proof ruled as source + date + record number,
 *    stamped with the same verdict.
 *
 * Truth rules are the shipped screen's, unchanged: an entry reads
 * FOUND only from a server discovery record (GET
 * /api/collections/me); masking lives at this display layer
 * (QC A11) and the record sheet honors it — an unfiled entry's
 * sheet releases nothing its row didn't. Art derives from the
 * real catalog definitions through the shipped compositors and
 * sprites — no drawn substitutes.
 */

const INK = '#F5ECDA';
const MUT = '#C2B096';
const DIM = '#9A8A6E';
const LINE = '#453218';
const AMBER = '#FFA01F';
const STAMP_RED = '#C4503F';
const PAPER = '#211809';
const PAPER_RAISED = '#2A2010';

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

const SCHEDULE_LETTERS: Record<CollectionFamily, string> = {
  legendary_effect: 'A',
  boss: 'B',
  weapon_frame: 'C',
  named_elite: 'D',
};

interface DiscoveryRecord {
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

function formatFiledDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function recordNo(entry: CollectionEntry, index: number): string {
  return `${SCHEDULE_LETTERS[entry.family]}-${String(index + 1).padStart(2, '0')}`;
}

const EntryArt: React.FC<{ entry: CollectionEntry; found: boolean; weaponSize?: number }> = ({
  entry,
  found,
  weaponSize = 88,
}) => {
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
      <div className="flex h-full w-full items-center justify-center" style={{ color: DIM, ...(silhouette ?? {}) }}>
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

/** The clerk's verdict, stamped — never a badge, never a pill. */
const Stamp: React.FC<{ filed: boolean; large?: boolean }> = ({ filed, large = false }) => (
  <span
    aria-hidden="true"
    className="inline-block shrink-0 font-black uppercase"
    style={{
      transform: 'rotate(-6deg)',
      border: `${large ? 3 : 2}px solid ${filed ? AMBER : STAMP_RED}`,
      color: filed ? AMBER : STAMP_RED,
      opacity: filed ? 0.95 : 0.62,
      padding: large ? '6px 12px' : '3px 7px',
      fontSize: large ? 15 : 11,
      letterSpacing: '0.18em',
      lineHeight: 1,
      backgroundColor: 'rgba(0,0,0,0.25)',
    }}
  >
    {filed ? 'Logged' : 'Unfiled'}
  </span>
);

/** One ruled field on a form: label over a hairline, value under it. */
const FormField: React.FC<{ label: string; children: React.ReactNode; last?: boolean }> = ({
  label,
  children,
  last = false,
}) => (
  <div style={{ borderBottom: last ? undefined : `1px solid ${LINE}`, padding: '8px 0' }}>
    <div className="text-[11px] font-bold uppercase" style={{ color: DIM, letterSpacing: '0.18em' }}>
      {label}
    </div>
    <div className="mt-1 text-[13px] leading-snug" style={{ color: INK }}>
      {children}
    </div>
  </div>
);

const ManifestRow: React.FC<{
  entry: CollectionEntry;
  index: number;
  record?: DiscoveryRecord;
  onOpen: () => void;
}> = ({ entry, index, record, onOpen }) => {
  const found = record !== undefined;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`collection-entry-${entry.family}-${entry.key}`}
      data-found={found}
      className="flex w-full items-center gap-3 text-left transition-transform active:scale-[0.99]"
      style={{ minHeight: 64, padding: '8px 2px', borderBottom: `1px solid ${LINE}` }}
    >
      <span
        className="w-9 shrink-0 text-[12px] font-bold"
        style={{ color: DIM, fontVariantNumeric: 'tabular-nums' }}
      >
        {recordNo(entry, index)}
      </span>
      <span
        className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden"
        style={{ border: `1px solid ${LINE}`, backgroundColor: 'rgba(0,0,0,0.45)' }}
      >
        <EntryArt entry={entry} found={found} />
      </span>
      <span className="min-w-0 flex-1">
        {found ? (
          <span className="block truncate text-[13px] font-black leading-tight" style={{ color: INK }}>
            {entry.name}
          </span>
        ) : (
          <span className="relative block text-[13px] font-black leading-tight" style={{ color: MUT }}>
            <span
              aria-hidden="true"
              className="absolute inset-y-[1px] left-0 w-3/4"
              style={{ backgroundColor: '#0A0703' }}
            />
            <span className="relative">Undiscovered</span>
          </span>
        )}
        <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: found ? MUT : DIM }}>
          {found ? `Logged · ${record.source}` : UNDISCOVERED_TEASERS[entry.family]}
        </span>
        {found && (
          <span className="block truncate text-[11px] leading-snug" style={{ color: DIM }}>
            {entry.hint}
          </span>
        )}
      </span>
      <Stamp filed={found} />
    </button>
  );
};

const RecordSheet: React.FC<{
  entry: CollectionEntry;
  index: number;
  record?: DiscoveryRecord;
  onClose: () => void;
}> = ({ entry, index, record, onClose }) => {
  const found = record !== undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close record sheet"
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}
        onClick={onClose}
      />
      <div
        className="relative max-h-[88vh] w-full max-w-[430px] overflow-y-auto"
        style={{ backgroundColor: PAPER, borderTop: `2px solid ${LINE}`, boxShadow: '0 -12px 40px rgba(0,0,0,0.8)' }}
      >
        <div
          className="flex items-center justify-between gap-2 px-4 py-3"
          style={{ borderBottom: `3px double ${LINE}` }}
        >
          <div>
            <div className="text-[15px] font-black uppercase leading-none" style={{ color: INK, letterSpacing: '0.08em' }}>
              Record of Discovery
            </div>
            <div className="mt-1 text-[11px] uppercase" style={{ color: DIM, letterSpacing: '0.16em' }}>
              Form CC-81/R · Record {recordNo(entry, index)} · Schedule {SCHEDULE_LETTERS[entry.family]}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex shrink-0 items-center gap-1 px-2 text-[11px] font-black uppercase"
            style={{ minHeight: 44, color: AMBER, letterSpacing: '0.14em' }}
          >
            Close file
            <PxIcon name="chevD" size={13} />
          </button>
        </div>

        <div className="px-4 pb-6 pt-3">
          <div
            className="flex h-44 items-center justify-center overflow-hidden"
            style={{ border: `1px solid ${LINE}`, backgroundColor: 'rgba(0,0,0,0.5)' }}
          >
            <EntryArt entry={entry} found={found} weaponSize={190} />
          </div>
          <div className="mt-1.5 text-[11px] uppercase" style={{ color: DIM, letterSpacing: '0.16em' }}>
            Exhibit 1 — {found ? 'the entry as logged' : 'silhouette on file; the item itself is not released'}
          </div>

          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase" style={{ color: DIM, letterSpacing: '0.18em' }}>
                Entry
              </div>
              {found ? (
                <div className="mt-1 text-[20px] font-black leading-tight" style={{ color: INK }}>
                  {entry.name}
                </div>
              ) : (
                <div className="relative mt-1 text-[20px] font-black leading-tight" style={{ color: MUT }}>
                  <span aria-hidden="true" className="absolute inset-y-[2px] left-0 w-4/5" style={{ backgroundColor: '#0A0703' }} />
                  <span className="relative">Undiscovered</span>
                </div>
              )}
            </div>
            <Stamp filed={found} large />
          </div>

          <div className="mt-2">
            <FormField label="Schedule">{FAMILY_LABELS[entry.family]}</FormField>
            <FormField label="Intel on file">
              {found ? entry.hint : UNDISCOVERED_TEASERS[entry.family]}
            </FormField>
            <FormField label="Proof — source of record">
              {found ? record.source : 'No record on file. The entry is proven only when the fact settles on the server.'}
            </FormField>
            <FormField label="Date filed" last>
              {found ? formatFiledDate(record.discovered_at) : '—'}
            </FormField>
          </div>
        </div>
      </div>
    </div>
  );
};

export const CollectionsDossier: React.FC<{
  payload: CollectionsPayload | null;
  coresFallback: number;
  error: string | null;
  embedded?: boolean;
  onRetry: () => void;
}> = ({ payload, coresFallback, error, embedded = false, onRetry }) => {
  const [selected, setSelected] = useState<{ entry: CollectionEntry; index: number } | null>(null);

  const discovered = useMemo(() => {
    const map = new Map<string, DiscoveryRecord>();
    for (const d of payload?.discoveries ?? []) {
      map.set(`${d.family}:${d.entry_key}`, { source: d.source, discovered_at: d.discovered_at });
    }
    return map;
  }, [payload]);

  const foundTotal = discovered.size;
  const openTotal = COLLECTION_TOTAL - foundTotal;
  const cores = payload?.legendary_cores ?? coresFallback;
  const pct = COLLECTION_TOTAL ? Math.round((foundTotal / COLLECTION_TOTAL) * 100) : 0;

  const selectedRecord = selected
    ? discovered.get(`${selected.entry.family}:${selected.entry.key}`)
    : undefined;

  return (
    <div className={embedded ? 'space-y-5' : 'space-y-5 p-4 pb-20'}>
      {/* ── Dossier cover ─────────────────────────────────────────── */}
      <div style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
        <div
          className="flex items-stretch justify-between text-[11px] font-bold uppercase"
          style={{ color: DIM, letterSpacing: '0.16em', borderBottom: `1px solid ${LINE}` }}
        >
          <span className="px-3 py-2" style={{ borderRight: `1px solid ${LINE}`, color: AMBER }}>
            Form CC-81
          </span>
          <span className="px-3 py-2">Frontier Registry · Wastes Desk</span>
          <span className="px-3 py-2" style={{ borderLeft: `1px solid ${LINE}` }}>
            File: Collections
          </span>
        </div>

        <div className="relative px-4 pb-4 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="bl-title text-3xl leading-none" style={{ color: INK }}>
              Collections
            </div>
            <PxIcon name="shelf" size={26} style={{ color: AMBER }} />
          </div>
          <p className="mt-2 max-w-[34ch] text-[12px] leading-snug" style={{ color: MUT }}>
            The claims dossier: every entry here was proven by a server record — a drop stored, a boss
            downed, an elite felled. If it is not stamped, it is not filed.
          </p>

          <div className="mt-4" style={{ borderTop: `1px solid ${LINE}` }}>
            <div
              className="flex items-baseline justify-between py-2"
              style={{ borderBottom: `1px solid ${LINE}` }}
            >
              <span className="text-[11px] font-bold uppercase" style={{ color: DIM, letterSpacing: '0.18em' }}>
                Claims filed
              </span>
              <span className="text-[20px] font-black leading-none" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>
                {foundTotal} / {COLLECTION_TOTAL}
                <span className="ml-2 text-[12px] font-bold" style={{ color: AMBER }}>
                  {pct}%
                </span>
              </span>
            </div>
            <div
              className="flex items-baseline justify-between py-2"
              style={{ borderBottom: `1px solid ${LINE}` }}
            >
              <span className="text-[11px] font-bold uppercase" style={{ color: DIM, letterSpacing: '0.18em' }}>
                Still open
              </span>
              <span className="text-[15px] font-black" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>
                {openTotal} entries unfiled
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-[11px] font-bold uppercase" style={{ color: DIM, letterSpacing: '0.18em' }}>
                Cores on account
              </span>
              <span className="flex items-center gap-2">
                <PixelWalletIcon id="legendaryCore" size={17} />
                <span className="text-[15px] font-black" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>
                  {cores}
                </span>
                <span className="text-[11px]" style={{ color: MUT }}>
                  Salvage Legendary gear to mint more.
                </span>
              </span>
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-4 right-4">
            <span
              aria-hidden="true"
              className="inline-block font-black uppercase"
              style={{
                transform: 'rotate(-6deg)',
                border: `3px solid ${foundTotal >= COLLECTION_TOTAL ? AMBER : STAMP_RED}`,
                color: foundTotal >= COLLECTION_TOTAL ? AMBER : STAMP_RED,
                opacity: 0.85,
                padding: '6px 12px',
                fontSize: 15,
                letterSpacing: '0.18em',
                lineHeight: 1,
                backgroundColor: 'rgba(0,0,0,0.25)',
              }}
            >
              {foundTotal >= COLLECTION_TOTAL ? 'File complete' : 'Partial file'}
            </span>
          </div>
          <div className="mt-1 text-[11px] uppercase" style={{ color: DIM, letterSpacing: '0.14em' }}>
            Status of file: {foundTotal >= COLLECTION_TOTAL ? 'complete' : 'partial — claims outstanding'}
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: '#FF5566' }}>
              <span>{error}</span>
              <button
                type="button"
                className="px-2 py-1 text-[11px] font-black uppercase"
                style={{ border: `1px solid ${LINE}`, color: AMBER, minHeight: 44 }}
                onClick={onRetry}
              >
                Retry
              </button>
            </div>
          )}
          {!payload && !error && (
            <div className="mt-3 text-[11px]" style={{ color: MUT }}>
              Pulling the file…
            </div>
          )}
        </div>

        {/* Ledger of schedules */}
        <div style={{ borderTop: `3px double ${LINE}` }}>
          <div
            className="grid grid-cols-[52px_1fr_auto_auto] gap-2 px-4 py-2 text-[11px] font-bold uppercase"
            style={{ color: DIM, letterSpacing: '0.16em', borderBottom: `1px solid ${LINE}` }}
          >
            <span>Sched.</span>
            <span>Family</span>
            <span className="w-16 text-right">Filed</span>
            <span className="w-12 text-right">Open</span>
          </div>
          {COLLECTION_FAMILIES.map((family) => {
            const entries = collectionEntriesForFamily(family);
            const filed = entries.filter((e) => discovered.has(`${family}:${e.key}`)).length;
            return (
              <div
                key={family}
                className="grid grid-cols-[52px_1fr_auto_auto] items-baseline gap-2 px-4 py-2"
                style={{ borderBottom: `1px solid ${LINE}`, fontVariantNumeric: 'tabular-nums' }}
              >
                <span className="text-[13px] font-black" style={{ color: AMBER }}>
                  {SCHEDULE_LETTERS[family]}
                </span>
                <span className="text-[13px] font-bold" style={{ color: INK }}>
                  {FAMILY_LABELS[family]}
                </span>
                <span className="w-16 text-right text-[13px] font-black" style={{ color: INK }}>
                  {filed} / {entries.length}
                </span>
                <span className="w-12 text-right text-[13px]" style={{ color: MUT }}>
                  {entries.length - filed}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Schedules: one manifest per family ────────────────────── */}
      {COLLECTION_FAMILIES.map((family) => {
        const entries = collectionEntriesForFamily(family);
        const filed = entries.filter((e) => discovered.has(`${family}:${e.key}`)).length;
        return (
          <section key={family} style={{ backgroundColor: PAPER, border: `1px solid ${LINE}` }}>
            <div className="px-4 pt-3" style={{ borderBottom: `3px double ${LINE}`, paddingBottom: 10 }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-8 w-8 items-center justify-center text-[15px] font-black"
                    style={{ border: `1px solid ${LINE}`, backgroundColor: PAPER_RAISED, color: AMBER }}
                  >
                    {SCHEDULE_LETTERS[family]}
                  </span>
                  <div className="text-[15px] font-black uppercase leading-none" style={{ color: INK, letterSpacing: '0.06em' }}>
                    {FAMILY_LABELS[family]}
                  </div>
                </div>
                <span className="shrink-0 text-[12px] font-black" style={{ color: MUT, fontVariantNumeric: 'tabular-nums' }}>
                  Filed {filed} / {entries.length}
                </span>
              </div>
              <div className="mt-1.5 text-[11px] leading-snug" style={{ color: DIM }}>
                {FAMILY_BLURBS[family]} Tap a line to open its record sheet.
              </div>
            </div>
            <div className="px-4 pb-2">
              {entries.map((entry, index) => (
                <ManifestRow
                  key={entry.key}
                  entry={entry}
                  index={index}
                  record={discovered.get(`${family}:${entry.key}`)}
                  onOpen={() => setSelected({ entry, index })}
                />
              ))}
            </div>
          </section>
        );
      })}

      <p className="px-1 text-[11px] leading-snug" style={{ color: DIM }}>
        Registry note: filed claims rest on server records only. Unfiled lines stay redacted — name,
        drops, and proof are released when the record exists, not before.
      </p>

      {selected && (
        <RecordSheet
          entry={selected.entry}
          index={selected.index}
          record={selectedRecord}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};
