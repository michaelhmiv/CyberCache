/**
 * ManualGalleryPage — PROTOTYPE (design/hunter-subpages-manual-c,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Field Manual reimagined in the Showcase register — the
 * manual as an EXHIBITION. Variant A hung the same content as a
 * stamped book of machined plates: masthead plate, gauge wells,
 * contents as numbered plates, entries as ruled documents. Here
 * every device of that grammar is deleted. The page opens on a
 * wall label — the title in clean oversized Bebas, the shipped
 * blurb as wall text — and the manual's eight sections hang as
 * exhibited pieces, each on the game's own art for its subject:
 * zone paintings full-bleed, a bespoke legendary and the cache
 * crate as object pieces on spotlit ground, the Dune Tyrant
 * standing in its arena for Boss Fights. Nothing is printed on
 * the art; the caption below each piece carries the section's
 * title, its shipped blurb, and its entry count.
 *
 * The guided tour is the featured exhibit: it hangs first and
 * largest, its current step as the caption's subject, and opens
 * into a viewing room where the steps advance exactly as the
 * shipped tour's controls do. Search is a real filter, kept from
 * the shipped screen's semantics — matching entries become an
 * index of captions that jump straight to their section room.
 *
 * Content is the shipped manual verbatim (SECTIONS / TOUR_STEPS
 * imported from HelpScreen — this pass designs the CONTAINER
 * only). The incumbent's per-section decorative colors and
 * unicode glyphs are dropped: in this register color is light
 * and action, never a section's paint.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { SECTIONS, TOUR_STEPS, type HelpSection } from '@/screens/HelpScreen';
import {
  AMBER,
  BODY,
  BONE,
  DISPLAY,
  FAINT,
  GROUND,
  HAIR,
  SECTION_ART,
  TOUR_ART,
  resolveArt,
  type SectionArt,
} from './manualGalleryModel';

type ManualView = { kind: 'index' } | { kind: 'tour' } | { kind: 'section'; id: string };

export interface ManualGalleryPageProps {
  initialView?: 'index' | 'tour' | 'section';
  initialSection?: string;
  initialTourStep?: number;
}

const TOTAL_ENTRIES = SECTIONS.reduce((n, s) => n + s.items.length, 0);

/** A hung piece: the game's art, edge to edge, nothing printed on it. */
const ArtFigure: React.FC<{ art: SectionArt; heightClass: string; testId?: string }> = ({
  art,
  heightClass,
  testId,
}) => {
  const resolved = resolveArt(art);
  return (
    <figure
      data-testid={testId}
      className={`relative w-full overflow-hidden ${heightClass}`}
      style={{ backgroundColor: GROUND, borderBottom: `1px solid ${HAIR}` }}
    >
      {resolved.paintingUrl && (
        <img
          src={resolved.paintingUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ imageRendering: 'pixelated' }}
          draggable={false}
        />
      )}
      {resolved.bossArenaUrl && (
        <>
          <img
            src={resolved.bossArenaUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ imageRendering: 'pixelated' }}
            draggable={false}
          />
          <img
            src={resolved.bossSpriteUrl}
            alt="Dune Tyrant"
            className="absolute bottom-0 left-1/2 h-[86%] -translate-x-1/2"
            style={{ imageRendering: 'pixelated' }}
            draggable={false}
          />
        </>
      )}
      {resolved.objectUrl && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background:
              'radial-gradient(115% 90% at 50% 32%, #2C1E0E 0%, #171008 62%, #100B06 100%)',
          }}
        >
          <img
            src={resolved.objectUrl}
            alt=""
            className="h-[72%] max-w-[78%] object-contain"
            style={{ imageRendering: 'pixelated' }}
            draggable={false}
          />
        </div>
      )}
    </figure>
  );
};

/** Progress as a single thread of light — the register's only gauge. */
const Thread: React.FC<{ value: number; max: number }> = ({ value, max }) => (
  <div className="h-[2px] w-full" style={{ backgroundColor: HAIR }}>
    <div
      className="h-full transition-all duration-500"
      style={{ width: `${(value / max) * 100}%`, backgroundColor: AMBER }}
    />
  </div>
);

const BackDoor: React.FC<{ label: string; onClick: () => void; testId?: string }> = ({
  label,
  onClick,
  testId,
}) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="flex min-h-[48px] items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] transition-transform active:scale-[0.97]"
    style={{ color: FAINT }}
  >
    <PxIcon name="chevL" size={13} style={{ color: FAINT }} />
    {label}
  </button>
);

