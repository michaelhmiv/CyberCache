/**
 * FieldManualQuietPage — PROTOTYPE (design/hunter-subpages-manual-e,
 * 2026-11-05). NOT shipped UI.
 *
 * Variant E — "Quiet plates". The Field Manual as a calm reading
 * document. Variant A built it as a bound, stamped book (cover plate,
 * START HERE stamp, contents as stamped plates, tab rail); this
 * variant deletes every one of those devices. No plates, no stamps,
 * no covers, no rails: the title is plain oversized type, the guided
 * tour is a numbered list with the current step's prose open, the
 * contents are a numbered index set in type, and a section reads as
 * prose entries between hairlines. One ink — bone on the page ground
 * at four values; state (done / current / next) reads through type
 * weight and placement, never hue.
 *
 * Mode: Read. Content is the shipped manual verbatim — SECTIONS and
 * TOUR_STEPS are imported from HelpScreen; this pass designs the
 * container only. Search is a real filter over the same terms and
 * bodies the shipped search reads, and its results jump straight to
 * the entry on its section page.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { SECTIONS, TOUR_STEPS, type HelpSection } from '@/screens/HelpScreen';

const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
/** Secondary ink at body sizes (clears 4.5:1 on the page ground). */
const BONE_SOFT = '#B3A488';
/** Faint ink — short labels and state words only. */
const BONE_FAINT = '#9A8B72';
const HAIRLINE = 'rgba(245,239,230,0.09)';
const HAIRLINE_STRONG = 'rgba(245,239,230,0.22)';

const display: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.04em',
  fontWeight: 400,
};

const TOTAL_ENTRIES = SECTIONS.reduce((n, s) => n + s.items.length, 0);

const stripStepNumber = (title: string) => title.replace(/^\d+\.\s*/, '');

export interface FieldManualQuietPageProps {
  /** Section open on first mount (capture/fixture door); null = index. */
  initialSection?: string | null;
  /** Tour cursor on first mount — the pass fixture is step 3 of 7. */
  initialTourStep?: number;
}

/* ─── The tour thread ──────────────────────────────────────────────── */

/** The page's one progress device: a 2px bone thread + a caption. */
const Thread: React.FC<{ done: number; total: number; caption: string }> = ({ done, total, caption }) => (
  <div>
    <div className="h-[2px] w-full" style={{ backgroundColor: HAIRLINE }}>
      <div className="h-full" style={{ width: `${(done / total) * 100}%`, backgroundColor: BONE }} />
    </div>
    <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
      {caption}
    </div>
  </div>
);

/* ─── Orientation — the guided tour as a numbered list ─────────────── */

