/**
 * paperTokens — PROTOTYPE (design/hunter-subpages-wardrobe-d,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * The ink-and-stock tokens of the Field Paperwork register, Wardrobe
 * edition: the page is a page — a sheet of dark registry stock ruled
 * by a clerk's hand, written in bone ink, decided in stamp ink.
 * Nothing here is machined: no plates, no bolts, no clipped corners.
 * Rules are horizontal only (a ledger never rules a margin column),
 * and no element wears a colored side bar — verdicts are carried by
 * rotated ink stamps, exactly as a registry office carries them.
 *
 * Contrast (against the sheet stock #171208): BONE ≈ 13:1,
 * CLERK ≈ 7.5:1, PENCIL #A2957F ≈ 5.4:1 (the smallest print on the
 * page — field labels and record details — clears the 4.5:1 floor),
 * stamp inks AMBER ≈ 6.9:1, CRIMSON ≈ 5.9:1, RUST #D08064 ≈ 5.4:1.
 */
import type React from 'react';

/** Sheet stock — dark registry paper under a desk lamp. */
export const STOCK: React.CSSProperties = {
  background: 'linear-gradient(172deg, #1B150B 0%, #171208 46%, #120D06 100%)',
  boxShadow: '0 0 0 1px rgba(239,231,211,0.16), 6px 8px 0 rgba(0,0,0,0.55)',
};

/** Bone ink — the clerk's primary hand. */
export const BONE = '#EFE7D3';
/** Clerk ink — secondary entries, honest grey-bone. */
export const CLERK = '#C4B797';
/** Pencil — the smallest filed print (≥11px, 4.5:1-safe). */
export const PENCIL = '#A2957F';
/** A ruled ledger line. */
export const RULE = 'rgba(239,231,211,0.14)';
/** A heavier rule — the double-rule's lower stroke. */
export const RULE_STRONG = 'rgba(239,231,211,0.34)';

/** Stamp inks. Amber = issued/worn + the one action waiting. */
export const INK_AMBER = '#FF9000';
/** Crimson = a preview struck over the record — tried, not issued. */
export const INK_CRIMSON = '#FF6A4D';
/** Rust = the faded red of an empty line. */
export const INK_RUST = '#D08064';
/** Grey ink = on file: present, not in use. */
export const INK_GREY = '#9A8F7A';

/** Clerk's typed values: form fields and record data are set in
 *  the app's mono stack — measurement, not costume. */
export const MONO = "Consolas, 'SF Mono', ui-monospace, monospace";
