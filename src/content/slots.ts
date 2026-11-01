/**
 * Data Slots — the vendor's slot machine (migration 0049).
 *
 * Content owner for the slot machine slice (design brief:
 * design-briefs/expansion-pack/slot-machine.md; ruling R9 in
 * DECISIONS.md: the strict table stands). This module owns:
 *
 *  - the payout table's TS twin (SLOT_OUTCOMES) — parity-pinned
 *    against the `slot_machine` odds seed in migration 0049, the
 *    vendor-catalog pattern. The odds are DATA, never a lever: a
 *    retune is a reviewed migration, not a live dial (brief §2.6).
 *  - the bet tiers + daily pull cap as economy levers (defaults +
 *    hard clamps), read live through the ONE economy config
 *    accessor; the SQL op reads them via cc_economy_config_number
 *    with identical clamps.
 *  - the vendor-bundle composition rule (§2.2.1): flat-100% staple
 *    consumables only, the smallest combination whose summed vendor
 *    price is >= 2x the bet — computed by ONE canonical DP that the
 *    SQL twin (cc_slot_bundle in 0049) mirrors step for step.
 *  - the cache-key fallback rule (§2.4): a key outcome is charged
 *    against the player's daily cache budget (the cache lane's
 *    10/day openings budget, migration 0037 — the interim sub-cap
 *    from the brief was never written; the lane landed first). When
 *    the budget is exhausted the pull pays 5 cache fragments
 *    instead and the result payload says so in plain language.
 *
 * The machine NEVER pays gear, legendary cores, scrap, or essences
 * (brief §2.2.2). Its best prize is a cache key — which still has to
 * survive the chest's own roll like every other key.
 */
import { VENDOR_STAPLE_DEFS } from '../lib/vendor/catalog';
import { cacheLaneResetsAt, cacheLaneUtcDay } from './cacheLane';

// ─── The payout table (R9: strict, credit RTP exactly 50.5%) ──────

export const SLOT_TABLE_ID = 'slot_machine';
export const SLOT_TABLE_VERSION = 1;

/** What a pull can pay. `key` is the cache key (budget-charged). */
export type SlotPayoutKind = 'none' | 'credits' | 'bundle' | 'fragments' | 'key';

export type SlotOutcomeId =
  | 'bust'
  | 'kickback'
  | 'breakeven'
  | 'triple'
  | 'vendor_bundle'
  | 'fragment_drop'
  | 'ten_spot'
  | 'cache_key'
  | 'jackpot';

/** Reel glyph language (brief §2.9): the game's own currencies —
 *  never card suits or fruit. */
export type SlotGlyph = 'blank' | 'credit_stack' | 'vial' | 'fragment' | 'key' | 'jackpot_star';

export interface SlotOutcomeDef {
  id: SlotOutcomeId;
  /** Player-facing name on the printed table. */
  label: string;
  /** Weight per 10,000 — the seeded odds data. */
  weight: number;
  kind: SlotPayoutKind;
  /** Credits outcomes only: payout = floor(bet x multiplier). */
  creditMultiplier: number;
  /** Fragments outcomes only: fragment count paid. */
  fragments: number;
  glyph: SlotGlyph;
  /** Player-facing prize description for the printed table. */
  paysLabel: string;
}

export const SLOT_OUTCOMES: readonly SlotOutcomeDef[] = [
  { id: 'bust', label: 'Bust', weight: 5480, kind: 'none', creditMultiplier: 0, fragments: 0, glyph: 'blank', paysLabel: 'Nothing' },
  { id: 'kickback', label: 'Kickback', weight: 2000, kind: 'credits', creditMultiplier: 0.5, fragments: 0, glyph: 'credit_stack', paysLabel: '0.5× bet back' },
  { id: 'breakeven', label: 'Break-even', weight: 1200, kind: 'credits', creditMultiplier: 1, fragments: 0, glyph: 'credit_stack', paysLabel: '1× bet back' },
  { id: 'triple', label: 'Triple', weight: 600, kind: 'credits', creditMultiplier: 3, fragments: 0, glyph: 'credit_stack', paysLabel: '3× bet' },
  { id: 'vendor_bundle', label: 'Vendor Bundle', weight: 420, kind: 'bundle', creditMultiplier: 0, fragments: 0, glyph: 'vial', paysLabel: 'Staple goods ≈ 2× bet' },
  { id: 'fragment_drop', label: 'Fragment Drop', weight: 200, kind: 'fragments', creditMultiplier: 0, fragments: 5, glyph: 'fragment', paysLabel: '5 cache fragments' },
  { id: 'ten_spot', label: 'Ten-Spot', weight: 80, kind: 'credits', creditMultiplier: 10, fragments: 0, glyph: 'credit_stack', paysLabel: '10× bet' },
  { id: 'cache_key', label: 'Cache Key', weight: 15, kind: 'key', creditMultiplier: 0, fragments: 0, glyph: 'key', paysLabel: '1 cache key' },
  { id: 'jackpot', label: 'Jackpot', weight: 5, kind: 'credits', creditMultiplier: 50, fragments: 0, glyph: 'jackpot_star', paysLabel: '50× bet' },
];

