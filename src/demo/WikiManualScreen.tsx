/**
 * WikiManualScreen — PROTOTYPE (design/field-manual-wiki-native,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * Owner direction (option 3, 2026-11-05): the Field Manual stops
 * being hand-written help text and renders the game's wiki natively.
 * This screen renders the REAL wiki/*.md corpus (wikiCorpus.ts loads
 * it byte-for-byte at build time) in Register B — Instrument Panel —
 * the register the owner picked for every other Hunter page today:
 * the Operator Console masthead, LCD bank and channel rows of the
 * manual-b anchor, adapted to a reading surface.
 *
 * Navigation is a real in-app stack: the index lists every wiki page
 * grouped by the wiki's own _Sidebar; tapping a row — or any
 * [[wikilink]] inside an article — pushes that page; BACK pops;
 * INDEX resets. Prev / Next keys walk the sidebar order.
 */
import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { ConsoleStyles, Lamp, Lcd, PushBtn, Rack, RackHead, Readout } from './consoleKit';
import { CK } from './consoleTokens';
import { WIKI_GROUPS, WIKI_ORDER, WIKI_PAGES, WIKI_STATS, resolveWikiPage, type WikiPage } from './wikiCorpus';
import { renderWikiMarkdown } from './wikiMarkdown';

const GROUP_OF = new Map<string, string>();
for (const g of WIKI_GROUPS) for (const p of g.pages) GROUP_OF.set(p.id, g.label);
const ORDER_INDEX = new Map(WIKI_ORDER.map((p, i) => [p.id, i]));

