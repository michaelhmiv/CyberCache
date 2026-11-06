/**
 * HelpScreen — the Field Manual (owner option 3, 2026-11-05).
 *
 * The manual stopped being hand-written help text: this screen
 * renders the game's own wiki (repo `wiki/*.md`, bundled at build
 * time — see src/lib/wiki/wikiCorpus.ts) natively, in Register B —
 * Instrument Panel — the register the owner picked for every Hunter
 * sub-page: the Operator Console masthead, LCD bank and channel
 * rows, adapted to a reading surface. The hand-written sections
 * and the guided tour that used to live in this file are retired —
 * the wiki is the manual now, and there is no state of the app
 * with neither.
 *
 * Navigation is a real in-app stack: the index lists every wiki
 * page grouped by the wiki's own _Sidebar; tapping a row — or any
 * [[wikilink]] inside an article — pushes that page; BACK pops;
 * INDEX resets. Prev / Next keys walk the sidebar order. Android
 * hardware back walks the same stack and, at the index, leaves the
 * sub-screen through the host's onExit — the same contract the
 * sub-screen header's Back button offers.
 *
 * Deep links: the host routes 'help' (index) and 'help:<Page>'
 * (straight to that page) here via initialPageId/intentSeq.
 */
import React from 'react';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  ConsoleStyles,
  Lamp,
  Lcd,
  PushBtn,
  Rack,
  RackHead,
  Readout,
} from '@/components/profile/manualConsoleKit';
import { CK } from '@/components/profile/manualConsoleTokens';
import {
  WIKI_GROUPS,
  WIKI_ORDER,
  WIKI_STATS,
  getLoadedWikiPage,
  getWikiLinkCount,
  loadWikiPage,
  preloadWikiCorpus,
  resolveWikiPage,
  searchWikiText,
  subscribeWikiCorpus,
  wikiCorpusReady,
  type WikiPage,
} from '@/lib/wiki/wikiCorpus';
import { renderWikiMarkdown } from '@/lib/wiki/wikiMarkdown';

const GROUP_OF = new Map<string, string>();
for (const g of WIKI_GROUPS) for (const p of g.pages) GROUP_OF.set(p.id, g.label);
const ORDER_INDEX = new Map(WIKI_ORDER.map((p, i) => [p.id, i]));

export interface HelpScreenProps {
  /** Deep-link target: a wiki page id or title, or null for the index. */
  initialPageId?: string | null;
  /** Bumped by the host on every 'help' navigation; a change re-applies initialPageId. */
  intentSeq?: number;
  /** Leave the sub-screen (the host's Back). Hardware back at the index calls this. */
  onExit?: () => void;
}

