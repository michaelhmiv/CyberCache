/**
 * paperKit — PROTOTYPE shared paperwork components for the Hunter
 * subpage design pass, Variant D. NOT shipped UI. First cut on
 * design/hunter-subpages-research-d; carried unchanged to
 * design/hunter-subpages-manual-d. Tokens and helpers live in
 * paperTokens.ts; this file exports components only.
 */
import React from 'react';
import { INK, INK_FAINT, monoStyle, paperSheet, RULE_HARD } from './paperTokens';

export const PaperSheet: React.FC<{
  children: React.ReactNode;
  className?: string;
  testId?: string;
}> = ({ children, className = '', testId }) => (
  <section className={`relative ${className}`} style={paperSheet} data-testid={testId}>
    <div className="relative px-3.5 py-3.5">{children}</div>
  </section>
);

/** The double rule that opens a schedule — a ledger section break. */
export const DoubleRule: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div aria-hidden="true" className={className} style={{ borderTop: `4px double ${RULE_HARD}` }} />
);

/**
 * A verdict stamp: double-ruled ink box, rotated as struck, ink at
 * low fill so the paper shows through. Stamps state paperwork truth
 * (COMPLETE / IN SESSION / PAID / ON FILE), never decoration.
 */
export const InkStamp: React.FC<{
  color: string;
  children: React.ReactNode;
  rotate?: number;
  fontSize?: number;
}> = ({ color, children, rotate = -5, fontSize = 11 }) => (
  <span
    className="inline-flex shrink-0 items-center"
    style={{
      transform: `rotate(${rotate}deg)`,
      border: `2px solid ${color}`,
      backgroundColor: `${color}14`,
      padding: 2,
      opacity: 0.94,
    }}
  >
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap font-black uppercase"
      style={{
        ...monoStyle,
        border: `1px solid ${color}`,
        color,
        fontSize,
        letterSpacing: '0.14em',
        padding: '2px 6px',
        lineHeight: 1.25,
      }}
    >
      {children}
    </span>
  </span>
);

/** A small endorsement stamp (prerequisite on file / not filed). */
export const EndorseStamp: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span
    className="inline-flex shrink-0 items-center whitespace-nowrap font-black uppercase"
    style={{
      ...monoStyle,
      border: `1.5px solid ${color}`,
      color,
      fontSize: 11,
      letterSpacing: '0.12em',
      padding: '2px 5px',
      transform: 'rotate(-3deg)',
      backgroundColor: `${color}12`,
    }}
  >
    {children}
  </span>
);

/**
 * One ruled form line: label, dotted leader, value — the clerk's
 * handwriting row. Values are tabular mono: these are records.
 */
export const FormLine: React.FC<{
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  className?: string;
}> = ({ label, value, valueColor = INK, className = '' }) => (
  <div className={`flex items-baseline gap-2 ${className}`}>
    <span
      className="shrink-0 font-bold uppercase"
      style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.08em' }}
    >
      {label}
    </span>
    <span aria-hidden="true" className="min-w-[12px] flex-1" style={{ borderBottom: `1px dotted ${RULE_HARD}` }} />
    <span
      className="text-right font-bold"
      style={{ ...monoStyle, color: valueColor, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}
    >
      {value}
    </span>
  </div>
);

/**
 * Study filed as a checkbox strip: twenty ruled boxes, inked as the
 * course is studied. The paperwork progress measure — a punch row,
 * not a gauge.
 */
export const CheckStrip: React.FC<{ fraction: number; color: string }> = ({ fraction, color }) => {
  const total = 20;
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * total);
  return (
    <div className="flex gap-[3px]" role="img" aria-label={`${filled} of ${total} study boxes filed`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="h-[13px] flex-1"
          style={{
            border: `1px solid ${i < filled ? color : RULE_HARD}`,
            backgroundColor: i < filled ? color : 'transparent',
            boxShadow: i < filled ? 'inset 0 0 0 1px rgba(0,0,0,0.35)' : undefined,
          }}
        />
      ))}
    </div>
  );
};

/** Tabular record number — Schedule letter + tier (A-1 … D-3). */
export const RecordNo: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = INK_FAINT,
}) => (
  <span
    className="shrink-0 font-bold"
    style={{ ...monoStyle, color, fontSize: 12, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em' }}
  >
    {children}
  </span>
);
