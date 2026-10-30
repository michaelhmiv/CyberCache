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
  /** Credits the seller is credited: price − fee. */
  sellerProceeds: number;
}

/**
 * Combined fee reduction from an aggregated skill-bonus record (as
 * produced by computeSkillBonuses). `foundBySeller` gates the Market
 * Manipulator term: the seller must have personally found the item
 * (a find-source item they did not acquire from another player).
 */
export function marketFeeReduction(
  bonuses: Record<string, number>,
  foundBySeller: boolean,
): number {
  const darknet = bonuses.marketFeeReduction ?? 0;
  const manipulator = foundBySeller ? (bonuses.foundItemFeeReduction ?? 0) : 0;
  return Math.min(1, Math.max(0, darknet + manipulator));
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
): MarketFeeBreakdown {
  const rate = Math.min(1, Math.max(0, feeRate));
  const reduction = Math.min(1, Math.max(0, feeReduction));
  const effectiveRate = rate * (1 - reduction);
  // The 1e-9 epsilon guards float dust on exact-integer results
  // (e.g. 10000 × 0.0375) so the TS mirror floors exactly where the
  // SQL numeric computation in cc_accept_listing does.
  const fee = Math.floor(price * effectiveRate + 1e-9);
  return {
    price,
    feeRate: rate,
    feeReduction: reduction,
    effectiveRate,
    fee,
    sellerProceeds: price - fee,
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
  /** Live fee-rate lever (0018); defaults to MARKET_FEE_RATE. */
  feeRate?: number;
}): MarketFeeBreakdown {
  const bonuses = computeSkillBonuses(
    input.skillSpends,
    input.classModBoosts ?? { nodeBoosts: {} },
  );
  return marketFeeForPrice(
    input.price,
    marketFeeReduction(bonuses, input.foundBySeller),
    input.feeRate,
  );
}