export const SLOT_OUTCOME_BY_ID: ReadonlyMap<SlotOutcomeId, SlotOutcomeDef> = new Map(
  SLOT_OUTCOMES.map((o) => [o.id, o]),
);

/** Total weight the table must sum to (weights are per 10,000). */
export const SLOT_WEIGHT_TOTAL = 10_000;

/**
 * Credit RTP derived FROM the table — Σ (weight / total) x credit
 * multiplier over the credit-paying outcomes. The structural test
 * asserts this equals exactly 0.505 on the shipped table (R9);
 * nothing in the codebase hardcodes the figure.
 */
export function slotCreditRtp(outcomes: readonly SlotOutcomeDef[] = SLOT_OUTCOMES): number {
  const total = outcomes.reduce((sum, o) => sum + o.weight, 0);
  const ev = outcomes.reduce(
    (sum, o) => sum + (o.kind === 'credits' ? (o.weight / total) * o.creditMultiplier : 0),
    0,
  );
  return ev;
}

/** Printed-table percentage for an outcome (weight per 10,000). */
export function slotOutcomePercent(outcome: SlotOutcomeDef): number {
  return outcome.weight / 100;
}

// ─── Levers (economy_config registry, migration 0018 pattern) ─────

export interface SlotLeverValues {
  /** Pulls per UTC day; 0 closes the machine without a deploy. */
  slotDailyPullCap: number;
  slotBetTier1: number;
  slotBetTier2: number;
  slotBetTier3: number;
}

export const SLOT_LEVER_DEFAULTS: SlotLeverValues = {
  slotDailyPullCap: 100,
  slotBetTier1: 50,
  slotBetTier2: 250,
  slotBetTier3: 1000,
};

export const SLOT_LEVER_CLAMPS: Record<keyof SlotLeverValues, { min: number; max: number }> = {
  slotDailyPullCap: { min: 0, max: 1000 },
  slotBetTier1: { min: 1, max: 100_000 },
  slotBetTier2: { min: 1, max: 100_000 },
  slotBetTier3: { min: 1, max: 100_000 },
};

function clampLever(key: keyof SlotLeverValues, value: number): number {
  const { min, max } = SLOT_LEVER_CLAMPS[key];
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Merge partial live values over the defaults, clamped — the same
 *  resolution the SQL op performs through cc_economy_config_number. */
export function resolveSlotLevers(partial?: Partial<SlotLeverValues> | null): SlotLeverValues {
  const out = { ...SLOT_LEVER_DEFAULTS };
  if (partial) {
    for (const key of Object.keys(SLOT_LEVER_DEFAULTS) as Array<keyof SlotLeverValues>) {
      const value = partial[key];
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = clampLever(key, value);
    }
  }
  return out;
}

/** Bet size for tier 1..3 under the resolved levers, or null. */
export function slotBetForTier(levers: SlotLeverValues, tier: number): number | null {
  if (tier === 1) return levers.slotBetTier1;
  if (tier === 2) return levers.slotBetTier2;
  if (tier === 3) return levers.slotBetTier3;
  return null;
}

/** Tier display names (brief §2.1). */
export const SLOT_TIER_NAMES: Record<number, string> = {
  1: 'Chump Change',
  2: 'Working Stiff',
  3: 'High Roller',
};

// ─── The cache-key fallback (brief §2.4) ──────────────────────────

/** Fragments paid when a key outcome lands on an exhausted cache
 *  budget — and by the fragment-drop outcome itself. 5 fragments =
 *  1 key by the shipped conversion, so the consolation is the same
 *  value class, never a cap breach. */
export const SLOT_KEY_FALLBACK_FRAGMENTS = 5;

/** The plain-language note the result payload carries on a fallback
 *  (brief §2.4: the payload says so in plain language). */
export const SLOT_KEY_FALLBACK_NOTE = 'Cache budget full — paid in fragments';

// ─── The vendor bundle (brief §2.2.1) ─────────────────────────────

export interface SlotBundleItem {
  itemKey: string;
  quantity: number;
  unitPrice: number;
}

export interface SlotBundle {
  items: SlotBundleItem[];
  /** Summed vendor price of the composed goods. */
  totalValue: number;
  /** The composition target: 2x the bet. */
  target: number;
}

/** Bundle value target as a multiple of the bet. */
export const SLOT_BUNDLE_TARGET_MULTIPLIER = 2;

interface SlotCoin {
  itemKey: string;
  price: number;
}

/**
 * The bundle coin set: the vendor's staple consumables (the catalog
 * module owns the staple set + prices; this list is derived, never
 * re-typed), in the canonical composition order — price descending,
 * item key ascending. The SQL twin (cc_slot_bundle) iterates
 * cc_vendor_catalog() staples in exactly this order.
 */
export function slotBundleCoins(): SlotCoin[] {
  return VENDOR_STAPLE_DEFS.map((def) => ({ itemKey: def.id, price: def.market.vendorPrice })).sort(
    (a, b) => b.price - a.price || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0),
  );
}

