/**
 * profileTelemetryTheme — the Instrument Panel palette and type
 * voices for the Profile & Record stop (Register B, "Service
 * Telemetry"; owner pick 2026-11-05). Constants live in their own
 * module (the telemetryTokens split from the approved prototype)
 * so the kit file exports components only.
 */
import type React from 'react';

export const TM_INK = '#F5EFE6';
export const TM_MUT = '#C9BBA6';
export const TM_FAINT = '#A2957F';
export const TM_STEEL = '#6B6257';
export const TM_STEEL_DARK = '#3A342B';
export const TM_SEG_EMPTY = '#241C12';
export const TM_GOLD = '#F2C063';
export const TM_AMBER = '#FF9000';
export const TM_GREEN = '#5FD95F';
export const TM_RED = '#FF5A4D';
export const TM_CYAN = '#3FD6E8';

/** Squared section voice: Chakra Petch — the game's techno face. */
export const tmHeadStyle: React.CSSProperties = {
  fontFamily: "'Chakra Petch', sans-serif",
  letterSpacing: '0.06em',
  fontWeight: 700,
};

export const tmMonoStyle: React.CSSProperties = {
  fontFamily: "Consolas, 'SF Mono', ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
};

/** Bebas Neue — the game's display face, used for the unit name. */
export const tmDisplayStyle: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.04em',
};
