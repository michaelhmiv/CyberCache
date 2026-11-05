/**
 * telemetryKit — PROTOTYPE shared console primitives for the Hunter
 * subpage design pass, variant B "Instrument Panel"
 * (design/hunter-subpages-research-b, 2026-11-05). NOT shipped UI.
 *
 * The register: the page as a machine being measured. Flat console
 * modules with hairline dividers, status lamps, segmented meters,
 * and tabular mono readouts. No plates, no bolts, no stamps, no
 * clipped corners — color is signal only (a lit lamp, a filled
 * meter segment, a channel hue), never decoration and never a
 * colored side bar. Mono is used for what it is for: measurement.
 */
import React from 'react';

export const INK = '#EDEAE2';
export const INK_MUTED = '#A7B0BC';
export const INK_FAINT = '#8B95A3';
export const PANEL = '#0B0E13';
export const PANEL_RAISED = '#10141B';
export const HAIRLINE = '#2B323D';
export const SEG_OFF = '#171C24';
export const AMBER = '#FF9000';
export const DANGER = '#FF4B5C';

/** Tabular mono — the readout voice. */
export const MONO: React.CSSProperties = {
  fontFamily: "Consolas, 'SF Mono', ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
};

/** Display voice: Bebas Neue set clean (the anchor's shadow-free setting). */
export const titleStyle: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.05em',
  fontWeight: 400,
};

/**
 * A status lamp: a small square signal light. Lit lamps carry
 * their hue and a tight bloom; unlit lamps are dark glass.
 */
export const Lamp: React.FC<{ color?: string; lit?: boolean; size?: number }> = ({
  color = INK_FAINT,
  lit = false,
  size = 10,
}) => (
  <span
    aria-hidden="true"
    className="inline-block shrink-0"
    style={{
      width: size,
      height: size,
      backgroundColor: lit ? color : '#141922',
      boxShadow: lit
        ? `0 0 6px ${color}, inset 0 0 0 1px rgba(0,0,0,0.55)`
        : 'inset 0 0 0 1px rgba(139,149,163,0.35)',
    }}
  />
);

/** One labelled readout: small caps label over a mono value. */
export const Readout: React.FC<{
  label: string;
  value: string;
  color?: string;
  valueSize?: number;
  align?: 'left' | 'right';
}> = ({ label, value, color = INK, valueSize = 16, align = 'left' }) => (
  <div className="min-w-0" style={{ textAlign: align }}>
    <div
      className="text-[11px] font-bold uppercase leading-none tracking-[0.14em]"
      style={{ color: INK_FAINT }}
    >
      {label}
    </div>
    <div
      className="mt-1 truncate leading-none"
      style={{ ...MONO, color, fontSize: valueSize, fontWeight: 700 }}
    >
      {value}
    </div>
  </div>
);

/**
 * A console module: flat panel, hairline frame, an optional header
 * strip divided from the body by a full-width hairline.
 */
export const Module: React.FC<{
  header?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}> = ({ header, children, testId }) => (
  <section
    data-testid={testId}
    style={{
      backgroundColor: PANEL,
      border: `1px solid ${HAIRLINE}`,
      boxShadow: 'inset 0 1px 0 rgba(237,234,226,0.04)',
    }}
  >
    {header && (
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${HAIRLINE}` }}
      >
        {header}
      </div>
    )}
    <div className="px-3 py-3">{children}</div>
  </section>
);

export interface SegCell {
  /** Fill color, or null for a dark unlit segment. */
  color: string | null;
  /** Hollow segment: transparent with a hairline inset (signal present, unfilled). */
  hollow?: boolean;
}

/** A segmented meter whose cells are data — one cell per unit of the thing measured. */
export const SegBar: React.FC<{ cells: SegCell[]; height?: number; gap?: number }> = ({
  cells,
  height = 10,
  gap = 2,
}) => (
  <div className="flex" style={{ gap }} role="img" aria-label={`${cells.filter((c) => c.color).length} of ${cells.length}`}>
    {cells.map((cell, i) => (
      <span
        key={i}
        className="flex-1"
        style={{
          height,
          backgroundColor: cell.color ?? (cell.hollow ? 'transparent' : SEG_OFF),
          boxShadow: cell.hollow
            ? `inset 0 0 0 1px ${HAIRLINE}`
            : 'inset 0 0 0 1px rgba(0,0,0,0.5)',
        }}
      />
    ))}
  </div>
);

/**
 * A tape meter: many thin vertical bars, the elapsed share lit —
 * a counter tape rather than a bar. The boundary is the playhead.
 */
export const TapeBar: React.FC<{ total?: number; fraction: number; color: string; height?: number }> = ({
  total = 48,
  fraction,
  color,
  height = 20,
}) => {
  const filled = Math.round(fraction * total);
  return (
    <div className="flex items-end" style={{ gap: 2 }} role="img" aria-label={`${Math.round(fraction * 100)}%`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="flex-1"
          style={{
            height: i === filled ? height : height - 5,
            backgroundColor: i < filled ? color : i === filled ? AMBER : SEG_OFF,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.45)',
          }}
        />
      ))}
    </div>
  );
};

/** "29H 45M" / "1D 04H" — a clock readout from milliseconds (floor). */
export function fmtClock(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}D ${String(hours).padStart(2, '0')}H`;
  return `${hours}H ${String(minutes).padStart(2, '0')}M`;
}

/** "18H 15M" — remaining-time readout (ceil, so it never reads zero early). */
export function fmtClockCeil(ms: number): string {
  const totalMinutes = Math.ceil(Math.max(0, ms) / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}D ${String(hours).padStart(2, '0')}H`;
  return `${hours}H ${String(minutes).padStart(2, '0')}M`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "NOV 06 · 06:15Z" — a Zulu timestamp readout, timezone-deterministic. */
export function fmtZulu(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} · ${hh}:${mm}Z`;
}
