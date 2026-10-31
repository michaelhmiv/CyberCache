import { ROAMING_AREAS } from '../constants/roamingAreas';

/**
 * Daily hot area (roaming-variance brief §2.4).
 *
 * One area per UTC day is "hot": +20% material-find chance, +10%
 * credits/XP, and danger up a band (the Chef multiplies incoming
 * damage by HOT_AREA_DANGER_MULTIPLIER). It is a temptation, not a
 * strictly-best button — the danger is real.
 *
 * Selection is `hash(UTC date) -> area`, computed from the date at
 * claim/read time — NEVER cron-driven (the vendor slice's standing
 * rule: a rotation that dies when a job doesn't fire is not a
 * rotation). Every player worldwide sees the same hot area on the
 * same UTC day; the client derives the identical value from the same
 * date for display and the Chef re-derives it for payout.
 */

/** Incoming-damage multiplier while roaming the hot area ("danger up one band"). */
export const HOT_AREA_DANGER_MULTIPLIER = 1.15;
/** Material-find chance bonus in the hot area (economy lever `hotAreaMaterialBonus`). */
export const HOT_AREA_MATERIAL_BONUS = 0.2;
/** Credits/XP yield bonus in the hot area (economy lever `hotAreaYieldBonus`). */
export const HOT_AREA_YIELD_BONUS = 0.1;

/** FNV-1a — the same hash family the pixel layer uses for seeds. */
function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The UTC day key a date belongs to (yyyy-mm-dd, UTC). */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The hot area id for the UTC day containing `date`. Deterministic worldwide. */
export function hotAreaIdForDate(date: Date): string {
  const areas = ROAMING_AREAS;
  const index = hashString(`hot-area:${utcDayKey(date)}`) % areas.length;
  return areas[index].id;
}

export function isHotArea(areaId: string, date: Date): boolean {
  return hotAreaIdForDate(date) === areaId;
}
