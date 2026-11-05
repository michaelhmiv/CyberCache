/**
 * StandingsConsoleKit — PROTOTYPE primitives for the Standings
 * "Instrument panel" variant (design/hunter-subpages-standings-b,
 * 2026-11-05). NOT shipped UI.
 *
 * The register is a telemetry deck: squared rack panels with steel
 * bezels and corner screws, inset LCD readout wells with scanlines,
 * LED indicators and bar meters. Everything is inset INTO the panel
 * — nothing sits on it. Mono is used strictly for data and
 * measurement (values, ranks, states), never as decoration. Color
 * lives in meter fills, LED states, and readout numerals — never in
 * a colored side bar.
 */
import React from 'react';
import {
  FAINT,
  GOLD,
  INK,
  monoStyle,
  SEG_EMPTY,
  STEEL_DARK,
} from './standingsConsoleTokens';

const panelShell: React.CSSProperties = {
  border: '2px solid #000',
  background: 'linear-gradient(180deg, #171310 0%, #100D09 58%, #0B0906 100%)',
  boxShadow:
    'inset 0 0 0 1px rgba(163,152,134,0.30), inset 0 1px 0 rgba(245,239,230,0.06), 4px 4px 0 rgba(0,0,0,0.6)',
};

/** Corner screws — 5px squares seated inside the squared corners. */
const Screws: React.FC = () => (
  <>
    {['left-[5px] top-[5px]', 'right-[5px] top-[5px]', 'bottom-[5px] left-[5px]', 'bottom-[5px] right-[5px]'].map(
      (pos) => (
        <span
          key={pos}
          aria-hidden="true"
          className={`absolute ${pos} h-[5px] w-[5px]`}
          style={{ backgroundColor: '#060504', boxShadow: 'inset 0 1px 0 rgba(201,187,166,0.55)' }}
        />
      ),
    )}
  </>
);

/** A squared rack panel: bezel + screws, content padded clear. */
export const Panel: React.FC<{
  children: React.ReactNode;
  className?: string;
  testId?: string;
  id?: string;
}> = ({ children, className = '', testId, id }) => (
  <section className={`relative ${className}`} style={panelShell} data-testid={testId} id={id}>
    <Screws />
    <div className="relative px-3.5 py-3">{children}</div>
  </section>
);

/**
 * Panel datum line: the measurement this panel reads, set as a mono
 * label with a ruled line and a short gold datum segment.
 */
export const PanelLabel: React.FC<{ label: string; right?: string; rightColor?: string }> = ({
  label,
  right,
  rightColor = FAINT,
}) => (
  <div className="mb-2.5">
    <div className="flex items-baseline justify-between gap-2">
      <span
        className="text-[11px] font-black uppercase"
        style={{ ...monoStyle, color: FAINT, letterSpacing: '0.14em' }}
      >
        {label}
      </span>
      {right && (
        <span className="text-[11px] font-bold" style={{ ...monoStyle, color: rightColor }}>
          {right}
        </span>
      )}
    </div>
    <div className="mt-1.5 flex" aria-hidden="true">
      <span style={{ width: 26, height: 2, backgroundColor: GOLD }} />
      <span className="flex-1" style={{ height: 1, marginTop: 1, backgroundColor: STEEL_DARK }} />
    </div>
  </div>
);

/** Inset LCD well: one measured value, scanlined dark glass. */
export const LcdWell: React.FC<{
  value: string;
  label: string;
  color?: string;
  valueSize?: number;
  className?: string;
}> = ({ value, label, color = INK, valueSize = 22, className = '' }) => (
  <div
    className={`relative overflow-hidden px-2 py-1.5 ${className}`}
    style={{
      border: `1px solid ${STEEL_DARK}`,
      background: 'linear-gradient(180deg, #050403 0%, #0A0806 100%)',
      boxShadow: 'inset 0 2px 7px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.6)',
    }}
  >
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(245,239,230,0.035) 0px, rgba(245,239,230,0.035) 1px, transparent 1px, transparent 3px)',
      }}
    />
    <div
      className="relative text-center font-bold leading-none"
      style={{ ...monoStyle, color, fontSize: valueSize }}
    >
      {value}
    </div>
    <div
      className="relative mt-1 text-center text-[11px] font-bold uppercase leading-none"
      style={{ ...monoStyle, color: FAINT, letterSpacing: '0.12em' }}
    >
      {label}
    </div>
  </div>
);

/** A single LED indicator: lit (glow) or dark. */
export const Led: React.FC<{ lit: boolean; color?: string; size?: number }> = ({
  lit,
  color = GOLD,
  size = 9,
}) => (
  <span
    aria-hidden="true"
    className="inline-block shrink-0"
    style={{
      width: size,
      height: size,
      backgroundColor: lit ? color : SEG_EMPTY,
      border: '1px solid rgba(0,0,0,0.8)',
      boxShadow: lit
        ? `0 0 7px ${color}AA, inset 0 0 0 1px rgba(0,0,0,0.35)`
        : 'inset 0 1px 2px rgba(0,0,0,0.8)',
    }}
  />
);

/** LED bar meter — the console's ratio measure (value vs a reference). */
export const LedMeter: React.FC<{
  /** 0..1 fill fraction. */
  ratio: number;
  color: string;
  segments?: number;
  height?: number;
  label: string;
}> = ({ ratio, color, segments = 10, height = 10, label }) => {
  const filled = Math.max(0, Math.min(segments, Math.round(ratio * segments)));
  return (
    <div className="flex gap-[2px]" role="img" aria-label={label}>
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{
            width: 5,
            height,
            backgroundColor: i < filled ? color : SEG_EMPTY,
            boxShadow: i < filled ? `0 0 4px ${color}66` : 'inset 0 1px 2px rgba(0,0,0,0.7)',
          }}
        />
      ))}
    </div>
  );
};

/** Small inset rank well: the measured position, in mono. */
export const RankWell: React.FC<{ rank: number; gold?: boolean; mine?: boolean }> = ({
  rank,
  gold = false,
  mine = false,
}) => (
  <span
    className="flex h-8 w-9 shrink-0 items-center justify-center font-bold"
    style={{
      ...monoStyle,
      fontSize: 15,
      color: mine ? '#FFB03A' : gold ? GOLD : INK,
      border: `1px solid ${mine ? 'rgba(255,144,0,0.55)' : STEEL_DARK}`,
      background: 'linear-gradient(180deg, #050403 0%, #0A0806 100%)',
      boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.9)',
    }}
  >
    {rank}
  </span>
);
