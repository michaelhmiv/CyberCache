// ── Painted icon masters (INT-9, Top-Choice Wave 13 integration) ─────────────
// The named BIG icon slots — the four nav sigils and the calendar display
// hero — plus the drop-rise marker family now render the painted masters
// instead of the PX_ICONS texel glyphs. The 76 everyday functional glyphs
// stay on PxIcon untouched (their adoption decision is still open), and
// PX_ICONS itself is unchanged.
//
// Provenance (Wave 13 pilot record + this slice's generations; masters
// keyed from their white grounds by border flood-fill, cropped to the
// alpha box, fitted to the shipped glyph's own footprint, palette-256):
//   nav-home / nav-pack / display-calendar — Wave 13 pilot masters.
//   nav-tag / nav-person — generated for this slice from the shipped
//     glyphs' own art (verbatim prompts in the PR body).
// Tint verification (per slot, against the call sites):
//   - Nav sigils: the tab color is a FIXED per-tab identity color
//     (src/constants/navSigils.ts); the active tab's state is carried by
//     the button's amber background, not by the icon — the painted master
//     ships in exactly that per-tab identity colorway, so no state tint
//     is lost. The other state-tinted PxIcon sites are out of scope.
//   - Calendar hero: the wrapper color is the constant STREAK_ACCENT in
//     every state (claimable/fresh only add a glow overlay) — fixed tint.
// Drop-rise masters: see dropRiseIcons.ts — grayscale luminance masters
// re-tinted at runtime by hue rotation (material/essence/fragment/scrap);
// credits and crate ship in their fixed identity colorways.
// Assets are produced by scripts/build-icon-masters.py; only its small
// palette-PNG outputs are committed (src/assets/icons/).

import navHomeUrl from '@/assets/icons/nav-home.png';
import navPackUrl from '@/assets/icons/nav-pack.png';
import navTagUrl from '@/assets/icons/nav-tag.png';
import navPersonUrl from '@/assets/icons/nav-person.png';
import displayCalendarUrl from '@/assets/icons/display-calendar.png';
import dropMaterialUrl from '@/assets/icons/drop-material.png';
import dropEssenceUrl from '@/assets/icons/drop-essence.png';
import dropFragmentUrl from '@/assets/icons/drop-fragment.png';
import dropScrapUrl from '@/assets/icons/drop-scrap.png';
import dropCreditsUrl from '@/assets/icons/drop-credits.png';
import dropCrateUrl from '@/assets/icons/drop-crate.png';

/** Nav sigil masters, keyed by the sigil icon name they replace. */
export const NAV_SIGIL_MASTERS: Record<string, string> = {
  home: navHomeUrl,
  pack: navPackUrl,
  tag: navTagUrl,
  person: navPersonUrl,
};

/** The calendar display hero (LoginStreakPanel, 40px slot). */
export const DISPLAY_CALENDAR_MASTER = displayCalendarUrl;

export type DropRiseKind = 'material' | 'essence' | 'fragment' | 'scrap' | 'credits' | 'crate';

/** Drop-rise masters: grayscale luminance masters for the hue-rotated
 *  kinds; full-color masters for credits/crate. */
export const DROP_RISE_MASTERS: Record<DropRiseKind, string> = {
  material: dropMaterialUrl,
  essence: dropEssenceUrl,
  fragment: dropFragmentUrl,
  scrap: dropScrapUrl,
  credits: dropCreditsUrl,
  crate: dropCrateUrl,
};

/** Kinds whose master is grayscale and re-tinted by hue rotation. */
export const DROP_RISE_RETINTED: ReadonlySet<DropRiseKind> = new Set([
  'material',
  'essence',
  'fragment',
  'scrap',
]);
