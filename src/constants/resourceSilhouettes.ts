/**
 * Resource SILHOUETTES — SVG path shapes for non-gear game resources.
 *
 * Each resource type has 3+ variant silhouette shapes that are selected
 * deterministically from a seed (for variety). Used by ResourceIcon to
 * render small (24–32px) icons in the universal resource bar and across
 * the site.
 *
 * Shapes are designed for a 24×24 viewBox and use the same Borderlands-
 * cyberpunk angular aesthetic as the gear silhouette libraries.
 */

export interface ResourceSilhouette {
  id: string;
  /** Main outline path */
  body: string;
  /** Inner detail / accent path */
  detail?: string;
  /** Secondary highlight (rendered in accent color) */
  highlight?: string;
}

// ── Credits (hexagonal coin with gear teeth) ────────────────────────────────

const CREDITS_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'credits-hex',
    body: 'M12 2L20 6.5V15.5L12 20L4 15.5V6.5L12 2Z',
    detail: 'M12 5.5L17.5 8.5V14.5L12 17.5L6.5 14.5V8.5L12 5.5Z',
    highlight: 'M12 2.5L7 5.3V6L12 3.3L17 6V5.3L12 2.5Z',
  },
  {
    id: 'credits-oct',
    body: 'M12 1.5L18.5 5V12L18.5 19L12 22.5L5.5 19V12L5.5 5L12 1.5Z',
    detail: 'M12 5L16 7.5V16.5L12 19L8 16.5V7.5L12 5Z',
  },
  {
    id: 'credits-round',
    body: 'M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z',
    detail: 'M12 4.5C7.86 4.5 4.5 7.86 4.5 12C4.5 16.14 7.86 19.5 12 19.5C16.14 19.5 19.5 16.14 19.5 12C19.5 7.86 16.14 4.5 12 4.5Z',
    highlight: 'M12 6.5L14.5 8V10L12 8.5L9.5 7V8L12 9.5L14.5 11V13L12 11.5L9.5 10V11L12 12.5L14.5 14V16L12 14.5L9.5 13V14L12 15.5L14.5 17V19L12 17.5L9.5 16V17L12 18.5L14.5 20V21L12 19.5L9.5 18Z',
  },
];

// ── Scrap (jagged metal plate with bolt holes) ──────────────────────────────

const SCRAP_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'scrap-plate',
    body: 'M4 4L10 2L16 3L20 7L22 13L20 18L14 22L8 21L2 17L3 11L4 4Z',
    detail: 'M7 7L10 6L14 7L16 10L16 14L13 17L9 17L6 14L7 10L7 7Z',
    highlight: 'M6 8.5L7.5 7.5L8 9L6.5 10Z',
  },
  {
    id: 'scrap-shard',
    body: 'M6 2L12 1L18 4L22 10L20 16L15 22L9 21L3 16L2 9L6 2Z',
    detail: 'M8 6L12 5L15 8L15 13L12 17L8 16L6 11L8 6Z',
  },
  {
    id: 'scrap-chunk',
    body: 'M3 5L8 3L14 2L19 6L21 12L19 18L14 22L8 21L2 16L1 10L3 5Z',
    detail: 'M6 7L10 6L14 8L15 13L12 17L8 17L5 12L6 7Z',
    highlight: 'M5 9L6 8.5L7 10L5.5 10.5Z',
  },
];

// ── Cache Key (angular keycard with circuit traces) ──────────────────────────

const CACHE_KEY_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'cachekey-card',
    body: 'M3 4H16L20 8V20H3V4Z',
    detail: 'M6 7H13V9H6V7Z M6 10.5H11V12.5H6V10.5Z',
    highlight: 'M17 5L19 7V19H17V5Z',
  },
  {
    id: 'cachekey-hex-card',
    body: 'M5 3L14 2L19 6V18L14 22L5 21L2 16V7L5 3Z',
    detail: 'M7 7L13 6L16 9V15L13 18L7 17L4 13V10L7 7Z',
    highlight: 'M8 9L11 8.5L13 10.5V14L11 16L8 15.5L6.5 12.5V10L8 9Z',
  },
  {
    id: 'cachekey-chip',
    body: 'M4 5H19L21 12V19H15V14H9V19H3V12L4 5Z',
    detail: 'M7 8H16V10H7V8Z',
    highlight: 'M10 14H14V17H10V14Z M9 19V21H15V19H9Z',
  },
];

// ── Cache Fragment (partial keycard shard) ───────────────────────────────────

const CACHE_FRAGMENT_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'cachefrag-shard1',
    body: 'M6 4L12 2L18 5L17 11L12 14L7 11L6 4Z',
    detail: 'M9 6L12 5L14 7L13 10L11 11L8 9L9 6Z',
  },
  {
    id: 'cachefrag-shard2',
    body: 'M5 5L10 3L16 4L18 9L15 13L9 14L5 10L5 5Z',
    detail: 'M8 7L11 6L13 8L12 11L9 11L7 9L8 7Z',
  },
  {
    id: 'cachefrag-shard3',
    body: 'M4 6L9 4L15 6L17 12L13 16L8 15L3 11L4 6Z',
    detail: 'M7 8L10 7L12 10L11 13L8 12L6 10L7 8Z',
  },
];

// ── Level (chevron-stacked rank insignia) ────────────────────────────────────

