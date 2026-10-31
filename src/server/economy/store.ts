/**
 * EconomyStore: the persistence seam for economy observability
 * (migration 0018).
 *
 *  - PgEconomyStore runs the SQL landed in 0018_economy_observability
 *    (cc_compute_economy_metrics / cc_set_economy_config) and plain
 *    selects against economy_metrics / economy_config.
 *  - InMemoryEconomyStore (memory.ts) mirrors the same observable
 *    semantics for tests, including the ledger attribution rules.
 *
 * The store is operator surface only: it is reached from the
 * job-secret-gated admin routes and the daily heartbeat, never from
 * a player route.
 */
import type { Pool } from 'pg';
import type { EconomyConfigSource } from './config';

/** One day of economy metrics — mirrors public.economy_metrics. */
export interface EconomyMetricsRow {
  day: string; // YYYY-MM-DD (UTC)
  creditsMintedRoaming: number;
  creditsMintedBoss: number;
  creditsMintedOffline: number;
  creditsMintedOther: number;
  creditsMintedVendorBuyback: number;
  creditsMintedTotal: number;
  creditsDestroyedMarketFees: number;
  creditsDestroyedVendor: number;
  creditsDestroyedResurrection: number;
  creditsDestroyedRespec: number;
  creditsDestroyedBossEntryFees: number;
  creditsDestroyedBossDeathFees: number;
  creditsDestroyedTotal: number;
  netCreditChange: number;
  legendariesRoaming: number;
  legendariesBoss: number;
  legendariesCache: number;
  legendariesTotal: number;
  marketListingsCreated: number;
  marketSales: number;
  marketVolume: number;
  marketMedianPrice: number | null;
  marketMedianByRarity: Record<string, number>;
  cacheKeysFromAds: number;
  cacheOpens: number;
  cacheFragmentsAwarded: number;
  /** Craft meters (migration 0024, brief §2.10). */
  craftJobsCompleted: number;
  craftUnitsCompleted: number;
  craftXpAwarded: number;
  materialsDestroyedCrafting: Record<string, number>;
  refinedUnitsProduced: number;
  gearItemsCrafted: number;
  craftedMarketSales: number;
  craftedMarketVolume: number;
  /** Legendary salvage + core meters (migration 0026). */
  legendariesSalvaged: number;
  legendaryCoresMinted: number;
  legendaryCoresSpent: number;
  computedAt: string;
}

export interface EconomyStore extends EconomyConfigSource {
  /** Recompute one UTC day (YYYY-MM-DD) and return the stored row. */
  computeMetricsForDay(day: string): Promise<EconomyMetricsRow>;
  /** Most recent computed days, ascending by day. */
  listMetrics(limitDays: number): Promise<EconomyMetricsRow[]>;
  /** Set one lever through the logging write path. */
  setConfigValue(key: string, value: number, updatedBy: string): Promise<void>;
}

interface PgMetricsRow {
  day: string;
  credits_minted_roaming: string;
  credits_minted_boss: string;
  credits_minted_offline: string;
  credits_minted_other: string;
  credits_minted_vendor_buyback: string;
  credits_minted_total: string;
  credits_destroyed_market_fees: string;
  credits_destroyed_vendor: string;
  credits_destroyed_resurrection: string;
  credits_destroyed_respec: string;
  credits_destroyed_boss_entry_fees: string;
  credits_destroyed_boss_death_fees: string;
  credits_destroyed_total: string;
  net_credit_change: string;
  legendaries_roaming: number;
  legendaries_boss: number;
  legendaries_cache: number;
  legendaries_total: number;
  market_listings_created: number;
  market_sales: number;
  market_volume: string;
  market_median_price: string | null;
  market_median_by_rarity: Record<string, number>;
  cache_keys_from_ads: number;
  cache_opens: number;
  cache_fragments_awarded: string;
  craft_jobs_completed?: number;
  craft_units_completed?: number;
  craft_xp_awarded?: string;
  materials_destroyed_crafting?: Record<string, number>;
  refined_units_produced?: number;
  gear_items_crafted?: number;
  crafted_market_sales?: number;
  crafted_market_volume?: string;
  legendaries_salvaged?: number;
  legendary_cores_minted?: string;
  legendary_cores_spent?: string;
  computed_at: string;
}