/**
 * Compose the vendor bundle for a bet: the smallest combination of
 * staple units whose summed vendor price is >= 2x the bet.
 *
 * Canonical DP (the SQL twin mirrors it step for step — change one,
 * change both, the parity tests will hold you to it):
 *  - sums are explored ascending from 0 to target + max coin price;
 *  - a sum is marked reachable the FIRST time any coin reaches it,
 *    iterating coins in canonical order, and never re-marked;
 *  - the answer is the smallest reachable sum >= target, rebuilt by
 *    walking the first-reach parent pointers.
 * Any bundle reaching the minimal sum satisfies "smallest
 * combination >= 2x bet"; first-reach makes WHICH one canonical.
 */
export function composeSlotBundle(betCredits: number): SlotBundle {
  const target = Math.max(0, Math.floor(betCredits) * SLOT_BUNDLE_TARGET_MULTIPLIER);
  const coins = slotBundleCoins();
  const maxPrice = coins.reduce((max, c) => Math.max(max, c.price), 0);
  const cap = target + maxPrice;
  const reachable = new Array<boolean>(cap + 1).fill(false);
  const parent = new Int32Array(cap + 1).fill(-1);
  const parentCoin = new Int32Array(cap + 1).fill(-1);
  reachable[0] = true;
  for (let sum = 0; sum <= cap; sum += 1) {
    if (!reachable[sum]) continue;
    for (let ci = 0; ci < coins.length; ci += 1) {
      const next = sum + coins[ci].price;
      if (next > cap || reachable[next]) continue;
      reachable[next] = true;
      parent[next] = sum;
      parentCoin[next] = ci;
    }
  }
  let total = -1;
  for (let sum = target; sum <= cap; sum += 1) {
    if (reachable[sum]) {
      total = sum;
      break;
    }
  }
  if (total < 0) {
    // Unreachable with the shipped coin set (the 40cr fuel cell makes
    // every sufficiently large sum reachable, and cap = target + max
    // price always contains a greedy fill); kept as a hard failure
    // rather than a silent under-payment.
    throw new Error(`No slot bundle composition reaches ${target}`);
  }
  const counts = new Map<number, number>();
  let cursor = total;
  while (cursor > 0) {
    const ci = parentCoin[cursor];
    counts.set(ci, (counts.get(ci) ?? 0) + 1);
    cursor = parent[cursor];
  }
  const items: SlotBundleItem[] = [...counts.entries()]
    .map(([ci, quantity]) => ({ itemKey: coins[ci].itemKey, quantity, unitPrice: coins[ci].price }))
    .sort((a, b) => b.unitPrice - a.unitPrice || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
  return { items, totalValue: total, target };
}

// ─── State view (read endpoint + panel) ───────────────────────────

export interface SlotCacheBudgetView {
  /** Openings used today (the budget counts openings, not keys). */
  openedToday: number;
  cap: number;
  remaining: number;
}

export interface SlotStateView {
  day: string;
  /** Bet sizes for tiers 1..3 under the live levers. */
  tiers: [number, number, number];
  tierNames: [string, string, string];
  cap: number;
  pullsToday: number;
  pullsRemaining: number;
  /** cap = 0 closes the machine (lever, no deploy). */
  machineOpen: boolean;
  cacheBudget: SlotCacheBudgetView;
  resetsAt: string;
}

export interface SlotStateFacts {
  day: string;
  pullsToday: number;
  cacheOpenedToday: number;
  cacheCap: number;
}

/** The one derivation of the machine's display state, shared by the
 *  read endpoint's two stores and mirrored by the pull result. */
export function buildSlotStateView(facts: SlotStateFacts, levers: SlotLeverValues): SlotStateView {
  const pullsToday = Math.max(0, Math.floor(facts.pullsToday));
  return {
    day: facts.day,
    tiers: [levers.slotBetTier1, levers.slotBetTier2, levers.slotBetTier3],
    tierNames: [SLOT_TIER_NAMES[1], SLOT_TIER_NAMES[2], SLOT_TIER_NAMES[3]],
    cap: levers.slotDailyPullCap,
    pullsToday,
    pullsRemaining: Math.max(0, levers.slotDailyPullCap - pullsToday),
    machineOpen: levers.slotDailyPullCap > 0,
    cacheBudget: {
      openedToday: Math.max(0, Math.floor(facts.cacheOpenedToday)),
      cap: facts.cacheCap,
      remaining: Math.max(0, facts.cacheCap - Math.floor(facts.cacheOpenedToday)),
    },
    resetsAt: cacheLaneResetsAt(facts.day),
  };
}

/** UTC day key for slot counters (the codebase's UTC-day convention). */
export function slotUtcDay(now: Date): string {
  return cacheLaneUtcDay(now);
}
