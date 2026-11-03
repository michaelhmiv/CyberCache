/**
 * Offline earnings cap — EARNED through Research (the Logistics &
 * Markets track), over a 2 h base every hunter holds from day one.
 *
 * History: launch behavior let any player pick a 2–12h cap in
 * Settings from day 1; the pacing-baseline tuning (0015) made the
 * cap server-derived from PLAYER LEVEL tiers (L20/40/60/80 →
 * 4/6/8/12h). Gate-removal step 6 (migration 0063) retires the
 * level carrier — level gates are gone from the game — and moves
 * the growth onto the carrier that always advertised it: the
 * Research Shop track, whose faculty text promises it "pays in
 * buyback, offline hours, and thinner fees" (src/content/
 * research.ts). Street Economics grants +2h, Supply Chains +4h,
 * Syndicate Ledger +4h — the same 2h → 12h earned range the level
 * tiers spanned, reachable by study instead of by level.
 *
 * The roaming-variance overhaul (brief §2.8, Michael's ruling
 * 2026-10-30) completes the model: the stored preference is a
 * LIMITER — it can only lower the earned cap, never raise it —
 * under a 24 h absolute ceiling. `effectiveOfflineCapHours` below
 * is the one formula; the settlement route enforces it server-side
 * and the Settings screen displays the same breakdown.
 *
 * This module is the single source of truth for the composition:
 * the settlement route (server) enforces it and the Settings
 * screen (client) displays it. The SQL settlers compose the same
 * earned value from research_completions via
 * cc_research_offline_cap_bonus (restated catalog-sum in 0063).
 */
import { RESEARCH_COURSES } from './research';

export const BASE_OFFLINE_CAP_HOURS = 2;

export interface OfflineCapMilestone {
  /** The Research course whose completion grants this step. */
  courseId: string;
  courseName: string;
  /** Hours this course's completion adds to the earned cap. */
  grantHours: number;
  /** The earned cap once this course (and its chain before it) is complete. */
  capHours: number;
}

/**
 * The earned-cap ladder, derived from the Research catalog's
 * offlineCapBonus grants in catalog order. The granting courses
 * form one prerequisite chain (Logistics & Markets T1 → T2 → T3),
 * so the cumulative sums are exactly the reachable earned caps:
 * 2h base → 4h → 8h → 12h.
 */
export const OFFLINE_CAP_MILESTONES: readonly OfflineCapMilestone[] = (() => {
  let cap = BASE_OFFLINE_CAP_HOURS;
  const out: OfflineCapMilestone[] = [];
  for (const course of RESEARCH_COURSES) {
    const grant = course.effects.offlineCapBonus ?? 0;
    if (grant > 0) {
      cap += grant;
      out.push({ courseId: course.id, courseName: course.name, grantHours: grant, capHours: cap });
    }
  }
  return out;
})();

/** Total offline-cap hours Research can grant (2 + 4 + 4 = 10). */
export const RESEARCH_OFFLINE_CAP_HOURS_TOTAL: number = OFFLINE_CAP_MILESTONES.reduce(
  (sum, m) => sum + m.grantHours,
  0,
);

/**
 * The offline cap a player has earned, before skill bonuses:
 * the 2h base plus the Research-granted hours (the
 * `offlineCapBonus` total from computeResearchBonuses over the
 * player's completions). Player level plays no part in it.
 */
export function earnedOfflineCapHours(researchCapHours: number): number {
  const granted = Math.floor(researchCapHours);
  return BASE_OFFLINE_CAP_HOURS + (Number.isFinite(granted) && granted > 0 ? granted : 0);
}

/** The next milestone a player has not yet earned, or null at the top. */
export function nextOfflineCapMilestone(researchCapHours: number): OfflineCapMilestone | null {
  const earned = earnedOfflineCapHours(researchCapHours);
  for (const milestone of OFFLINE_CAP_MILESTONES) {
    if (earned < milestone.capHours) return milestone;
  }
  return null;
}

/**
 * ABSOLUTE ceiling on offline earnings — Michael's ruling (2026-10-30,
 * roaming-variance brief §2.8): no combination of earned hours, skill
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
  /** Offline-cap hours granted by completed Research (Logistics track). */
  researchCapHours?: number;
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
 *   effective = min(earned(research) + bonus, userCap ?? ∞, ceiling)
 *
 * Enforcement stays server-side in settlement, computed from DB
 * research completions + DB skill spends + the stored limiter; the
 * client displays this same math and never sizes a settlement.
 */
export function effectiveOfflineCapHours(input: EffectiveOfflineCapInput): number {
  const earned =
    earnedOfflineCapHours(input.researchCapHours ?? 0) +
    Math.max(0, Math.floor(input.bonusHours ?? 0));
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
