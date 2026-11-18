import type { ChefExtractionState } from '@/lib/chef/chefClient';

/**
 * R2 bars-render seeds (presentation only, dash/bars-render).
 *
 * The two rundown-zone treatments read their facts from here
 * because today those facts live inside the panels' component
 * state (EndlessPanel's getEndlessMe payload, ExtractionPanel's
 * getExtractionState payload) — no store carries them, so the
 * zone cannot read them. The production build lifts run state
 * into a slice (the extraction feed slice is the in-repo
 * precedent for a panel publishing to a store); the zone's
 * props then come from that slice and this module goes away.
 * homeMain's fetch stub serves the extraction payload below as
 * the /extraction/state response, so the panel and the zone
 * read ONE seeded state and cannot disagree.
 */

/** The endless run the zone reports: depth 7 cleared, the
 *  escrow below at risk, best depth 9. Mirrors the activeRun
 *  homeMain serves from /endless/me for ?state=endless-run. */
export const BARS_ENDLESS_RUN = {
  depthReached: 7,
  startLevel: 18,
  escrowCredits: 1240,
  escrowXp: 3860,
  escrowScrap: 412,
  deathPayoutPercent: 50,
  bestDepth: 9,
} as const;

/** A paused Deep Delve at Dustwaste Frontier: extraction
 *  holds the Home slot, the pass sits at 6:48 of
 *  10:00 (3:12 left), and the gear factor ×0.72 is below the
 *  ×0.80 Deep Delve floor — the warning the panel only prints
 *  while the delve is active. Pool 1,780 vs ~2,460 expected
 *  damage is the factor's own arithmetic (1,780 / 2,460 ≈ 0.72).
 *  Mastery Lv.6 clears the Lv.5 deep unlock. */
export const BARS_EXTRACTION_STATE: ChefExtractionState = {
  active: false,
  hasState: true,
  areaId: 'dustwaste_frontier',
  method: 'deep',
  passAreaId: 'dustwaste_frontier',
  passMethod: 'deep',
  accruedMs: 408_000,
  passMs: 600_000,
  pendingPasses: 0,
  finalizedPasses: 23,
  totalXpAwarded: 5420,
  mastery: { level: 6, xp: 4120 },
  preview: {
    areaId: 'dustwaste_frontier',
    areaName: 'Dustwaste Frontier',
    method: 'deep',
    gearFactor: 0.72,
    survivalPool: 1780,
    expectedPassDamage: 2460,
    drawsPerPass: 9,
    xpPerPass: 240,
    deepDegraded: true,
    deepUnlocked: true,
    isHot: false,
  },
  settled: { advancedMs: 0, xpAwarded: 0, materials: {}, essences: {}, passes: [] },
};

/** extract-repaint frame 2: an ACTIVE Surface Sweep at
 *  Throwtech Dumpnet — the second-area frame for the repainted
 *  extraction set. Same player (pool 1,780, mastery Lv.6);
 *  factor ×0.91 → expected pass damage ≈ 1,780 / 0.91 ≈ 1,956.
 *  drawsPerPass follows the content formula (extraction.ts):
 *  32 base × 0.91 factor × 1.025 mastery ≈ 30. Served by
 *  homeMain's stub when ?state=extract2; the stage area comes
 *  from the idle store seed in HomeHarnessPage. */
export const BARS_EXTRACTION_STATE_2: ChefExtractionState = {
  active: true,
  hasState: true,
  areaId: 'throwtech_dumpnet',
  method: 'surface',
  passAreaId: 'throwtech_dumpnet',
  passMethod: 'surface',
  accruedMs: 264_000,
  passMs: 600_000,
  pendingPasses: 0,
  finalizedPasses: 11,
  totalXpAwarded: 2640,
  mastery: { level: 6, xp: 4120 },
  preview: {
    areaId: 'throwtech_dumpnet',
    areaName: 'Throwtech Dumpnet',
    method: 'surface',
    gearFactor: 0.91,
    survivalPool: 1780,
    expectedPassDamage: 1956,
    drawsPerPass: 30,
    xpPerPass: 180,
    deepDegraded: false,
    deepUnlocked: true,
    isHot: false,
  },
  settled: { advancedMs: 0, xpAwarded: 0, materials: {}, essences: {}, passes: [] },
};
