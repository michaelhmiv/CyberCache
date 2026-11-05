/**
 * paperTokens — PROTOTYPE paperwork tokens for the Hunter subpage
 * design pass, Variant D. NOT shipped UI. The shared D paper kit:
 * first cut on design/hunter-subpages-research-d (2026-11-05),
 * carried unchanged to design/hunter-subpages-manual-d so the five
 * D options read as one clerk's office. Constants, type voices, and the
 * clerk's date hand live here so paperKit.tsx can export components
 * only (react-refresh/only-export-components).
 *
 * The register is FIELD PAPERWORK: a frontier registry clerk's file —
 * ruled form lines with dotted leaders, double rules, tabular record
 * numbers, checkbox strips, and verdict stamps struck in ink. The
 * world stays the game's dark wastes: this is carbon-dark paper,
 * bone ink, never a light theme. Color lives in stamp ink and the
 * faculty ink of each schedule — never in a colored side bar.
 */
import type React from 'react';

/** Bone ink on carbon paper. */
export const INK = '#EDE4D3';
export const INK_MUTED = '#C9BBA6';
/** Lightened past A's plate value to hold ≥4.5:1 on the paper ground
 * for 11px clerk text. */
export const INK_FAINT = '#A89C87';
export const RULE = 'rgba(237,228,211,0.26)';
export const RULE_HARD = '#7A7060';
export const STAMP_RED = '#FF7A5C';
export const AMBER = '#FF9000';
export const DANGER_INK = '#FF6B6B';

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
export function clerkDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}
export function clerkDay(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${dd} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
