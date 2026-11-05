/**
 * The Instrument Panel theme (owner pick B, 2026-11-05) — the shared
 * constants of the console register as it lands on the Research stop:
 * readout ink, hairline steel, signal amber, segmented-meter cells.
 * Kept in a component-free module so the console components file can
 * satisfy the fast-refresh export rule (the hunterPlateTheme.ts
 * pattern).
 *
 * The register: the page as a machine being measured. Flat console
 * modules with hairline dividers, status lamps, segmented meters,
 * and tabular mono readouts. No plates, no bolts, no stamps, no
 * clipped corners — color is signal only (a lit lamp, a filled meter
 * segment, a channel hue), never decoration and never a colored
 * side bar. Mono is used for what it is for: measurement.
 */
import type React from 'react';

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

export interface SegCell {
  /** Fill color, or null for a dark unlit segment. */
  color: string | null;
  /** Hollow segment: transparent with a hairline inset (signal present, unfilled). */
  hollow?: boolean;
}

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
