import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { CollectionEntry } from '@/content/collections';
import type { CollectionsPayload } from '@/lib/api/verifiedOps';
import {
  COLLECTION_TOTAL,
  LEDGER_FAMILY_LABELS,
  LEDGER_UNDISCOVERED_TEASERS,
  buildLedger,
  formatLedgerDate,
  groupFrameRows,
  ledgerSpriteUrl,
  seedFromKey,
  type LedgerRow,
} from './collectionsLedgerModel';

/**
 * CollectionsLedger — Variant E ("Quiet plates") of the Hunter
 * sub-page design pass. PROTOTYPE ONLY (design branch, never
 * merged): the same shelf the shipped CollectionsScreen serves,
 * re-set as a quiet index.
 *
 * The register: the collection at rest. No plates, no stamps, no
 * gauges, no wells — the page is a ledger of record where type does
 * all the work. Entries print as numbered rows in one continuous
 * catalog (1–81), found entries in full ink with their catalog hint
 * (the intel the shipped page computes but never displays) and a
 * provenance line; unlogged entries rest at "Undiscovered" with the
 * family teaser, their art a silhouette. Chapters are separated by
 * air and a single hairline; art sits small and frameless at the
 * row's edge. Tapping a row opens the reading room: the piece large
 * on empty ground, its name at poster size, the hint as prose, and
 * the server record as a footnote.
 *
 * Truth rules are the shipped page's (QC A11): found state derives
 * only from the payload's discovery records, and undiscovered
 * entries print neither name nor hint — in the index or the room.
 */

const DISPLAY: React.CSSProperties = {
  fontFamily: "'Bebas Neue', 'Chakra Petch', system-ui, sans-serif",
  letterSpacing: '0.015em',
};

const QuietArt: React.FC<{ entry: CollectionEntry; found: boolean; size: number }> = ({ entry, found, size }) => {
  const silhouette = !found
    ? { filter: 'brightness(0) contrast(1.2)', opacity: 0.45 }
    : undefined;
  if (entry.family === 'weapon_frame') {
    const [weaponType, manufacturer] = entry.key.split(':') as [WeaponType, Manufacturer];
    return (
      <div style={silhouette} className="flex items-center justify-center">
        <PixelWeapon
          input={{
            weaponType,
            manufacturer,
            rarity: Rarity.Legendary,
            pixelSeed: seedFromKey(entry.key),
            rollQuality: 88,
            id: `collection-ledger-${entry.key}`,
          }}
          size={size}
          density="card"
        />
      </div>
    );
  }
  const url = ledgerSpriteUrl(entry);
  if (!url) {
    return (
      <div style={silhouette} className="flex items-center justify-center text-text-muted">
        <PxIcon name="star" size={Math.round(size * 0.5)} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={found ? entry.name : 'Undiscovered entry'}
      draggable={false}
      className="object-contain"
      style={{ imageRendering: 'pixelated', maxHeight: size, maxWidth: size, ...(silhouette ?? {}) }}
    />
  );
};

const LedgerRowButton: React.FC<{ row: LedgerRow; onOpen: (row: LedgerRow) => void }> = ({ row, onOpen }) => {
  const { entry, discovery } = row;
  const found = discovery !== undefined;
  const date = formatLedgerDate(discovery?.discoveredAt);
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      aria-label={found ? entry.name : 'Undiscovered entry'}
      className="grid w-full grid-cols-[2rem_minmax(0,1fr)_3.25rem] items-start gap-3 text-left"
      data-testid={`collection-entry-${entry.family}-${entry.key}`}
      data-found={found}
    >
      <span className="pt-[5px] text-[12px] tabular-nums text-text-muted">
        {String(row.number).padStart(2, '0')}
      </span>
      <span className="min-w-0">
        <span
          className={`block text-[21px] font-semibold leading-snug ${
            found ? 'text-text-primary' : 'text-text-muted'
          }`}
        >
          {found ? entry.name : 'Undiscovered'}
        </span>
        <span
          className={`mt-1 block text-[13px] leading-relaxed ${
            found ? 'text-text-secondary' : 'text-text-muted'
          }`}
        >
          {found ? entry.hint : LEDGER_UNDISCOVERED_TEASERS[entry.family]}
        </span>
        {found && (
          <span className="mt-2 block text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
            Logged · {discovery.source}
            {date ? ` · ${date}` : ''}
          </span>
        )}
      </span>
      <span className="flex h-[52px] w-[52px] items-start justify-end pt-[2px]">
        <QuietArt entry={entry} found={found} size={52} />
      </span>
    </button>
  );
};

