/**
 * quickBuy — the QuickBuy sweep planner (QB-1, owner directive
 * 2026-11-03: a + beside every shortfall goods line; a pop-up sheet
 * that fills the shortfall from the player market and/or the NPC
 * vendor without leaving the surface).
 *
 * This module is the ONE planner for a quick-buy sweep. Three
 * callers share it so the numbers can never disagree:
 *   - the Chef quote read (both write stores assemble the quote from
 *     live listing rows through `planMarketSweep`),
 *   - the client sheet (re-plans locally when the quantity stepper
 *     moves, pricing the take with the same function the server
 *     quoted),
 *   - the InMemory write store's fill mirror.
 * The Postgres fill (`cc_quickbuy_fill`, migration 0060) restates
 * the same rules in SQL and parity is pinned by tests: sweep order
 * (unit price ascending, then listed_at, then id), the split-charge
 * rule, and the quote-is-a-ceiling enforcement.
 *
 * The rules that matter:
 *   - A sweep walks OPEN stack listings for one good, cheapest UNIT
 *     price first, EXCLUDING the buyer's own listings (no buying
 *     from yourself, no fee games).
 *   - Taking q units from a stack of (Q, P) charges
 *     floor(P × q / Q); the remainder listing keeps P − charge for
 *     Q − q. A full take is exactly P — identical to accepting the
 *     listing whole. No credits are created or destroyed by the
 *     split itself; the standard seller-side market fee then applies
 *     to each leg's charge exactly as cc_accept_listing applies it.
 *   - The vendor leg is flat: today's vendor unit price (rotation +
 *     Item of the Day resolved by src/lib/vendor/catalog.ts) times
 *     the quantity. The vendor never sells fragments or cores.
 *   - The quote is a CEILING: the fill re-plans under lock and
 *     charges the re-planned total only when it is ≤ the quoted
 *     total for the confirmed quantity; otherwise it aborts with a
 *     fresh quote (see migration 0060). This module only plans —
 *     the ceiling comparison lives in the fill paths.
 */
import {
  CORE_IDENTITY_KEY,
  FRAGMENT_IDENTITY_KEY,
  essenceIdentityKey,
  materialIdentityKey,
} from './identityKey';

export type QuickBuyGoodKind = 'material' | 'essence' | 'consumable' | 'fragment' | 'core';

/** The stack listing kinds a quick-buy sweep can take from — 1:1 with the good kinds. */
export type QuickBuyListingKind = QuickBuyGoodKind;

export type QuickBuySource = 'market' | 'vendor';

export interface QuickBuyGoodRef {
  kind: QuickBuyGoodKind;
  /** Material/essence id, consumable type, or the commodity id for fragment/core. */
  id: string;
}

/** The fragment/core commodity ids used on the wire (the good's `id`). */
export const QUICKBUY_FRAGMENT_ID = 'cache';
export const QUICKBUY_CORE_ID = 'legendary';

export const QUICKBUY_GOOD_KINDS: readonly QuickBuyGoodKind[] = [
  'material',
  'essence',
  'consumable',
  'fragment',
  'core',
];

export function isQuickBuyGoodKind(value: unknown): value is QuickBuyGoodKind {
  return typeof value === 'string' && (QUICKBUY_GOOD_KINDS as readonly string[]).includes(value);
}

/**
 * The single identity key for a good, when one exists. Materials,
 * essences, fragments and cores each have exactly one market
 * identity; consumables band by quality, so a consumable good has
 * one key PER BAND — `consumableIdentityKey` with a quality — and
 * this returns null for them (the sweep matches by consumable type,
 * across bands, cheapest unit first).
 */
export function quickBuyIdentityKey(good: QuickBuyGoodRef): string | null {
  switch (good.kind) {
    case 'material':
      return materialIdentityKey(good.id);
    case 'essence':
      return essenceIdentityKey(good.id);
    case 'fragment':
      return FRAGMENT_IDENTITY_KEY;
    case 'core':
      return CORE_IDENTITY_KEY;
    case 'consumable':
      return null;
  }
}

/** Minimal listing row the planner reads — both stores project their rows into this shape. */
export interface QuickBuyListingRow {
  id: string;
  sellerUserId: string;
  sellerKind: 'player' | 'npc';
  quantity: number;
  priceCredits: number;
  qualityPercent: number | null;
  /** ISO timestamp; sweep tie-break after unit price. */
  listedAt: string;
}

export interface QuickBuyFillLeg {
  listingId: string;
  sellerKind: 'player' | 'npc';
  takeQty: number;
  /** The stack's listed unit price (price ÷ quantity) — display + ordering fact. */
  unitPrice: number;
  /** Whole credits charged for this leg (the split rule). */
  charge: number;
  qualityPercent: number | null;
}

export interface QuickBuyMarketPlan {
  /** Total units listed across the supplied rows (after own-listing exclusion). */
  supplyQty: number;
  /** Units the plan takes: min(requested, supply). */
  fillableQty: number;
  /** True when supply cannot cover the request. */
  partial: boolean;
  /** Legs in sweep order, covering exactly fillableQty. */
  fills: QuickBuyFillLeg[];
  /** Whole credits for the planned take (the ceiling the sheet quotes). */
  total: number;
  /** Highest unit price the plan touches; null when there is no supply. */
  worstUnitPrice: number | null;
}