function mapMetricsRow(r: PgMetricsRow): EconomyMetricsRow {
  const day = typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10);
  return {
    day,
    creditsMintedRoaming: Number(r.credits_minted_roaming),
    creditsMintedBoss: Number(r.credits_minted_boss),
    creditsMintedOffline: Number(r.credits_minted_offline),
    creditsMintedOther: Number(r.credits_minted_other),
    creditsMintedVendorBuyback: Number(r.credits_minted_vendor_buyback),
    creditsMintedTotal: Number(r.credits_minted_total),
    creditsDestroyedMarketFees: Number(r.credits_destroyed_market_fees),
    creditsDestroyedVendor: Number(r.credits_destroyed_vendor),
    creditsDestroyedResurrection: Number(r.credits_destroyed_resurrection),
    creditsDestroyedRespec: Number(r.credits_destroyed_respec),
    creditsDestroyedBossEntryFees: Number(r.credits_destroyed_boss_entry_fees),
    creditsDestroyedBossDeathFees: Number(r.credits_destroyed_boss_death_fees),
    creditsDestroyedTotal: Number(r.credits_destroyed_total),
    netCreditChange: Number(r.net_credit_change),
    legendariesRoaming: Number(r.legendaries_roaming),
    legendariesBoss: Number(r.legendaries_boss),
    legendariesCache: Number(r.legendaries_cache),
    legendariesTotal: Number(r.legendaries_total),
    marketListingsCreated: Number(r.market_listings_created),
    marketSales: Number(r.market_sales),
    marketVolume: Number(r.market_volume),
    marketMedianPrice: r.market_median_price === null ? null : Number(r.market_median_price),
    marketMedianByRarity: r.market_median_by_rarity ?? {},
    cacheKeysFromAds: Number(r.cache_keys_from_ads),
    cacheOpens: Number(r.cache_opens),
    cacheFragmentsAwarded: Number(r.cache_fragments_awarded),
    craftJobsCompleted: Number(r.craft_jobs_completed ?? 0),
    craftUnitsCompleted: Number(r.craft_units_completed ?? 0),
    craftXpAwarded: Number(r.craft_xp_awarded ?? 0),
    materialsDestroyedCrafting: r.materials_destroyed_crafting ?? {},
    refinedUnitsProduced: Number(r.refined_units_produced ?? 0),
    gearItemsCrafted: Number(r.gear_items_crafted ?? 0),
    craftedMarketSales: Number(r.crafted_market_sales ?? 0),
    craftedMarketVolume: Number(r.crafted_market_volume ?? 0),
    legendariesSalvaged: Number(r.legendaries_salvaged ?? 0),
    legendaryCoresMinted: Number(r.legendary_cores_minted ?? 0),
    legendaryCoresSpent: Number(r.legendary_cores_spent ?? 0),
    computedAt: typeof r.computed_at === 'string' ? r.computed_at : new Date(r.computed_at).toISOString(),
  };
}

const METRICS_COLUMNS = `
  day::text as day, credits_minted_roaming, credits_minted_boss,
  credits_minted_offline, credits_minted_other, credits_minted_vendor_buyback,
  credits_minted_total,
  credits_destroyed_market_fees, credits_destroyed_vendor,
  credits_destroyed_resurrection, credits_destroyed_respec,
  credits_destroyed_boss_entry_fees, credits_destroyed_boss_death_fees,
  credits_destroyed_total, net_credit_change,
  legendaries_roaming, legendaries_boss, legendaries_cache, legendaries_total,
  market_listings_created, market_sales, market_volume,
  market_median_price, market_median_by_rarity,
  cache_keys_from_ads, cache_opens, cache_fragments_awarded,
  legendaries_salvaged, legendary_cores_minted, legendary_cores_spent,
  computed_at::text as computed_at`;

export class PgEconomyStore implements EconomyStore {
  constructor(private readonly pool: Pool) {}

  async loadConfigValues(): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query<{ key: string; value: unknown }>(
      'select key, value from public.economy_config',
    );
    const values: Record<string, unknown> = {};
    for (const row of rows) values[row.key] = row.value;
    return values;
  }

  async setConfigValue(key: string, value: number, updatedBy: string): Promise<void> {
    await this.pool.query('select public.cc_set_economy_config($1, $2::jsonb, $3)', [
      key,
      JSON.stringify(value),
      updatedBy,
    ]);
  }

  async computeMetricsForDay(day: string): Promise<EconomyMetricsRow> {
    await this.pool.query('select public.cc_compute_economy_metrics($1::date)', [day]);
    const { rows } = await this.pool.query<PgMetricsRow>(
      `select ${METRICS_COLUMNS} from public.economy_metrics where day = $1::date`,
      [day],
    );
    return mapMetricsRow(rows[0]);
  }

  async listMetrics(limitDays: number): Promise<EconomyMetricsRow[]> {
    const limit = Math.max(1, Math.min(365, Math.trunc(limitDays) || 1));
    const { rows } = await this.pool.query<PgMetricsRow>(
      `select ${METRICS_COLUMNS} from public.economy_metrics
        order by day desc limit $1`,
      [limit],
    );
    return rows.map(mapMetricsRow).reverse();
  }
}