const ReadingRoom: React.FC<{ row: LedgerRow; onClose: () => void }> = ({ row, onClose }) => {
  const { entry, discovery } = row;
  const found = discovery !== undefined;
  const date = formatLedgerDate(discovery?.discoveredAt);
  const isFrame = entry.family === 'weapon_frame';
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" data-testid="collection-ledger-detail">
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col px-7 pb-16">
        <button
          type="button"
          onClick={onClose}
          className="mt-4 flex min-h-[44px] items-center gap-2 self-start text-[13px] font-bold uppercase tracking-[0.14em] text-text-secondary"
        >
          <PxIcon name="chevL" size={14} />
          Collections
        </button>

        <div className="flex h-[216px] items-center justify-center">
          <QuietArt entry={entry} found={found} size={isFrame ? 264 : 192} />
        </div>

        <h3 style={DISPLAY} className="mt-12 text-[54px] leading-[0.95] text-text-primary">
          {found ? entry.name : 'Undiscovered'}
        </h3>
        <p className="mt-3 text-[12px] uppercase tracking-[0.18em] text-text-muted">
          No. {row.number} — {LEDGER_FAMILY_LABELS[entry.family]}
        </p>

        <p className="mt-7 max-w-[36ch] text-[16px] leading-relaxed text-text-secondary">
          {found ? entry.hint : LEDGER_UNDISCOVERED_TEASERS[entry.family]}
        </p>

        {/* The provenance is the room's colophon — it anchors the
            foot of the page, however much air the piece leaves. */}
        <div className="min-h-14 flex-1" />
        <div className="border-t border-border-light/50 pt-6">
          {found ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                Proven by server record
              </p>
              <p className="mt-2 text-[14px] text-text-secondary">
                {discovery.source}
                {date ? ` — ${date}` : ''}
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                Not yet logged
              </p>
              <p className="mt-2 text-[14px] text-text-secondary">
                Its name and intel stay sealed until the record exists.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const CollectionsLedger: React.FC<{ payload: CollectionsPayload }> = ({ payload }) => {
  const { chapters, foundTotal } = useMemo(() => buildLedger(payload), [payload]);
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const cores = payload.legendary_cores;
  const remaining = COLLECTION_TOTAL - foundTotal;

  return (
    <div className="h-full overflow-y-auto bg-bg text-text-primary">
      <div className="mx-auto w-full max-w-[480px] px-7 pb-20">
        <header className="pt-16">
          <h1 style={DISPLAY} className="text-[64px] leading-[0.95] text-text-primary">
            Collections
          </h1>
          <p className="mt-6 max-w-[36ch] text-[15px] leading-relaxed text-text-secondary">
            The trophy shelf, kept as a record. Every entry below was proven by a server
            record — a drop stored, a boss downed, an elite felled.
          </p>
          <div className="mt-12 flex items-baseline gap-4">
            <span style={DISPLAY} className="text-[96px] leading-[0.85] text-text-primary">
              {foundTotal}
            </span>
            <span className="text-[15px] leading-snug text-text-muted">
              of {COLLECTION_TOTAL} entries
              <br />
              logged
            </span>
          </div>
          <p className="mt-7 text-[13px] leading-relaxed text-text-muted">
            {cores} legendary cores held — salvage Legendary gear to mint more, and spend
            them on core-catalyzed frames at the Forge.
          </p>
        </header>

        {chapters.map((chapter) => (
          <section key={chapter.family} className="mt-20 border-t border-border-light/50 pt-12">
            <h2 style={DISPLAY} className="text-[40px] leading-none text-text-primary">
              {chapter.label}
            </h2>
            <p className="mt-3 text-[13px] text-text-muted">
              {chapter.found} of {chapter.total} logged
            </p>
            <p className="mt-2 max-w-[38ch] text-[14px] leading-relaxed text-text-secondary">
              {chapter.blurb}
            </p>

            {chapter.family === 'weapon_frame' ? (
              <div className="mt-4">
                {groupFrameRows(chapter.rows).map((group) => (
                  <div key={group.typeName} className="mt-10">
                    <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-text-muted">
                      {group.typeName}
                    </div>
                    <div className="mt-6 space-y-7">
                      {group.rows.map((row) => (
                        <LedgerRowButton key={row.entry.key} row={row} onOpen={setSelected} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-9 space-y-7">
                {chapter.rows.map((row) => (
                  <LedgerRowButton key={row.entry.key} row={row} onOpen={setSelected} />
                ))}
              </div>
            )}
          </section>
        ))}

        <footer className="mt-24 border-t border-border-light/50 pt-8">
          <p className="text-[13px] text-text-muted">
            {remaining} entries still wait in the wastes.
          </p>
        </footer>
      </div>

      {selected && <ReadingRoom row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};
