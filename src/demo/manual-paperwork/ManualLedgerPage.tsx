/**
 * ManualLedgerPage — PROTOTYPE (design/hunter-subpages-manual-d,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Field Manual reimagined in Variant D's FIELD PAPERWORK
 * register: not a bound book (that is Variant A's stamped book) but
 * a clerk-issued form packet — Form FM-27, numbered for the 27
 * entries it files. The cover is a form sheet: the hunter's name
 * typed onto a dotted leader, the standing of the file read off
 * ruled lines. The guided tour rides as a perforated orientation
 * slip (and, opened, a seven-line checklist record with boxes the
 * clerk inks as steps are filed). The contents are an INDEX OF
 * SCHEDULES — eight ruled ledger lines, one per section, lettered
 * A–H so every entry carries a record number (C-2 is Loadout's
 * second entry, in any D room). A section opens as its record
 * sheet: entries as numbered records divided by hairlines, the
 * sheet stamped FILED.
 *
 * Content is the shipped manual verbatim — SECTIONS / TOUR_STEPS
 * are imported from helpContent; this pass designs the CONTAINER
 * only. The incumbent's per-section decorative colors are dropped:
 * in this office color is stamp ink and amber action, never a
 * section's paint — and never a colored side bar.
 */
import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { SECTIONS, TOUR_STEPS, type HelpSection } from '@/screens/helpContent';
import { DoubleRule, EndorseStamp, FormLine, InkStamp, PaperSheet, RecordNo } from './paperKit';
import { AMBER, INK, INK_FAINT, INK_MUTED, RULE, RULE_HARD, STAMP_RED, displayStyle, monoStyle } from './paperTokens';

type ManualView = { kind: 'index' } | { kind: 'tour' } | { kind: 'section'; id: string };

export interface ManualLedgerPageProps {
  initialView?: 'index' | 'tour' | 'section';
  initialSection?: string;
  initialQuery?: string;
  /** 0-based tour cursor; the shared fixture stands at step 3 of 7. */
  initialTourStep?: number;
}

const LETTERS = 'ABCDEFGH';
const TOTAL_ENTRIES = SECTIONS.reduce((n, s) => n + s.items.length, 0);
const HUNTER_LINE = 'ROOK SANDOVAL · HUNTER LV 24';

