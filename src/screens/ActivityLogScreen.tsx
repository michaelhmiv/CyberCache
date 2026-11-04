/**
 * ActivityLogScreen (AL-3) — the full Activity Log.
 *
 * The Home feed shows the last few facts; this screen is the
 * whole record: every drop with its receipt, every kill stretch,
 * trade, craft, boss fight, dispatch, and while-away settlement,
 * newest first, back to the account's first day. Owner rulings
 * baked in: history keeps EVERYTHING (cursor pagination, no UI
 * cutoff), kills render as the lumped summary lines they are,
 * while-away facts ride the same stream under their divider, and
 * ONE search box covers item names, enemy names, and areas (the
 * API's single `q`). Kind chips filter server-side; time signs
 * and the two dividers (while-away, receipts-begin) are rendered
 * structure over the stream, computed from the records
 * themselves.
 *
 * Built through the `impeccable` skill pass (Operate/Read mode):
 * the shipped feed's anatomy is the baseline — clipped panels,
 * rarity-bordered plates, uppercase micro-labels at the 11px
 * floor, tap targets ≥44px, scroll-don't-shrink chip rail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { ActivityRecordCard } from '@/components/activity/ActivityRecordCard';
import { ActivityRecordSheet } from '@/components/activity/ActivityRecordSheet';
import {
  fetchActivityLog,
  type ActivityLogKindFilter, type ActivityRecord,
} from '@/lib/api/activityLogService';
import { bandStream, decorateStream } from '@/lib/activity/activityLogView';

const slashClip = { clipPath: 'polygon(9px 0,100% 0,calc(100% - 9px) 100%,0 100%)' };
const PAGE_SIZE = 50;

interface Chip { id: string; label: string; kinds?: ActivityLogKindFilter[] }

const CHIPS: Chip[] = [
  { id: 'all', label: 'All' },
  { id: 'drop', label: 'Loot', kinds: ['drop'] },
  { id: 'kills', label: 'Kills', kinds: ['kills'] },
  { id: 'boss', label: 'Boss', kinds: ['boss'] },
  { id: 'cache', label: 'Caches', kinds: ['cache'] },
  { id: 'craft', label: 'Craft', kinds: ['craft'] },
  { id: 'market', label: 'Market', kinds: ['market'] },
  { id: 'earnings', label: 'Earnings', kinds: ['earnings'] },
  { id: 'away', label: 'Away', kinds: ['away'] },
  { id: 'salvage', label: 'Salvage', kinds: ['salvage'] },
  { id: 'dispatch', label: 'Dispatch', kinds: ['dispatch'] },
  { id: 'endless', label: 'Endless', kinds: ['endless'] },
  { id: 'system', label: 'System', kinds: ['settlement', 'system'] },
];

export function ActivityLogScreen() {
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chipId, setChipId] = useState('all');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selected, setSelected] = useState<ActivityRecord | null>(null);
  const requestSeq = useRef(0);

  const chip = useMemo(() => CHIPS.find((c) => c.id === chipId) ?? CHIPS[0], [chipId]);

  // Search applies on a short debounce — one box, server-side.
  // The loading flip rides the timer callback with the query, so
  // no state is set synchronously in an effect body.
  useEffect(() => {
    if (query.trim() === appliedQuery) return;
    const t = setTimeout(() => {
      setAppliedQuery(query.trim());
      setLoading(true);
    }, 350);
    return () => clearTimeout(t);
  }, [query, appliedQuery]);

  // First-page load, house pattern: the service promise's own
  // callbacks write state (ProfileScreen's shape), with a sequence
  // guard so a slow earlier page can never overwrite a newer one.
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const seq = ++requestSeq.current;
    fetchActivityLog({ kinds: chip.kinds, q: appliedQuery || undefined, limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled || requestSeq.current !== seq) return;
        setRecords(page.records);
        setNextCursor(page.nextCursor);
        setError(null);
      })
      .catch(() => {
        if (cancelled || requestSeq.current !== seq) return;
        setError('The record could not be read. Your history is safe on the server — try again.');
        setRecords([]);
        setNextCursor(null);
      })
      .finally(() => {
        if (!cancelled && requestSeq.current === seq) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [chip, appliedQuery, retryNonce]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const page = await fetchActivityLog({
        kinds: chip.kinds, q: appliedQuery || undefined, cursor: nextCursor, limit: PAGE_SIZE,
      });
      if (requestSeq.current !== seq) return;
      setRecords((prev) => [...prev, ...page.records]);
      setNextCursor(page.nextCursor);
    } catch {
      if (requestSeq.current === seq) setError('Older facts could not be read — try again.');
    } finally {
      if (requestSeq.current === seq) setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, chip, appliedQuery]);

  const bands = useMemo(() => bandStream(decorateStream(records)), [records]);
  const oldest = records.length > 0 ? records[records.length - 1] : null;
  const endDate = oldest
    ? new Date(oldest.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="bl-page space-y-3 p-4 pb-20">
      {/* Search — one box across items, enemies, and areas. */}
      <div className="flex h-11 items-center gap-2 border-2 border-border bg-surface px-3" style={slashClip}>
        <span className="shrink-0 text-text-muted"><PxIcon name="search" size={16} /></span>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search items, enemies, areas…"
          aria-label="Search the activity log"
          data-testid="activity-search"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-text-primary outline-none placeholder:text-text-muted"
        />
        <span className="shrink-0 text-[11px] font-black uppercase tracking-[0.08em] text-text-muted" data-testid="activity-count">
          {records.length} {records.length === 1 ? 'fact' : 'facts'}{nextCursor ? '+' : ''}
        </span>
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="flex h-8 w-8 shrink-0 items-center justify-center text-text-muted"
          >
            <PxIcon name="x" size={13} />
          </button>
        )}
      </div>

      {/* Kind rail — scrolls, never shrinks. */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Filter by kind">
        {CHIPS.map((c) => {
          const active = c.id === chipId;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`activity-chip-${c.id}`}
              onClick={() => { setChipId(c.id); setLoading(true); }}
              className={`flex min-h-[44px] shrink-0 items-center px-3 text-[11px] font-black uppercase tracking-[0.08em] ${
                active ? 'bg-amber text-black' : 'border border-border bg-surface text-text-secondary'
              }`}
              style={slashClip}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {loading && (
        <p className="py-10 text-center text-[12px] font-semibold text-text-muted">Reading the record…</p>
      )}

      {!loading && error && records.length === 0 && (
        <div className="bl-panel p-4 text-center">
          <p className="text-[13px] font-bold text-text-primary">{error}</p>
          <button type="button" onClick={() => { setLoading(true); setRetryNonce((n) => n + 1); }} className="bl-primary mt-3 px-4 py-2.5 text-[12px] font-black uppercase tracking-[0.08em]">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && records.length === 0 && (
        <div className="bl-panel p-4 text-center">
          {appliedQuery ? (
            <>
              <p className="text-[13px] font-bold text-text-primary">
                Nothing in the record matches "{appliedQuery}".
              </p>
              <p className="mt-1 text-[12px] text-text-secondary">
                Search covers item names, enemy names, and area names.
              </p>
              <button type="button" onClick={() => setQuery('')} className="bl-primary mt-3 px-4 py-2.5 text-[12px] font-black uppercase tracking-[0.08em]">
                Clear search
              </button>
            </>
          ) : chip.id !== 'all' ? (
            <p className="text-[13px] font-bold text-text-primary">
              No {chip.label.toLowerCase()} facts yet — they'll land here as you play.
            </p>
          ) : (
            <p className="text-[13px] font-bold text-text-primary">
              Nothing recorded yet — your first hunt starts the record.
            </p>
          )}
        </div>
      )}

      {!loading && bands.map((band) => (
        <section key={band.key} aria-label={band.label}>
          <div className="mb-2 mt-1 flex items-center gap-2">
            <h2 className="text-[13px] font-black uppercase tracking-[0.18em] text-text-primary">{band.label}</h2>
            <span className="h-px flex-1 bg-white/10" aria-hidden />
          </div>
          <div className="space-y-2">
            {band.entries.map(({ record, awayDivider, receiptsDivider }) => (
              <div key={record.id}>
                {awayDivider && (
                  <div className="mb-2 flex items-center gap-2 border border-[#3B82F6]/50 bg-[#3B82F6]/10 px-3 py-2.5" style={slashClip}>
                    <span className="shrink-0 text-[#3B82F6]"><PxIcon name="clock" size={16} /></span>
                    <div>
                      <div className="text-[12px] font-black uppercase tracking-[0.12em] text-text-primary">While you were away</div>
                      <div className="text-[11px] text-text-secondary">Settled by the offline pass — every entry below keeps its receipt.</div>
                    </div>
                  </div>
                )}
                {receiptsDivider && (
                  <div className="mb-2 border border-amber/40 bg-amber/10 px-3 py-2.5" style={slashClip}>
                    <div className="text-[12px] font-black uppercase tracking-[0.12em] text-amber">Receipts begin here</div>
                    <div className="text-[11px] text-text-secondary">
                      Earlier drops predate item records — the log shows them, it just can't source them.
                    </div>
                  </div>
                )}
                <ActivityRecordCard record={record} onSelect={setSelected} />
              </div>
            ))}
          </div>
        </section>
      ))}

      {!loading && records.length > 0 && (
        <div className="pt-1">
          {error && <p className="mb-2 text-center text-[12px] font-semibold text-[#FF4B5C]">{error}</p>}
          {nextCursor ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              data-testid="activity-load-more"
              className="bl-secondary flex min-h-[44px] w-full items-center justify-center gap-2 px-4 text-[12px] font-black uppercase tracking-[0.08em] disabled:opacity-60"
            >
              {loadingMore ? 'Reading older facts…' : 'Load older facts'}
              {!loadingMore && <PxIcon name="chevD" size={13} />}
            </button>
          ) : (
            <p className="py-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              End of the record{endDate ? ` — back to ${endDate}` : ''}
            </p>
          )}
        </div>
      )}

      <ActivityRecordSheet record={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
