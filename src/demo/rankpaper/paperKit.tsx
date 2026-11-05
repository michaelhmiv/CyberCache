/**
 * paperKit — PROTOTYPE primitives for Cache Rank variant D,
 * "Field paperwork" (design/hunter-subpages-rank-d, 2026-11-05).
 * NOT shipped UI.
 *
 * The register is stamped field paperwork: the rank rendered as a
 * service record a wasteland clerk files — ruled documents, dotted
 * leaders, ledger lines, rubber stamps. The documents are SQUARE
 * (paper is square — no machined plate clips), and color lives in
 * stamp ink, never in a colored side bar. Constants live in
 * paperTokens.ts; this file exports components only.
 */
import React from 'react';
import {
  DIM,
  GOLD,
  GROUND,
  INK,
  MUT,
  RULE,
  RULE_SOFT,
  STOCK,
  STOCK_RAISED,
  displayStyle,
  tabular,
} from './paperTokens';

/**
 * A filed document: square stock, black edge, one inset hairline.
 * Documents stack on the ground like papers on a clerk's desk.
 */
export const Doc: React.FC<{
  children: React.ReactNode;
  raised?: boolean;
  className?: string;
  testId?: string;
}> = ({ children, raised = false, className = '', testId }) => (
  <section
    className={`relative ${className}`}
    data-testid={testId}
    style={{
      backgroundColor: raised ? STOCK_RAISED : STOCK,
      border: '2px solid #000',
      boxShadow: 'inset 0 0 0 1px rgba(245,236,218,0.07), 4px 4px 0 rgba(0,0,0,0.45)',
    }}
  >
    {children}
  </section>
);

/** Form header band: the document's printed title block. */
export const FormHead: React.FC<{
  left: string;
  right?: string;
  title: string;
  titleSize?: number;
}> = ({ left, right, title, titleSize = 27 }) => (
  <div className="px-3.5 pt-3">
    <div
      className="flex items-baseline justify-between gap-2 pb-1.5"
      style={{ borderBottom: `2px solid ${INK}` }}
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: DIM }}>
        {left}
      </span>
      {right && (
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: DIM }}>
          {right}
        </span>
      )}
    </div>
    <div
      className="uppercase leading-none pt-2"
      style={{ ...displayStyle, fontSize: titleSize, color: INK }}
    >
      {title}
    </div>
  </div>
);

/** Two punched binder holes — the record is kept, not displayed. */
export const PunchHoles: React.FC = () => (
  <div aria-hidden="true" className="flex items-center gap-16 px-8 pt-2.5">
    {[0, 1].map((i) => (
      <span
        key={i}
        className="block h-[13px] w-[13px] rounded-full"
        style={{
          backgroundColor: GROUND,
          boxShadow: 'inset 0 2px 3px rgba(0,0,0,0.95), 0 1px 0 rgba(245,236,218,0.10)',
        }}
      />
    ))}
  </div>
);

/**
 * A rubber stamp: double-rule outline, slight rotation, ink color.
 * The stamp is the register's verb — granted, paid, endorsed, filed.
 */
export const Stamp: React.FC<{
  children: React.ReactNode;
  color?: string;
  rotate?: number;
  size?: number;
  testId?: string;
}> = ({ children, color = GOLD, rotate = -2, size = 12, testId }) => (
  <span
    data-testid={testId}
    className="inline-flex shrink-0 items-center gap-1 uppercase"
    style={{
      ...displayStyle,
      fontSize: size,
      letterSpacing: '0.16em',
      color,
      border: `2px solid ${color}`,
      boxShadow: `inset 0 0 0 2px ${STOCK}, inset 0 0 0 3.5px ${color}`,
      padding: '4px 9px 3px',
      transform: `rotate(${rotate}deg)`,
      opacity: 0.94,
      backgroundColor: 'rgba(18,12,6,0.35)',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </span>
);

/** A form field: small-caps label over a dotted writing line. */
export const Field: React.FC<{
  label: string;
  value: React.ReactNode;
  valueSize?: number;
}> = ({ label, value, valueSize = 15 }) => (
  <div className="min-w-0">
    <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: DIM }}>
      {label}
    </div>
    <div
      className="mt-0.5 pb-1 font-bold leading-tight"
      style={{
        color: INK,
        fontSize: valueSize,
        borderBottom: `1.5px dotted ${RULE}`,
        ...tabular,
      }}
    >
      {value}
    </div>
  </div>
);

/** A ledger line: entry text, dotted leader, right-ruled amount. */
export const LedgerRow: React.FC<{
  label: React.ReactNode;
  amount: React.ReactNode;
  strong?: boolean;
  amountColor?: string;
}> = ({ label, amount, strong = false, amountColor = INK }) => (
  <div className="flex items-baseline gap-2 py-[7px]" style={{ borderBottom: `1px solid ${RULE_SOFT}` }}>
    <span
      className={`${strong ? 'font-black uppercase tracking-wide' : 'font-semibold'} text-[12px] leading-snug`}
      style={{ color: strong ? INK : MUT }}
    >
      {label}
    </span>
    <span aria-hidden="true" className="min-w-3 flex-1 translate-y-[-3px]" style={{ borderBottom: `1.5px dotted ${RULE}` }} />
    <span
      className={`${strong ? 'text-[17px] font-black' : 'text-[14px] font-bold'} leading-none`}
      style={{ color: amountColor, ...tabular }}
    >
      {amount}
    </span>
  </div>
);

/** Perforated tear line between filed slips. */
export const Perf: React.FC = () => (
  <div
    aria-hidden="true"
    className="mx-1 h-[9px]"
    style={{
      backgroundImage: `radial-gradient(circle at 4px 4px, ${GROUND} 2.2px, transparent 2.6px)`,
      backgroundSize: '13px 9px',
      backgroundRepeat: 'repeat-x',
      opacity: 0.9,
    }}
  />
);
