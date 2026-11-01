/**
 * marketFee — the ONE market sale-fee computation.
 *
 * A completed player-market sale pays a fee of MARKET_FEE_RATE of the
 * listed price, destroyed (credited to nobody). The buyer always pays
 * the listed price; the seller receives price − fee.
 *
 * The seller's Scavenger fee-reduction nodes reduce the fee:
 *   - Darknet Broker (`scav_fee_1`): `marketFeeReduction` effect,
 *     +5% fee reduction per effective point (def:
 *     src/constants/skillTrees.ts).
 *   - Market Manipulator (`scav_major_3`): `foundItemFeeReduction`
 *     effect, an additional 15% fee reduction for items the seller
 *     personally found (def: src/constants/skillTrees.ts).
 *   - House Brand (`fix_major_3`, Fixer tree, migration 0029):
 *     `craftedItemFeeReduction` effect, an additional 15% fee
 *     reduction for Workshop-crafted items (def: same file). Found
 *     and crafted are disjoint by the drop-source taxonomy, so the
 *     two gated terms never stack on one sale.
 * Reductions are relative (they shrink the fee, not the price) and
 * stack additively, exactly as computeSkillBonuses aggregates the
 * effect keys. Effective points include class mod boosts, via the one
 * shared computeSkillBonuses — callers must derive spends/boosts from
 * server-side records, never from a request body.
 *
 * Consumers:
 *   - db/migrations/0017_market_sale_fee.sql — cc_accept_listing
 *     mirrors this math in SQL (the atomic completion path) with the
 *     node ids / effect values restated; parity is pinned by tests.
 *   - src/server/writes/memory.ts — the in-memory WriteStore mirror.
 *   - src/screens/MarketScreen.tsx — display-only proceeds preview.
 *
 * NPC-seeded listings (item supply_mode 'npc_market') are exempt: the
 * fee does not apply and the NPC payout is unchanged.
 *
 * Cache Rank Silver Tongue (0031): a seller with Silver Tongue ranks
 * is minted an uplift of floor(post-fee proceeds × bonus) on top of
 * their proceeds — the fee itself is computed exactly as above and
 * destroyed in full; the uplift never reduces it. NPC sales are
 * exempt from the uplift as well (no fee branch runs for them).
 */
import { computeSkillBonuses, type ClassModBoosts } from '../skills/skillBonuses';
import { DropSource } from '../../types/game';

/** Fee charged on a completed player-market sale, as a fraction of price. */
export const MARKET_FEE_RATE = 0.05;

/**
 * Drop sources that count as "personally found" for Market
 * Manipulator: the item entered the game as a find for its holder.
 * Marketplace (NPC seeds) and Crafted are not finds.
 */
export const MARKET_FOUND_SOURCES: ReadonlySet<string> = new Set<string>([
  DropSource.WorldDrop,
  DropSource.BossDrop,
  DropSource.CacheForged,
  DropSource.Event,
]);

export function isFoundSource(sourceTag: unknown): boolean {
  return typeof sourceTag === 'string' && MARKET_FOUND_SOURCES.has(sourceTag);
}

export interface MarketFeeBreakdown {
  price: number;
  /** The headline fee rate (MARKET_FEE_RATE). */
  feeRate: number;
  /** Combined relative reduction of the fee, 0..1. */
  feeReduction: number;
  /** MARKET_FEE_RATE × (1 − feeReduction). */
  effectiveRate: number;
  /** Whole credits destroyed by the fee. */
  fee: number;
  /**
   * Cache Rank Silver Tongue rate (0031): the fraction of the
   * POST-FEE proceeds minted to the seller on top. 0 when the
   * seller has no Silver Tongue ranks (or for display callers).
   */
  proceedsBonusRate: number;
  /** Whole credits minted by the Silver Tongue uplift (0031). */
  proceedsBonus: number;
  /** Credits the seller is credited: price − fee + proceedsBonus. */
  sellerProceeds: number;
}

