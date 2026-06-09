import type { RoamingAreaDef } from '../../constants/roamingAreas';

/**
 * Compute the XP-per-tick multiplier for a roaming area.
 *
 * The base formula uses unlock level only (linear 0.06 per level above 1),
 * giving a smooth curve from 1.0 at the starter area up to ~2.4 at the
 * highest-tier area. The danger rating adds a small bonus so that
 * high-risk / high-reward areas feel meaningfully faster to progress in.
 *
 * | Danger    | Bonus |
 * |-----------|-------|
 * | Low       | +0.00 |
 * | Medium    | +0.05 |
 * | Medium/High | +0.10 |
 * | Variable  | +0.05 |
 * | High      | +0.15 |
 *
 * Final value is rounded to 2 decimal places and floored at 0.5 so a
 * misconfigured area can never reduce XP below half the baseline.
 */
export function areaXpMultiplier(area: RoamingAreaDef): number {
  const levelBonus = 1 + (area.unlockLevel - 1) * 0.06;
  const dangerBonus =
    area.dangerRating === 'Low' ? 0
    : area.dangerRating === 'Medium' ? 0.05
    : area.dangerRating === 'Medium/High' ? 0.1
    : area.dangerRating === 'Variable' ? 0.05
    : area.dangerRating === 'High' ? 0.15
    : 0;
  return Math.max(0.5, Math.round((levelBonus + dangerBonus) * 100) / 100);
}

/**
 * The XP awarded per successful tick in a given area. This is the value
 * stored in `RoamingAreaDef.idleXpPerTick`, exposed as a helper so callers
 * don't need to know about the area's internal structure.
 */
export function areaXpPerTick(area: RoamingAreaDef): number {
  return area.idleXpPerTick;
}