/**
 * The split rule (SCOPE §4.3): taking `takeQty` from a stack of
 * (stackQty, stackPrice) charges floor(stackPrice × takeQty /
 * stackQty). A full take charges the stack price exactly, so
 * draining a stack leg by leg always sums to its listed price.
 */
export function splitStackCharge(stackPrice: number, takeQty: number, stackQty: number): number {
  const price = Math.max(0, Math.floor(stackPrice) || 0);
  const qty = Math.max(0, Math.floor(stackQty) || 0);
  const take = Math.max(0, Math.floor(takeQty) || 0);
  if (qty <= 0 || take <= 0) return 0;
  if (take >= qty) return price;
  return Math.floor((price * take) / qty);
}

/** Sweep order: unit price ascending, then listed_at, then id (the SQL fill locks in this order). */
export function compareQuickBuyRows(a: QuickBuyListingRow, b: QuickBuyListingRow): number {
  const unitA = a.quantity > 0 ? a.priceCredits / a.quantity : Number.POSITIVE_INFINITY;
  const unitB = b.quantity > 0 ? b.priceCredits / b.quantity : Number.POSITIVE_INFINITY;
  if (unitA !== unitB) return unitA - unitB;
  if (a.listedAt !== b.listedAt) return a.listedAt < b.listedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Plan a market sweep of `requestedQty` over `rows` for `buyerId`:
 * the buyer's own listings are excluded before anything is counted
 * (they are not supply). Returns the legs in sweep order covering
 * min(requested, supply).
 */
export function planMarketSweep(
  rows: readonly QuickBuyListingRow[],
  requestedQty: number,
  buyerId: string,
): QuickBuyMarketPlan {
  const wanted = Math.max(0, Math.floor(requestedQty) || 0);
  const eligible = rows
    // Pure player market (2026-11-04): NPC listings are never sweep
    // supply, whatever rows a caller hands the planner.
    .filter((row) => row.sellerUserId !== buyerId && row.sellerKind !== 'npc' && row.quantity > 0 && row.priceCredits >= 0)
    .sort(compareQuickBuyRows);
  const supplyQty = eligible.reduce((sum, row) => sum + row.quantity, 0);
  const fills: QuickBuyFillLeg[] = [];
  let remaining = Math.min(wanted, supplyQty);
  let total = 0;
  let worstUnitPrice: number | null = null;
  for (const row of eligible) {
    if (remaining <= 0) break;
    const takeQty = Math.min(remaining, row.quantity);
    const charge = splitStackCharge(row.priceCredits, takeQty, row.quantity);
    fills.push({
      listingId: row.id,
      sellerKind: row.sellerKind,
      takeQty,
      unitPrice: row.quantity > 0 ? row.priceCredits / row.quantity : 0,
      charge,
      qualityPercent: row.qualityPercent,
    });
    total += charge;
    worstUnitPrice = row.quantity > 0 ? row.priceCredits / row.quantity : worstUnitPrice;
    remaining -= takeQty;
  }
  return {
    supplyQty,
    fillableQty: Math.min(wanted, supplyQty),
    partial: supplyQty < wanted,
    fills,
    total,
    worstUnitPrice,
  };
}

/** The vendor half of a quote: today's offer for the good, or null when the vendor doesn't stock it today. */
export interface QuickBuyVendorQuote {
  unitPrice: number;
  basePrice: number;
  itemOfTheDay: boolean;
  staple: boolean;
  /** unitPrice × requestedQty. */
  total: number;
}

export interface QuickBuyQuote {
  action_type: 'cc_quickbuy_quote';
  good: QuickBuyGoodRef;
  requested_qty: number;
  /** The buyer's credit balance at quote time. */
  balance: number;
  market: QuickBuyMarketPlan & {
    /** Every eligible row in sweep order (own listings excluded) — the sheet re-plans locally from these. */
    listings: QuickBuyListingRow[];
  };
  vendor: QuickBuyVendorQuote | null;
}

/**
 * The sheet's default tab: the cheaper COMPLETE fill wins; when
 * neither source completes the fill, the cheaper partial (the vendor
 * never partials — its stock is infinite — so a vendor offer is
 * always complete when present; a market-only partial defaults to
 * market). Returns null when neither source has anything.
 */
export function defaultQuickBuyTab(quote: QuickBuyQuote): QuickBuySource | null {
  const marketComplete = !quote.market.partial && quote.market.fillableQty > 0;
  const vendorComplete = quote.vendor !== null;
  if (marketComplete && vendorComplete) {
    return quote.vendor!.total <= quote.market.total ? 'vendor' : 'market';
  }
  if (vendorComplete) return 'vendor';
  if (marketComplete) return 'market';
  if (quote.market.fillableQty > 0) return 'market';
  return null;
}
