/**
 * Offline earnings cap — EARNED by player level (pacing-baseline tuning,
 * lifecycle evaluation §3/§6A).
 *
 * Launch behavior let any player pick a 2–12h cap in Settings from day 1,
 * which handed new accounts the full idle ceiling before they had played
 * an hour. The tuning pass made the cap server-derived (earned tiers +
 * the Scavenger keystone bonus, ignoring any larger stored value).
 *
 * The roaming-variance overhaul (brief §2.8, Michael's ruling
 * 2026-10-30) completes the model: the stored preference returns as a
 * LIMITER — it can only lower the earned cap, never raise it — under a
 * 24 h absolute ceiling. `effectiveOfflineCapHours` below is the one
 * formula; the settlement route enforces it server-side and the
 * Settings screen displays the same breakdown.
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

/**
 * ABSOLUTE ceiling on offline earnings — Michael's ruling (2026-10-30,
 * roaming-variance brief §2.8): no combination of earned tiers, skill
 * bonuses, or future cap sources may ever settle more than 24 h of
 * offline time. It binds nothing today (the maximum attainable cap is
 * 12 h earned + 4 h keystone = 16 h); it is the guardrail every future
 * cap source must respect. Registered as the `absoluteOfflineCapHours`
 * economy lever with an allowed range of [1, 24] — the lever can lower
 * the ceiling but raising it past 24 takes a code change and a ruling.
 */
export const ABSOLUTE_OFFLINE_CAP_HOURS = 24;

/** The limiter choices offered in Settings (hours). Null = no limiter. */
export const OFFLINE_CAP_LIMITER_OPTIONS: readonly number[] = [1, 2, 4, 6, 8, 12, 16, 20, 24];

export interface EffectiveOfflineCapInput {
  level: number;
  /** Server-derived skill bonus hours (Scavenger keystone today). */
  bonusHours?: number;
  /**
   * The player's stored limiter (`profiles.offline_cap_hours`), read
   * ONLY as a ceiling on the earned cap — the post-overhaul semantics
   * of the legacy column. Null/undefined/non-positive = no limiter.
   */
  userCapHours?: number | null;
  /** The absolute ceiling (economy lever; defaults to the constant). */
  ceilingHours?: number;
}

/**
 * The one cap formula (brief §2.8):
 *
 *   effective = min(earned(level) + bonus, userCap ?? ∞, ceiling)
 *
 * Enforcement stays server-side in settlement, computed from DB level +
 * DB skill spends + the stored limiter; the client displays this same
 * math and never sizes a settlement.
 */
export function effectiveOfflineCapHours(input: EffectiveOfflineCapInput): number {
  const earned = earnedOfflineCapHours(input.level) + Math.max(0, Math.floor(input.bonusHours ?? 0));
  const ceiling = Math.min(
    ABSOLUTE_OFFLINE_CAP_HOURS,
    Math.max(1, Math.floor(input.ceilingHours ?? ABSOLUTE_OFFLINE_CAP_HOURS)),
  );
  const userCap =
    typeof input.userCapHours === 'number' && Number.isFinite(input.userCapHours) && input.userCapHours > 0
      ? Math.floor(input.userCapHours)
      : Number.POSITIVE_INFINITY;
  return Math.max(1, Math.min(earned, userCap, ceiling));
}
