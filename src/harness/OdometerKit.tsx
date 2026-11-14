import React, { useEffect, useRef, useState } from 'react';

/**
 * ODOMETER SPLITS — shared display primitives (iter-08, harness only).
 *
 * The language: cumulative quantities read as ROLLING ODOMETER
 * DIGITS — each digit is a vertical 0–9 drum that translates to its
 * value and settles (one authored motion: exponential ease-out,
 * ~650 ms). Every event also posts a SPLIT row: its own total plus
 * a delta vs the previous event that is real subtraction, computed
 * in code from the fixture values — never typed. A spoked RATE
 * WHEEL spins at the craft pace: 1 revolution = 1 work beat, so
 * rev/min IS the pace (2 → 5 → 9 /MIN).
 *
 * Colors are the program's shipped source coding (BuildAnalyzerBand
 * / craftbars chrome): DMG #FFD23C, CRIT #FF4D2E, SPD #2DD4EE,
 * FIRE #FF7A1A, MOLTEN #FFB300, ECHO #B18CFF, SHLD #6EC1FF,
 * enemy #F87171, loot green #4ADE80, pace amber #F5B83D.
 * Panel chrome #07080B on 2px #232833 — the shipped harness grammar.
 * Presentation only — no combat math is run anywhere in this kit.
 */

export const SRC = {
  dmg: '#FFD23C',
  crit: '#FF4D2E',
  spd: '#2DD4EE',
  fire: '#FF7A1A',
  molten: '#FFB300',
  echo: '#B18CFF',
  shld: '#6EC1FF',
  enemy: '#F87171',
  loot: '#4ADE80',
  pace: '#F5B83D',
  dim: '#5B6472',
  faint: '#8A93A3',
  empty: '#1A1E27',
  ink: '#E8EAF0',
};

export const panelStyle: React.CSSProperties = {
  background: '#07080B',
  border: '2px solid #232833',
  borderTop: 'none',
  padding: '10px 12px 12px',
  boxSizing: 'border-box',
};

export const headStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  color: SRC.faint,
  whiteSpace: 'nowrap',
};

export const numStyle: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/* ─── Odometer ──────────────────────────────────────────────────
 * Renders a formatted string; every digit character becomes a drum
 * (a 0–9 strip translated by -digit × row height), every other
 * character (`.`, `:`, `,`) is a static column. The drum transition
 * is the concept's single authored motion. Values roll up or down
 * with the same mechanism — direction comes from the numbers. */
export const Odometer: React.FC<{
  text: string;
  size?: number;
  color?: string;
  testId?: string;
}> = ({ text, size = 22, color = SRC.ink, testId }) => {
  const rowH = Math.round(size * 1.18);
  return (
    <span
      data-testid={testId}
      style={{
        display: 'inline-flex',
        alignItems: 'flex-start',
        fontSize: size,
        fontWeight: 900,
        lineHeight: `${rowH}px`,
        color,
        ...numStyle,
      }}
    >
      {text.split('').map((ch, i) =>
        ch >= '0' && ch <= '9' ? (
          <span
            key={i}
            style={{ display: 'inline-block', height: rowH, overflow: 'hidden', width: '0.62em' }}
          >
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                transform: `translateY(${-Number(ch) * rowH}px)`,
                transition: 'transform 650ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {Array.from({ length: 10 }, (_, d) => (
                <span key={d} style={{ height: rowH, lineHeight: `${rowH}px`, textAlign: 'center' }}>
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} style={{ lineHeight: `${rowH}px` }}>
            {ch}
          </span>
        ),
      )}
    </span>
  );
};

/** Zero-padded integer text for an odometer, e.g. pad(96, 3) = "096". */
export const pad = (v: number, n: number): string => String(Math.max(0, Math.round(v))).padStart(n, '0');

/** m:ss clock text, e.g. clock(264) = "4:24". */
export const clock = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/* ─── Split row ─────────────────────────────────────────────────
 * One event's split: tag, component breakdown (the game's own
 * labels, in source colors), the event total, and the delta vs the
 * previous event. `delta === null` is the first event: it carries a
 * BASE marker — a fabricated ±0 would be a lie about a comparison
 * that never happened. */
