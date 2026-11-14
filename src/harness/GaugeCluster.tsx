import React, { useEffect, useRef, useState } from 'react';

/**
 * Gauge Cluster (THROWAWAY rendering prototype, 2026-11-13 —
 * harness only, never shipped). One analog needle gauge per live
 * quantity. The needle is driven by a real spring integrator
 * (semi-implicit Euler at rAF): it sweeps, overshoots and settles —
 * the overshoot is the physics of the needle, never of the number.
 * The digital readout under the hub always prints the true target
 * value the instant it is set; the needle catches up.
 *
 * A red arc segment / red tick is drawn ONLY where the caller
 * passes a real threshold (redFrom / ticks[].red) sourced from the
 * fixture or the content defs — this component invents none.
 */

export interface GaugeTick {
  /** Position on the scale, 0..1. */
  at: number;
  red?: boolean;
}

export interface GaugeSpec {
  key: string;
  label: string;
  /** Needle target, 0..1 of scale. */
  frac: number;
  /** Exact digital value printed under the hub. */
  display: string;
  color: string;
  ticks?: GaugeTick[];
  /** Start of a red arc segment, 0..1 — only for a real threshold. */
  redFrom?: number;
  /** This dial just changed: full brightness; others sit muted. */
  hot?: boolean;
  hero?: boolean;
  /** Spring tuning: stiffness / damping (underdamped by default). */
  k?: number;
  d?: number;
}

const SWEEP = 240; // degrees of dial travel
const START = -120; // needle angle at frac 0

const polar = (frac: number, r: number): [number, number] => {
  const a = ((START + frac * SWEEP) * Math.PI) / 180;
  return [50 + r * Math.sin(a), 46 - r * Math.cos(a)];
};

const arcPath = (from: number, to: number, r: number): string => {
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  const large = (to - from) * SWEEP > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

const Gauge: React.FC<{ spec: GaugeSpec }> = ({ spec }) => {
  const size = spec.hero ? 148 : 86;
  const [frac, setFrac] = useState(spec.frac);
  const stateRef = useRef({ x: spec.frac, v: 0 });
  const targetRef = useRef(spec.frac);
  targetRef.current = spec.frac;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      const k = spec.k ?? 110;
      const d = spec.d ?? 10.5;
      // semi-implicit Euler spring toward the target
      const a = k * (targetRef.current - s.x) - d * s.v;
      s.v += a * dt;
      s.x += s.v * dt;
      if (Math.abs(s.v) < 0.0005 && Math.abs(targetRef.current - s.x) < 0.0005) {
        s.x = targetRef.current;
        s.v = 0;
      }
      setFrac(s.x);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const angle = START + frac * SWEEP;
  const [nx, ny] = polar(Math.max(-0.04, Math.min(1.04, frac)), 29);
  const bright = spec.hot ? 1 : 0.62;

  return (
    <div
      data-testid={`gauge-${spec.key}`}
      style={{
        width: size,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity: bright,
        transition: 'opacity 250ms ease',
      }}
    >
      <svg viewBox="0 0 100 66" width={size} height={size * 0.66} aria-label={spec.label}>
        {/* scale arc */}
        <path d={arcPath(0, 1, 38)} stroke="#232833" strokeWidth="3" fill="none" />
        {/* red threshold arc — only when a real threshold was passed in */}
        {spec.redFrom !== undefined && (
          <path d={arcPath(spec.redFrom, 1, 38)} stroke="#FF4D2E" strokeWidth="3" fill="none" opacity="0.85" />
        )}
        {/* value arc in the dial's own color, up to the needle */}
        <path
          d={arcPath(0, Math.max(0.001, Math.min(1, frac)), 38)}
          stroke={spec.color}
          strokeWidth="3"
          fill="none"
          opacity="0.9"
        />
        {/* ticks */}
        {(spec.ticks ?? []).map((t, i) => {
          const [x1, y1] = polar(t.at, 33);
          const [x2, y2] = polar(t.at, 38.5);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={t.red ? '#FF4D2E' : '#4A5265'}
              strokeWidth={t.red ? 2.4 : 1.4}
            />
          );
        })}
        {/* needle */}
        <line x1="50" y1="46" x2={nx} y2={ny} stroke={spec.hot ? '#FFFFFF' : '#C9D2E0'} strokeWidth="2.6" />
        <line x1="50" y1="46" x2={50 - (nx - 50) * 0.28} y2={46 - (ny - 46) * 0.28} stroke={spec.hot ? '#FFFFFF' : '#C9D2E0'} strokeWidth="2.6" />
        <circle cx="50" cy="46" r="4.6" fill="#12151D" stroke={spec.color} strokeWidth="1.8" />
        {/* angle kept for debugging / capture probes */}
        <title>{`${spec.label} angle ${angle.toFixed(1)}`}</title>
      </svg>
      {/* digital value — the fact, printed the instant it is set */}
      <div
        style={{
          fontSize: spec.hero ? 15 : 12,
          fontWeight: 900,
          lineHeight: '15px',
          color: spec.color,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {spec.display}
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: '#8A93A3', whiteSpace: 'nowrap' }}>
        {spec.label}
      </div>
    </div>
  );
};

export const GaugeCluster: React.FC<{ gauges: GaugeSpec[]; testId?: string }> = ({ gauges, testId }) => (
  <div
    data-testid={testId ?? 'gauge-cluster'}
    style={{
      background: '#07080B',
      border: '2px solid #232833',
      borderTop: 'none',
      padding: '10px 8px 8px',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-around',
      gap: 4,
    }}
  >
    {gauges.map((g) => (
      <Gauge key={g.key} spec={g} />
    ))}
  </div>
);
