/**
 * Offline earnings cap — EARNED by player level (pacing-baseline tuning,
 * lifecycle evaluation §3/§6A).
 *
 * Launch behavior let any player pick a 2–12h cap in Settings from day 1,
 * which handed new accounts the full idle ceiling before they had played
 * an hour. The cap is now server-derived: the Chef's offline settlement
 * enforces `earnedOfflineCapHours(playerLevel) + offlineCapBonus` (the
 * Scavenger keystone's bonus, wired by the same tuning pass) and ignores
 * any larger stored/client value. `profiles.offline_cap_hours` remains
 * as a legacy preference column but no longer sizes a settlement.
 *
 * This module is the single source of truth for the tier table: the
 * settlement route (server) enforces it and the Settings screen (client)
 * displays it.
 */

export interface OfflineCapTier {
  /** First player level that earns this cap. */
  minLevel: number;
  hours: number;
}

/** Ascending by level. The base cap (below the first tier) is 2h. */
export const OFFLINE_CAP_TIERS: readonly OfflineCapTier[] = [
  { minLevel: 20, hours: 4 },
  { minLevel: 40, hours: 6 },
  { minLevel: 60, hours: 8 },
  { minLevel: 80, hours: 12 },
];

export const BASE_OFFLINE_CAP_HOURS = 2;

/** The offline cap a player has earned at `level`, before skill bonuses. */
export function earnedOfflineCapHours(level: number): number {
  const lv = Math.max(1, Math.floor(level) || 1);
  let hours = BASE_OFFLINE_CAP_HOURS;
  for (const tier of OFFLINE_CAP_TIERS) {
    if (lv >= tier.minLevel) hours = tier.hours;
  }
  return hours;
}

/** The next tier a player has not yet earned, or null at the top tier. */
export function nextOfflineCapTier(level: number): OfflineCapTier | null {
  const lv = Math.max(1, Math.floor(level) || 1);
  for (const tier of OFFLINE_CAP_TIERS) {
    if (lv < tier.minLevel) return tier;
  }
  return null;
}
