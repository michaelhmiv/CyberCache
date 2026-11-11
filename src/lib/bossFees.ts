/**
 * Boss entry-fee escalation (pacing-baseline tuning, lifecycle
 * evaluation §6A).
 *
 * A first attempt on a boss costs half the def's `entryCost` until
 * its first victory (the first-clear discount, below); repeats cost
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
 *
 * First-clear discount (tuning D4 / proposal P10, owner ruling
 * 2026-11-10): while a player has never beaten a boss, its base fee
 * is HALF the entryCost (`firstClearEntryFee`); the first victory
 * ends the discount for that boss forever, and rematch pricing
 * applies from then on. `bossBaseFee` is the one derivation of the
 * pre-escalation base — the Chef's charge, its affordability refusal,
 * and both display surfaces all read it, so the price shown is the
 * price charged.
 */

export const REMATCH_FEE_MAX_MULTIPLIER = 8;

/** Fraction of the entry fee charged before a boss's first clear. */
export const FIRST_CLEAR_FEE_FRACTION = 0.5;

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

/**
 * The entry fee owed before a boss's first victory: half the def's
 * entryCost, rounded to whole credits (every shipped entry cost is
 * a multiple of 100, so the halving is exact today).
 */
export function firstClearEntryFee(entryCost: number): number {
  const base = Math.max(0, Math.trunc(entryCost) || 0);
  return Math.round(base * FIRST_CLEAR_FEE_FRACTION);
}

/**
 * The pre-escalation base fee for the next attempt on a boss: the
 * rematchCost once the player has beaten it, the discounted
 * first-clear entry fee until then. `defeated` comes from the
 * player's recorded victories (server boss_state on the charge
 * path; the mirrored store on display surfaces).
 */
export function bossBaseFee(def: { entryCost: number; rematchCost: number }, defeated: boolean): number {
  return defeated ? Math.max(0, Math.trunc(def.rematchCost) || 0) : firstClearEntryFee(def.entryCost);
}

/** ISO timestamp of the current UTC day's start (00:00:00.000Z). */
export function utcDayStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
