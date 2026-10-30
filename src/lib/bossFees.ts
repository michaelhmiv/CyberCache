/**
 * Boss entry-fee escalation (pacing-baseline tuning, lifecycle
 * evaluation §6A).
 *
 * The first attempt on a boss costs the def's `entryCost`; repeats cost
 * `rematchCost`. On top of that base, the fee doubles for every victory
 * the player has already banked against THAT boss today (UTC day,
 * matching the daily-heartbeat convention), capped at ×8:
 *
 *   fee = base × min(8, 2^(victories today))
 *
 * The Chef counts today's victories from the verified action ledger and
 * charges the escalated fee; this module holds the shared math so the
 * prep panel displays exactly the fee the Chef will charge. Display is
 * advisory only — the charged fee in the attempt response is truth.
 */

export const REMATCH_FEE_MAX_MULTIPLIER = 8;

/** Fee multiplier for a boss after `victoriesToday` victories (UTC day). */
export function bossFeeMultiplier(victoriesToday: number): number {
  const wins = Math.max(0, Math.trunc(victoriesToday) || 0);
  return Math.min(REMATCH_FEE_MAX_MULTIPLIER, 2 ** wins);
}

/** The fee for the next attempt: def base fee under today's escalation. */
export function escalatedBossFee(baseFee: number, victoriesToday: number): number {
  return Math.max(0, Math.trunc(baseFee) || 0) * bossFeeMultiplier(victoriesToday);
}

/** ISO timestamp of the current UTC day's start (00:00:00.000Z). */
export function utcDayStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