export const ManualGalleryPage: React.FC<ManualGalleryPageProps> = ({
  initialView = 'index',
  initialSection = 'loot',
  initialTourStep = 2,
}) => {
  const [view, setView] = useState<ManualView>(() =>
    initialView === 'section' ? { kind: 'section', id: initialSection } : { kind: initialView },
  );
  const [query, setQuery] = useState('');
  const [tourStep, setTourStep] = useState(initialTourStep);

  const searching = query.trim().length > 0;
  const matches = useMemo(() => {
    if (!searching) return [];
    const lower = query.toLowerCase();
    return SECTIONS.flatMap((s) =>
      s.items
        .filter((it) => it.term.toLowerCase().includes(lower) || it.body.toLowerCase().includes(lower))
        .map((it) => ({ section: s, item: it })),
    );
  }, [query, searching]);

  // A room change starts at the room's top — the exhibition's
  // scroll container keeps its position across views otherwise.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: 'start' });
  }, [view]);

  const openSection = (id: string) => setView({ kind: 'section', id });
  const sectionIndex = view.kind === 'section' ? SECTIONS.findIndex((s) => s.id === view.id) : -1;
  const section: HelpSection | undefined = sectionIndex >= 0 ? SECTIONS[sectionIndex] : undefined;
  const step = TOUR_STEPS[tourStep];

  return (
    <div data-testid="manual-gallery" ref={rootRef}>
      {view.kind === 'index' && (
        <>
          {/* ── THE WALL LABEL — title first, then the wall text ── */}
          <header className="px-5 pt-10">
            <h1
              className="text-[56px] leading-[0.95]"
              style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.01em' }}
            >
              Field Manual
            </h1>
            <p className="mt-4 max-w-[36ch] text-[14px] leading-[1.65]" style={{ color: BODY }}>
              Pinned notes for loot, combat, caches, and buildcraft.
            </p>
            <div
              className="mt-6 flex items-baseline gap-5 text-[11px] font-bold uppercase tracking-[0.18em]"
              style={{ color: FAINT }}
            >
              <span>
                {SECTIONS.length} sections
              </span>
              <span>{TOTAL_ENTRIES} entries</span>
              <span>
                {TOUR_STEPS.length} tour stops
              </span>
            </div>
          </header>

          {/* ── SEARCH — a line on the wall, not a form ─────────── */}
          <div className="px-5">
            <div
              className="mt-7 flex min-h-[48px] items-center gap-3 border-b transition-colors focus-within:border-[#FF9000]"
              style={{ borderColor: HAIR }}
            >
              <PxIcon name="search" size={16} style={{ color: FAINT }} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the manual..."
                aria-label="Search the manual"
                data-testid="gallery-search-input"
                className="min-w-0 flex-1 bg-transparent text-[14px] focus:outline-none"
                style={{ color: BONE }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center"
                  style={{ color: FAINT }}
                >
                  <PxIcon name="x" size={13} />
                </button>
              )}
            </div>
          </div>

          {searching ? (
            <>
              {/* ── THE INDEX — search results as captions ──────── */}
              <div className="px-5 pt-8">
                <div
                  className="text-[11px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: FAINT }}
                >
                  {matches.length} match{matches.length === 1 ? '' : 'es'}
                </div>
              </div>
              {matches.length === 0 ? (
                <p className="px-5 pt-4 text-[13px] leading-[1.65]" style={{ color: BODY }}>
                  No entries match &ldquo;{query.trim()}&rdquo;. Try a shorter word.
                </p>
              ) : (
                <div className="pt-2">
                  {matches.map(({ section: s, item }) => (
                    <button
                      key={`${s.id}-${item.term}`}
                      type="button"
                      onClick={() => openSection(s.id)}
                      data-testid={`match-${s.id}-${item.term}`}
                      className="block w-full px-5 py-4 text-left transition-transform active:scale-[0.99]"
                      style={{ borderBottom: `1px solid ${HAIR}` }}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-[15px] font-semibold" style={{ color: BONE }}>
                          {item.term}
                        </span>
                        <span
                          className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em]"
                          style={{ color: FAINT }}
                        >
                          {s.title}
                        </span>
                      </span>
                      <span
                        className="mt-1 line-clamp-2 block text-[12.5px] leading-[1.55]"
                        style={{ color: BODY }}
                      >
                        {item.body}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* ── FEATURED EXHIBIT — Orientation, the guided tour ── */}
              <section className="pt-12" data-testid="gallery-featured">
                <ArtFigure art={TOUR_ART} heightClass="h-[296px]" testId="featured-art" />
                <div className="px-5 pt-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2
                      className="text-[30px] leading-none"
                      style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.02em' }}
                    >
                      Orientation
                    </h2>
                    <span
                      className="shrink-0 text-[12px] font-bold tabular-nums"
                      style={{ color: FAINT }}
                    >
                      Step {tourStep + 1} of {TOUR_STEPS.length}
                    </span>
                  </div>
                  <div className="mt-3 text-[15px] font-semibold" style={{ color: BONE }}>
                    {step.title}
                  </div>
                  <p className="mt-1.5 text-[13.5px] leading-[1.65]" style={{ color: BODY }}>
                    {step.body}
                  </p>
                  <div className="mt-4">
                    <Thread value={tourStep + 1} max={TOUR_STEPS.length} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setView({ kind: 'tour' })}
                    data-testid="featured-enter-tour"
                    className="flex min-h-[48px] items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] transition-transform active:scale-[0.97]"
                    style={{ color: AMBER }}
                  >
                    Open the guided tour
                    <PxIcon name="chevR" size={13} style={{ color: AMBER }} />
                  </button>
                </div>
              </section>

              {/* ── THE HANG — eight sections, eight pieces ─────── */}
              <main>
                {SECTIONS.map((s) => (
                  <section key={s.id} className="pt-14">
                    <button
                      type="button"
                      onClick={() => openSection(s.id)}
                      data-testid={`piece-${s.id}`}
                      aria-label={`${s.title} — open section`}
                      className="block w-full text-left transition-transform active:scale-[0.995]"
                    >
                      <ArtFigure art={SECTION_ART[s.id]} heightClass="h-[208px]" />
                      <span className="block px-5 pt-4">
                        <span
                          className="block text-[26px] leading-none"
                          style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.02em' }}
                        >
                          {s.title}
                        </span>
                        <span
                          className="mt-2 block text-[13.5px] leading-[1.6]"
                          style={{ color: BODY }}
                        >
                          {s.blurb}
                        </span>
                        <span
                          className="mt-2.5 block text-[11px] font-bold uppercase tracking-[0.18em]"
                          style={{ color: FAINT }}
                        >
                          {s.items.length} entries
                        </span>
                      </span>
                    </button>
                  </section>
                ))}
              </main>

              {/* ── COLOPHON ─────────────────────────────────────── */}
              <footer className="mt-16 px-5 pb-12" style={{ borderTop: `1px solid ${HAIR}` }}>
                <div
                  className="pt-5 text-[15px]"
                  style={{ fontFamily: DISPLAY, color: FAINT, letterSpacing: '0.03em' }}
                >
                  Field Manual
                </div>
                <p className="mt-1.5 text-[12.5px] leading-[1.6]" style={{ color: FAINT }}>
                  {SECTIONS.length} sections · {TOTAL_ENTRIES} entries — the game, explained in
                  its own words.
                </p>
              </footer>
            </>
          )}
        </>
      )}

      {view.kind === 'tour' && (
        <div data-testid="tour-room">
          {/* ── VIEWING ROOM — the tour, one step on the wall ───── */}
          <div className="flex items-center justify-between px-5 pt-3">
            <BackDoor label="Index" onClick={() => setView({ kind: 'index' })} testId="tour-back" />
            <span
              className="text-[11px] font-bold uppercase tracking-[0.18em]"
              style={{ color: FAINT }}
            >
              The guided tour
            </span>
          </div>
          <ArtFigure art={TOUR_ART} heightClass="h-[190px]" testId="tour-art" />
          <div className="px-5 pt-6">
            <div
              className="text-[12px] font-bold tabular-nums uppercase tracking-[0.18em]"
              style={{ color: FAINT }}
            >
              Step {tourStep + 1} of {TOUR_STEPS.length}
            </div>
            <h2
              className="mt-2.5 text-[32px] leading-[1.02]"
              style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.02em' }}
            >
              {step.title}
            </h2>
            <p className="mt-3.5 text-[14px] leading-[1.7]" style={{ color: BODY }}>
              {step.body}
            </p>
            <div
              className="mt-6 flex items-baseline gap-2 pt-4 text-[12.5px]"
              style={{ borderTop: `1px solid ${HAIR}` }}
            >
              <span style={{ color: FAINT }}>On view —</span>
              <span className="font-semibold" style={{ color: BONE }}>
                {step.target.label}
              </span>
              <span style={{ color: FAINT }}>· {step.spotlight}</span>
            </div>
            <div className="mt-6">
              <Thread value={tourStep + 1} max={TOUR_STEPS.length} />
            </div>
            <button
              type="button"
              onClick={() => setTourStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))}
              data-testid="tour-cta"
              className="mt-6 flex min-h-[52px] w-full items-center justify-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] transition-transform active:scale-[0.98]"
              style={{ border: `1px solid ${HAIR}`, color: BONE }}
            >
              {step.cta}
              <PxIcon name="chevR" size={13} style={{ color: AMBER }} />
            </button>
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setTourStep((s) => Math.max(0, s - 1))}
                disabled={tourStep === 0}
                className="flex min-h-[48px] items-center gap-1.5 px-2 text-[12px] font-bold uppercase tracking-[0.14em] disabled:opacity-30"
                style={{ color: FAINT }}
              >
                <PxIcon name="chevL" size={12} />
                Back
              </button>
              <button
                type="button"
                onClick={() => setTourStep(0)}
                className="min-h-[48px] px-2 text-[12px] font-bold uppercase tracking-[0.14em]"
                style={{ color: FAINT }}
              >
                Restart
              </button>
              <button
                type="button"
                onClick={() => setTourStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))}
                disabled={tourStep === TOUR_STEPS.length - 1}
                className="flex min-h-[48px] items-center gap-1.5 px-2 text-[12px] font-bold uppercase tracking-[0.14em] disabled:opacity-30"
                style={{ color: FAINT }}
              >
                Next
                <PxIcon name="chevR" size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {view.kind === 'section' && section && (
        <div data-testid={`room-${section.id}`}>
          {/* ── SECTION ROOM — one piece, read at caption pace ── */}
          <div className="flex items-center justify-between px-5 pt-3">
            <BackDoor
              label="Index"
              onClick={() => setView({ kind: 'index' })}
              testId="room-back"
            />
            <span
              className="text-[11px] font-bold tabular-nums uppercase tracking-[0.18em]"
              style={{ color: FAINT }}
            >
              Section {sectionIndex + 1} of {SECTIONS.length}
            </span>
          </div>

          {/* Contents as a word rail — the exhibition's running order. */}
          <nav
            className="flex gap-6 overflow-x-auto px-5 pb-1"
            data-testid="room-contents-rail"
            aria-label="Sections"
          >
            {SECTIONS.map((s) => {
              const current = s.id === section.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSection(s.id)}
                  className="relative min-h-[44px] shrink-0 whitespace-nowrap text-[12px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: current ? BONE : FAINT }}
                >
                  {s.title}
                  {current && (
                    <span
                      className="absolute inset-x-0 bottom-0 h-[2px]"
                      style={{ backgroundColor: AMBER }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="pt-3">
            <ArtFigure art={SECTION_ART[section.id]} heightClass="h-[190px]" testId="room-art" />
          </div>

          <div className="px-5 pt-6">
            <h2
              className="text-[36px] leading-[0.98]"
              style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.02em' }}
            >
              {section.title}
            </h2>
            <p className="mt-2.5 text-[14px] leading-[1.65]" style={{ color: BODY }}>
              {section.blurb}
            </p>
            <div
              className="mt-3 text-[11px] font-bold uppercase tracking-[0.18em]"
              style={{ color: FAINT }}
            >
              {section.items.length} entries
            </div>
          </div>

          {/* Entries as exhibit captions: term, then the text itself. */}
          <div className="px-5">
            {section.items.map((item, i) => (
              <article
                key={item.term}
                className={i > 0 ? 'mt-8 pt-8' : 'mt-9'}
                style={i > 0 ? { borderTop: `1px solid ${HAIR}` } : undefined}
              >
                <h3 className="text-[16px] font-semibold leading-snug" style={{ color: BONE }}>
                  {item.term}
                </h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.7]" style={{ color: BODY }}>
                  {item.body}
                </p>
              </article>
            ))}
          </div>

          {/* Foot doors — the way through the exhibition. */}
          <div
            className="mt-12 grid grid-cols-2"
            style={{ borderTop: `1px solid ${HAIR}` }}
          >
            {[
              { target: sectionIndex - 1, label: 'Previous', align: 'left' as const },
              { target: sectionIndex + 1, label: 'Next', align: 'right' as const },
            ].map(({ target, label, align }) => {
              const dest = SECTIONS[target];
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => (dest ? openSection(dest.id) : setView({ kind: 'index' }))}
                  className={`min-h-[68px] px-5 py-3.5 ${align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  <span
                    className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em]"
                    style={{
                      color: FAINT,
                      justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {align === 'left' && <PxIcon name="chevL" size={11} />}
                    {label}
                    {align === 'right' && <PxIcon name="chevR" size={11} />}
                  </span>
                  <span
                    className="mt-1 block truncate text-[17px]"
                    style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.03em' }}
                  >
                    {dest ? dest.title : 'Index'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
