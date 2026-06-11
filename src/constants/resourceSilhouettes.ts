/**
 * Resource SILHOUETTES — bold, iconic SVG path shapes for non-gear game resources.
 *
 * Designed for small sizes (18–24px viewBox). Each resource has 3+ shape variants
 * selected deterministically by seed. The shapes prioritize:
 *   - Instant recognizability (even at 18px)
 *   - Clear silhouettes with bold internal detail
 *   - Distinct profiles so no two resources share a shape class
 *
 * Used by ResourceIcon in the universal ResourceBar.
 */

export interface ResourceSilhouette {
  id: string;
  /** Main outline — bold, fill with primary color */
  body: string;
  /** Inner core — brighter/contrasting fill */
  core?: string;
  /** Highlight accent — small bright feature for pop */
  highlight?: string;
}

// ── Credits: coin / ingot shapes — round, unmistakable ────────────────────────

const CREDITS_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'credits-coin',
    body: 'M12 1.5C6.2 1.5 1.5 6.2 1.5 12S6.2 22.5 12 22.5 22.5 17.8 22.5 12 17.8 1.5 12 1.5Z',
    core: 'M12 4C7.6 4 4 7.6 4 12S7.6 20 12 20 20 16.4 20 12 16.4 4 12 4Z',
    highlight: 'M9.5 12L11 14.5L14.5 10',
  },
  {
    id: 'credits-ingot',
    body: 'M3 7L12 3L21 7V17L12 21L3 17V7Z',
    core: 'M6 8.5L12 5.5L18 8.5V15.5L12 18.5L6 15.5V8.5Z',
    highlight: 'M9 10L15 14L12 16L9 13Z',
  },
  {
    id: 'credits-stack',
    body: 'M3 6L12 2L21 6L21 10L12 14L3 10Z M3 10L12 14L21 10V14L12 18L3 14Z M3 14L12 18L21 14V18L12 22L3 18Z',
    core: 'M5 7.5L12 4.5L19 7.5V9.5L12 12.5L5 9.5V7.5Z',
  },
];

// ── Scrap: jagged shards, sharp triangles — aggressive, angular ───────────────

const SCRAP_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'scrap-shard',
    body: 'M12 1L21 8L19 15L22 22L12 20L4 23L2 15L1 7L12 1Z',
    core: 'M12 4L17 8.5L16 14L18 18L12 16.5L7 18.5L5 14L4 8.5L12 4Z',
    highlight: 'M8 9L10 7L11 9Z M14 13L15 15L13 14Z',
  },
  {
    id: 'scrap-blade',
    body: 'M4 2L12 1L18 5L22 12L19 19L13 22L7 21L3 16L2 8L4 2Z',
    core: 'M7 5L12 4L15 7L17 12L15 17L11 19L7 18L5 13L7 5Z',
    highlight: 'M9 8L11 7L11 10Z M14 14L16 15L14 16Z',
  },
  {
    id: 'scrap-spike',
    body: 'M12 1L21 8L19 15L22 22L12 20L4 23L2 15L1 7L12 1Z',
    core: 'M12 4L17 8.5L16 14L18 18L12 16.5L7 18.5L5 14L4 8.5L12 4Z',
    highlight: 'M8 9L10 7L11 9Z',
  },
];

// ── Cache Key: keycard / key shape with teeth — tech feel ─────────────────────

const CACHE_KEY_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'cachekey-card',
    body: 'M4 3H14L19 7V21H4V3Z',
    core: 'M7 6H12V9H7V6Z M7 11H10V13H7V11Z M7 15H11V17H7V15Z',
    highlight: 'M16 4L18 6.5V20H5V4L7 5Z',
  },
  {
    id: 'cachekey-key',
    body: 'M2 7H12L14 9V12L7 12L5 14L5 20H2V7Z',
    core: 'M4 9H10V11H4V9Z',
    highlight: 'M7 12L9 12.5L7 14V14.5L8 15L7 16V17L9 18H7V16.5H7L6 15V14.5Z M3.5 16.5H6V18H3.5Z M3.5 13H6V15H3.5Z',
  },
  {
    id: 'cachekey-hex',
    body: 'M12 2L20 7V17L12 22L4 17V7L12 2Z',
    core: 'M12 5L17 8V16L12 19L7 16V8L12 5Z',
    highlight: 'M12 8L15 10V14L12 16L9 14V10L12 8Z',
  },
];