export const HelpScreen: React.FC<HelpScreenProps> = ({ initialPageId = null, intentSeq = 0, onExit }) => {
  const start = initialPageId ? resolveWikiPage(initialPageId) : null;
  const [stack, setStack] = React.useState<string[]>(start ? [start.id] : []);
  const [query, setQuery] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Corpus convergence: the background preload lands H1 titles, the
  // link count and search readiness after first paint — re-render
  // as each arrives.
  const [, setCorpusTick] = React.useState(0);
  React.useEffect(() => subscribeWikiCorpus(() => setCorpusTick((t) => t + 1)), []);
  React.useEffect(() => {
    void preloadWikiCorpus();
  }, []);

  // Deep-link intents after mount (the host keeps this screen
  // mounted while the sub-screen is open).
  const lastIntentSeq = React.useRef(intentSeq);
  React.useEffect(() => {
    if (intentSeq === lastIntentSeq.current) return;
    lastIntentSeq.current = intentSeq;
    const target = initialPageId ? resolveWikiPage(initialPageId) : null;
    setStack(target ? [target.id] : []);
  }, [intentSeq, initialPageId]);

  const currentId = stack.length > 0 ? stack[stack.length - 1] : null;
  const currentMeta = currentId ? resolveWikiPage(currentId) : null;

  // The open page's body: cached pages render instantly (the cache
  // read is a pure Map lookup, and the corpus subscription above
  // re-renders when a load lands); a cold page shows the receiving
  // state until its chunk arrives through the async path.
  const [asyncPage, setAsyncPage] = React.useState<WikiPage | null>(null);
  React.useEffect(() => {
    if (!currentId || getLoadedWikiPage(currentId)) return undefined;
    let live = true;
    void loadWikiPage(currentId).then((page) => {
      if (live) setAsyncPage(page);
    });
    return () => {
      live = false;
    };
  }, [currentId]);
  const loaded: WikiPage | null = currentId
    ? (getLoadedWikiPage(currentId) ?? (asyncPage && asyncPage.id === currentId ? asyncPage : null))
    : null;

  React.useEffect(() => {
    // Guarded: scrollIntoView is absent in some hosts (tests, SSR).
    const el = rootRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start' });
    }
  }, [stack]);

  const openPage = React.useCallback((id: string) => {
    setStack((s) => (s[s.length - 1] === id ? s : [...s, id]));
  }, []);
  const goBack = React.useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const goIndex = React.useCallback(() => setStack([]), []);

  // Android hardware back: pop the reading stack first; at the
  // index, hand the press to the host (leaves the sub-screen). The
  // listener registers once; refs (kept fresh by an every-render
  // effect) carry the current stack and exit callback into it.
  const backRef = React.useRef<() => boolean>(() => false);
  const exitRef = React.useRef(onExit);
  React.useEffect(() => {
    backRef.current = () => {
      if (stack.length > 0) {
        goBack();
        return true;
      }
      return false;
    };
    exitRef.current = onExit;
  });
  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let handle: PluginListenerHandle | undefined;
    let live = true;
    void CapacitorApp.addListener('backButton', () => {
      if (!backRef.current()) exitRef.current?.();
    }).then((h) => {
      if (live) handle = h;
      else void h.remove();
    });
    return () => {
      live = false;
      if (handle) void handle.remove();
    };
  }, []);

  const ctx = React.useMemo(() => ({ openPage }), [openPage]);
  const articleBody = React.useMemo(
    () => (loaded && loaded.id === currentId ? renderWikiMarkdown(loaded.markdown, ctx) : null),
    [loaded, currentId, ctx],
  );

  const q = query.trim().toLowerCase();
  const visibleGroups = WIKI_GROUPS.map((g) => ({
    ...g,
    pages: q ? g.pages.filter((p) => p.title.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : g.pages,
  })).filter((g) => g.pages.length > 0);
  const titleMatchedIds = React.useMemo(
    () => new Set(visibleGroups.flatMap((g) => g.pages.map((p) => p.id))),
    [visibleGroups],
  );
  const visibleCount = visibleGroups.reduce((n, g) => n + g.pages.length, 0);
  const corpusReady = wikiCorpusReady();
  const textHits = q && corpusReady
    ? searchWikiText(query).filter((hit) => !titleMatchedIds.has(hit.page.id))
    : [];
  const linkCount = getWikiLinkCount();

  return (
    <div ref={rootRef} className="flex flex-col gap-3 p-3 pb-6">
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
          <Lcd label="Links" value={linkCount ?? '—'} />
          <Lcd label="Source" value="Wiki/*.md" valueColor={CK.amber} />
        </div>
      </Rack>

      {currentId === null ? (
        <>
          {/* ── Search: titles instantly, body text once indexed ── */}
          <Rack testId="wiki-filter">
            <RackHead
              icon={<PxIcon name="search" size={15} style={{ color: CK.label }} />}
              label="Index Query"
              readout={
                <Readout>
                  {q
                    ? `${visibleCount} pages · ${corpusReady ? `${textHits.length} text hits` : 'indexing…'}`
                    : `Showing ${visibleCount}/${WIKI_STATS.pages}`}
                </Readout>
              }
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

          {/* ── Body-text hits ────────────────────────────────── */}
          {q && textHits.length > 0 && (
            <Rack testId="wiki-search-hits">
              <RackHead
                icon={<PxIcon name="search" size={15} style={{ color: CK.label }} />}
                label="In the Text"
                readout={<Readout>{`${textHits.length} hit${textHits.length === 1 ? '' : 's'}`}</Readout>}
              />
              <div className="px-3 py-2">
                {textHits.map((hit) => {
                  const seq = (ORDER_INDEX.get(hit.page.id) ?? 0) + 1;
                  return (
                    <button
                      key={hit.page.id}
                      type="button"
                      data-page={hit.page.id}
                      onClick={() => openPage(hit.page.id)}
                      className="flex min-h-[52px] w-full items-start gap-3 px-1.5 py-2 text-left"
                      style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <span className="ck-num w-[52px] shrink-0 pt-0.5 text-[12px] font-bold tracking-[0.08em]" style={{ color: CK.label }}>
                        {`PG-${String(seq).padStart(2, '0')}`}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold leading-snug" style={{ color: CK.bone }}>
                          {hit.page.title}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug" style={{ color: CK.boneDim }}>
                          {hit.snippet}
                        </span>
                      </span>
                      <PxIcon name="chevR" size={13} style={{ color: CK.label, flexShrink: 0, marginTop: 4 }} />
                    </button>
                  );
                })}
              </div>
            </Rack>
          )}

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
                    const seq = (ORDER_INDEX.get(page.id) ?? 0) + 1;
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
                  {`Doc · ${GROUP_OF.get(currentId) ?? 'Wiki'}`}
                </span>
                <span className="ck-num mt-1 truncate text-[15px] font-bold leading-none" style={{ color: CK.amber }}>
                  {currentId}
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
            {articleBody ? (
              <>
                <div className="px-4 py-4">{articleBody}</div>
                <div
                  className="flex items-center gap-2 px-3 py-2.5"
                  style={{ borderTop: `1px solid ${CK.bezel}` }}
                >
                  <Lamp state="ok" size={8} />
                  <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: CK.label }}>
                    End of page — source wiki/{currentId}.md
                  </span>
                  <Readout>{`${(ORDER_INDEX.get(currentId) ?? 0) + 1} of ${WIKI_ORDER.length}`}</Readout>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2.5 px-4 py-6" data-testid="wiki-loading">
                <Lamp state="live" />
                <span className="text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: CK.boneDim }}>
                  {`Receiving ${currentMeta?.title ?? currentId}…`}
                </span>
              </div>
            )}
          </Rack>

          {/* ── Prev / Next along the sidebar order ──────────── */}
          <div className="flex gap-2">
            <PushBtn
              className="flex-1"
              disabled={(ORDER_INDEX.get(currentId) ?? 0) === 0}
              onClick={() => {
                const prev = WIKI_ORDER[(ORDER_INDEX.get(currentId) ?? 0) - 1];
                if (prev) {
                  setStack((s) => [...s.slice(0, -1), prev.id]);
                }
              }}
            >
              <PxIcon name="chevL" size={13} /> Prev page
            </PushBtn>
            <PushBtn
              className="flex-1"
              disabled={(ORDER_INDEX.get(currentId) ?? 0) >= WIKI_ORDER.length - 1}
              onClick={() => {
                const next = WIKI_ORDER[(ORDER_INDEX.get(currentId) ?? 0) + 1];
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