export interface SplitPart {
  label: string;
  value: number;
  color: string;
}

export const SplitRow: React.FC<{
  tag: string;
  parts: SplitPart[];
  total: number;
  delta: number | null;
  note?: string;
  totalColor?: string;
}> = ({ tag, parts, total, delta, note, totalColor }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
      padding: '5px 0',
      borderTop: '1px solid #1A1E27',
      flexWrap: 'wrap',
    }}
  >
    <span style={{ ...headStyle, width: 22, color: SRC.dim }}>{tag}</span>
    {parts.map((p, i) => (
      <span key={i} style={{ fontSize: 11, fontWeight: 900, color: p.color, whiteSpace: 'nowrap', ...numStyle }}>
        {p.label} {p.value}
      </span>
    ))}
    {note && (
      <span style={{ fontSize: 11, fontWeight: 900, color: SRC.crit, whiteSpace: 'nowrap' }}>{note}</span>
    )}
    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      {delta === null ? (
        <span style={{ fontSize: 11, fontWeight: 800, color: SRC.dim, letterSpacing: '0.06em' }}>BASE</span>
      ) : (
        <span
          style={{
            fontSize: 12,
            fontWeight: 900,
            color: delta > 0 ? SRC.loot : delta < 0 ? SRC.enemy : SRC.faint,
            ...numStyle,
          }}
        >
          Δ {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
      <Odometer text={String(total)} size={15} color={totalColor ?? SRC.ink} />
    </span>
  </div>
);

/* ─── Rate wheel ────────────────────────────────────────────────
 * A spoked wheel whose spin speed IS the pace: one revolution per
 * work beat, so revolutions per minute = pace. Driven by rAF while
 * `spin` is true; `angle` seeds the frozen position for stills (a
 * still at a higher pace sits at a later angle — the progression
 * across the three craft stills is the ramp, frozen). One amber rim
 * marker makes rotation readable at a glance. */
export const RateWheel: React.FC<{
  pace: number;
  spin: boolean;
  angle: number;
  size?: number;
}> = ({ pace, spin, angle, size = 92 }) => {
  const [live, setLive] = useState(angle);
  const stateRef = useRef({ a: angle, last: 0 });
  stateRef.current.a = spin ? stateRef.current.a : angle;

  useEffect(() => {
    if (!spin) {
      setLive(angle);
      return undefined;
    }
    let raf = 0;
    stateRef.current.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - stateRef.current.last) / 1000);
      stateRef.current.last = now;
      // rev/min = pace → degrees/sec = pace × 360 / 60 = pace × 6
      stateRef.current.a = (stateRef.current.a + pace * 6 * dt) % 360;
      setLive(stateRef.current.a);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [spin, pace, angle]);

  const shown = spin ? live : angle;
  const cx = 50;
  const cy = 50;
  return (
    <svg
      data-testid="rate-wheel"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-label={`Rate wheel, pace ${pace} per minute`}
      style={{ flexShrink: 0 }}
    >
      <circle cx={cx} cy={cy} r="46" fill="none" stroke="#232833" strokeWidth="4" />
      <g transform={`rotate(${shown.toFixed(1)} ${cx} ${cy})`}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i * 60 * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + 42 * Math.sin(a)}
              y2={cy - 42 * Math.cos(a)}
              stroke="#4A5265"
              strokeWidth="3"
            />
          );
        })}
        <circle cx={cx} cy={cy - 42} r="5" fill={SRC.pace} />
      </g>
      <circle cx={cx} cy={cy} r="9" fill="#12151D" stroke={SRC.pace} strokeWidth="2.5" />
    </svg>
  );
};

/* ─── Hero counter ──────────────────────────────────────────────
 * The surface's one hero odometer: label on the left, drums on the
 * right. `hot` = the quantity that just changed (full bright);
 * settled counters render at the muted tone. */
export const HeroCounter: React.FC<{
  label: string;
  text: string;
  color?: string;
  hot?: boolean;
  size?: number;
  testId?: string;
}> = ({ label, text, color, hot, size = 26, testId }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: hot === false ? 0.72 : 1 }}>
    <span style={headStyle}>{label}</span>
    <Odometer text={text} size={size} color={color ?? SRC.ink} testId={testId} />
  </div>
);
