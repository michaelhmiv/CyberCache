/**
 * paperTokens — PROTOTYPE paperwork tokens for the Hunter subpage
 * design pass, Variant D (design/hunter-subpages-profile-d,
 * 2026-11-05). NOT shipped UI. Constants and type voices live here
 * so paperKit.tsx can export components only
 * (react-refresh/only-export-components). The token set is shared
 * with the sibling D variants (research-d's kit) so the five D
 * options read as one clerk's office across the PDF: carbon-dark
 * paper, bone ink, ruled lines, verdict stamps. Color lives in
 * stamp ink and data ink — never in a colored side bar.
 */
import type React from 'react';

/** Bone ink on carbon paper. */
export const INK = '#EDE4D3';
export const INK_MUTED = '#C9BBA6';
/** Lightened past the plate family's dim value to hold ≥4.5:1 on
 * the paper ground for 11px clerk text. */
export const INK_FAINT = '#A89C87';
export const RULE = 'rgba(237,228,211,0.26)';
export const RULE_HARD = '#7A7060';
export const STAMP_RED = '#FF7A5C';
export const AMBER = '#FF9000';

export const monoStyle: React.CSSProperties = {
  fontFamily: "Consolas, 'SF Mono', ui-monospace, monospace",
};

export const displayStyle: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.05em',
  fontWeight: 400,
};

/** A sheet of the file: carbon-dark paper, hairline inset, soft drop. */
export const paperSheet: React.CSSProperties = {
  border: '1px solid #000',
  background: 'linear-gradient(172deg, #1A1611 0%, #131009 58%, #0E0C08 100%)',
  boxShadow: 'inset 0 0 0 1px rgba(237,228,211,0.13), 0 10px 24px rgba(0,0,0,0.45)',
};

/** Clerk date, UTC-stamped for deterministic filing: 04 NOV 2026 · 06:14 UTC. */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function clerkDay(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${dd} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
