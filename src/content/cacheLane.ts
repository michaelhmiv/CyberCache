/**
 * Cache box lane (migration 0037) — the monetization lane for Data
 * Caches, kept visibly distinct from loot drops.
 *
 * Michael's law for this lane:
 *  - CACHE BOX ≠ LOOT DROP. Drops are earned gameplay (roaming,
 *    bosses, endless); cache boxes are the ad lane. The words are
 *    never swapped on any surface.
 *  - 1 FREE box daily + watch-ad boxes up to 10/day TOTAL (the cap
 *    counts every opening of the day, the free one included).
 *  - Always optional, never restricting gameplay; NO ADS ON THE
 *    PLAY SCREEN, EVER — the ad offer lives only on the cache
 *    surface (ChestScreen).
 *  - No server-side ad verification (SSV): ad completions are
 *    client-attested; the hard daily cap is the abuse control.
 *
 * THE KEYS ↔ BUDGET MODEL (the reconciliation this slice ships):
 * there is ONE daily budget of box openings. Every opening consumes
 * one budget slot, however it is paid:
 *  - the day's FIRST opening is FREE (no key, no ad) — the server
 *    resolves it as free even if the caller asked to pay, so the
 *    free slot can never be wasted or sold back;
 *  - openings 2..cap are paid per opening, player's choice on the
 *    cache surface: 1 cache key OR one watch-ad attestation;
 *  - keys (fragments, weekly leaderboards 0035, login streak 0036)
 *    stay a stock that buys ad-free openings INSIDE the budget —
 *    they never buy an opening past the cap (the same rule the
 *    approved slot-machine defaults state: key prizes are charged
 *    against the 10/day cache budget);
 *  - the retired rewarded-key claim (cc_claim_rewarded_cache_key,
 *    3 keys/day + 5-minute cooldown) is gone: ads no longer mint
 *    keys, they attest openings directly.
 *
 * The cap is a live lever (cacheBoxDailyCap, economy_config 0018)
 * with the shipped default 10; the free count (1) is a rule, not a
 * lever. Both twins (SQL cc_make_item / in-memory writes) resolve
 * payment through these same rules — resolveCacheBoxPayment below
 * is the TS statement of the SQL logic.
 */

// ─── Constants ───────────────────────────────────────────────────────

/** Shipped default for the daily box budget (the lever's default). */
export const CACHE_BOX_DAILY_CAP_DEFAULT = 10;

/** Free boxes per UTC day — a rule of the lane, never levered. */
export const CACHE_BOX_FREE_PER_DAY = 1;

/** The ways an opening is paid for. */
export type CacheBoxPayment = 'free' | 'ad' | 'key';

export const CACHE_BOX_PAYMENTS: readonly CacheBoxPayment[] = ['free', 'ad', 'key'];

/** Player-facing rule line for the cache surface. */
export const CACHE_LANE_RULE =
  'One free cache box every day. Open more with a cache key or a short ad — up to 10 boxes a day in total. The budget resets at 00:00 UTC.';

// ─── UTC day helpers (the codebase's UTC-day convention) ────────────

