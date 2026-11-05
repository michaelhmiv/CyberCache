/**
 * FieldManualConsole — PROTOTYPE (design/hunter-subpages-manual-b,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Field Manual in the B register — "Instrument panel". Where
 * variant A bound the manual as a stamped book (cover plate, contents
 * plates, ruled entries), B mounts it as the hunter rig's own
 * OPERATOR CONSOLE: a rack unit you read telemetry off. The masthead
 * is a unit plate with a scanlined LCD bank (sections / entries /
 * tour step / operator). The guided tour is a POWER-ON SEQUENCE —
 * seven checklist rows with status lamps: green where a step is
 * complete, a pulsing amber lamp on the live step, dark sockets
 * queued behind it; the live step opens inline with its full text,
 * its target readout, and its real call to action. The contents are
 * a CHANNEL SELECT bank — eight channels, each with an LCD channel
 * tab, an entry count, and a signal meter sized by its entries. A
 * channel opens as a SPEC SHEET: entries as numbered spec rows.
 *
 * Search is the INDEX QUERY well: a real filter with the shipped
 * matching rule (term or body contains the query), returning match
 * lines that jump straight to their channel.
 *
 * Content is the shipped manual verbatim (SECTIONS / TOUR_STEPS are
 * imported from HelpScreen — this pass designs the CONTAINER only).
 * The incumbent's per-section decorative colors are dropped: in this
 * register color is state or action, never a section's paint.
 */
import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { SECTIONS, TOUR_STEPS, type HelpSection } from '@/screens/HelpScreen';
import { CK, ConsoleStyles, Lamp, Lcd, PushBtn, Rack, RackHead, Readout, SegMeter } from './consoleKit';

type ManualView = { kind: 'index' } | { kind: 'section'; id: string };

export interface FieldManualConsoleProps {
  initialView?: 'index' | 'section';
  initialSection?: string;
  initialTourStep?: number;
  initialQuery?: string;
}

const TOTAL_ENTRIES = SECTIONS.reduce((n, s) => n + s.items.length, 0);
const MAX_ENTRIES = Math.max(...SECTIONS.map((s) => s.items.length));
const pad2 = (n: number) => String(n).padStart(2, '0');

