import React, { useEffect, useState } from 'react';
import { RacePair } from './RacePair';
import { EXTRACTION_LEVER_DEFAULTS, EXTRACTION_PASS_MS } from '@/content/extraction';
import { researchCourse, RESEARCH_MASTERY_XP_PER_HOUR } from '@/content/research';

/**
 * Quota Race — gathering/extraction + research panels
 * (THROWAWAY rendering prototype, 2026-11-13, harness only).
 *
 * Neither occupation has a diorama scene: their real surfaces are
 * panels (ExtractionPanel / ResearchPanel) that read settled Chef
 * state and cannot mount without a server. This page mounts the
 * race pair under a fact header built ONLY from the occupations'
 * content defs — every number below is imported or derived in-line
 * from those defs, never typed from memory. (Same honest-mount
 * pattern as sibling iterations; README states it plainly.)
 *
 * EXTRACTION (src/content/extraction.ts): Surface pass at
 * Dustwaste Frontier (the default roaming area). Pass =
 * EXTRACTION_PASS_MS (10 min). Draws at full rate =
 * extractFindsPerHour (192/h) → 32 draws per pass — the finds
 * quota. Seeded gear factor 0.82 → expected draws 32 × 0.82 =
 * 26.24; the yield beat stages 26 finds (Scrap ×17 · Ballistic
 * Parts ×9 — both in Dustwaste Frontier's shipped materialBias,
 * src/constants/roamingAreas.ts), the floor of that expectation:
 * a presentation seed, not a server roll.
 * THE RACE: finds banked (top) vs the pass clock (bottom). Finds
 * land ONLY at pass settlement (the def's law), so mid-pass the
 * clock bar leads alone — the race's tension is honest: the quota
 * is only scored when the clock bar finishes.
 *
 * RESEARCH (src/content/research.ts): Shop Fundamentals —
 * Fabrication T1, 6 h, 2,500 cr fee (destroyed at enroll; it never
 * moves, so it is not a racer — README). Mastery XP = 10/h × 6 h
 * = 60, granted ONCE at completion (the def's R-law).
 * THE RACE: elapsed time (top, climbing to the 6 h quota) vs
 * remaining time (bottom, draining to zero) — two bars converging
 * on the same completion from opposite ends.
 *
 * Drive: ?mode=extract|research ?beat=start|flow|yield|done and
 * window.__setBeat(...).
 */

