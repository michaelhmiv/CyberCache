/**
 * resurrectionCost — pure helpers for the three resurrect paths.
 *
 * - `resurrectionCostForArea(areaId)` — credits needed to skip the
 *   free 5-minute timer. Scales with the area's `unlockLevel` so
 *   dying in a level-1 area is cheap, dying in a level-25 area is
 *   punishing. Caps at 50,000 credits.
 * - `RESURRECTION_FREE_TIMER_MS` — the free timer duration. The
 *   survival slice seeds `resurrectionReadyAt` to this many ms in
 *   the future when `die()` is called.
 *
 * The cost formula is intentionally simple and pure — no RNG, no
 * store reads. The caller passes the area and the level. This keeps
 * the function unit-testable and lets the death overlay render the
 * cost without having to read the entire area roster.
 */

import { ROAMING_AREAS, type RoamingAreaDef } from '@/constants/roamingAreas';

/** Free resurrect timer: 5 minutes from death. */
export const RESURRECTION_FREE_TIMER_MS = 5 * 60 * 1000;

/** Per-level credit cost. Linear scale from 100 (lv 1) up to 50,000 (lv 500+). */
const PER_LEVEL_CREDITS = 100;
const MAX_CREDITS = 50_000;

/**
 * Look up an area by ID. Returns the default low-tier area if the
 * ID is unknown (defensive — caller should always pass a real ID).
 */
function findArea(areaId: string | null | undefined): RoamingAreaDef | undefined {
  if (!areaId) return undefined;
  return ROAMING_AREAS.find((a) => a.id === areaId);
}

/**
 * Credit cost to skip the free resurrection timer. Scales linearly
 * with the area's `unlockLevel` (1-25 in current content). At lv 1
 * it's 100 credits; at lv 25 it's 2,500; capped at MAX_CREDITS.
 */
export function resurrectionCostForArea(areaId: string | null | undefined): number {
  const area = findArea(areaId);
  if (!area) return 100; // unknown area → cheapest option
  return Math.min(MAX_CREDITS, area.unlockLevel * PER_LEVEL_CREDITS);
}

/**
 * Format a credit cost for display: "100 cr" / "2,500 cr" / "50.0K cr".
 */
export function formatCreditCost(credits: number): string {
  if (credits >= 10_000) {
    return `${(credits / 1_000).toFixed(1)}K cr`;
  }
  return `${credits.toLocaleString()} cr`;
}
