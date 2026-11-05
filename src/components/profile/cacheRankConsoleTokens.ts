/**
 * cacheRankConsoleTokens — design tokens for the Cache Rank
 * console register (Instrument Panel, owner pick B for this page,
 * 2026-11-05). Scoped to the Cache Rank panel and its kit; nothing
 * else imports from here. Constants only — kept in their own
 * module so the kit file exports components alone.
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