/** A ruled clerk's button — mono voice, hairline-hard border, 44px floor. */
const ClerkButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  className?: string;
}> = ({ children, onClick, disabled, testId, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    data-testid={testId}
    className={`flex min-h-[44px] items-center justify-center gap-1.5 px-3 font-black uppercase transition-transform active:scale-[0.98] disabled:opacity-30 ${className}`}
    style={{ ...monoStyle, border: `1px solid ${RULE_HARD}`, color: INK_MUTED, fontSize: 11, letterSpacing: '0.12em', backgroundColor: 'rgba(0,0,0,0.25)' }}
  >
    {children}
  </button>
);

/**
 * The tour filed as a strip of seven ruled boxes: inked once a step
 * is filed, the open step struck in amber. A punch row, not a gauge
 * — the same hand as the kit's CheckStrip at the tour's own count.
 */
const TourStrip: React.FC<{ current: number }> = ({ current }) => (
  <div className="flex gap-[5px]" role="img" aria-label={`Orientation step ${current + 1} of ${TOUR_STEPS.length}`}>
    {TOUR_STEPS.map((step, i) => (
      <span
        key={step.id}
        className="flex h-[15px] flex-1 items-center justify-center"
        style={{
          border: `1px solid ${i === current ? AMBER : i < current ? INK : RULE_HARD}`,
          backgroundColor: i < current ? INK : 'transparent',
          boxShadow: i < current ? 'inset 0 0 0 1px rgba(0,0,0,0.35)' : undefined,
        }}
      >
        {i === current && <span style={{ width: 5, height: 5, backgroundColor: AMBER }} />}
      </span>
    ))}
  </div>
);

export const ManualLedgerPage: React.FC<ManualLedgerPageProps> = ({
  initialView = 'index',
  initialSection = 'loot',
  initialQuery = '',
  initialTourStep = 2,
}) => {
  const [view, setView] = useState<ManualView>(() =>
    initialView === 'section' ? { kind: 'section', id: initialSection } : { kind: initialView },
  );
  const [query, setQuery] = useState(initialQuery);
  const [tourStep, setTourStep] = useState(initialTourStep);

  const searching = query.trim().length > 0;
  const step = TOUR_STEPS[tourStep];

  const matches = useMemo(() => {
    if (!searching) return [];
    const lower = query.toLowerCase();
    return SECTIONS.flatMap((section, si) =>
      section.items
        .map((item, ii) => ({ section, item, si, ii }))
        .filter(({ item }) => item.term.toLowerCase().includes(lower) || item.body.toLowerCase().includes(lower)),
    );
  }, [query, searching]);

  const matchedTermsFor = (sectionId: string) =>
    new Set(matches.filter((m) => m.section.id === sectionId).map((m) => m.item.term));

  const sectionIndex = view.kind === 'section' ? SECTIONS.findIndex((s) => s.id === view.id) : -1;
  const section: HelpSection | undefined = sectionIndex >= 0 ? SECTIONS[sectionIndex] : undefined;

  const advanceTour = () => setTourStep((s) => Math.min(s + 1, TOUR_STEPS.length - 1));

  /** Contents rail — rides the tour and section sheets; the index is its own contents. */
  const ContentsRail = (
    <div className="flex gap-1.5 overflow-x-auto pb-3" data-testid="manual-contents-rail">
      <button
        type="button"
        onClick={() => setView({ kind: 'index' })}
        className="flex min-h-[44px] shrink-0 items-center px-3 font-black uppercase"
        style={{ ...monoStyle, border: `1px solid ${RULE_HARD}`, color: INK_MUTED, fontSize: 11, letterSpacing: '0.1em', backgroundColor: 'rgba(0,0,0,0.25)' }}
      >
        Cover
      </button>
      {SECTIONS.map((s, i) => {
        const current = view.kind === 'section' && view.id === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => setView({ kind: 'section', id: s.id })}
            className="flex min-h-[44px] shrink-0 items-center px-3 font-black uppercase"
            style={{
              ...monoStyle,
              fontSize: 11,
              letterSpacing: '0.1em',
              ...(current
                ? { backgroundColor: AMBER, color: '#131009', border: '1px solid #000' }
                : { border: `1px solid ${RULE_HARD}`, color: INK_MUTED, backgroundColor: 'rgba(0,0,0,0.25)' }),
            }}
          >
            {LETTERS[i]} · {s.title}
          </button>
        );
      })}
    </div>
  );

  return (
    <div data-testid="field-manual-ledger">
      {/* ══════════ INDEX — cover sheet, orientation slip, schedules ══════════ */}
      {view.kind === 'index' && (
        <div className="space-y-3.5">
          {/* ── COVER SHEET — Form FM-27 ── */}
          <PaperSheet testId="manual-cover">
            <div className="flex items-start justify-between gap-3">
              <span className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.14em' }}>
                Frontier Registry · Issued Handbook
              </span>
              <RecordNo color={INK}>FORM FM-27</RecordNo>
            </div>
            <div className="relative mt-2.5">
              <h1 style={{ ...displayStyle, color: INK, fontSize: 40, lineHeight: 0.95 }}>Field Manual</h1>
              <div className="absolute -top-1 right-0">
                <InkStamp color={AMBER} rotate={-6}>Issued</InkStamp>
              </div>
            </div>
            <p className="mt-2" style={{ ...monoStyle, color: INK_MUTED, fontSize: 12, lineHeight: 1.5 }}>
              Pinned notes for loot, combat, caches, and buildcraft.
            </p>
            <div className="mt-3.5 space-y-2">
              <FormLine label="Issued to" value={HUNTER_LINE} />
              <FormLine label="Sections on file" value={String(SECTIONS.length)} />
              <FormLine label="Entries on file" value={String(TOTAL_ENTRIES)} />
              <FormLine label="Orientation" value={`STEP ${tourStep + 1} OF ${TOUR_STEPS.length}`} valueColor={AMBER} />
            </div>
            {/* FIND IN FILE — the shipped search, filed as a form field. */}
            <div className="mt-4">
              <label
                htmlFor="manual-ledger-search"
                className="font-bold uppercase"
                style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.14em' }}
              >
                Find in file
              </label>
              <div className="mt-1 flex items-center gap-2" style={{ borderBottom: `1px dotted ${RULE_HARD}` }}>
                <PxIcon name="search" size={15} style={{ color: INK_FAINT, flexShrink: 0 }} />
                <input
                  id="manual-ledger-search"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the manual..."
                  className="min-h-[44px] min-w-0 flex-1 bg-transparent font-bold focus:outline-none"
                  style={{ ...monoStyle, color: INK, fontSize: 13, letterSpacing: '0.02em' }}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="flex min-h-[44px] shrink-0 items-center gap-1 font-black uppercase"
                    style={{ ...monoStyle, color: STAMP_RED, fontSize: 11, letterSpacing: '0.12em' }}
                  >
                    <PxIcon name="x" size={12} />
                    Clear
                  </button>
                )}
              </div>
            </div>
          </PaperSheet>

          {/* ── ORIENTATION SLIP — perforated off the cover ── */}
          <div aria-hidden="true" style={{ borderTop: `2px dashed ${RULE_HARD}` }} />
          <PaperSheet testId="manual-orientation-slip">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-baseline gap-2.5">
                <RecordNo>O-1</RecordNo>
                <h2 style={{ ...displayStyle, color: INK, fontSize: 21, lineHeight: 1 }}>Orientation — The Guided Tour</h2>
              </div>
              <InkStamp color={STAMP_RED} rotate={-4}>In progress</InkStamp>
            </div>
            <div className="mt-3 space-y-2">
              <FormLine label="Current step" value={step.title} />
              <FormLine
                label="Sent to"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <PxIcon name={step.target.icon} size={13} style={{ color: AMBER }} />
                    {step.target.label}
                  </span>
                }
              />
              <FormLine label="Look for" value={step.spotlight} />
            </div>
            <div className="mt-3.5">
              <TourStrip current={tourStep} />
              <div className="mt-1.5 font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.12em' }}>
                {tourStep} of {TOUR_STEPS.length} boxes filed · box {tourStep + 1} open
              </div>
            </div>
            <p className="mt-3" style={{ color: INK_MUTED, fontSize: 13, lineHeight: 1.55 }}>
              {step.body}
            </p>
            <button
              type="button"
              onClick={advanceTour}
              data-testid="manual-tour-cta"
              className="mt-3.5 flex min-h-[48px] w-full items-center justify-center gap-2 font-black uppercase transition-transform active:scale-[0.98]"
              style={{ ...monoStyle, backgroundColor: AMBER, color: '#131009', fontSize: 12.5, letterSpacing: '0.14em', border: '1px solid #000', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.35)' }}
            >
              {step.cta}
              <PxIcon name="chevR" size={13} />
            </button>
            <div className="mt-2 flex gap-2">
              <ClerkButton className="flex-1" disabled={tourStep === 0} onClick={() => setTourStep((s) => Math.max(0, s - 1))} testId="manual-tour-back">
                Back
              </ClerkButton>
              <ClerkButton className="flex-1" onClick={() => setTourStep(0)} testId="manual-tour-restart">
                Restart
              </ClerkButton>
              <ClerkButton className="flex-1" disabled={tourStep === TOUR_STEPS.length - 1} onClick={advanceTour} testId="manual-tour-next">
                Next
              </ClerkButton>
            </div>
            <button
              type="button"
              onClick={() => setView({ kind: 'tour' })}
              data-testid="manual-tour-open"
              className="mt-1.5 flex min-h-[44px] w-full items-center justify-center font-black uppercase"
              style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.12em', textDecoration: 'underline dotted', textUnderlineOffset: 4 }}
            >
              Open the full tour record — all seven steps
            </button>
          </PaperSheet>

          {/* ── SEARCH RETURN or INDEX OF SCHEDULES ── */}
          {searching ? (
            <PaperSheet testId="manual-search-return">
              <div className="flex items-baseline justify-between gap-3">
                <h2 style={{ ...displayStyle, color: INK, fontSize: 21, lineHeight: 1 }}>Search Return</h2>
                <RecordNo color={INK}>
                  {matches.length} {matches.length === 1 ? 'MATCH' : 'MATCHES'}
                </RecordNo>
              </div>
              {matches.length === 0 ? (
                <div className="mt-3">
                  <p className="font-bold uppercase" style={{ ...monoStyle, color: INK_MUTED, fontSize: 12, letterSpacing: '0.08em', lineHeight: 1.6 }}>
                    No entry in the file matches.
                  </p>
                  <ClerkButton className="mt-3 w-full" onClick={() => setQuery('')}>
                    Clear the search
                  </ClerkButton>
                </div>
              ) : (
                <div className="mt-2">
                  {matches.map(({ section: s, item, si, ii }, mi) => (
                    <button
                      key={`${s.id}-${item.term}`}
                      type="button"
                      onClick={() => setView({ kind: 'section', id: s.id })}
                      data-testid={`manual-match-${mi}`}
                      className="block w-full py-3 text-left"
                      style={{ borderTop: mi === 0 ? undefined : `1px solid ${RULE}` }}
                    >
                      <div className="flex items-baseline gap-2.5">
                        <RecordNo>
                          {LETTERS[si]}-{ii + 1}
                        </RecordNo>
                        <span style={{ ...displayStyle, color: INK, fontSize: 17, letterSpacing: '0.04em' }}>{item.term}</span>
                        <span className="ml-auto shrink-0 font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
                          Schedule {LETTERS[si]}
                        </span>
                      </div>
                      <p className="mt-1 pl-[52px]" style={{ color: INK_MUTED, fontSize: 12.5, lineHeight: 1.5 }}>
                        {item.body}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </PaperSheet>
          ) : (
            <PaperSheet testId="manual-schedule-index">
              <div className="flex items-baseline justify-between gap-3">
                <h2 style={{ ...displayStyle, color: INK, fontSize: 21, lineHeight: 1 }}>Index of Schedules</h2>
                <span className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.12em' }}>
                  Tap a line to open its sheet
                </span>
              </div>
              <div className="mt-1.5">
                {SECTIONS.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setView({ kind: 'section', id: s.id })}
                    data-testid={`manual-schedule-${s.id}`}
                    className="flex w-full items-center gap-3 py-3 text-left"
                    style={{ borderTop: i === 0 ? undefined : `1px solid ${RULE}`, minHeight: 56 }}
                  >
                    <span
                      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center font-black"
                      style={{ ...monoStyle, border: `1px solid ${RULE_HARD}`, color: INK, fontSize: 12.5 }}
                    >
                      {LETTERS[i]}
                    </span>
                    <PxIcon name={s.icon} size={16} style={{ color: INK_FAINT, flexShrink: 0 }} />
                    <span className="min-w-0 flex-1">
                      <span className="block" style={{ ...displayStyle, color: INK, fontSize: 18, letterSpacing: '0.04em', lineHeight: 1.05 }}>
                        {s.title}
                      </span>
                      <span className="block" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11.5, lineHeight: 1.35 }}>
                        {s.blurb}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-black" style={{ ...monoStyle, color: INK, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                        {s.items.length}
                      </span>
                      <span className="block font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
                        Entries
                      </span>
                    </span>
                    <PxIcon name="chevR" size={14} style={{ color: INK_FAINT, flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            </PaperSheet>
          )}
        </div>
      )}

      {/* ══════════ TOUR RECORD — the seven steps as a checklist ══════════ */}
      {view.kind === 'tour' && (
        <div>
          {ContentsRail}
          <PaperSheet testId="manual-tour-record">
            <div className="flex items-start justify-between gap-3">
              <h2 style={{ ...displayStyle, color: INK, fontSize: 24, lineHeight: 1 }}>Orientation Record</h2>
              <InkStamp color={STAMP_RED} rotate={-4}>In progress</InkStamp>
            </div>
            <div className="mt-3 space-y-2">
              <FormLine label="Steps filed" value={`${tourStep} OF ${TOUR_STEPS.length}`} />
              <FormLine label="Current step" value={step.title} valueColor={AMBER} />
            </div>
            <DoubleRule className="mt-3.5" />
            <div>
              {TOUR_STEPS.map((s, i) => {
                const filed = i < tourStep;
                const current = i === tourStep;
                return (
                  <div key={s.id} className="py-3" style={{ borderBottom: i === TOUR_STEPS.length - 1 ? undefined : `1px solid ${RULE}` }}>
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-[3px] flex h-[15px] w-[15px] shrink-0 items-center justify-center"
                        style={{
                          border: `1px solid ${current ? AMBER : filed ? INK : RULE_HARD}`,
                          backgroundColor: filed ? INK : 'transparent',
                        }}
                      >
                        {current && <span style={{ width: 5, height: 5, backgroundColor: AMBER }} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span style={{ ...displayStyle, color: filed || current ? INK : INK_MUTED, fontSize: 17, letterSpacing: '0.04em', lineHeight: 1.1 }}>
                            {s.title}
                          </span>
                          {filed && <EndorseStamp color={INK_FAINT}>Filed</EndorseStamp>}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.08em' }}>
                          <PxIcon name={s.target.icon} size={12} style={{ color: current ? AMBER : INK_FAINT }} />
                          {s.target.label}
                          <span aria-hidden="true">·</span>
                          {s.spotlight}
                        </div>
                        {current && (
                          <>
                            <p className="mt-2" style={{ color: INK_MUTED, fontSize: 13, lineHeight: 1.55 }}>
                              {s.body}
                            </p>
                            <button
                              type="button"
                              onClick={advanceTour}
                              className="mt-2.5 flex min-h-[48px] w-full items-center justify-center gap-2 font-black uppercase transition-transform active:scale-[0.98]"
                              style={{ ...monoStyle, backgroundColor: AMBER, color: '#131009', fontSize: 12.5, letterSpacing: '0.14em', border: '1px solid #000', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.35)' }}
                            >
                              {s.cta}
                              <PxIcon name="chevR" size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <ClerkButton className="mt-2 w-full" onClick={() => setView({ kind: 'index' })}>
              Return to cover
            </ClerkButton>
          </PaperSheet>
        </div>
      )}

      {/* ══════════ SECTION SHEET — one schedule, filed ══════════ */}
      {view.kind === 'section' && section && (
        <div>
          {ContentsRail}
          <PaperSheet testId="manual-section-sheet">
            <div className="flex items-start justify-between gap-3">
              <RecordNo color={INK}>SCHEDULE {LETTERS[sectionIndex]}</RecordNo>
              <InkStamp color={INK_MUTED} rotate={-4}>Filed</InkStamp>
            </div>
            <h2 className="mt-2" style={{ ...displayStyle, color: INK, fontSize: 30, lineHeight: 0.98 }}>
              {section.title}
            </h2>
            <p className="mt-1.5" style={{ ...monoStyle, color: INK_MUTED, fontSize: 12, lineHeight: 1.5 }}>
              {section.blurb}
            </p>
            <div className="mt-3 space-y-2">
              <FormLine label="Section" value={`${sectionIndex + 1} OF ${SECTIONS.length}`} />
              <FormLine label="Entries" value={String(section.items.length)} />
            </div>
            <DoubleRule className="mt-3.5" />
            <div>
              {section.items.map((item, ii) => {
                const matched = searching && matchedTermsFor(section.id).has(item.term);
                return (
                  <div
                    key={item.term}
                    data-testid={`manual-entry-${section.id}-${ii}`}
                    className="flex gap-3 py-3.5"
                    style={{ borderBottom: ii === section.items.length - 1 ? undefined : `1px solid ${RULE}` }}
                  >
                    <span className="pt-[2px]">
                      <RecordNo>
                        {LETTERS[sectionIndex]}-{ii + 1}
                      </RecordNo>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span style={{ ...displayStyle, color: INK, fontSize: 18, letterSpacing: '0.04em', lineHeight: 1.1 }}>
                          {item.term}
                        </span>
                        {matched && <EndorseStamp color={STAMP_RED}>Match</EndorseStamp>}
                      </div>
                      <p className="mt-1" style={{ color: INK_MUTED, fontSize: 13, lineHeight: 1.55 }}>
                        {item.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              {sectionIndex > 0 && (
                <ClerkButton className="flex-1" onClick={() => setView({ kind: 'section', id: SECTIONS[sectionIndex - 1].id })}>
                  <PxIcon name="chevL" size={12} />
                  {LETTERS[sectionIndex - 1]} · {SECTIONS[sectionIndex - 1].title}
                </ClerkButton>
              )}
              {sectionIndex < SECTIONS.length - 1 && (
                <ClerkButton className="flex-1" onClick={() => setView({ kind: 'section', id: SECTIONS[sectionIndex + 1].id })}>
                  {LETTERS[sectionIndex + 1]} · {SECTIONS[sectionIndex + 1].title}
                  <PxIcon name="chevR" size={12} />
                </ClerkButton>
              )}
            </div>
          </PaperSheet>
        </div>
      )}
    </div>
  );
};
