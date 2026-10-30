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

/**
 * Fee multiplier for a boss after `victoriesToday` victories (UTC day).
 * `maxMultiplier` is the live lever (economy_config
 * 'rematchEscalationCap', 0018) as resolved by the server route; it
 * defaults to the shipped cap so display surfaces and direct calls
 * are unchanged.
 */
export function bossFeeMultiplier(
  victoriesToday: number,
  maxMultiplier: number = REMATCH_FEE_MAX_MULTIPLIER,
): number {
  const wins = Math.max(0, Math.trunc(victoriesToday) || 0);
  const cap = Math.max(1, Math.trunc(maxMultiplier) || REMATCH_FEE_MAX_MULTIPLIER);
  return Math.min(cap, 2 ** wins);
}

/** The fee for the next attempt: def base fee under today's escalation. */
export function escalatedBossFee(
  baseFee: number,
  victoriesToday: number,
  maxMultiplier: number = REMATCH_FEE_MAX_MULTIPLIER,
): number {
  return Math.max(0, Math.trunc(baseFee) || 0) * bossFeeMultiplier(victoriesToday, maxMultiplier);
}

/** ISO timestamp of the current UTC day's start (00:00:00.000Z). */
export function utcDayStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