export const FieldManualConsole: React.FC<FieldManualConsoleProps> = ({
  initialView = 'index',
  initialSection = 'loot',
  initialTourStep = 2,
  initialQuery = '',
}) => {
  const [view, setView] = useState<ManualView>(() =>
    initialView === 'section' ? { kind: 'section', id: initialSection } : { kind: 'index' },
  );
  const [query, setQuery] = useState(initialQuery);
  const [tourStep, setTourStep] = useState(initialTourStep);

  const searching = query.trim().length > 0;
  const matches = useMemo(() => {
    if (!searching) return [];
    const lower = query.toLowerCase();
    return SECTIONS.flatMap((s, ci) =>
      s.items
        .filter((it) => it.term.toLowerCase().includes(lower) || it.body.toLowerCase().includes(lower))
        .map((it) => ({ section: s, channel: ci + 1, item: it })),
    );
  }, [query, searching]);

  const sectionIndex = view.kind === 'section' ? SECTIONS.findIndex((s) => s.id === view.id) : -1;
  const section: HelpSection | undefined = sectionIndex >= 0 ? SECTIONS[sectionIndex] : undefined;

  const openSection = (id: string) => setView({ kind: 'section', id });
  /** The tour's jump button: in the shipped app it switches tabs and
   *  advances the cursor; the prototype advances the cursor only. */
  const tourJump = () => setTourStep((s) => Math.min(s + 1, TOUR_STEPS.length - 1));

  /* ── Channel row (contents bank) ─────────────────────────────── */
  const channelRow = (s: HelpSection, ci: number) => (
    <button
      key={s.id}
      type="button"
      onClick={() => openSection(s.id)}
      className="flex min-h-[58px] w-full items-center gap-2.5 px-2.5 py-2 text-left transition-transform active:translate-y-[1px]"
      style={{
        background: CK.panelInner,
        border: '2px solid #000',
        boxShadow: `inset 0 0 0 1px ${CK.bezel}, inset 0 1px 0 ${CK.seam}`,
      }}
    >
      <span
        className="ck-num flex h-[38px] w-[46px] shrink-0 items-center justify-center text-[14px] font-bold"
        style={{
          color: CK.bone,
          background: CK.lcd,
          boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.9)',
        }}
      >
        {pad2(ci + 1)}
      </span>
      <span
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center"
        style={{ color: CK.boneDim, boxShadow: `inset 0 0 0 1px ${CK.bezel}`, background: 'rgba(0,0,0,0.35)' }}
      >
        <PxIcon name={s.icon} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold uppercase leading-tight tracking-[0.06em]" style={{ color: CK.bone }}>
          {s.title}
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-tight" style={{ color: CK.boneDim }}>
          {s.blurb}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <Readout>
          ENT <span style={{ color: CK.bone }}>{pad2(s.items.length)}</span>
        </Readout>
        <SegMeter
          cellWidth={9}
          states={Array.from({ length: MAX_ENTRIES }, (_, i) => (i < s.items.length ? 'ok' : 'off'))}
        />
      </span>
      <PxIcon name="chevR" size={13} style={{ color: CK.label, flexShrink: 0 }} />
    </button>
  );

  return (
    <div className="space-y-3" data-testid="field-manual-console">
      <ConsoleStyles />

      {view.kind === 'index' && (
        <>
          {/* ── MASTHEAD — the unit plate ─────────────────────── */}
          <Rack testId="manual-masthead">
            <div
              className="flex min-h-[34px] items-center gap-2 px-3"
              style={{ borderBottom: `1px solid ${CK.bezel}` }}
            >
              <PxIcon name="power" size={13} style={{ color: CK.green }} />
              <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: CK.boneDim }}>
                Unit FM-08 · Operator Console
              </span>
              <Lamp state="ok" size={8} />
              <Readout color={CK.green}>PWR OK</Readout>
            </div>
            <div className="px-3.5 pb-3 pt-3">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-[52px] w-[52px] shrink-0 items-center justify-center"
                  style={{
                    color: CK.amber,
                    background: 'rgba(0,0,0,0.4)',
                    boxShadow: `inset 0 0 0 1px ${CK.bezel}, inset 0 2px 5px rgba(0,0,0,0.7)`,
                  }}
                >
                  <PxIcon name="book" size={26} />
                </span>
                <div className="min-w-0">
                  <h1
                    className="text-[36px] uppercase leading-[0.95]"
                    style={{ fontFamily: "'Bebas Neue', 'Chakra Petch', sans-serif", letterSpacing: '0.04em', color: CK.bone }}
                  >
                    Field Manual
                  </h1>
                  <p className="mt-1 text-[12.5px] leading-snug" style={{ color: CK.boneDim }}>
                    Pinned notes for loot, combat, caches, and buildcraft.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Lcd label="Sections" value={pad2(SECTIONS.length)} />
                <Lcd label="Entries" value={TOTAL_ENTRIES} />
                <Lcd label="Tour step" value={`${tourStep + 1} / ${TOUR_STEPS.length}`} valueColor={CK.amber} />
              </div>
              <Lcd className="mt-2" label="Operator" value={<span className="text-[15px]">ROOK SANDOVAL · LV 24</span>} />
            </div>
          </Rack>

          {/* ── POWER-ON SEQUENCE — the guided tour ───────────── */}
          <Rack testId="manual-power-on">
            <RackHead
              icon={<PxIcon name="pin" size={13} style={{ color: CK.amber }} />}
              label="Orientation — Power-On Sequence"
              readout={
                <Readout>
                  <span style={{ color: CK.amber }}>{Math.round(((tourStep + 1) / TOUR_STEPS.length) * 100)}%</span>
                </Readout>
              }
            />
            <div className="px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <SegMeter
                  states={TOUR_STEPS.map((_, i) => (i < tourStep ? 'ok' : i === tourStep ? 'live' : 'off'))}
                  cellWidth={26}
                />
                <Readout>
                  STEP <span style={{ color: CK.bone }}>{tourStep + 1}</span> OF {TOUR_STEPS.length}
                </Readout>
              </div>

              <div className="mt-3 space-y-1.5">
                {TOUR_STEPS.map((step, i) => {
                  const state = i < tourStep ? 'ok' : i === tourStep ? 'live' : 'off';
                  const isCurrent = i === tourStep;
                  return (
                    <div
                      key={step.id}
                      style={
                        isCurrent
                          ? {
                              background: 'rgba(0,0,0,0.38)',
                              border: '2px solid #000',
                              boxShadow: `inset 0 0 0 1px ${CK.bezel}`,
                            }
                          : undefined
                      }
                    >
                      <div className="flex min-h-[44px] items-center gap-2.5 px-2.5">
                        <Lamp state={state} />
                        <span className="ck-num text-[11px] font-bold tracking-[0.12em]" style={{ color: CK.label }}>
                          S-{pad2(i + 1)}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-[13px] font-bold uppercase tracking-[0.05em]"
                          style={{ color: state === 'off' ? CK.boneDim : CK.bone }}
                        >
                          {step.title.replace(/^\d+\.\s*/, '')}
                        </span>
                        {state === 'ok' && (
                          <span className="flex items-center gap-1" style={{ color: CK.green }}>
                            <PxIcon name="check" size={13} />
                            <Readout color={CK.green}>OK</Readout>
                          </span>
                        )}
                        {state === 'live' && <Readout color={CK.amber}>Live</Readout>}
                        {state === 'off' && <Readout>Queued</Readout>}
                      </div>

                      {isCurrent && (
                        <div className="px-2.5 pb-3">
                          <p className="text-[13px] leading-[1.55]" style={{ color: '#CFC8BA' }}>
                            {step.body}
                          </p>
                          <div className="mt-2.5 flex items-center gap-2">
                            <span
                              className="flex items-center gap-1.5 px-2 py-1"
                              style={{ boxShadow: `inset 0 0 0 1px ${CK.bezel}`, background: 'rgba(0,0,0,0.4)' }}
                            >
                              <PxIcon name={step.target.icon} size={13} style={{ color: CK.amber }} />
                              <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: CK.bone }}>
                                {step.target.label}
                              </span>
                            </span>
                            <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: CK.label }}>
                              {step.spotlight}
                            </span>
                          </div>
                          <PushBtn primary className="mt-3 w-full" onClick={tourJump}>
                            {step.cta}
                            <PxIcon name="chevR" size={13} />
                          </PushBtn>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            <PushBtn onClick={() => setTourStep((s) => Math.max(0, s - 1))} disabled={tourStep === 0}>
                              <PxIcon name="chevL" size={13} /> Back
                            </PushBtn>
                            <PushBtn onClick={() => setTourStep(0)}>Restart</PushBtn>
                            <PushBtn
                              onClick={() => setTourStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))}
                              disabled={tourStep === TOUR_STEPS.length - 1}
                            >
                              Next <PxIcon name="chevR" size={13} />
                            </PushBtn>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Rack>

          {/* ── INDEX QUERY — search ──────────────────────────── */}
          <Rack testId="manual-query">
            <RackHead
              icon={<PxIcon name="search" size={13} style={{ color: CK.boneDim }} />}
              label="Index Query"
              readout={searching ? <Readout color={CK.amber}>{matches.length} MATCH{matches.length === 1 ? '' : 'ES'}</Readout> : <Readout>{TOTAL_ENTRIES} ENT</Readout>}
            />
            <div className="px-3.5 py-3">
              <div
                className="flex min-h-[46px] items-center gap-2 px-2.5"
                style={{
                  background: CK.lcd,
                  boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.05)',
                }}
              >
                <PxIcon name="search" size={17} style={{ color: CK.label, flexShrink: 0 }} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the manual..."
                  aria-label="Search the manual"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                  style={{ color: CK.bone, caretColor: CK.amber }}
                />
                {query === '' && <span aria-hidden className="ck-caret block h-[18px] w-[8px] shrink-0" style={{ background: CK.amber }} />}
                {query !== '' && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="flex h-[44px] w-[36px] shrink-0 items-center justify-center"
                    style={{ color: CK.boneDim }}
                  >
                    <PxIcon name="x" size={13} />
                  </button>
                )}
              </div>

              {searching && (
                <div className="mt-2.5 space-y-1.5">
                  {matches.length === 0 && (
                    <p className="py-1 text-[12px] uppercase tracking-[0.1em]" style={{ color: CK.boneDim }}>
                      No matches in index.
                    </p>
                  )}
                  {matches.map(({ section: s, channel, item }) => (
                    <button
                      key={`${s.id}-${item.term}`}
                      type="button"
                      onClick={() => openSection(s.id)}
                      className="flex min-h-[48px] w-full items-center gap-2.5 px-2.5 py-2 text-left transition-transform active:translate-y-[1px]"
                      style={{
                        background: 'rgba(0,0,0,0.38)',
                        border: '2px solid #000',
                        boxShadow: `inset 0 0 0 1px ${CK.bezel}`,
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold uppercase tracking-[0.05em]" style={{ color: CK.bone }}>
                          {item.term}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px]" style={{ color: CK.boneDim }}>
                          {item.body}
                        </span>
                      </span>
                      <Readout>
                        CH-<span style={{ color: CK.bone }}>{pad2(channel)}</span>
                      </Readout>
                      <PxIcon name="chevR" size={13} style={{ color: CK.label, flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Rack>

          {/* ── CHANNEL SELECT — the contents bank ────────────── */}
          {!searching && (
            <div data-testid="manual-channels">
              <div className="flex items-end justify-between px-1 pb-2 pt-1">
                <h2 className="text-[13px] font-bold uppercase tracking-[0.18em]" style={{ color: CK.bone }}>
                  Channel Select
                </h2>
                <Readout>
                  {pad2(SECTIONS.length)} CH · {TOTAL_ENTRIES} ENT
                </Readout>
              </div>
              <div className="space-y-1.5">{SECTIONS.map((s, ci) => channelRow(s, ci))}</div>
              <div className="flex items-center justify-center gap-2 pb-1 pt-3">
                <Lamp state="live" size={8} />
                <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: CK.label }}>
                  Awaiting channel select
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {view.kind === 'section' && section && (
        <>
          {/* ── Channel header ──────────────────────────────── */}
          <div className="flex items-center gap-2">
            <PushBtn onClick={() => setView({ kind: 'index' })} className="flex-1">
              <PxIcon name="chevL" size={13} /> Index
            </PushBtn>
            <Readout>
              CH-<span style={{ color: CK.bone }}>{pad2(sectionIndex + 1)}</span> / {pad2(SECTIONS.length)}
            </Readout>
          </div>

          <Rack testId="manual-channel-head">
            <div className="px-3.5 py-3.5">
              <div className="flex items-center gap-3">
                <span
                  className="ck-num flex h-[56px] w-[64px] shrink-0 items-center justify-center text-[24px] font-bold"
                  style={{
                    color: CK.amber,
                    background: CK.lcd,
                    textShadow: '0 0 9px rgba(255,144,0,0.35)',
                    boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.9)',
                  }}
                >
                  {pad2(sectionIndex + 1)}
                </span>
                <span
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center"
                  style={{ color: CK.boneDim, boxShadow: `inset 0 0 0 1px ${CK.bezel}`, background: 'rgba(0,0,0,0.35)' }}
                >
                  <PxIcon name={section.icon} size={26} />
                </span>
                <div className="min-w-0">
                  <h1
                    className="truncate text-[28px] uppercase leading-[0.95]"
                    style={{ fontFamily: "'Bebas Neue', 'Chakra Petch', sans-serif", letterSpacing: '0.04em', color: CK.bone }}
                  >
                    {section.title}
                  </h1>
                  <p className="mt-1 text-[12.5px] leading-snug" style={{ color: CK.boneDim }}>
                    {section.blurb}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Lcd label="Entries" value={pad2(section.items.length)} />
                <Lcd label="Position" value={`${sectionIndex + 1} OF ${SECTIONS.length}`} />
                <Lcd label="Status" value={<span className="flex items-center gap-2 text-[15px]"><Lamp state="ok" size={8} /> ONLINE</span>} />
              </div>
            </div>
          </Rack>

          {/* ── Channel switcher rail ───────────────────────── */}
          <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="manual-channel-rail">
            {SECTIONS.map((s, ci) => {
              const current = ci === sectionIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSection(s.id)}
                  className="ck-num flex min-h-[44px] shrink-0 items-center px-3 text-[12px] font-bold tracking-[0.1em] transition-transform active:translate-y-[1px]"
                  style={
                    current
                      ? {
                          background: 'linear-gradient(180deg, #FFAA2E 0%, #FF9000 60%, #E07B00 100%)',
                          color: '#14100A',
                          border: '2px solid #000',
                          boxShadow: '0 2px 0 #000, inset 0 1px 0 rgba(255,255,255,0.45)',
                        }
                      : {
                          background: 'linear-gradient(180deg, #262B38 0%, #181C25 100%)',
                          color: CK.boneDim,
                          border: '2px solid #000',
                          boxShadow: `0 2px 0 #000, inset 0 0 0 1px ${CK.bezel}`,
                        }
                  }
                >
                  CH-{pad2(ci + 1)}
                </button>
              );
            })}
          </div>

          {/* ── SPEC SHEET — the entries ──────────────────────── */}
          <Rack testId="manual-spec-sheet">
            <RackHead
              label={`Spec Sheet — ${section.title}`}
              readout={
                <Readout>
                  <span style={{ color: CK.bone }}>{pad2(section.items.length)}</span> ENTRIES
                </Readout>
              }
            />
            <div className="px-3.5 py-2">
              {section.items.map((item, i) => (
                <article
                  key={item.term}
                  className="py-3"
                  style={i > 0 ? { borderTop: `1px solid ${CK.bezel}` } : undefined}
                >
                  <div className="flex items-baseline gap-2.5">
                    <span className="ck-num text-[11px] font-bold tracking-[0.12em]" style={{ color: CK.amber }}>
                      E-{pad2(i + 1)}
                    </span>
                    <h3 className="text-[14px] font-bold uppercase leading-tight tracking-[0.06em]" style={{ color: CK.bone }}>
                      {item.term}
                    </h3>
                  </div>
                  <p className="mt-1.5 pl-[42px] text-[13.5px] leading-[1.6]" style={{ color: '#CFC8BA' }}>
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          </Rack>

          {/* ── Prev / next channel ───────────────────────────── */}
          <div className="grid grid-cols-2 gap-2">
            <PushBtn
              onClick={() => sectionIndex > 0 && openSection(SECTIONS[sectionIndex - 1].id)}
              disabled={sectionIndex === 0}
            >
              <PxIcon name="chevL" size={13} />
              <span className="min-w-0">
                <span className="block text-[11px]" style={{ color: CK.label }}>Prev</span>
                <span className="block max-w-[130px] truncate">
                  {sectionIndex > 0 ? SECTIONS[sectionIndex - 1].title : '—'}
                </span>
              </span>
            </PushBtn>
            <PushBtn
              onClick={() => sectionIndex < SECTIONS.length - 1 && openSection(SECTIONS[sectionIndex + 1].id)}
              disabled={sectionIndex === SECTIONS.length - 1}
            >
              <span className="min-w-0 text-right">
                <span className="block text-[11px]" style={{ color: CK.label }}>Next</span>
                <span className="block max-w-[130px] truncate">
                  {sectionIndex < SECTIONS.length - 1 ? SECTIONS[sectionIndex + 1].title : '—'}
                </span>
              </span>
              <PxIcon name="chevR" size={13} />
            </PushBtn>
          </div>
        </>
      )}
    </div>
  );
};
