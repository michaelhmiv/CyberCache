/**
 * plateKit — PROTOTYPE shared plate primitives for the Hunter
 * subpage design pass (design/hunter-subpages-rank-research,
 * 2026-11-05). NOT shipped UI.
 *
 * The grammar is copied from the approved Arena Plates menu pass
 * (design/hunter-menu-prototype, HunterMenuLooks.tsx): machined
 * plate shell, corner bolts, foot strip, bone ink, gauge wells.
 * Color lives in numerals, foot strips, stamps, and light — never
 * in a colored side bar.
 */
import React from 'react';

export const BONE = '#F5EFE6';
export const BONE_MUTED = '#C9BBA6';
export const BONE_FAINT = '#A2957F';
export const STEEL = '#6B6257';
export const STEEL_DARK = '#3A342B';
export const WELL_EMPTY = '#2C2620';
export const AMBER = '#FF9000';
export const AMBER_GLOW = '#FFEA3A';
export const RANK_GOLD = '#F2C063';
export const DANGER = '#FF8FA3';

/**
 * Plate title voice: Bebas Neue set clean. The shipped `.bl-title`
 * utility was tried first and rejected on capture — its stacked
 * text-shadows (3px black drop + amber fringe) smear into a legible
 * double image at plate-title sizes. The approved plates anchor
 * sets its display type shadow-free; this matches it.
 */
export const plateTitleStyle: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.05em',
  fontWeight: 400,
};

export const PLATE_CLIP =
  'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)';

export const plateShell: React.CSSProperties = {
  clipPath: PLATE_CLIP,
  border: '2px solid #000',
  background: 'linear-gradient(158deg, #1D1811 0%, #12100C 58%, #0C0A08 100%)',
  boxShadow: '5px 5px 0 rgba(0,0,0,0.75), inset 0 0 0 1px rgba(163,152,134,0.28)',
};

/** Machined corner bolts — 5px squares, black with a steel top edge. */
export const Bolts: React.FC = () => (
  <>
    {['left-[7px] top-[7px]', 'right-[7px] top-[7px]', 'bottom-[7px] left-[7px]', 'bottom-[7px] right-[7px]'].map(
      (pos) => (
        <span
          key={pos}
          aria-hidden="true"
          className={`absolute ${pos} h-[5px] w-[5px]`}
          style={{ backgroundColor: '#060504', boxShadow: 'inset 0 1px 0 rgba(201,187,166,0.5)' }}
        />
      ),
    )}
  </>
);

/** The plate's base rail — the sanctioned home of a data color. */
export const FootStrip: React.FC<{ color: string; height?: number }> = ({ color, height = 4 }) => (
  <div aria-hidden="true" className="absolute inset-x-0 bottom-0" style={{ height, backgroundColor: color }} />
);

/** A plate: shell + bolts + foot strip, content padded clear of both. */
export const Plate: React.FC<{
  children: React.ReactNode;
  footColor?: string;
  footHeight?: number;
  className?: string;
  testId?: string;
}> = ({ children, footColor, footHeight = 4, className = '', testId }) => (
  <div className={`relative overflow-hidden ${className}`} style={plateShell} data-testid={testId}>
    <Bolts />
    <div className="relative px-3.5 pb-4 pt-3">{children}</div>
    {footColor && <FootStrip color={footColor} height={footHeight} />}
  </div>
);

/** Inset gauge well: a dark machined socket holding one hero numeral. */
export const GaugeWell: React.FC<{
  value: string;
  label: string;
  color?: string;
  valueSize?: number;
}> = ({ value, label, color = BONE, valueSize = 30 }) => (
  <div
    className="flex shrink-0 flex-col items-center justify-center px-3 py-1.5"
    style={{
      border: `2px solid ${STEEL}`,
      backgroundColor: 'rgba(6,5,4,0.85)',
      boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(163,152,134,0.16)',
    }}
  >
    <span className="font-black leading-none" style={{ color, fontSize: valueSize }}>
      {value}
    </span>
    <span className="mt-1 text-[11px] font-bold uppercase leading-none tracking-wide" style={{ color: BONE_FAINT }}>
      {label}
    </span>
  </div>
);

/** Segment ladder — the family's progress measure (segmented, never a ring). */
export const SegmentLadder: React.FC<{
  filled: number;
  total: number;
  color: string;
  height?: number;
  segmentClassName?: string;
}> = ({ filled, total, color, height = 9, segmentClassName = '' }) => (
  <div className="flex gap-[3px]" role="img" aria-label={`${filled} of ${total}`}>
    {Array.from({ length: total }, (_, i) => (
      <span
        key={i}
        className={`flex-1 ${segmentClassName}`}
        style={{
          height,
          backgroundColor: i < filled ? color : WELL_EMPTY,
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.55)',
        }}
      />
    ))}
  </div>
);

/** A recorded-state stamp: bone outline, slight rotation, no fill. */
export const Stamp: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = BONE }) => (
  <span
    className="inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] font-black uppercase tracking-widest"
    style={{ border: `2px solid ${color}`, color, transform: 'rotate(-2deg)', backgroundColor: 'rgba(6,5,4,0.6)' }}
  >
    {children}
  </span>
);
