/**
 * FieldManualBook — PROTOTYPE (design/hunter-subpages-wardrobe-manual,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Field Manual reimagined as a BOUND BOOK inside the Arena Plates
 * family — the deliberate opposite composition to the Wardrobe's
 * fitting stand. The shipped HelpScreen is a stack of MobileCards
 * (rarity side bar on every one) with accordion sections and entries
 * indented behind colored left borders. Here the world owns the
 * FRAME — a machined masthead plate, stamped section marks, contents
 * wayfinding — and the reading column inside stays calm: one long
 * page plate per section, entries divided by hairlines, body set at
 * a reading size with real leading.
 *
 * The cover IS the table of contents: the eight sections as stamped
 * index plates. The guided tour is the book's frontispiece —
 * "Orientation", the one amber stamp on the cover, because it is the
 * one action waiting. Search lives on the cover and returns an index
 * of matching entries that jump straight to their section page.
 *
 * Content is the shipped manual verbatim (SECTIONS / TOUR_STEPS are
 * imported from HelpScreen — this pass designs the CONTAINER only;
 * the stale tour text is a known debt owned by the papercut batch).
 * The incumbent's per-section decorative colors are dropped: in this
 * family color is data or action, never a section's paint.
 */
import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { SECTIONS, TOUR_STEPS, type HelpSection } from '@/screens/HelpScreen';
import { AMBER, BONE, BONE_FAINT, BONE_MUTED, Bolts, FootStrip, Gauge, STEEL, Stamp, pageShell, plateShell } from './plate';

type ManualView = { kind: 'cover' } | { kind: 'tour' } | { kind: 'section'; id: string };

export interface FieldManualBookProps {
  initialView?: 'cover' | 'tour' | 'section';
  initialSection?: string;
  initialTourStep?: number;
}

const TOTAL_ENTRIES = SECTIONS.reduce((n, s) => n + s.items.length, 0);