/** UTC day (YYYY-MM-DD) of a Date. */
export function cacheLaneUtcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** ISO instant the budget for `day` (YYYY-MM-DD) resets: the next UTC midnight. */
export function cacheLaneResetsAt(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// ─── Levers ──────────────────────────────────────────────────────────

/**
 * Lever values for the lane. Defaults and hard clamps live HERE
 * (content) and the economy-config registry mirrors them, pinned
 * equal by tests; the SQL call site reads the value through
 * cc_economy_config_number with the identical clamp.
 */
export interface CacheLaneLeverValues {
  /** Total cache boxes openable per UTC day, free included. */
  cacheBoxDailyCap: number;
}

export const CACHE_LANE_LEVER_DEFAULTS: CacheLaneLeverValues = {
  cacheBoxDailyCap: CACHE_BOX_DAILY_CAP_DEFAULT,
};

/** Hard clamps per lever — the SQL call site clamps identically. */
export const CACHE_LANE_LEVER_CLAMPS: Record<
  keyof CacheLaneLeverValues,
  { min: number; max: number; integer?: boolean }
> = {
  cacheBoxDailyCap: { min: 1, max: 30, integer: true },
};

function clampLever(key: keyof CacheLaneLeverValues, value: number): number {
  const clamp = CACHE_LANE_LEVER_CLAMPS[key];
  const clamped = Math.min(clamp.max, Math.max(clamp.min, value));
  return clamp.integer ? Math.trunc(clamped) : clamped;
}

/** Merge raw lever values over the shipped defaults, clamped. */
export function resolveCacheLaneLevers(
  partial?: Partial<CacheLaneLeverValues> | null,
): CacheLaneLeverValues {
  const values: CacheLaneLeverValues = { ...CACHE_LANE_LEVER_DEFAULTS };
  if (!partial) return values;
  for (const key of Object.keys(CACHE_LANE_LEVER_DEFAULTS) as Array<keyof CacheLaneLeverValues>) {
    const raw = partial[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      values[key] = clampLever(key, raw);
    }
  }
  return values;
}

// ─── Facts + view ────────────────────────────────────────────────────

/** Per-payment opening counts for one UTC day. */
export interface CacheBoxPaymentCounts {
  free: number;
  ad: number;
  key: number;
}

/** Server facts the lane view derives from (one player's UTC day). */
export interface CacheLaneFacts {
  /** UTC day (YYYY-MM-DD) the counts belong to. */
  day: string;
  /** The player's cache key stock (profiles.cache_tokens). */
  keys: number;
  /** Openings already recorded today, by payment. */
  byPayment: CacheBoxPaymentCounts;
}

export function cacheBoxOpenedTotal(byPayment: CacheBoxPaymentCounts): number {
  return byPayment.free + byPayment.ad + byPayment.key;
}

/** The player-facing lane state, derived from facts + levers. */
export interface CacheLaneView {
  day: string;
  /** Effective daily cap (lever-resolved). */
  cap: number;
  freePerDay: number;
  openedToday: number;
  remaining: number;
  /** True while the day's free opening is still unclaimed. */
  freeAvailable: boolean;
  /** The player's cache key stock. */
  keys: number;
  byPayment: CacheBoxPaymentCounts;
  /** ISO instant the budget resets (next UTC midnight). */
  resetsAt: string;
  rule: string;
}

/**
 * Derive the lane view from server facts. Pure: the read route and
 * both write twins share this derivation, so no path can show a
 * different budget.
 */
export function cacheLaneView(facts: CacheLaneFacts, levers: CacheLaneLeverValues): CacheLaneView {
  const cap = Math.max(1, Math.trunc(levers.cacheBoxDailyCap) || CACHE_BOX_DAILY_CAP_DEFAULT);
  const openedToday = cacheBoxOpenedTotal(facts.byPayment);
  return {
    day: facts.day,
    cap,
    freePerDay: CACHE_BOX_FREE_PER_DAY,
    openedToday,
    remaining: Math.max(0, cap - openedToday),
    freeAvailable: facts.byPayment.free < CACHE_BOX_FREE_PER_DAY,
    keys: Math.max(0, Math.trunc(facts.keys) || 0),
    byPayment: { ...facts.byPayment },
    resetsAt: cacheLaneResetsAt(facts.day),
    rule: CACHE_LANE_RULE,
  };
}

// ─── Payment resolution (free-first ordering) ────────────────────────

/**
 * Resolve how the NEXT opening is paid, given what the player asked
 * for and today's counts. The server owns the free slot: while a
 * free opening remains, ANY request resolves to 'free' (a key or an
 * ad is never consumed for it). Once the free slot is used:
 *  - 'ad' resolves to 'ad' (the call itself is the attestation;
 *    the caller must still supply an ad unit id — enforced by the
 *    write paths, not here);
 *  - 'key' resolves to 'key';
 *  - 'free' can no longer resolve (returns null — the write paths
 *    raise the "free box already used" error);
 *  - anything else returns null.
 * A request made with the budget exhausted also returns null; the
 * write paths check the cap first and raise the cap error, so this
 * helper only decides payment for an opening that may proceed.
 */
export function resolveCacheBoxPayment(
  requested: string,
  byPayment: CacheBoxPaymentCounts,
): CacheBoxPayment | null {
  if (byPayment.free < CACHE_BOX_FREE_PER_DAY) return 'free';
  if (requested === 'ad') return 'ad';
  if (requested === 'key') return 'key';
  return null;
}