export const WikiManualScreen: React.FC<{ initialDoc?: string | null }> = ({ initialDoc }) => {
  const start = initialDoc ? resolveWikiPage(initialDoc) : null;
  const [stack, setStack] = React.useState<string[]>(start ? [start.id] : []);
  const [query, setQuery] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);

  const current: WikiPage | null =
    stack.length > 0 ? WIKI_PAGES.find((p) => p.id === stack[stack.length - 1]) ?? null : null;

  React.useEffect(() => {
    rootRef.current?.scrollIntoView({ block: 'start' });
  }, [stack]);

  const openPage = React.useCallback((id: string) => {
    setStack((s) => (s[s.length - 1] === id ? s : [...s, id]));
  }, []);
  const goBack = React.useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const goIndex = React.useCallback(() => setStack([]), []);

  const ctx = React.useMemo(() => ({ openPage }), [openPage ]);

  const q = query.trim().toLowerCase();
  const visibleGroups = WIKI_GROUPS.map((g) => ({
    ...g,
    pages: q ? g.pages.filter((p) => p.title.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : g.pages,
  })).filter((g) => g.pages.length > 0);
  const visibleCount = visibleGroups.reduce((n, g) => n + g.pages.length, 0);

  let channelSeq = 0;

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <ConsoleStyles />

      {/* ── Masthead: the unit plate ─────────────────────────── */}
      <Rack>
        <div
          className="flex min-h-[36px] items-center gap-2 px-3"
          style={{ borderBottom: `1px solid ${CK.bezel}`, boxShadow: '0 1px 0 rgba(0,0,0,0.6)' }}
        >
          <Lamp state="ok" />
          <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: CK.boneDim }}>
            Unit FM-09 · Field Manual
          </span>
          <Readout color={CK.green}>Wiki Uplink</Readout>
        </div>
        <div className="flex items-center gap-3 px-4 pt-3">
          <PxIcon name="book" size={30} style={{ color: CK.bone }} />
          <h1
            className="flex-1"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, lineHeight: 1, letterSpacing: '0.03em', color: CK.bone }}
          >
            Field Manual
          </h1>
        </div>
        <p className="px-4 pb-3 pt-1.5 text-[13px] leading-snug" style={{ color: CK.boneDim }}>
          The game&apos;s wiki, rendered natively — the same pages the GitHub wiki publishes, read off the rig.
        </p>
        <div className="grid grid-cols-3 gap-2 px-3 pb-3">
          <Lcd label="Pages" value={WIKI_STATS.pages} />
          <Lcd label="Links" value={WIKI_STATS.links} />
          <Lcd label="Source" value="Wiki/*.md" valueColor={CK.amber} />
        </div>
      </Rack>

      {current === null ? (
        <>
          {/* ── Index query ─────────────────────────────────── */}
          <Rack testId="wiki-filter">
            <RackHead
              icon={<PxIcon name="search" size={15} style={{ color: CK.label }} />}
              label="Index Query"
              readout={<Readout>{`Showing ${visibleCount}/${WIKI_STATS.pages}`}</Readout>}
            />
            <div className="p-3">
              <div
                className="flex items-center px-3"
                style={{
                  background: CK.lcd,
                  boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.05)',
                }}
              >
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter pages…"
                  aria-label="Filter wiki pages"
                  className="min-h-[44px] w-full bg-transparent text-[15px] font-semibold outline-none"
                  style={{ color: CK.bone, caretColor: CK.amber }}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear filter"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center"
                  >
                    <PxIcon name="x" size={14} style={{ color: CK.label }} />
                  </button>
                )}
              </div>
            </div>
          </Rack>

          {/* ── Index: channel select over the sidebar groups ── */}
          <Rack testId="wiki-index">
            <RackHead
              icon={<PxIcon name="book" size={15} style={{ color: CK.label }} />}
              label="Contents — Page Select"
              readout={<Readout>{q ? `${visibleCount} match${visibleCount === 1 ? '' : 'es'}` : 'Awaiting select'}</Readout>}
            />
            <div className="px-3 py-2">
              {visibleGroups.length === 0 && (
                <p className="py-4 text-[13px]" style={{ color: CK.label }}>
                  No page matches that query. Clear the filter to see the full index.
                </p>
              )}
              {visibleGroups.map((group) => (
                <div key={group.label} className="py-1.5">
                  <div className="flex items-baseline gap-2 pb-1 pt-2">
                    <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: CK.amber }}>
                      {group.label}
                    </span>
                    <Readout>{`${group.pages.length} pages`}</Readout>
                  </div>
                  {group.pages.map((page) => {
                    channelSeq += 1;
                    const seq = channelSeq;
                    return (
                      <button
                        key={page.id}
                        type="button"
                        data-page={page.id}
                        onClick={() => openPage(page.id)}
                        className="flex min-h-[52px] w-full items-center gap-3 px-1.5 text-left"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                      >
                        <span className="ck-num w-[52px] shrink-0 text-[12px] font-bold tracking-[0.08em]" style={{ color: CK.label }}>
                          {`PG-${String(seq).padStart(2, '0')}`}
                        </span>
                        <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug" style={{ color: CK.bone }}>
                          {page.title}
                        </span>
                        {page.generated && <Readout color={CK.amber}>Data</Readout>}
                        <PxIcon name="chevR" size={13} style={{ color: CK.label, flexShrink: 0 }} />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Rack>
        </>
      ) : (
        <>
          {/* ── Article controls ─────────────────────────────── */}
          <Rack>
            <div className="flex items-stretch gap-2 p-2.5">
              <PushBtn onClick={goBack} className="shrink-0" ariaLabel={stack.length > 1 ? 'Back to previous page' : 'Back to index'}>
                <PxIcon name="chevL" size={13} />
                {stack.length > 1 ? 'Back' : 'Index'}
              </PushBtn>
              <div
                className="flex min-w-0 flex-1 flex-col justify-center px-3"
                style={{
                  background: CK.lcd,
                  boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.05)',
                }}
              >
                <span className="text-[11px] font-semibold uppercase leading-none tracking-[0.14em]" style={{ color: CK.label }}>
                  {`Doc · ${GROUP_OF.get(current.id) ?? 'Wiki'}`}
                </span>
                <span className="ck-num mt-1 truncate text-[15px] font-bold leading-none" style={{ color: CK.amber }}>
                  {current.id}
                </span>
              </div>
              <PushBtn onClick={goIndex} className="shrink-0" ariaLabel="Back to the index">
                <PxIcon name="book" size={14} />
                Index
              </PushBtn>
            </div>
          </Rack>

          {/* ── Article body ─────────────────────────────────── */}
          <Rack testId="wiki-article">
            <div className="px-4 py-4">{renderWikiMarkdown(current.markdown, ctx)}</div>
            <div
              className="flex items-center gap-2 px-3 py-2.5"
              style={{ borderTop: `1px solid ${CK.bezel}` }}
            >
              <Lamp state="ok" size={8} />
              <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: CK.label }}>
                End of page — source wiki/{current.id}.md
              </span>
              <Readout>{`${(ORDER_INDEX.get(current.id) ?? 0) + 1} of ${WIKI_ORDER.length}`}</Readout>
            </div>
          </Rack>

          {/* ── Prev / Next along the sidebar order ──────────── */}
          <div className="flex gap-2">
            <PushBtn
              className="flex-1"
              disabled={(ORDER_INDEX.get(current.id) ?? 0) === 0}
              onClick={() => {
                const prev = WIKI_ORDER[(ORDER_INDEX.get(current.id) ?? 0) - 1];
                if (prev) {
                  setStack((s) => [...s.slice(0, -1), prev.id]);
                }
              }}
            >
              <PxIcon name="chevL" size={13} /> Prev page
            </PushBtn>
            <PushBtn
              className="flex-1"
              disabled={(ORDER_INDEX.get(current.id) ?? 0) >= WIKI_ORDER.length - 1}
              onClick={() => {
                const next = WIKI_ORDER[(ORDER_INDEX.get(current.id) ?? 0) + 1];
                if (next) {
                  setStack((s) => [...s.slice(0, -1), next.id]);
                }
              }}
            >
              Next page <PxIcon name="chevR" size={13} />
            </PushBtn>
          </div>
        </>
      )}
    </div>
  );
};
