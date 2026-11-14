import React from 'react';

/**
 * SIGNAL TRACE band (iter-03, THROWAWAY harness prototype — never
 * shipped). A scrolling scope trace seated under the real stage:
 * amplitude = event size, density = event rate. Each combat burst's
 * SHAPE separates its components, drawn left to right in claim
 * order: DMG plateau -> FIRE hump -> SPD ripple -> MOLTEN echo
 * spike -> ECHO spike. Amplitude scale is linear and fixed:
 * 1 damage unit = 0.45 px, snapped to the 4 px texel step the
 * game's light kit uses. Purely presentational: the harness page
 * feeds it frames built from the verbatim fixture; it owns no
 * game state and rolls nothing.
 */

export type TracePartKey = 'dmg' | 'fire' | 'spd' | 'molten' | 'echo' | 'find';

export interface TracePart {
  key: TracePartKey;
  value: number;
}

export interface TraceBurst {
  total: number;
  parts: TracePart[];
  crit?: boolean;
}

export interface TraceTelegraph {
  label: string;
  /** 0 = faint dashed ghost at the right edge; 1 = solid, landed. */
  progress: number;
  countdown: string;
}

const COLORS: Record<TracePartKey, string> = {
  dmg: '#FFD23C',
  fire: '#FF7A1A',
  spd: '#2DD4EE',
  molten: '#FFB300',
  echo: '#B18CFF',
  find: '#2DD4EE',
};

const W = 364;
const H = 96;
const BASE = 62; // baseline y
const STEP = 4;
const SCALE = 0.45;

const amp = (v: number): number => Math.max(STEP, Math.round((v * SCALE) / STEP) * STEP);

/** Points for one part's shape, starting at (x, BASE). Returns the
 *  polyline points and the x where the next part begins. */
const partPoints = (key: TracePartKey, value: number, x: number): { pts: string; nextX: number } => {
  const a = amp(value);
  const top = BASE - a;
  switch (key) {
    case 'dmg': {
      // flat-topped plateau: the base hit reads as a held block
      const w = 26;
      return { pts: `${x},${BASE} ${x},${top} ${x + w},${top} ${x + w},${BASE - STEP}`, nextX: x + w };
    }
    case 'fire': {
      // rounded hump (sampled arc)
      const w = 20;
      const pts = [`${x},${BASE - STEP}`];
      for (let i = 1; i < 5; i++) {
        const t = i / 5;
        const y = BASE - STEP - Math.round((Math.sin(t * Math.PI) * a) / STEP) * STEP;
        pts.push(`${x + Math.round(w * t)},${y}`);
      }
      pts.push(`${x + w},${BASE - STEP}`);
      return { pts: pts.join(' '), nextX: x + w };
    }
    case 'spd': {
      // fast ripple: three narrow teeth
      const pts = [`${x},${BASE - STEP}`];
      let cx = x;
      for (let i = 0; i < 3; i++) {
        pts.push(`${cx + 3},${top}`);
        pts.push(`${cx + 6},${BASE - STEP}`);
        cx += 6;
      }
      return { pts: pts.join(' '), nextX: cx };
    }
    case 'molten':
    case 'echo': {
      // proc echo: one delayed sharp spike after a gap
      const gx = x + 7;
      return { pts: `${gx},${BASE} ${gx + 3},${top} ${gx + 6},${BASE}`, nextX: gx + 6 };
    }
    case 'find': {
      // gathering find: one short blip
      return { pts: `${x},${BASE} ${x + 3},${top} ${x + 6},${BASE}`, nextX: x + 10 };
    }
  }
};

const Burst: React.FC<{ burst: TraceBurst; x: number; dim: boolean }> = ({ burst, x, dim }) => {
  let cx = x;
  const segs: React.ReactNode[] = [];
  burst.parts.forEach((p, i) => {
    const { pts, nextX } = partPoints(p.key, p.value, cx);
    segs.push(
      <polyline
        key={i}
        points={pts}
        fill="none"
        stroke={COLORS[p.key]}
        strokeWidth={2.5}
        strokeLinejoin="round"
        opacity={dim ? 0.4 : 1}
      />,
    );
    cx = nextX;
  });
  const dmgPart = burst.parts.find((p) => p.key === 'dmg');
  const critTop = dmgPart ? BASE - amp(dmgPart.value) : 0;
  return (
    <g>
      {segs}
      {burst.crit && dmgPart && (
        <>
          <line x1={x} y1={critTop - 4} x2={x + 26} y2={critTop - 4} stroke="#FF4D2E" strokeWidth={2.5} />
          <text x={x + 13} y={critTop - 8} textAnchor="middle" fontSize={11} fontWeight={900} fill="#FF4D2E">
            ×2.0
          </text>
        </>
      )}
      <text
        x={x + 4}
        y={BASE + 16}
        fontSize={11}
        fontWeight={900}
        fill={burst.crit ? '#FF4D2E' : '#E8ECF3'}
        opacity={dim ? 0.45 : 1}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {burst.total}
      </text>
    </g>
  );
};

/** The boss telegraph: the Sand Slam signature — a low rumble
 *  resolving into one wide slam spike — entering from the right
 *  edge as a dashed ghost and solidifying as the windup runs. */