// ── Cache Fragment: partial shard — broken keycard piece ──────────────────────

const CACHE_FRAGMENT_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'cachefrag-piece',
    body: 'M4 5L8 3L14 4L17 8L15 14L10 16L5 13L4 5Z',
    core: 'M7 7L10 5.5L13 7L12 11L9 12L7 10L7 7Z',
  },
  {
    id: 'cachefrag-chip',
    body: 'M3 6L9 4L16 6L18 11L14 16L8 15L2 11L3 6Z',
    core: 'M6 8L10 7L13 9L12 12L9 13L6 11L6 8Z',
    highlight: 'M8 9.5L10 8.5L11 10L9 11Z',
  },
];

// ── Level: upward chevron / rank insignia — military prestige ─────────────────

const LEVEL_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'level-chevron',
    body: 'M12 2L21 11L17 11L17 22H7L7 11L3 11L12 2Z',
    core: 'M12 5L17 10.5H15V18H9V10.5H7L12 5Z',
    highlight: 'M12 8L10 12H14L12 8Z',
  },
  {
    id: 'level-star',
    body: 'M12 1L14.5 8L22 9L16 14.5L17.5 22L12 18L6.5 22L8 14.5L2 9L9.5 8L12 1Z',
    core: 'M12 5L13.5 9.5L18.5 10L14.5 13.5L15.5 18L12 15.5L8.5 18L9.5 13.5L5.5 10L10.5 9.5L12 5Z',
    highlight: 'M12 8L11 11.5L13.5 12.5L12 14L10 12.5L12 8Z',
  },
  {
    id: 'level-shield',
    body: 'M12 2L22 7V13Q12 22 12 22Q12 22 2 13V7L12 2Z',
    core: 'M12 5L17.5 8V11.5Q12 17 12 17Q12 17 6.5 11.5V8L12 5Z',
    highlight: 'M12 8L14.5 10V12L12 13.5L9.5 12V10L12 8Z',
  },
];

// ── XP: upward arrow / diamond progress — momentum feel ────────────────────────

const XP_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'xp-diamond',
    body: 'M12 1.5L21 12L12 22.5L3 12L12 1.5Z',
    core: 'M12 5L17 12L12 19L7 12L12 5Z',
    highlight: 'M12 8.5L14 12L13.5 15L12 16.5L10.5 15L10 12L12 8.5Z',
  },
  {
    id: 'xp-arrow',
    body: 'M12 2L19 9H15V22H9V9H5L12 2Z',
    core: 'M12 5L16 8.5H13.5V18H10.5V8.5H8L12 5Z',
  },
  {
    id: 'xp-bolt',
    body: 'M14 1L5 12H11L10 23L19 12H13L14 1Z',
    core: 'M13 5L8 12H11L10.5 18L15.5 12H13L13 5Z',
    highlight: 'M12 8L11.5 9.5L13 9L12 8Z',
  },
];

// ── Mastery Point: star/crystal node — prestige currency ──────────────────────

const MASTERY_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'mastery-star4',
    body: 'M12 1L14.5 8.5L22 9.5L16 14.5L17.5 22L12 18L6.5 22L8 14.5L2 9.5L9.5 8.5L12 1Z',
    core: 'M12 5.5L13.5 9.5L18.5 10L14.5 13L15.5 17.5L12 15L8.5 17.5L9.5 13L5.5 10L10.5 9.5L12 5.5Z',
  },
  {
    id: 'mastery-crystal',
    body: 'M12 2L18 7L21 13L18 19L12 23L6 19L3 13L6 7L12 2Z',
    core: 'M12 5.5L16 9L18 13L16 17L12 20L8 17L6 13L8 9L12 5.5Z',
    highlight: 'M12 9L13.5 11L14 13L13 15L12 16L11 15L10 13L10.5 11L12 9Z',
  },
];