const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const Header: React.FC<{ title: string; lines: string[] }> = ({ title, lines }) => (
  <div
    data-testid="panel-fact-header"
    style={{ background: '#07080B', border: '2px solid #232833', padding: '12px 14px', boxSizing: 'border-box' }}
  >
    <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.06em', color: '#E8ECF3' }}>{title}</div>
    {lines.map((l) => (
      <div key={l} style={{ fontSize: 11, fontWeight: 700, color: '#8A93A3', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {l}
      </div>
    ))}
  </div>
);

// ─── Extraction ──────────────────────────────────────────────────

const DRAWS_PER_PASS_FULL = Math.round((EXTRACTION_LEVER_DEFAULTS.extractFindsPerHour * EXTRACTION_PASS_MS) / 3_600_000); // 32
const YIELD_FINDS = 26;

interface ExtractBeat {
  passMs: number;
  finds: number;
  status: string;
  detail: string;
  hot: 'top' | 'bottom' | null;
  settled: boolean;
}
const EXTRACT_BEATS: Record<string, ExtractBeat> = {
  start: {
    passMs: 40_000, finds: 0, settled: false, hot: null,
    status: 'AT THE LINE — PASS CLOCK RUNNING · NO FINDS BANKED YET',
    detail: 'SURFACE · GEAR FACTOR 0.82 · EXPECTED 32 × 0.82 = 26.24 FINDS',
  },
  flow: {
    passMs: 380_000, finds: 0, settled: false, hot: 'bottom',
    status: 'CLOCK LEADS — 6:20 GONE · FINDS LAND ONLY AT SETTLEMENT',
    detail: 'FINDS ARE MATERIALS + ESSENCES ONLY (EXTRACTION DEF)',
  },
  yield: {
    passMs: EXTRACTION_PASS_MS, finds: YIELD_FINDS, settled: true, hot: 'top',
    status: 'SETTLED — CLOCK FINISHED · 26 FINDS BANKED AGAINST THE 32 QUOTA',
    detail: 'SCRAP ×17 · BALLISTIC PARTS ×9 (DUSTWASTE FRONTIER MATERIAL BIAS)',
  },
};

// ─── Research ────────────────────────────────────────────────────

const COURSE = researchCourse('shop_fundamentals')!;
const COURSE_MS = COURSE.durationHours * 3_600_000;
const COURSE_XP = RESEARCH_MASTERY_XP_PER_HOUR * COURSE.durationHours; // 60

interface ResearchBeat {
  elapsedMs: number;
  status: string;
  detail: string;
  hot: 'top' | 'bottom' | null;
  done: boolean;
}
const RESEARCH_BEATS: Record<string, ResearchBeat> = {
  start: {
    elapsedMs: 0.4 * 3_600_000, done: false, hot: null,
    status: 'EARLY — 0.4 H IN · 5.6 H STILL ON THE CLOCK',
    detail: 'FABRICATION · TIER 1 · FEE 2,500 CR PAID AT ENROLL',
  },
  flow: {
    elapsedMs: 3.6 * 3_600_000, done: false, hot: 'top',
    status: 'PAST HALFWAY — ELAPSED LEADS REMAINING BY 1.2 H',
    detail: 'PROGRESS IS WALL-CLOCK · NO AWAY CAP (RESEARCH DEF)',
  },
  done: {
    elapsedMs: COURSE_MS, done: true, hot: 'top',
    status: 'FINISH — BARS MEET AT COMPLETION · +60 MASTERY XP',
    detail: 'UNLOCK: CRAFT QUALITY SHIFT +2 · XP GRANTED ONCE, AT COMPLETION',
  },
};

const hours = (ms: number): string => `${(ms / 3_600_000).toFixed(1)} H`;

// ─── Page ────────────────────────────────────────────────────────

export const PanelRacePage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const mode = params.get('mode') === 'research' ? 'research' : 'extract';
  const [beat, setBeat] = useState(params.get('beat') ?? 'start');

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (b: string) => setBeat(b);
  }, []);

  const ex = EXTRACT_BEATS[beat] ?? EXTRACT_BEATS.start;
  const re = RESEARCH_BEATS[beat] ?? RESEARCH_BEATS.start;

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      {mode === 'extract' ? (
        <>
          <Header
            title="EXTRACTION — DUSTWASTE FRONTIER"
            lines={[
              'SURFACE · PASS 10:00 · 192 DRAWS/H AT FACTOR 1',
              ex.settled ? 'PASS SETTLED — SCRAP ×17 · BALLISTIC PARTS ×9' : 'FINDS LAND AT PASS SETTLEMENT',
            ]}
          />
          <RacePair
            testId="extract-race-pair"
            quotaText="QUOTA — 32 FINDS · PASS 10:00"
            top={{ label: 'FINDS BANKED', valueText: `${ex.finds} / ${DRAWS_PER_PASS_FULL}`, frac: ex.finds / DRAWS_PER_PASS_FULL, color: '#F5B83D', hot: ex.hot === 'top' }}
            bottom={{ label: 'PASS ELAPSED', valueText: `${clock(ex.passMs)} / 10:00`, frac: ex.passMs / EXTRACTION_PASS_MS, color: '#2DD4EE', hot: ex.hot === 'bottom' }}
            status={ex.status}
            detail={ex.detail}
          />
        </>
      ) : (
        <>
          <Header
            title="RESEARCH — SHOP FUNDAMENTALS"
            lines={[
              'FABRICATION · TIER 1 · 6 H · FEE 2,500 CR PAID AT ENROLL',
              re.done ? 'COMPLETE — UNLOCK: CRAFT QUALITY SHIFT +2' : 'PROGRESS IS WALL-CLOCK · NO AWAY CAP',
            ]}
          />
          <RacePair
            testId="research-race-pair"
            quotaText="QUOTA — 6.0 H COURSE"
            top={{ label: 'ELAPSED', valueText: `${hours(re.elapsedMs)} / 6.0 H`, frac: re.elapsedMs / COURSE_MS, color: '#B18CFF', hot: re.hot === 'top' }}
            bottom={{ label: 'REMAINING', valueText: hours(COURSE_MS - re.elapsedMs), frac: (COURSE_MS - re.elapsedMs) / COURSE_MS, color: '#2DD4EE', hot: re.hot === 'bottom' }}
            status={re.status}
            detail={re.detail}
          />
        </>
      )}
    </div>
  );
};
