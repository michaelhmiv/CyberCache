/**
 * paperTokens — PROTOTYPE constants for Cache Rank variant D,
 * "Field paperwork" (design/hunter-subpages-rank-d, 2026-11-05).
 * NOT shipped UI. Grounds and ink come from the game's own
 * DESIGN.md tokens (warm ink-browns, bone ink); color lives in
 * stamp ink, never in a colored side bar. Kept apart from the
 * component kit so every file exports one kind of thing.
 */
import type React from 'react';

export const GROUND = '#171008';
export const WELL = '#120C06';
export const STOCK = '#241A10'; // --panel: document stock
export const STOCK_RAISED = '#2E2113'; // --panel2
export const RULE = '#453218'; // --line: ruled hairlines
export const RULE_SOFT = 'rgba(69,50,24,0.55)';
export const INK = '#F5ECDA';
export const MUT = '#C2B096';
export const DIM = '#A08D6D';
export const AMBER = '#FFA01F';
export const CTA = '#FF8A00';
export const PENCIL = '#FF5566'; // red-pencil annotation only
export const GOLD = '#F2C063'; // rank gold — grant stamps, balance

export const displayStyle: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.06em',
  fontWeight: 400,
};

export const tabular: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** Horizontal ruled-paper texture for ledger stock (faint). */
export const ruledStock: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(0deg, transparent 0px, transparent 27px, rgba(69,50,24,0.28) 27px, rgba(69,50,24,0.28) 28px)',
};