/**
 * Combined fee reduction from an aggregated skill-bonus record (as
 * produced by computeSkillBonuses). `foundBySeller` gates the Market
 * Manipulator term: the seller must have personally found the item
 * (a find-source item they did not acquire from another player).
 * `craftedBySeller` gates the Fixer House Brand term (migration
 * 0029): the item being sold is Workshop-crafted, identified exactly
 * the way the economy metrics identify crafted sales — the listing's
 * batch_origin is 'crafted' (consumables) or the item payload's
 * origin is 'crafted' (gear/vehicles). Found and crafted are
 * DISJOINT by the drop-source taxonomy (a crafted item's source is
 * Crafted, never a find source), so the two gated terms can never
 * both fire on one sale; all terms still compose additively under
 * the one ≤ 1 clamp. Service fees (repair board) pass both flags
 * false — House Brand never applies to labor.
 */
export function marketFeeReduction(
  bonuses: Record<string, number>,
  foundBySeller: boolean,
  craftedBySeller = false,
): number {
  const darknet = bonuses.marketFeeReduction ?? 0;
  const manipulator = foundBySeller ? (bonuses.foundItemFeeReduction ?? 0) : 0;
  const houseBrand = craftedBySeller ? (bonuses.craftedItemFeeReduction ?? 0) : 0;
  return Math.min(1, Math.max(0, darknet + manipulator + houseBrand));
}

/**
 * Fee breakdown for a price and an already-computed reduction.
 * `feeRate` is the live lever (economy_config 'marketFeeRate', 0018)
 * when a server caller resolved one; it defaults to MARKET_FEE_RATE
 * so display surfaces and existing callers are unchanged. The SQL
 * completion path reads the same table row inside cc_accept_listing.
 */
export function marketFeeForPrice(
  price: number,
  feeReduction: number,
  feeRate: number = MARKET_FEE_RATE,
  proceedsBonusRate = 0,
): MarketFeeBreakdown {
  const rate = Math.min(1, Math.max(0, feeRate));
  const reduction = Math.min(1, Math.max(0, feeReduction));
  const effectiveRate = rate * (1 - reduction);
  // The 1e-9 epsilon guards float dust on exact-integer results
  // (e.g. 10000 × 0.0375) so the TS mirror floors exactly where the
  // SQL numeric computation in cc_accept_listing does.
  const fee = Math.floor(price * effectiveRate + 1e-9);
  // Cache Rank Silver Tongue (0031): composition order is FIXED —
  // the fee is computed first (rate × (1 − reductions), destroyed),
  // then the uplift is floor(post-fee proceeds × bonus rate) and
  // MINTED to the seller. The SQL twin is cc_accept_listing (0031).
  const bonusRate = Math.min(1, Math.max(0, proceedsBonusRate));
  const proceedsBonus = Math.floor((price - fee) * bonusRate + 1e-9);
  return {
    price,
    feeRate: rate,
    feeReduction: reduction,
    effectiveRate,
    fee,
    proceedsBonusRate: bonusRate,
    proceedsBonus,
    sellerProceeds: price - fee + proceedsBonus,
  };
}

/**
 * Full derivation from a seller's records: skill spends + equipped
 * class mod boosts (server-side records only) and whether the seller
 * personally found the item being sold.
 */
export function marketFeeForSeller(input: {
  price: number;
  skillSpends: Record<string, number>;
  classModBoosts?: ClassModBoosts;
  foundBySeller: boolean;
  /** House Brand gate (0029): the sold item is Workshop-crafted. */
  craftedBySeller?: boolean;
  /** Live fee-rate lever (0018); defaults to MARKET_FEE_RATE. */
  feeRate?: number;
  /**
   * The seller's resolved Cache Rank Silver Tongue fraction (0031),
   * derived by the caller from the seller's cache_rank_spends —
   * applied to the post-fee proceeds. Absent = 0.
   */
  cacheRankProceedsBonus?: number;
}): MarketFeeBreakdown {
  const bonuses = computeSkillBonuses(
    input.skillSpends,
    input.classModBoosts ?? { nodeBoosts: {} },
  );
  return marketFeeForPrice(
    input.price,
    marketFeeReduction(bonuses, input.foundBySeller, input.craftedBySeller ?? false),
    input.feeRate,
    input.cacheRankProceedsBonus ?? 0,
  );
}
