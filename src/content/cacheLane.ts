/**
 * Cache box lane (migration 0037, rebuilt by 0082) — the
 * monetization lane for Data Caches, kept visibly distinct from
 * loot drops.
 *
 * Michael's law for this lane (owner ruling 2026-11-04, which
 * REBUILDS the lane and supersedes the 0037 budget model):
 *  - CACHE BOX ≠ LOOT DROP. Drops are earned gameplay (roaming,
 *    bosses, endless); cache boxes are the ad lane. The words are
 *    never swapped on any surface.
 *  - NO DAILY LIMITS. There is no daily cap, no daily budget, and
 *    no free daily box. The 0037 concepts (cacheBoxDailyCap, the
 *    free-first slot, "openings today", the 00:00 UTC budget
 *    reset) are gone from the server, the client, and the copy.
 *  - SCARCITY IS SUPPLY. What makes a box rare is how rarely keys
 *    exist, not a quota on opening them. Roaming pays WHOLE KEYS
 *    directly at a hard-cut rate (see CACHE_KEY_CHANCE in
 *    roamingRates.ts), settled through the same silent fractional-
 *    remainder bookkeeping the other claim currencies use — the
 *    remainder is bookkeeping, never a visible currency.
 *  - FRAGMENTS ARE ABOLISHED (same ruling). The old cache-fragment
 *    currency (profiles.cache_token_parts, the 5:1 auto-conversion)
 *    is gone: nothing pays fragments, nothing displays them, and
 *    stranded balances converted to keys at 5:1 floor in migration
 *    0082. Keys are the ONLY cache currency. The flat sources —
 *    login streak day 7, the weekly contracts set bonus, weekly
 *    leaderboard podiums, the jackpot legendary's guaranteed key —
 *    are the primary way keys appear.
 *  - EVERY OPENING IS PAID, player's choice per opening: 1 cache
 *    key OR one rewarded-ad attestation. Uncapped — a player may
 *    open as many boxes as they can pay for. Keys stay a stock
 *    (profiles.cache_tokens). Existing key stockpiles are
 *    grandfathered — no clawback; with no cap they are simply
 *    spendable.
 *  - Always optional, never restricting gameplay; NO ADS ON THE
 *    PLAY SCREEN, EVER — the ad offer lives only on the cache
 *    surface (ChestScreen).
 *  - No server-side ad verification (SSV): ad completions are
 *    client-attested. The 0037 abuse control was the daily cap;
 *    with the cap gone the control is that an opening must be
 *    paid — by key or by ad — every single time, and the nonce
 *    ledger makes each opening exactly-once (replays grant
 *    nothing).
 *
 * Both twins (SQL cc_make_item / in-memory writes) resolve payment
 * through these same rules — resolveCacheBoxPayment below is the
 * TS statement of the SQL logic.
 */

// ─── Constants ───────────────────────────────────────────────────────

/** The ways an opening is paid for. There is no free opening. */
export type CacheBoxPayment = 'ad' | 'key';

export const CACHE_BOX_PAYMENTS: readonly CacheBoxPayment[] = ['ad', 'key'];

/** Player-facing rule line for the cache surface. */
export const CACHE_LANE_RULE =
  'Every cache box costs 1 cache key or one short ad — no daily limit. Keys are rare: roaming drops one now and then, and the login streak, contracts, and leaderboards pay them too.';

// ─── UTC day helper (the codebase's UTC-day convention) ────────────

/**
 * UTC day (YYYY-MM-DD) of a Date. The lane itself keeps no daily
 * state anymore; this still stamps the cache_box_openings audit
 * record (one row per opening, written by both write twins).
 */
export function cacheLaneUtcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ─── Facts + view ────────────────────────────────────────────────────

/** Server facts the lane view derives from (one player). */
export interface CacheLaneFacts {
  /** The player's cache key stock (profiles.cache_tokens). */
  keys: number;
}

/** The player-facing lane state, derived from facts. */
export interface CacheLaneView {
  /** The player's cache key stock. */
  keys: number;
  rule: string;
}

/**
 * Derive the lane view from server facts. Pure: the read route and
 * both write twins share this derivation, so no path can show a
 * different lane.
 */
export function cacheLaneView(facts: CacheLaneFacts): CacheLaneView {
  return {
    keys: Math.max(0, Math.trunc(facts.keys) || 0),
    rule: CACHE_LANE_RULE,
  };
}

// ─── Payment resolution ──────────────────────────────────────────────

/**
 * Resolve how an opening is paid, given what the player asked for.
 * The request arrives normalized (trimmed, lowercased) by the write
 * paths:
 *  - 'ad' resolves to 'ad' (the call itself is the attestation;
 *    the caller must still supply an ad unit id — enforced by the
 *    write paths, not here);
 *  - 'key' resolves to 'key' (the write paths check + debit the
 *    stock);
 *  - anything else — including 'free', which no longer exists —
 *    returns null; the write paths raise the "Unknown cache box
 *    payment" error.
 * There is deliberately no count, day, or budget input: nothing
 * about yesterday or earlier today can change how the next
 * opening is paid.
 */
export function resolveCacheBoxPayment(requested: string): CacheBoxPayment | null {
  if (requested === 'ad') return 'ad';
  if (requested === 'key') return 'key';
  return null;
}
