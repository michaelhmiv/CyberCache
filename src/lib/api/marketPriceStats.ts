/**
 * Market price intelligence (market depth 0019) — completed-sales
 * stats per identity key from GET /api/market/price-stats. The math
 * is src/lib/market/priceStats.ts on the server; this is only the
 * transport. Failures degrade to "no guidance" ({}), never an error
 * surface — sellers fall back to the default-price formula.
 */
import { apiRequest } from './http';
import type { PriceStats } from '@/lib/market/priceStats';

export async function fetchPriceStats(keys: readonly string[]): Promise<Record<string, PriceStats>> {
  const unique = [...new Set(keys.filter(Boolean))].slice(0, 100);
  if (!unique.length) return {};
  try {
    const res = await apiRequest<{ stats: Record<string, PriceStats> }>(
      `/market/price-stats?keys=${encodeURIComponent(unique.join(','))}`,
    );
    return res?.stats ?? {};
  } catch (error) {
    console.warn('[marketPriceStats] fetch failed:', error instanceof Error ? error.message : error);
    return {};
  }
}
