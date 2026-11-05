/**
 * standingsConsoleTokens — PROTOTYPE design tokens for the Standings
 * "Instrument panel" variant (design/hunter-subpages-standings-b,
 * 2026-11-05). NOT shipped UI. Constants only — kept in their own
 * module so the component kit file exports components alone.
 *
 * The register is a telemetry deck: the boards read as instruments.
 * Same ink family as the shipped game and the sibling B variants
 * (Cache Rank "The Console"); FAINT is lightened to hold 4.5:1 on
 * the panel ground.
 */
import type React from 'react';
import type { LeaderboardMetric } from '@/lib/api/leaderboardService';

/** Compact channel names for the selector bank (mono, 11px). */
export const METRIC_SHORT: Record<LeaderboardMetric, string> = {
  level: 'LV',
  xp: 'XP',
  net_worth: 'WORTH',
  total_kills: 'KILLS',
  kdr: 'K/D',
  highest_boss_tier: 'BOSS',
  total_mastery_xp: 'M-XP',
  highest_mastery_level: 'M-LV',
  legendary_items: 'LEGEND',
  total_items: 'ITEMS',
};

export const INK = '#F5EFE6';
export const MUT = '#C9BBA6';
export const FAINT = '#A2957F';
export const STEEL = '#6B6257';
export const STEEL_DARK = '#3A342B';
export const WELL_BG = '#070503';
export const SEG_EMPTY = '#241C12';
export const GOLD = '#F2C063';
export const AMBER = '#FF9000';
export const GREEN = '#5FD95F';
export const RED = '#FF4B5C';

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