const Telegraph: React.FC<{ t: TraceTelegraph }> = ({ t }) => {
  const x0 = 268;
  const pts = [
    `${x0},${BASE}`,
    `${x0 + 14},${BASE - 8}`,
    `${x0 + 26},${BASE - 4}`,
    `${x0 + 40},${BASE - 12}`,
    `${x0 + 52},${BASE - 60}`,
    `${x0 + 60},${BASE}`,
    `${x0 + 84},${BASE}`,
  ].join(' ');
  return (
    <g>
      <polyline
        points={pts}
        fill="none"
        stroke="#FF4D2E"
        strokeWidth={2.5}
        strokeDasharray="5 4"
        opacity={0.35 + t.progress * 0.65}
        strokeLinejoin="round"
      />
      {t.progress > 0.45 && (
        <polyline points={pts} fill="none" stroke="#FF4D2E" strokeWidth={2.5} opacity={0.9} strokeLinejoin="round"
          strokeDasharray={`${Math.round(t.progress * 200)} 400`} />
      )}
      <text x={x0 + 42} y={14} textAnchor="middle" fontSize={11} fontWeight={900} fill="#FF4D2E" letterSpacing="0.06em">
        {t.label} · {t.countdown}
      </text>
    </g>
  );
};

export interface SignalTraceProps {
  bursts: TraceBurst[];
  /** Right-aligned state readout, e.g. "204 / 300 HP". */
  stateLabel: string;
  /** Left-aligned event caption, e.g. "TICK 2 · MOLTEN CORE". */
  caption: string;
  captionColor?: string;
  /** Shield hit on the latest burst: downward deflection, value = SHLD lost. */
  shieldDip?: number;
  telegraph?: TraceTelegraph | null;
  /** Research mode: a slow wall-clock wave, fraction complete 0..1. */
  slowWave?: number | null;
  footerLeft?: string;
  footerRight?: string;
}

export const SignalTrace: React.FC<SignalTraceProps> = ({
  bursts,
  stateLabel,
  caption,
  captionColor = '#8A93A3',
  shieldDip,
  telegraph,
  slowWave,
  footerLeft,
  footerRight,
}) => {
  // Bursts scroll: oldest at left, latest ends near x=250 so a
  // telegraph (or the future) still has room to enter at right.
  const burstWidth = 118;
  const startX = Math.max(6, 250 - bursts.length * burstWidth);
  // slow research wave points
  let waveDone = '';
  let waveTodo = '';
  if (slowWave != null) {
    const donePts: string[] = [];
    const todoPts: string[] = [];
    for (let x = 6; x <= W - 6; x += 6) {
      const y = BASE - 14 - Math.round((Math.sin(x / 34) * 10) / STEP) * STEP;
      ((x - 6) / (W - 12) <= slowWave ? donePts : todoPts).push(`${x},${y}`);
    }
    waveDone = donePts.join(' ');
    waveTodo = todoPts.join(' ');
  }
  return (
    <div
      data-testid="signal-trace"
      style={{
        background: '#07080B',
        border: '2px solid #232833',
        borderTop: 'none',
        padding: '8px 10px 6px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: captionColor }}>{caption}</span>
        <span style={{ fontSize: 11, fontWeight: 900, color: '#E8ECF3', fontVariantNumeric: 'tabular-nums' }}>{stateLabel}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }} aria-hidden>
        {/* scope grid: baseline + faint amplitude rails */}
        <line x1={0} y1={BASE} x2={W} y2={BASE} stroke="#2A3040" strokeWidth={1.5} />
        <line x1={0} y1={BASE - 28} x2={W} y2={BASE - 28} stroke="#161A22" strokeWidth={1} />
        <line x1={0} y1={BASE - 56} x2={W} y2={BASE - 56} stroke="#161A22" strokeWidth={1} />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <line key={i} x1={6 + i * 44} y1={BASE} x2={6 + i * 44} y2={BASE + 4} stroke="#2A3040" strokeWidth={1.5} />
        ))}
        {slowWave != null && waveTodo && <polyline points={waveTodo} fill="none" stroke="#39415A" strokeWidth={2} strokeDasharray="4 4" />}
        {slowWave != null && waveDone && <polyline points={waveDone} fill="none" stroke="#B18CFF" strokeWidth={2.5} strokeLinejoin="round" />}
        {bursts.map((b, i) => (
          <Burst key={i} burst={b} x={startX + i * burstWidth} dim={i < bursts.length - 1} />
        ))}
        {shieldDip != null && bursts.length > 0 && (
          <g>
            <polyline
              points={`${startX + (bursts.length - 1) * burstWidth + 84},${BASE} ${startX + (bursts.length - 1) * burstWidth + 90},${BASE + amp(shieldDip)} ${startX + (bursts.length - 1) * burstWidth + 98},${BASE}`}
              fill="none"
              stroke="#6EC1FF"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
            <text
              x={startX + (bursts.length - 1) * burstWidth + 91}
              y={BASE + amp(shieldDip) + 14}
              textAnchor="middle"
              fontSize={11}
              fontWeight={900}
              fill="#6EC1FF"
            >
              SHLD −{shieldDip}
            </text>
          </g>
        )}
        {telegraph && <Telegraph t={telegraph} />}
        {bursts.length === 0 && slowWave == null && !telegraph && (
          <text x={8} y={BASE - 10} fontSize={11} fontWeight={700} fill="#5B6472" letterSpacing="0.08em">
            FLATLINE · NO EVENTS
          </text>
        )}
      </svg>
      {(footerLeft || footerRight) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#5B6472', letterSpacing: '0.06em' }}>{footerLeft ?? ''}</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#8A93A3', fontVariantNumeric: 'tabular-nums' }}>{footerRight ?? ''}</span>
        </div>
      )}
    </div>
  );
};
