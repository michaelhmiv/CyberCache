/**
 * priceStats — per-identity-key completed-sales statistics for the
 * player market (market depth slice, migration 0019).
 *
 * One pure computation shared by both read stores: each store pulls
 * raw sale records (identity key, UNIT price, sold-at) for the keys
 * asked about, and this module folds them into the stats the UI
 * shows. Unit price = listing price ÷ quantity, so a stack of 10
 * medkits listed for 5,000cr is a 500cr sale in the stats — stack
 * totals would make medians meaningless across different stack sizes.
 *
 * Windows (all anchored at `now`, ms epoch):
 *   - salesCount / medianUnitPrice: sales in the last 30 days.
 *   - lastUnitPrice / lastSoldAt: the most recent sale at ANY age in
 *     the supplied records (stores supply the last 45 days, so a
 *     slow-moving key still shows its last sale).
 *   - trend: median of the last 7 days vs the median of days 8–14,
 *     as a signed fraction; |trend| ≤ 5% reads 'flat'. Null when
 *     either window has no sales.
 *   - recentUnitPrices: up to 12 most recent unit prices in the 30d
 *     window, chronological — the sparkline series.
 *
 * An unknown key (or a key with no sales) yields zeroed stats with
 * null price fields — never a crash, never a fabricated price.
 */
export interface SaleRecord {
  identityKey: string;
  unitPrice: number;
  /** ms epoch. */
  soldAt: number;
}

export type PriceTrend = 'up' | 'down' | 'flat';

export interface PriceStats {
  identityKey: string;
  /** Completed sales in the last 30 days. */
  salesCount: number;
  /** Median unit price over the last 30 days; null when no sales. */
  medianUnitPrice: number | null;
  /** Most recent sale's unit price at any supplied age; null when none. */
  lastUnitPrice: number | null;
  /** ms epoch of the most recent sale; null when none. */
  lastSoldAt: number | null;
  median7d: number | null;
  medianPrev7d: number | null;
  /** (median7d − medianPrev7d) / medianPrev7d; null when either side is empty. */
  trendPct: number | null;
  trend: PriceTrend | null;
  /** Up to 12 unit prices, oldest → newest, last 30 days — sparkline series. */
  recentUnitPrices: number[];
}

export const PRICE_STATS_WINDOW_DAYS = 30;
/** How far back read stores supply sale records (covers last-sale + trend windows). */
export const PRICE_STATS_SUPPLY_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;
const FLAT_BAND = 0.05;
const SPARKLINE_POINTS = 12;

/** Standard median: middle value, or the mean of the two middle values. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function emptyStats(identityKey: string): PriceStats {
  return {
    identityKey,
    salesCount: 0,
    medianUnitPrice: null,
    lastUnitPrice: null,
    lastSoldAt: null,
    median7d: null,
    medianPrev7d: null,
    trendPct: null,
    trend: null,
    recentUnitPrices: [],
  };
}

export function computePriceStats(
  records: readonly SaleRecord[],
  keys: readonly string[],
  now: number,
): Record<string, PriceStats> {
  const byKey = new Map<string, SaleRecord[]>();
  for (const key of keys) byKey.set(key, []);
  for (const record of records) {
    const bucket = byKey.get(record.identityKey);
    if (bucket) bucket.push(record);
  }

  const out: Record<string, PriceStats> = {};
  for (const key of keys) {
    const sales = (byKey.get(key) ?? [])
      .filter((s) => Number.isFinite(s.unitPrice) && s.unitPrice > 0)
      .sort((a, b) => a.soldAt - b.soldAt);
    if (!sales.length) {
      out[key] = emptyStats(key);
      continue;
    }
    const windowStart = now - PRICE_STATS_WINDOW_DAYS * DAY_MS;
    const inWindow = sales.filter((s) => s.soldAt >= windowStart && s.soldAt <= now);
    const last7 = inWindow.filter((s) => s.soldAt >= now - 7 * DAY_MS);
    const prev7 = inWindow.filter((s) => s.soldAt < now - 7 * DAY_MS && s.soldAt >= now - 14 * DAY_MS);
    const median7d = median(last7.map((s) => s.unitPrice));
    const medianPrev7d = median(prev7.map((s) => s.unitPrice));
    let trendPct: number | null = null;
    let trend: PriceTrend | null = null;
    if (median7d !== null && medianPrev7d !== null && medianPrev7d > 0) {
      trendPct = (median7d - medianPrev7d) / medianPrev7d;
      trend = Math.abs(trendPct) <= FLAT_BAND ? 'flat' : trendPct > 0 ? 'up' : 'down';
    }
    const last = sales[sales.length - 1];
    out[key] = {
      identityKey: key,
      salesCount: inWindow.length,
      medianUnitPrice: median(inWindow.map((s) => s.unitPrice)),
      lastUnitPrice: last.unitPrice,
      lastSoldAt: last.soldAt,
      median7d,
      medianPrev7d,
      trendPct,
      trend,
      recentUnitPrices: inWindow.slice(-SPARKLINE_POINTS).map((s) => s.unitPrice),
    };
  }
  return out;
}