const LEVEL_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'level-chevrons',
    body: 'M4 20L12 8L20 20H4Z',
    detail: 'M7 16L12 8.5L17 16H7Z',
    highlight: 'M10 13L12 10L14 13H10Z',
  },
  {
    id: 'level-diamond',
    body: 'M12 2L22 11L12 20L2 11L12 2Z',
    detail: 'M12 5.5L17.5 11L12 16.5L6.5 11L12 5.5Z',
    highlight: 'M12 8.5L14.5 11L12 13.5L9.5 11L12 8.5Z',
  },
  {
    id: 'level-shield-rank',
    body: 'M12 2L22 7V13Q12 22 12 22Q12 22 2 13V7L12 2Z',
    detail: 'M12 5L17.5 8V11.5Q12 17 12 17Q12 17 6.5 11.5V8L12 5Z',
  },
];

// ── XP (upward-filled progress diamond) ──────────────────────────────────────

const XP_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'xp-diamond-fill',
    body: 'M12 2L20 12L12 22L4 12L12 2Z',
    detail: 'M12 5L16 12L12 19L8 12L12 5Z',
    highlight: 'M12 8L13.5 12L12 16L10.5 12L12 8Z',
  },
  {
    id: 'xp-arrow-up',
    body: 'M12 4L14 6L13 6L13 20H11L11 6L10 6L12 4Z M12 3L18 10H15L12 6.5L9 10H6L12 3Z',
    detail: 'M12 2L19 10H16L12 5.5L8 10H5L12 2Z',
  },
  {
    id: 'xp-bolt',
    body: 'M13 2L5 12H11L10 22L19 12H13L13 2Z',
    detail: 'M12.5 5L8 11.5H11.5L11 17L16 10.5H12.5L12.5 5Z',
  },
];

// ── Mastery Point (faceted crystal node) ─────────────────────────────────────

const MASTERY_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'mastery-crystal',
    body: 'M12 1.5L18 6L22 13L18 20L12 23.5L6 20L2 13L6 6L12 1.5Z',
    detail: 'M12 5L16 8L19 13L16 18L12 20.5L8 18L5 13L8 8L12 5Z',
    highlight: 'M12 9L14 11L15.5 13L14 15L12 16.5L10 15L8.5 13L10 11L12 9Z',
  },
  {
    id: 'mastery-star',
    body: 'M12 2L14.5 8.5L21 9.5L16 14.5L17 21L12 17.5L7 21L8 14.5L3 9.5L9.5 8.5L12 2Z',
    detail: 'M12 5.5L13.5 9.5L18 10L14.5 13L15 17.5L12 15L9 17.5L9.5 13L6 10L10.5 9.5L12 5.5Z',
  },
  {
    id: 'mastery-node',
    body: 'M12 3C7.03 3 3 7.03 3 12C3 16.97 7.03 21 12 21C16.97 21 21 16.97 21 12C21 7.03 16.97 3 12 3Z',
    detail: 'M12 6L17 10L15 18L12 19L9 18L7 10L12 6Z',
    highlight: 'M12 8L14.5 10.5L13.5 15L12 15.5L10.5 15L9.5 10.5L12 8Z',
  },
];

// ── Loot (angular loot crate / package with glow) ────────────────────────────

const LOOT_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'loot-crate',
    body: 'M3 7L12 3L21 7V16L12 20L3 16V7Z',
    detail: 'M6 9L12 6.5L18 9L18 14.5L12 17L6 14.5V9Z',
    highlight: 'M12 8.5L15 10V14L12 15.5L9 14V10L12 8.5Z',
  },
  {
    id: 'loot-box-angular',
    body: 'M4 6L12 2L20 6L20 18L12 22L4 18V6Z',
    detail: 'M7 8.5L12 6L17 8.5L17 16L12 18.5L7 16V8.5Z',
    highlight: 'M12 9L14.5 10.5V15L12 16L9.5 15V10.5L12 9Z',
  },
  {
    id: 'loot-capsule',
    body: 'M7 3H17L20 12L17 21H7L4 12L7 3Z',
    detail: 'M9 6H15L17 12L15 18H9L7 12L9 6Z',
    highlight: 'M11 8.5H13L14.5 12L13 15.5H11L9.5 12L11 8.5Z',
  },
];

// ── Registry ─────────────────────────────────────────────────────────────────

export type ResourceSilhouetteId =
  | 'credits'
  | 'scrap'
  | 'cacheKey'
  | 'cacheFragment'
  | 'level'
  | 'xp'
  | 'masteryPoint'
  | 'loot';

export const RESOURCE_SILHOUETTES: Record<ResourceSilhouetteId, ResourceSilhouette[]> = {
  credits: CREDITS_SILHOUETTES,
  scrap: SCRAP_SILHOUETTES,
  cacheKey: CACHE_KEY_SILHOUETTES,
  cacheFragment: CACHE_FRAGMENT_SILHOUETTES,
  level: LEVEL_SILHOUETTES,
  xp: XP_SILHOUETTES,
  masteryPoint: MASTERY_SILHOUETTES,
  loot: LOOT_SILHOUETTES,
};

/** Deterministic silhouette picker — same seed always gets the same variant. */
export function pickResourceSilhouette(
  resourceId: ResourceSilhouetteId,
  seed: number,
): ResourceSilhouette {
  const variants = RESOURCE_SILHOUETTES[resourceId];
  if (!variants || variants.length === 0) {
    return { id: 'unknown', body: 'M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z' };
  }
  return variants[Math.abs(seed) % variants.length];
}