const Orientation: React.FC<{
  step: number;
  onStep: (n: number) => void;
  onJump: () => void;
}> = ({ step, onStep, onJump }) => {
  return (
    <section aria-label="Orientation — the guided tour">
      <h2 className="leading-none" style={{ ...display, fontSize: 40, color: BONE }}>
        Orientation
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
        The guided tour — seven steps through the game, taken in order. You are on step {step + 1}.
      </p>

      <div className="mt-8">
        <Thread done={step + 1} total={TOUR_STEPS.length} caption={`Step ${step + 1} of ${TOUR_STEPS.length}`} />
      </div>

      <ol className="mt-6">
        {TOUR_STEPS.map((s, i) => {
          const state = i < step ? 'done' : i === step ? 'current' : 'next';
          return (
            <li key={s.id} style={{ borderTop: `1px solid ${HAIRLINE}` }}>
              <button
                type="button"
                onClick={() => onStep(i)}
                aria-current={state === 'current' ? 'step' : undefined}
                className="flex min-h-[52px] w-full items-baseline gap-4 py-3 text-left"
              >
                <span
                  className="w-7 shrink-0 leading-none"
                  style={{ ...display, fontSize: 22, color: state === 'next' ? BONE_FAINT : BONE }}
                >
                  {i + 1}
                </span>
                <span
                  className="min-w-0 flex-1 text-[15px]"
                  style={{
                    color: state === 'done' ? BONE_FAINT : BONE,
                    fontWeight: state === 'current' ? 700 : 600,
                  }}
                >
                  {stripStepNumber(s.title)}
                </span>
                {state === 'done' && (
                  <span className="flex shrink-0 items-center gap-1.5" style={{ color: BONE_FAINT }}>
                    <PxIcon name="check" size={12} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.18em]">Done</span>
                  </span>
                )}
                {state === 'current' && (
                  <span
                    className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em]"
                    style={{ color: BONE_MUTED }}
                  >
                    You are here
                  </span>
                )}
              </button>

              {state === 'current' && (
                <div className="pb-6 pl-11 pr-1">
                  <p className="text-[13px] leading-[1.75]" style={{ color: BONE_SOFT }}>
                    {s.body}
                  </p>
                  <div
                    className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em]"
                    style={{ color: BONE_FAINT }}
                  >
                    {s.target.label} · {s.spotlight}
                  </div>
                  <button
                    type="button"
                    onClick={onJump}
                    className="mt-5 flex min-h-[44px] items-center gap-2 px-5 text-[11px] font-bold uppercase tracking-[0.18em]"
                    style={{ border: `1px solid ${HAIRLINE_STRONG}`, color: BONE }}
                  >
                    {s.cta}
                    <PxIcon name="chevR" size={12} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-between" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
        <button
          type="button"
          onClick={() => onStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className="flex min-h-[44px] items-center gap-2 py-2 text-[11px] font-bold uppercase tracking-[0.18em] disabled:opacity-30"
          style={{ color: BONE_MUTED }}
        >
          <PxIcon name="chevL" size={12} />
          Back
        </button>
        <button
          type="button"
          onClick={() => onStep(0)}
          className="min-h-[44px] py-2 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ color: BONE_FAINT }}
        >
          Restart
        </button>
        <button
          type="button"
          onClick={() => onStep(Math.min(TOUR_STEPS.length - 1, step + 1))}
          disabled={step === TOUR_STEPS.length - 1}
          className="flex min-h-[44px] items-center gap-2 py-2 text-[11px] font-bold uppercase tracking-[0.18em] disabled:opacity-30"
          style={{ color: BONE }}
        >
          Next
          <PxIcon name="chevR" size={12} />
        </button>
      </div>
    </section>
  );
};

/* ─── Contents — the eight sections as a numbered index ────────────── */

const Contents: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => (
  <section aria-label="Contents" className="mt-16">
    <h2 className="leading-none" style={{ ...display, fontSize: 40, color: BONE }}>
      Contents
    </h2>
    <p className="mt-3 text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
      Eight sections, {TOTAL_ENTRIES} entries. Tap a section to read it.
    </p>
    <div className="mt-6">
      {SECTIONS.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onOpen(s.id)}
          className="flex w-full items-baseline gap-4 py-5 text-left"
          style={{ borderTop: `1px solid ${i === 0 ? HAIRLINE_STRONG : HAIRLINE}` }}
        >
          <span className="w-9 shrink-0 leading-none" style={{ ...display, fontSize: 26, color: BONE_FAINT }}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block leading-tight" style={{ ...display, fontSize: 24, color: BONE }}>
              {s.title}
            </span>
            <span className="mt-1 block text-[12px] leading-snug" style={{ color: BONE_SOFT }}>
              {s.blurb}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2" style={{ color: BONE_FAINT }}>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em]">
              {s.items.length} {s.items.length === 1 ? 'entry' : 'entries'}
            </span>
            <PxIcon name="chevR" size={13} />
          </span>
        </button>
      ))}
    </div>
  </section>
);

/* ─── A section page — entries as prose between hairlines ──────────── */

const SectionPage: React.FC<{
  section: HelpSection;
  index: number;
  focusEntry: number | null;
  onBack: () => void;
  onOpen: (id: string) => void;
}> = ({ section, index, focusEntry, onBack, onOpen }) => {
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusEntry !== null) {
      focusRef.current?.scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo(0, 0);
      document
        .querySelector('[data-testid="field-manual-quiet"]')
        ?.scrollIntoView({ block: 'start' });
    }
  }, [focusEntry, section.id]);

  const prev = index > 0 ? SECTIONS[index - 1] : null;
  const next = index < SECTIONS.length - 1 ? SECTIONS[index + 1] : null;

  const door = (target: HelpSection, word: string, align: 'left' | 'right') => (
    <button
      key={target.id}
      type="button"
      onClick={() => onOpen(target.id)}
      className="flex min-h-[56px] w-full items-center gap-3 py-3"
      style={{
        borderTop: `1px solid ${HAIRLINE}`,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        textAlign: align,
      }}
    >
      {align === 'left' && <PxIcon name="chevL" size={13} style={{ color: BONE_FAINT }} />}
      <span>
        <span
          className="block text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ color: BONE_FAINT }}
        >
          {word}
        </span>
        <span className="mt-0.5 block leading-tight" style={{ ...display, fontSize: 19, color: BONE }}>
          {target.title}
        </span>
      </span>
      {align === 'right' && <PxIcon name="chevR" size={13} style={{ color: BONE_FAINT }} />}
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[44px] items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ color: BONE_MUTED }}
        >
          <PxIcon name="chevL" size={13} />
          Contents
        </button>
        <span className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
          {index + 1} of {SECTIONS.length}
        </span>
      </div>

      <h1 className="mt-8 leading-none" style={{ ...display, fontSize: 44, color: BONE }}>
        {section.title}
      </h1>
      <p className="mt-3 text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
        {section.blurb}
      </p>

      <div className="mt-8">
        <Thread
          done={index + 1}
          total={SECTIONS.length}
          caption={`Section ${index + 1} of ${SECTIONS.length} · ${section.items.length} ${
            section.items.length === 1 ? 'entry' : 'entries'
          }`}
        />
      </div>

      <div className="mt-4">
        {section.items.map((item, i) => (
          <article
            key={item.term}
            ref={focusEntry === i ? focusRef : undefined}
            className="py-7"
            style={{ borderTop: `1px solid ${i === 0 ? HAIRLINE_STRONG : HAIRLINE}` }}
          >
            <h3 className="leading-tight" style={{ ...display, fontSize: 22, color: BONE }}>
              {item.term}
            </h3>
            <p className="mt-2.5 text-[13px] leading-[1.75]" style={{ color: BONE_SOFT }}>
              {item.body}
            </p>
          </article>
        ))}
      </div>

      <nav aria-label="More of the manual" className="mt-4">
        {prev && door(prev, 'Previous section', 'left')}
        {next && door(next, 'Next section', 'right')}
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[56px] w-full items-center justify-center text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ borderTop: `1px solid ${HAIRLINE}`, color: BONE_FAINT }}
        >
          Back to contents
        </button>
      </nav>
    </div>
  );
};

