/**
 * paperKit — PROTOTYPE paperwork components for the Hunter subpage
 * design pass, Variant D (design/hunter-subpages-profile-d,
 * 2026-11-05). NOT shipped UI. Tokens and helpers live in
 * paperTokens.ts; this file exports components only. The base kit
 * (sheet, double rule, stamps, form line, check strip, record
 * number) is the sibling D variants' shared clerk vocabulary; the
 * ledger row, schedule head, and tally row are this page's own
 * instruments — a personnel file is read as ledger lines, so the
 * career record is filed as ledger lines.
 */
import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { displayStyle, INK, INK_FAINT, INK_MUTED, monoStyle, paperSheet, RULE, RULE_HARD } from './paperTokens';

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

/** A hairline rule — the single ruled line between ledger entries. */
export const HairRule: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div aria-hidden="true" className={className} style={{ borderTop: `1px solid ${RULE}` }} />
);

/**
 * A verdict stamp: double-ruled ink box, rotated as struck, ink at
 * low fill so the paper shows through. Stamps state paperwork truth
 * (RECORD CURRENT / UNFILED / FIELD VERIFIED), never decoration.
 * Text never renders below the 11px floor.
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
 * Progress filed as a checkbox strip: twenty ruled boxes, inked as
 * the portion is earned. The paperwork progress measure — a punch
 * row, not a gauge.
 */
export const CheckStrip: React.FC<{ fraction: number; color: string }> = ({ fraction, color }) => {
  const total = 20;
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * total);
  return (
    <div className="flex gap-[3px]" role="img" aria-label={`${filled} of ${total} boxes filed`}>
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

/** Tabular record number — Schedule letter + part (SCHEDULE A, A-1 …). */
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

/**
 * A schedule's head: record number, the schedule's name in display
 * type, a ruled line, and room for a verdict stamp at the right.
 */
export const ScheduleHead: React.FC<{
  no: string;
  title: string;
  right?: React.ReactNode;
  stamp?: React.ReactNode;
}> = ({ no, title, right, stamp }) => (
  <div className="flex items-center gap-2.5">
    <RecordNo>{no}</RecordNo>
    <span className="shrink-0 uppercase" style={{ ...displayStyle, color: INK, fontSize: 19, lineHeight: 1 }}>
      {title}
    </span>
    <span aria-hidden="true" className="min-w-[10px] flex-1" style={{ borderTop: `1px solid ${RULE_HARD}` }} />
    {right}
    {stamp}
  </div>
);

/** A sub-schedule's ruled group head inside a schedule (A-1 · HUNTER). */
export const GroupHead: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`flex items-center gap-2 ${className}`}>
    <span
      className="shrink-0 font-bold uppercase"
      style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}
    >
      {children}
    </span>
    <span aria-hidden="true" className="flex-1" style={{ borderTop: `1px solid ${RULE}` }} />
  </div>
);

/**
 * One ledger row of the record: label, dotted leader, tabular
 * value. Rows the shipped page made tappable (they carry a
 * StatDetailPanel payload) render as full-width buttons with a
 * chevron and a 44px touch height; the rest are plain filed lines.
 */
export const LedgerRow: React.FC<{
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  onClick?: () => void;
  testId?: string;
}> = ({ label, value, valueColor = INK, onClick, testId }) => {
  const inner = (
    <>
      <span
        className="shrink-0 font-bold uppercase"
        style={{ ...monoStyle, color: INK_MUTED, fontSize: 11.5, letterSpacing: '0.07em' }}
      >
        {label}
      </span>
      <span aria-hidden="true" className="min-w-[12px] flex-1" style={{ borderBottom: `1px dotted ${RULE_HARD}` }} />
      <span
        className="text-right font-bold"
        style={{ ...monoStyle, color: valueColor, fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </span>
      {onClick && <PxIcon name="chevR" size={12} className="shrink-0 self-center opacity-50" />}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="flex min-h-[44px] w-full items-center gap-2 text-left transition-colors active:bg-white/5"
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="flex items-baseline gap-2 py-[7px]" data-testid={testId}>
      {inner}
    </div>
  );
};

/**
 * A tally strip: ten punched cells, inked in proportion — the
 * clerk's share measure for the combat tallies (a count's portion
 * of the whole record, punched cell by cell).
 */
export const TallyStrip: React.FC<{ fraction: number; color: string }> = ({ fraction, color }) => {
  const total = 10;
  const filled = Math.max(0, Math.min(total, Math.round(Math.min(1, Math.max(0, fraction)) * total)));
  return (
    <div className="flex gap-[3px]" role="img" aria-label={`${filled} of ${total} tally cells punched`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="h-[10px] flex-1"
          style={{
            border: `1px solid ${i < filled ? color : RULE_HARD}`,
            backgroundColor: i < filled ? color : 'transparent',
          }}
        />
      ))}
    </div>
  );
};

/** One tally entry: the name and its count over its punched strip. */
export const TallyRow: React.FC<{
  name: string;
  count: number;
  fraction: number;
  color: string;
}> = ({ name, count, fraction, color }) => (
  <div>
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 font-bold" style={{ ...monoStyle, color: INK, fontSize: 12.5 }}>
        {name}
      </span>
      <span aria-hidden="true" className="min-w-[12px] flex-1" style={{ borderBottom: `1px dotted ${RULE_HARD}` }} />
      <span
        className="text-right font-bold"
        style={{ ...monoStyle, color: INK, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}
      >
        {count.toLocaleString('en-US')}
      </span>
    </div>
    <div className="mt-1.5">
      <TallyStrip fraction={fraction} color={color} />
    </div>
  </div>
);
