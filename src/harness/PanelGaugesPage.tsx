import React, { useEffect, useState } from 'react';
import { GaugeCluster, type GaugeSpec } from './GaugeCluster';
import { EXTRACTION_DEEP_GEAR_FACTOR, EXTRACTION_LEVER_DEFAULTS, EXTRACTION_PASS_MS } from '@/content/extraction';
import { researchCourse, RESEARCH_MASTERY_XP_PER_HOUR } from '@/content/research';

/**
 * Gauge Cluster — gathering/extraction + research/dispatch panels
 * (THROWAWAY rendering prototype, 2026-11-13, harness only).
 *
 * Neither occupation has a diorama scene: their real surfaces are
 * panels (ExtractionPanel / ResearchPanel) that read settled server
 * state through the Chef, so they cannot be mounted in a harness
 * without a server. This page mounts the gauge cluster under a
 * fact header built ONLY from the occupations' content defs —
 * every number below is imported or derived in-line from those
 * defs, never typed from memory. (README states this plainly.)
 *
 * EXTRACTION (src/content/extraction.ts): Surface pass at
 * Dustwaste Frontier. Pass = EXTRACTION_PASS_MS (10 min). Draws at
 * full rate = extractFindsPerHour (192/h) → 32 draws per pass;
 * Deep Delve rate = ×extractDeepYieldMult (288/h — red tick).
 * Gear factor dial: red tick at EXTRACTION_DEEP_GEAR_FACTOR (0.80,
 * the Deep settlement gate). Seeded gear factor 0.82 → expected
 * draws 32 × 0.82 = 26.24; the yield beat stages 26 finds
 * (TechFragments ×17 · BallisticParts ×9 — both in the area's
 * shipped materialBias, src/constants/roamingAreas.ts), the floor
 * of that expectation: a presentation seed, not a server roll.
 * No XP dial: pass XP needs benchmarkXpPerHour(level) settled
 * server-side — omitted rather than invented (README).
 *
 * RESEARCH (src/content/research.ts): Shop Fundamentals —
 * Fabrication T1, 6 h, 2,500 cr fee (paid at enroll, a sink, so no
 * fee dial: it never moves). Mastery XP = 10/h × duration, granted
 * ONCE at completion (R-law in the def) — the XP dial tracks the
 * accrued share and is labeled AT COMPLETION. Unlock on done:
 * craftQualityShift +2 (the course's own effects record).
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

const GEAR_FACTOR = 0.82;
const DRAWS_PER_PASS_FULL = Math.round((EXTRACTION_LEVER_DEFAULTS.extractFindsPerHour * EXTRACTION_PASS_MS) / 3_600_000); // 32
const YIELD_FINDS = 26;

interface ExtractState { passMs: number; finds: number; hot: string | null }
const EXTRACT_BEATS: Record<string, ExtractState> = {
  start: { passMs: 40_000, finds: 0, hot: null },
  flow: { passMs: 380_000, finds: 0, hot: 'pass' },
  yield: { passMs: 25_000, finds: YIELD_FINDS, hot: 'finds' },
};

const extractGauges = (s: ExtractState): GaugeSpec[] => [
  {
    key: 'pass', label: 'PASS · 10 MIN', frac: s.passMs / EXTRACTION_PASS_MS,
    display: clock(s.passMs), color: '#2DD4EE', hot: s.hot === 'pass',
    ticks: [{ at: 0.25 }, { at: 0.5 }, { at: 0.75 }], k: 70, d: 13,
  },
  {
    key: 'finds', label: 'FINDS THIS PASS', frac: s.finds / DRAWS_PER_PASS_FULL,
    display: String(s.finds), color: '#F5B83D', hot: s.hot === 'finds',
    ticks: [{ at: 0.5 }], k: 100, d: 10,
  },
  {
    key: 'gear', label: 'GEAR FACTOR', frac: GEAR_FACTOR,
    display: GEAR_FACTOR.toFixed(2), color: '#6EC1FF', hot: s.hot === 'gear',
    ticks: [{ at: EXTRACTION_DEEP_GEAR_FACTOR, red: true }], k: 70, d: 13,
  },
];

// ─── Research ────────────────────────────────────────────────────

const COURSE = researchCourse('shop_fundamentals')!;
const COURSE_MS = COURSE.durationHours * 3_600_000;
const COURSE_XP = RESEARCH_MASTERY_XP_PER_HOUR * COURSE.durationHours; // 60

interface ResearchState { elapsedMs: number; done: boolean; hot: string | null }
const RESEARCH_BEATS: Record<string, ResearchState> = {
  start: { elapsedMs: 0.4 * 3_600_000, done: false, hot: null },
  flow: { elapsedMs: 3.6 * 3_600_000, done: false, hot: 'elapsed' },
  done: { elapsedMs: COURSE_MS, done: true, hot: 'xp' },
};

const hours = (ms: number): string => `${(ms / 3_600_000).toFixed(1)} H`;

const researchGauges = (s: ResearchState): GaugeSpec[] => {
  const frac = s.elapsedMs / COURSE_MS;
  return [
    {
      key: 'elapsed', label: 'ELAPSED', frac, display: hours(s.elapsedMs), color: '#B18CFF',
      hot: s.hot === 'elapsed', ticks: [{ at: 0.25 }, { at: 0.5 }, { at: 0.75 }], k: 70, d: 13,
    },
    {
      key: 'remain', label: 'REMAINING', frac: 1 - frac, display: hours(COURSE_MS - s.elapsedMs), color: '#2DD4EE',
      hot: s.hot === 'remain', ticks: [{ at: 0.25 }, { at: 0.5 }, { at: 0.75 }], k: 70, d: 13,
    },
    {
      key: 'xp', label: 'MASTERY XP · AT COMPLETION', frac, display: String(Math.round(COURSE_XP * frac)), color: '#F5B83D',
      hot: s.hot === 'xp', ticks: [{ at: 0.5 }], k: 70, d: 13,
    },
  ];
};

// ─── Page ────────────────────────────────────────────────────────

export const PanelGaugesPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const mode = params.get('mode') === 'research' ? 'research' : 'extract';
  const [beat, setBeat] = useState(params.get('beat') ?? 'start');

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (b: string) => setBeat(b);
  }, []);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      {mode === 'extract' ? (
        <>
          <Header
            title="EXTRACTION — DUSTWASTE FRONTIER"
            lines={[
              'SURFACE · PASS 10:00 · 192 DRAWS/H AT FACTOR 1',
              beat === 'yield' ? 'PASS SETTLED — TECH FRAGMENTS ×17 · BALLISTIC PARTS ×9' : 'FINDS LAND AT PASS SETTLEMENT',
            ]}
          />
          <GaugeCluster gauges={extractGauges(EXTRACT_BEATS[beat] ?? EXTRACT_BEATS.start)} testId="extract-gauge-cluster" />
        </>
      ) : (
        <>
          <Header
            title="RESEARCH — SHOP FUNDAMENTALS"
            lines={[
              'FABRICATION · TIER 1 · 6 H · FEE 2,500 CR PAID AT ENROLL',
              beat === 'done' ? 'COMPLETE — UNLOCK: CRAFT QUALITY SHIFT +2' : 'PROGRESS IS WALL-CLOCK · NO AWAY CAP',
            ]}
          />
          <GaugeCluster gauges={researchGauges(RESEARCH_BEATS[beat] ?? RESEARCH_BEATS.start)} testId="research-gauge-cluster" />
        </>
      )}
    </div>
  );
};