/* ─── The page ─────────────────────────────────────────────────────── */

export const FieldManualQuietPage: React.FC<FieldManualQuietPageProps> = ({
  initialSection = null,
  initialTourStep = 2,
}) => {
  const [sectionId, setSectionId] = useState<string | null>(initialSection);
  const [focusEntry, setFocusEntry] = useState<number | null>(null);
  const [tourStep, setTourStep] = useState(initialTourStep);
  const [query, setQuery] = useState('');

  const searching = query.trim().length > 0;
  const matches = useMemo(() => {
    if (!searching) return [];
    const lower = query.trim().toLowerCase();
    return SECTIONS.flatMap((s) =>
      s.items
        .map((item, entryIndex) => ({ section: s, item, entryIndex }))
        .filter(
          ({ item }) =>
            item.term.toLowerCase().includes(lower) || item.body.toLowerCase().includes(lower),
        ),
    );
  }, [query, searching]);

  const openSection = (id: string, entry: number | null = null) => {
    setFocusEntry(entry);
    setSectionId(id);
  };

  const sectionIndex = sectionId ? SECTIONS.findIndex((s) => s.id === sectionId) : -1;
  const section = sectionIndex >= 0 ? SECTIONS[sectionIndex] : undefined;

  if (section) {
    return (
      <div data-testid="field-manual-quiet" className="pb-16 pt-2">
        <SectionPage
          section={section}
          index={sectionIndex}
          focusEntry={focusEntry}
          onBack={() => {
            setSectionId(null);
            setFocusEntry(null);
          }}
          onOpen={(id) => openSection(id)}
        />
      </div>
    );
  }

  return (
    <div data-testid="field-manual-quiet" className="pb-16">
      {/* The title is the cover. Plain oversized type, nothing else. */}
      <div className="pt-10">
        <h1 className="leading-none" style={{ ...display, fontSize: 60, color: BONE }}>
          Field Manual
        </h1>
        <p className="mt-4 max-w-[34ch] text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
          Pinned notes for loot, combat, caches, and buildcraft.
        </p>
        <div
          className="mt-6 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ color: BONE_FAINT }}
        >
          {SECTIONS.length} sections · {TOTAL_ENTRIES} entries
        </div>
      </div>

      {/* Search — a hairline and a word. A real filter, as shipped. */}
      <div
        className="mt-10 flex min-h-[44px] items-center gap-3"
        style={{ borderBottom: `1px solid ${HAIRLINE_STRONG}` }}
      >
        <PxIcon name="search" size={15} style={{ color: BONE_FAINT }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the manual…"
          aria-label="Search the manual"
          className="unstyled min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
          style={{ color: BONE }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center"
            style={{ color: BONE_FAINT }}
          >
            <PxIcon name="x" size={13} />
          </button>
        )}
      </div>

      {searching ? (
        <section aria-label="Search results" className="mt-10">
          <p className="text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
            {matches.length === 0
              ? `Nothing in the manual matches “${query.trim()}”.`
              : `${matches.length} ${matches.length === 1 ? 'entry matches' : 'entries match'} “${query.trim()}”.`}
          </p>
          {matches.length === 0 ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-5 flex min-h-[44px] items-center px-5 text-[11px] font-bold uppercase tracking-[0.18em]"
              style={{ border: `1px solid ${HAIRLINE_STRONG}`, color: BONE }}
            >
              Clear the search
            </button>
          ) : (
            <div className="mt-4">
              {matches.map(({ section: s, item, entryIndex }) => (
                <button
                  key={`${s.id}-${item.term}`}
                  type="button"
                  onClick={() => openSection(s.id, entryIndex)}
                  className="block w-full py-5 text-left"
                  style={{ borderTop: `1px solid ${HAIRLINE}` }}
                >
                  <span
                    className="block text-[11px] font-bold uppercase tracking-[0.18em]"
                    style={{ color: BONE_FAINT }}
                  >
                    {s.title}
                  </span>
                  <span className="mt-1.5 block leading-tight" style={{ ...display, fontSize: 21, color: BONE }}>
                    {item.term}
                  </span>
                  <span className="mt-1.5 block text-[13px] leading-[1.7]" style={{ color: BONE_SOFT }}>
                    {item.body}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="mt-14">
            <Orientation step={tourStep} onStep={setTourStep} onJump={() => setTourStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))} />
          </div>
          <Contents onOpen={(id) => openSection(id)} />
          <p className="mt-14 text-center text-[12px]" style={{ color: BONE_FAINT }}>
            That is the whole manual.
          </p>
        </>
      )}
    </div>
  );
};
