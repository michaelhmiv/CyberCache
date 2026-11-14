import React from 'react';

/**
 * Quota Race (THROWAWAY rendering prototype, 2026-11-13 — harness
 * only, never shipped). The concept's ONLY new grammar: two bars
 * racing on one shared track toward one finish line (the quota).
 * The top bar is always YOUR output climbing toward the quota; the
 * bottom bar is the opposing REAL state — either draining toward
 * zero (enemy HP, remaining time) or charging toward the same line
 * (a boss telegraph, a pass clock, a pace tier). Both bars carry
 * their exact real values at every beat; the status line states
 * only the arithmetic relationship between the two (who leads, by
 * how much, what remains) — never an invented outcome.
 *
 * Seated in the game's existing panel chrome (#07080B ground,
 * #232833 border — the craftbars harness's own seat colors). No new
 * palette, no new typeface. All type >= 11px, tabular numerals.
 */

export interface RaceBarSpec {
  label: string;
  /** Exact value text, e.g. "200 / 300". */
  valueText: string;
  /** Bar length, 0..1 of the shared track. */
  frac: number;
  color: string;
  /** The bar that just moved: full brightness; the other sits muted. */
  hot?: boolean;
}

export interface RacePairProps {
  top: RaceBarSpec;
  bottom: RaceBarSpec;
  /** Finish-line label — the quota both bars are measured against. */
  quotaText: string;
  /** The race's arithmetic truth at this beat, stated plainly. */
  status: string;
  /** Optional fixture anatomy line (components that sum to a total). */
  detail?: string;
  testId?: string;
}

const Bar: React.FC<{ spec: RaceBarSpec; isTop: boolean }> = ({ spec, isTop }) => (
  <div style={{ opacity: spec.hot ? 1 : 0.72, transition: 'opacity 250ms ease' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: '#8A93A3', whiteSpace: 'nowrap' }}>
        {spec.label}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 900,
          color: spec.color,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {spec.valueText}
      </span>
    </div>
    <div
      style={{
        position: 'relative',
        height: 16,
        background: '#1A1E27',
        marginTop: 3,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.max(0, Math.min(1, spec.frac)) * 100}%`,
          background: spec.color,
          transition: 'width 650ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      {/* quarter markers — track geometry only, no data implied */}
      {[0.25, 0.5, 0.75].map((q) => (
        <div
          key={q}
          style={{ position: 'absolute', left: `${q * 100}%`, top: 0, bottom: 0, width: 1, background: '#050608', opacity: 0.55 }}
        />
      ))}
      {isTop ? null : null}
    </div>
  </div>
);

export const RacePair: React.FC<RacePairProps> = ({ top, bottom, quotaText, status, detail, testId }) => (
  <div
    data-testid={testId ?? 'race-pair'}
    style={{
      background: '#07080B',
      border: '2px solid #232833',
      borderTop: 'none',
      padding: '10px 12px 9px',
      boxSizing: 'border-box',
      position: 'relative',
    }}
  >
    {/* finish line: the quota, drawn at the track's right edge */}
    <div
      style={{
        position: 'absolute',
        right: 12,
        top: 26,
        bottom: 34,
        width: 2,
        background: '#E8ECF3',
        opacity: 0.5,
      }}
    />
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: '#E8ECF3' }}>{quotaText}</span>
    </div>
    <Bar spec={top} isTop />
    <div style={{ height: 8 }} />
    <Bar spec={bottom} isTop={false} />
    <div
      style={{
        marginTop: 8,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.06em',
        color: '#C9D2E0',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {status}
    </div>
    {detail ? (
      <div style={{ marginTop: 3, fontSize: 11, fontWeight: 700, color: '#8A93A3', fontVariantNumeric: 'tabular-nums' }}>
        {detail}
      </div>
    ) : null}
  </div>
);