// ── Consumables ────────────────────────────────────────────────────────────────

const CONSUMABLE_SILHOUETTES: Record<string, ResourceSilhouette[]> = {
  medKit: [{ id: 'medkit', body: 'M7 3H17L20 7V17L17 21H7L4 17V7L7 3Z', core: 'M9 8H15V16H9V8Z M12 5V19 M5 12H19', highlight: 'M10 9H14V15H10V9Z' }],
  grenade: [{ id: 'grenade', body: 'M8 3H16L14 5L14 6H10L10 5L8 3Z M6 6H18Q18 12 14 18L12 22L10 18Q6 12 6 6Z', core: 'M8 8H16Q16 12 13 16L12 18L11 16Q8 12 8 8Z', highlight: 'M10 10H14V14H10V10Z' }],
  ammoPack: [{ id: 'ammo', body: 'M5 4H16L19 8V18L16 21H5V4Z', core: 'M8 7H14V10H8V7Z M8 12H14V15H8V12Z', highlight: 'M10 8H12V9H10V8Z' }],
  shieldCell: [{ id: 'shieldcell', body: 'M6 3H18L21 7V17L18 21H6L3 17V7L6 3Z', core: 'M9 7H15V9H12V15H15V17H9V15H12V9H9V7Z', highlight: 'M8 11H16L12 8Z' }],
  elementalCoating: [{ id: 'coating', body: 'M9 2H15L16 8Q14 11 16 12Q14 16 16 20L15 22H9L8 20Q10 16 8 12Q10 11 8 8L9 2Z', core: 'M11 6H13L13.5 9Q12 10.5 13 12Q12 14 13 16L12.5 18H11.5L11 16Q12 14 11 12Q12 10.5 11 9L11 6Z' }],
  luckBooster: [{ id: 'luck', body: 'M12 2L14.5 7.5L20.5 8L16 12.5L17 19L12 15.5L7 19L8 12.5L3.5 8L9.5 7.5L12 2Z', core: 'M12 6L13.5 9L17 9.5L14.5 11.5L15 15L12 13L9 15L9.5 11.5L7 9.5L10.5 9L12 6Z' }],
  bossScanner: [{ id: 'scanner', body: 'M4 5H20L22 9V15L20 19H4L2 15V9L4 5Z', core: 'M7 8H17L18 10V14L17 16H7L6 14V10L7 8Z', highlight: 'M9 10H15V14H9V10Z M12 10.5V13.5' }],
};

// ── Loot: crate / chest / capsule — container, reward shape ──────────────────

const LOOT_SILHOUETTES: ResourceSilhouette[] = [
  {
    id: 'loot-crate',
    body: 'M2 7L12 3L22 7V17L12 21L2 17V7Z',
    core: 'M5 9L12 6L19 9V15L12 18L5 15V9Z',
    highlight: 'M9 10.5L15 13.5L12 15L9 12Z',
  },
  {
    id: 'loot-chest',
    body: 'M3 8L12 4L21 8V11L12 7L3 11Z M3 11L12 15L21 11V20L12 24L3 20V11Z',
    core: 'M6 13L12 10L18 13V18L12 21L6 18V13Z',
    highlight: 'M11 11L13 12.5L12 14L10 12.5Z',
  },
  {
    id: 'loot-capsule',
    body: 'M8 2H16L20 12L16 22H8L4 12L8 2Z',
    core: 'M9.5 5H14.5L17.5 12L14.5 19H9.5L6.5 12L9.5 5Z',
    highlight: 'M11 8H13L14.5 12L13 16H11L9.5 12L11 8Z',
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
    return {
      id: 'unknown',
      body: 'M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z',
    };
  }
  return variants[Math.abs(seed) % variants.length];
}