export const FieldManualBook: React.FC<FieldManualBookProps> = ({
  initialView = 'cover',
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

  const openSection = (id: string) => setView({ kind: 'section', id });
  const sectionIndex = view.kind === 'section' ? SECTIONS.findIndex((s) => s.id === view.id) : -1;
  const section: HelpSection | undefined = sectionIndex >= 0 ? SECTIONS[sectionIndex] : undefined;

  /** Contents rail — rides the section and tour views; the cover is its own contents. */
  const ContentsRail = (
    <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="manual-contents-rail">
      <button
        type="button"
        onClick={() => setView({ kind: 'cover' })}
        className="min-h-[44px] shrink-0 px-3 text-[11px] font-black uppercase tracking-wide"
        style={{
          border: `2px solid ${STEEL}`,
          color: BONE_MUTED,
          backgroundColor: 'rgba(6,5,4,0.6)',
        }}
      >
        Cover
      </button>
      {SECTIONS.map((s, i) => {
        const current = view.kind === 'section' && view.id === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => openSection(s.id)}
            className="min-h-[44px] shrink-0 px-3 text-[11px] font-black uppercase tracking-wide"
            style={
              current
                ? { backgroundColor: AMBER, color: '#000', boxShadow: '3px 3px 0 rgba(0,0,0,0.75)' }
                : { border: `2px solid ${STEEL}`, color: BONE_MUTED, backgroundColor: 'rgba(6,5,4,0.6)' }
            }
          >
            {String(i + 1).padStart(2, '0')} · {s.title}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="field-manual-book">
      {view.kind === 'cover' && (
        <>
          {/* ── MASTHEAD — the book's cover plate ─────────────────── */}
          <div className="relative px-4 pb-4 pt-4" style={plateShell}>
            <Bolts />
            <div className="flex items-center gap-3">
              <div
                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center"
                style={{ border: `2px solid ${STEEL}`, backgroundColor: 'rgba(6,5,4,0.82)', color: AMBER }}
              >
                <PxIcon name="book" size={26} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="bl-title text-[34px] leading-none" style={{ color: BONE }}>
                  Field Manual
                </div>
                <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
                  Frontier issue · {SECTIONS.length} sections · {TOTAL_ENTRIES} entries
                </div>
              </div>
              <Gauge value={SECTIONS.length} label="Sections" className="shrink-0" />
            </div>
            <div className="mt-3 text-[12px] leading-snug" style={{ color: BONE_MUTED }}>
              Pinned notes for loot, combat, caches, and buildcraft.
            </div>
            <FootStrip />
          </div>

          {/* ── SEARCH — an index plate, not a form field ─────────── */}
          <div className="relative flex min-h-[48px] items-center gap-2 px-3" style={pageShell}>
            <PxIcon name="search" size={17} style={{ color: BONE_FAINT }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the manual..."
              aria-label="Search the manual"
              className="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none"
              style={{ color: BONE }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center"
                style={{ color: BONE_MUTED }}
              >
                <PxIcon name="x" size={13} />
              </button>
            )}
          </div>

          {searching ? (
            <>
              <div className="flex items-baseline justify-between px-1 pt-1">
                <div className="bl-title text-[17px] leading-none" style={{ color: BONE }}>
                  Index
                </div>
                <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
                  {matches.length} match{matches.length === 1 ? '' : 'es'}
                </div>
              </div>
              {matches.length === 0 ? (
                <div className="px-1 text-[12px]" style={{ color: BONE_MUTED }}>
                  Nothing in the manual matches that. Try a shorter word.
                </div>
              ) : (
                matches.map(({ section: s, item }) => (
                  <button
                    key={`${s.id}-${item.term}`}
                    type="button"
                    onClick={() => openSection(s.id)}
                    className="relative block w-full px-3.5 py-2.5 text-left"
                    style={pageShell}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-bold" style={{ color: BONE }}>
                        {item.term}
                      </span>
                      <span
                        className="shrink-0 px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide"
                        style={{ border: `1.5px solid ${STEEL}`, color: BONE_MUTED }}
                      >
                        {s.title}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
                      {item.body}
                    </div>
                  </button>
                ))
              )}
            </>
          ) : (
            <>
              {/* ── ORIENTATION — the frontispiece, the cover's one action ── */}
              <button
                type="button"
                onClick={() => setView({ kind: 'tour' })}
                className="relative block w-full px-4 pb-4 pt-3.5 text-left"
                style={plateShell}
                data-testid="manual-orientation"
              >
                <Bolts />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Stamp amber>Start here</Stamp>
                    <div className="mt-2.5 text-[16px] font-black uppercase leading-tight tracking-wide" style={{ color: BONE }}>
                      Orientation — the guided tour
                    </div>
                    <div className="mt-1 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
                      Seven stops across Home, Gear, Market, and Hunter.
                    </div>
                  </div>
                  <Gauge value={`${tourStep + 1}/${TOUR_STEPS.length}`} label="Step" className="shrink-0" />
                </div>
                <FootStrip color={AMBER} />
              </button>

              {/* ── CONTENTS — the cover is the table of contents ──── */}
              <div className="flex items-baseline justify-between px-1 pt-1">
                <div className="bl-title text-[17px] leading-none" style={{ color: BONE }}>
                  Contents
                </div>
                <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
                  Tap a section to open its page
                </div>
              </div>
              <div className="space-y-2">
                {SECTIONS.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openSection(s.id)}
                    className="relative flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
                    style={pageShell}
                    data-testid={`toc-${s.id}`}
                  >
                    <span
                      className="bl-title flex h-[36px] w-[36px] shrink-0 items-center justify-center text-[16px]"
                      style={{ border: `2px solid ${STEEL}`, color: BONE, backgroundColor: 'rgba(6,5,4,0.6)' }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-black uppercase leading-tight tracking-wide" style={{ color: BONE }}>
                        {s.title}
                      </span>
                      <span className="block truncate text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
                        {s.blurb}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[15px] font-black" style={{ color: BONE_MUTED }}>
                        {s.items.length}
                      </span>
                      <PxIcon name="chevR" size={13} style={{ color: BONE_FAINT }} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="px-1 pb-1 pt-1 text-center text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
                The manual prints the game as shipped — odds and costs live on the machines that charge them.
              </div>
            </>
          )}
        </>
      )}

      {view.kind === 'tour' && (
        <>
          {ContentsRail}
          <div className="flex items-center justify-between px-1">
            <Stamp amber>Orientation</Stamp>
            <button
              type="button"
              onClick={() => setView({ kind: 'cover' })}
              className="min-h-[44px] px-2 text-[11px] font-black uppercase tracking-wide"
              style={{ color: BONE_MUTED }}
            >
              Back to cover
            </button>
          </div>
          <div className="h-[3px] w-full" style={{ backgroundColor: 'rgba(163,152,134,0.25)' }}>
            <div
              className="h-full transition-all"
              style={{ width: `${((tourStep + 1) / TOUR_STEPS.length) * 100}%`, backgroundColor: AMBER }}
            />
          </div>
          {(() => {
            const step = TOUR_STEPS[tourStep];
            return (
              <div className="relative px-4 pb-4 pt-3.5" style={plateShell} data-testid="manual-tour-step">
                <Bolts />
                <div className="flex items-start justify-between gap-3">
                  <div className="bl-title text-[21px] leading-tight" style={{ color: BONE }}>
                    {step.title}
                  </div>
                  <Gauge value={tourStep + 1} label={`of ${TOUR_STEPS.length}`} className="shrink-0" />
                </div>
                <p className="mt-2 text-[13px] leading-[1.65]" style={{ color: BONE_MUTED }}>
                  {step.body}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className="flex items-center gap-1.5 px-2 py-1.5"
                    style={{ border: `1.5px solid ${STEEL}`, backgroundColor: 'rgba(6,5,4,0.6)' }}
                  >
                    <PxIcon name={step.target.icon} size={13} style={{ color: AMBER }} />
                    <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: BONE }}>
                      {step.target.label}
                    </span>
                  </span>
                  <span className="text-[11px] uppercase tracking-wide" style={{ color: BONE_FAINT }}>
                    {step.spotlight}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setTourStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))}
                  className="relative mt-3.5 flex min-h-[48px] w-full items-center justify-center gap-2 overflow-hidden"
                  style={pageShell}
                >
                  <span className="text-[12px] font-black uppercase tracking-[0.14em]" style={{ color: BONE }}>
                    {step.cta}
                  </span>
                  <PxIcon name="chevR" size={13} style={{ color: BONE }} />
                  <FootStrip color={AMBER} />
                </button>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setTourStep((s) => Math.max(0, s - 1))}
                    disabled={tourStep === 0}
                    className="min-h-[44px] px-3 text-[11px] font-black uppercase tracking-widest disabled:opacity-30"
                    style={{ border: `2px solid ${STEEL}`, color: BONE_MUTED }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setTourStep(0)}
                    className="min-h-[44px] px-3 text-[11px] font-black uppercase tracking-widest"
                    style={{ border: `2px solid ${STEEL}`, color: BONE_FAINT }}
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    onClick={() => setTourStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))}
                    disabled={tourStep === TOUR_STEPS.length - 1}
                    className="min-h-[44px] px-3 text-[11px] font-black uppercase tracking-widest disabled:opacity-30"
                    style={{ border: `2px solid ${STEEL}`, color: BONE_MUTED }}
                  >
                    Next
                  </button>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {view.kind === 'section' && section && (
        <>
          {ContentsRail}
          {/* ── SECTION OPENER — the stamp is the wayfinding ──────── */}
          <div className="px-1 pt-1">
            <Stamp>{section.title}</Stamp>
            <div className="bl-title mt-3 text-[28px] leading-none" style={{ color: BONE }}>
              {section.title}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="text-[12px]" style={{ color: BONE_MUTED }}>
                {section.blurb}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_FAINT }}>
                {section.items.length} entries
              </span>
            </div>
          </div>

          {/* ── THE PAGE — one long plate, a calm column ──────────── */}
          <div className="relative px-4 py-4" style={pageShell} data-testid={`manual-page-${section.id}`}>
            {section.items.map((item, i) => (
              <div key={item.term} className={i > 0 ? 'mt-5 border-t pt-5' : ''} style={i > 0 ? { borderColor: 'rgba(163,152,134,0.18)' } : undefined}>
                <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>
                  {item.term}
                </div>
                <p className="mt-1 text-[13px] leading-[1.65]" style={{ color: BONE_MUTED }}>
                  {item.body}
                </p>
              </div>
            ))}
            <FootStrip />
          </div>

          {/* ── FOOT DOORS — the way forward ──────────────────────── */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { target: sectionIndex - 1, label: 'Prev', align: 'left' as const },
              { target: sectionIndex + 1, label: 'Next', align: 'right' as const },
            ].map(({ target, label, align }) => {
              const dest = SECTIONS[target];
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => (dest ? openSection(dest.id) : setView({ kind: 'cover' }))}
                  className={`relative overflow-hidden px-3.5 pb-3.5 pt-2.5 ${align === 'right' ? 'text-right' : 'text-left'}`}
                  style={pageShell}
                >
                  <div className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: BONE_FAINT }}>
                    {label}
                  </div>
                  <div className="mt-0.5 truncate text-[13px] font-black uppercase" style={{ color: BONE }}>
                    {dest ? dest.title : 'Cover'}
                  </div>
                  <FootStrip />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
