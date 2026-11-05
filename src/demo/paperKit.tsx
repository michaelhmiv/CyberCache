/**
 * paperKit — PROTOTYPE primitives (design/hunter-subpages-wardrobe-d,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The Field Paperwork register's moving parts for the Wardrobe
 * ledger: the rubber stamp (the register's verb — every state on
 * the page is a verdict struck in ink), the ledger double-rule,
 * the dotted-leader form field, and the clerk's checkbox. Tokens
 * live in paperTokens.ts; this file is components only.
 */
import React from 'react';
import { BONE, CLERK, INK_GREY, MONO, PENCIL, RULE, RULE_STRONG } from './paperTokens';

/**
 * A verdict struck in ink: double-ruled stamp border, letterspaced
 * caps, rotated a few degrees off the line — no two strikes land
 * alike, so the tilt is a prop. `strike` replays the stamp-strike
 * animation (state changes re-mount the stamp with a new key).
 * Stamp text never renders below the 11px floor.
 */
export const Stamp: React.FC<{
  text: string;
  ink?: string;
  tilt?: number;
  size?: number;
  strike?: boolean;
  className?: string;
}> = ({ text, ink = INK_GREY, tilt = -5, size = 11, strike = false, className = '' }) => (
  <span
    aria-label={text}
    className={`inline-block shrink-0 select-none whitespace-nowrap px-2 py-[3px] font-black uppercase ${className}`}
    style={
      {
        color: ink,
        border: `2px solid ${ink}`,
        boxShadow: `inset 0 0 0 1px rgba(18,13,6,0.85), inset 0 0 0 2.5px ${ink}`,
        letterSpacing: '0.14em',
        fontSize: size,
        lineHeight: 1.15,
        opacity: 0.94,
        transform: `rotate(${tilt}deg)`,
        '--stamp-tilt': `${tilt}deg`,
        animation: strike ? 'stamp-strike 190ms cubic-bezier(0.2, 1.4, 0.4, 1) both' : undefined,
      } as React.CSSProperties
    }
  >
    {text}
  </span>
);

/** The ledger's double rule: a heavy stroke over a hairline. */
export const DoubleRule: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div aria-hidden="true" className={className}>
    <div style={{ height: 3, backgroundColor: RULE_STRONG }} />
    <div style={{ height: 1, marginTop: 2, backgroundColor: RULE }} />
  </div>
);

/** A single hairline rule between ledger entries. */
export const HairRule: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div aria-hidden="true" className={className} style={{ height: 1, backgroundColor: RULE }} />
);

/**
 * A form field typed onto its line: label in clerk caps, value in
 * mono, joined by the dotted leader every registry form prints.
 */
export const FormField: React.FC<{ label: string; value: string; className?: string }> = ({
  label,
  value,
  className = '',
}) => (
  <div className={`flex items-baseline gap-2 ${className}`}>
    <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: PENCIL }}>
      {label}
    </span>
    <span aria-hidden="true" className="min-w-3 flex-1 -translate-y-[3px] border-b border-dotted" style={{ borderColor: 'rgba(239,231,211,0.3)' }} />
    <span className="shrink-0 text-[12px] font-semibold uppercase tracking-wide" style={{ color: BONE, fontFamily: MONO }}>
      {value}
    </span>
  </div>
);

/** A section heading inside the ledger: clerk caps over its rule. */
export const LedgerHead: React.FC<{ title: string; note?: string; className?: string }> = ({
  title,
  note,
  className = '',
}) => (
  <div className={className}>
    <div className="flex items-baseline justify-between gap-3 px-1">
      <h2 className="text-[15px] font-black uppercase leading-none tracking-[0.1em]" style={{ color: BONE }}>
        {title}
      </h2>
      {note && (
        <span className="text-right text-[11px] font-bold uppercase leading-tight tracking-wide" style={{ color: PENCIL }}>
          {note}
        </span>
      )}
    </div>
    <DoubleRule className="mt-2" />
  </div>
);

/**
 * The clerk's checkbox for form picks (head variants): an ink
 * square, crossed when the pick is entered on the form. Drawn —
 * never a unicode glyph.
 */
export const InkBox: React.FC<{ checked: boolean; disabled?: boolean }> = ({ checked, disabled = false }) => (
  <span
    aria-hidden="true"
    className="relative inline-block h-[15px] w-[15px] shrink-0"
    style={{ border: `2px solid ${disabled ? PENCIL : CLERK}`, opacity: disabled ? 0.45 : 1 }}
  >
    {checked && (
      <>
        <span className="absolute left-1/2 top-1/2 h-[2px] w-[13px] -translate-x-1/2 -translate-y-1/2 rotate-45" style={{ backgroundColor: BONE }} />
        <span className="absolute left-1/2 top-1/2 h-[2px] w-[13px] -translate-x-1/2 -translate-y-1/2 -rotate-45" style={{ backgroundColor: BONE }} />
      </>
    )}
  </span>
);
