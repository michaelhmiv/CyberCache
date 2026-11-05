/**
 * ResearchConsoleKit — the Instrument Panel primitives (owner pick B,
 * 2026-11-05) as they land on the Research stop: status lamps,
 * labelled readouts, flat console modules, segmented meters, and the
 * tape meter. Presentation only — every value these render is passed
 * in from the Chef's state view by ResearchPanel.
 */
import React from 'react';
import {
  AMBER,
  HAIRLINE,
  INK,
  INK_FAINT,
  MONO,
  PANEL,
  SEG_OFF,
  type SegCell,
} from './researchConsoleTheme';

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
