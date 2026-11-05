/**
 * consoleTokens — PROTOTYPE constants (design/hunter-subpages-manual-b).
 * The B-register ("Instrument panel") palette for the Field Manual
 * console, split out of consoleKit.tsx so the kit file exports only
 * components (react-refresh/only-export-components).
 *
 * Color law (DESIGN.md §1): amber marks the one primary action or the
 * live state only; green is a completed/positive state; bone is data.
 */
export const CK = {
  /** Panel face — machined steel, lit from the top edge. */
  panel: 'linear-gradient(180deg, #1C202B 0%, #12151D 78%)',
  /** Panel inner face, one step darker (sub-modules). */
  panelInner: 'linear-gradient(180deg, #171B24 0%, #10131A 80%)',
  bezel: '#3A3644',
  seam: 'rgba(255,255,255,0.07)',
  /** LCD well glass. */
  lcd: '#060705',
  bone: '#EAE3D1',
  boneDim: '#B4AB9C',
  label: '#A79D8E',
  amber: '#FF9000',
  amberSoft: 'rgba(255,144,0,0.14)',
  green: '#7CFC00',
  greenSoft: 'rgba(124,252,0,0.12)',
  red: '#FF4B5C',
  lampOff: '#23262E',
};
