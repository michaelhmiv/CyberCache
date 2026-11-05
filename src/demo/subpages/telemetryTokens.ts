/**
 * telemetryTokens — PROTOTYPE design tokens for the Profile
 * "Instrument panel" variant (design/hunter-subpages-profile-b,
 * 2026-11-05). NOT shipped UI. Constants only — kept in their own
 * module so the component kit file exports components alone.
 *
 * The values are the B-register console tokens, shared with the
 * Cache Rank instrument variant so the five B pages read as one
 * console family in the owner's PDF.
 */
import type React from 'react';

export const INK = '#F5EFE6';
export const MUT = '#C9BBA6';
export const FAINT = '#A2957F';
export const STEEL = '#6B6257';
export const STEEL_DARK = '#3A342B';
export const WELL_BG = '#070503';
export const SEG_EMPTY = '#241C12';
export const GOLD = '#F2C063';
export const AMBER = '#FF9000';
export const AMBER_GLOW = '#FFEA3A';
export const GREEN = '#5FD95F';
export const RED = '#FF5A4D';
export const CYAN = '#3FD6E8';

/** Squared section voice: Chakra Petch — the game's techno face. */
export const headStyle: React.CSSProperties = {
  fontFamily: "'Chakra Petch', sans-serif",
  letterSpacing: '0.06em',
  fontWeight: 700,
};

export const monoStyle: React.CSSProperties = {
  fontFamily: "Consolas, 'SF Mono', ui-monospace, monospace",
  fontVariantNumeric: 'tabular-nums',
};

/** Bebas Neue — the game's display face, used for the unit name. */
export const displayStyle: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.04em',
};
