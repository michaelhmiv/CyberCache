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
  /** Cache box lane issuance by payment (migration 0037). */
  cacheBoxesOpenedFree: number;
  cacheBoxesOpenedAd: number;
  cacheBoxesOpenedKey: number;
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
  /** Reforge meters (migration 0027): completed reforges, the scrap
   *  destroyed by them, and the legendary cores they destroyed (the
   *  reforge share of legendaryCoresSpent, broken out — a subset
   *  view, never an additional count). */
  reforgesCompleted: number;
  scrapDestroyedReforge: number;
  legendaryCoresDestroyedReforge: number;
  /** Endless meters (migration 0028): runs started/ended, encounters
   *  cleared, the day's deepest ended run, escrow payouts (credits
   *  fold into creditsMintedTotal; XP is metered here only), entry
   *  fees destroyed (folded into creditsDestroyedTotal), and
   *  milestone drops by rarity. */
  endlessRunsStarted: number;
  endlessRunsEnded: number;
  endlessEncountersCleared: number;
  endlessDeepestDepth: number;
  endlessCreditsPaid: number;
  endlessXpPaid: number;
  endlessFeesDestroyed: number;
  endlessMilestoneDrops: number;
  endlessMilestoneDropsByRarity: Record<string, number>;
  /** Action skill fire meters (migration 0030): fires per tree per
   *  day, folded from the appliers' ledger results. Firing moves no
   *  currency, so these never touch the minted/destroyed totals. */
  actionSkillFiresGunslinger: number;
  actionSkillFiresDemolition: number;
  actionSkillFiresScavenger: number;
  actionSkillFiresFixer: number;
  /** Cache Rank token meters (migration 0031): tokens granted /
   *  spent per day from the grant/spend ledger payloads. Tokens are
   *  not credits; these never touch the minted/destroyed totals. */
  cacheRankTokensGranted: number;
  cacheRankTokensSpent: number;
  /** Dispatch mint meters (migration 0032): foot + courier settle
   *  payouts per day from the cc_dispatch_settle ledger payloads.
   *  Both are real mints and fold into creditsMintedTotal. */
  creditsMintedDispatch: number;
  creditsMintedCourier: number;
  /** Extraction meters (migration 0033): passes finalized and XP
   *  awarded per day from the cc_apply_extraction ledger payloads,
   *  plus the per-material-id mint map (materials and essences —
   *  disjoint id spaces, summed per id). Extraction mints no
   *  credits; these never touch the minted/destroyed totals. */
  extractionPasses: number;
  extractionXpAwarded: number;
  materialsMintedExtraction: Record<string, number>;
  /** Weekly-leaderboard meters (migration 0035): cache keys paid by
   *  settlement — the cc_leaderboard_settlement rows' awarded keys,
   *  metered distinctly from ad-lane issuance (cacheKeysFromAds).
   *  Keys are not credits; this never touches the totals. */
  cacheKeysFromLeaderboards: number;
  /** Login-streak meters (migration 0036): the day's
   *  cc_login_streak_claim grants. Credits are a real faucet and
   *  are included in creditsMintedTotal; fragments and keys are
   *  their own sources — the keys are NOT leaderboard keys and NOT
   *  ad-lane issuance, and never enter the credit totals. */
  creditsMintedLoginStreak: number;
  cacheFragmentsFromLoginStreak: number;
  cacheKeysFromLoginStreak: number;
  /** Research meters (migration 0038): enrollments started and
   *  courses completed that day, plus the enrollment fees destroyed
   *  at enroll — the fees are a sink and are included in
   *  creditsDestroyedTotal. */
  researchEnrollmentsStarted: number;
  researchCoursesCompleted: number;
  researchCreditsDestroyed: number;
  /** Manufacturer Standing meters (migration 0043): points awarded
   *  per source (turn-ins from the day's cc_turn_in_item ledger rows;
   *  drip folded from manufacturer_standing_daily), items destroyed
   *  by the desk (turn-ins + tribute items), tribute credits
   *  destroyed, ALL standing credits destroyed (tribute + Rep Shelf /
   *  Parts Crate buys + Signature Orders — a component of
   *  creditsDestroyedTotal, never double-counted), Signature Orders
   *  fulfilled, and rank-ups by manufacturer. Standing mints no
   *  credits; a turned-in Legendary never joins legendariesSalvaged. */
  standingPointsAwarded: { turn_in: Record<string, number>; drip: Record<string, number> };
  standingItemsDestroyed: number;
  standingTributeCreditsDestroyed: number;
  standingCreditsDestroyed: number;
  standingOrdersFulfilled: number;
  standingRankUps: Record<string, number>;
  /** Data Slots meters (migration 0049): pulls, credits wagered
   *  (a component of creditsDestroyedTotal — the gross fold every
   *  prior slice uses), credits paid (== creditsMintedSlots, a
   *  component of creditsMintedTotal), bundles / fragments / keys
   *  paid in kind, key→fragment fallbacks, and the net slot sink
   *  memo creditsDestroyedSlots (wagered − paid, floored at 0; a
   *  breakout only, never separately folded). Slots mint no gear,
   *  cores, scrap, or essences. */
  slotPulls: number;
  slotCreditsWagered: number;
  slotCreditsPaid: number;
  slotBundlesPaid: number;
  slotFragmentsPaid: number;
  slotKeysPaid: number;
  slotFragmentFallbacks: number;
  creditsMintedSlots: number;
  creditsDestroyedSlots: number;
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
  reforges_completed?: number;
  scrap_destroyed_reforge?: string;
  legendary_cores_destroyed_reforge?: string;
  extraction_passes?: number;
  extraction_xp_awarded?: string;
  materials_minted_extraction?: Record<string, number>;
  cache_keys_from_leaderboards?: number;
  credits_minted_login_streak?: string;
  cache_fragments_from_login_streak?: string;
  cache_keys_from_login_streak?: number;
  research_enrollments_started?: number;
  research_courses_completed?: number;
  research_credits_destroyed?: number;
  standing_points_awarded?: { turn_in?: Record<string, number>; drip?: Record<string, number> };
  standing_items_destroyed?: number;
  standing_tribute_credits_destroyed?: number;
  standing_credits_destroyed?: number;
  standing_orders_fulfilled?: number;
  standing_rank_ups?: Record<string, number>;
  slot_pulls?: number;
  slot_credits_wagered?: number;
  slot_credits_paid?: number;
  slot_bundles_paid?: number;
  slot_fragments_paid?: number;
  slot_keys_paid?: number;
  slot_fragment_fallbacks?: number;
  credits_minted_slots?: number;
  credits_destroyed_slots?: number;
  endless_runs_started?: number;
  endless_runs_ended?: number;
  endless_encounters_cleared?: number;
  endless_deepest_depth?: number;
  endless_credits_paid?: string;
  endless_xp_paid?: string;
  endless_fees_destroyed?: string;
  endless_milestone_drops?: number;
  endless_milestone_drops_by_rarity?: Record<string, number>;
  action_skill_fires_gunslinger?: number;
  action_skill_fires_demolition?: number;
  action_skill_fires_scavenger?: number;
  action_skill_fires_fixer?: number;
  cache_rank_tokens_granted?: number;
  cache_rank_tokens_spent?: number;
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
    cacheBoxesOpenedFree: Number(r.cache_boxes_opened_free ?? 0),
    cacheBoxesOpenedAd: Number(r.cache_boxes_opened_ad ?? 0),
    cacheBoxesOpenedKey: Number(r.cache_boxes_opened_key ?? 0),
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
    reforgesCompleted: Number(r.reforges_completed ?? 0),
    scrapDestroyedReforge: Number(r.scrap_destroyed_reforge ?? 0),
    legendaryCoresDestroyedReforge: Number(r.legendary_cores_destroyed_reforge ?? 0),
    endlessRunsStarted: Number(r.endless_runs_started ?? 0),
    endlessRunsEnded: Number(r.endless_runs_ended ?? 0),
    endlessEncountersCleared: Number(r.endless_encounters_cleared ?? 0),
    endlessDeepestDepth: Number(r.endless_deepest_depth ?? 0),
    endlessCreditsPaid: Number(r.endless_credits_paid ?? 0),
    endlessXpPaid: Number(r.endless_xp_paid ?? 0),
    endlessFeesDestroyed: Number(r.endless_fees_destroyed ?? 0),
    endlessMilestoneDrops: Number(r.endless_milestone_drops ?? 0),
    endlessMilestoneDropsByRarity: r.endless_milestone_drops_by_rarity ?? {},
    actionSkillFiresGunslinger: Number(r.action_skill_fires_gunslinger ?? 0),
    actionSkillFiresDemolition: Number(r.action_skill_fires_demolition ?? 0),
    actionSkillFiresScavenger: Number(r.action_skill_fires_scavenger ?? 0),
    actionSkillFiresFixer: Number(r.action_skill_fires_fixer ?? 0),
    cacheRankTokensGranted: Number(r.cache_rank_tokens_granted ?? 0),
    cacheRankTokensSpent: Number(r.cache_rank_tokens_spent ?? 0),
    creditsMintedDispatch: Number(r.credits_minted_dispatch ?? 0),
    creditsMintedCourier: Number(r.credits_minted_courier ?? 0),
    extractionPasses: Number(r.extraction_passes ?? 0),
    extractionXpAwarded: Number(r.extraction_xp_awarded ?? 0),
    materialsMintedExtraction: r.materials_minted_extraction ?? {},
    cacheKeysFromLeaderboards: Number(r.cache_keys_from_leaderboards ?? 0),
    creditsMintedLoginStreak: Number(r.credits_minted_login_streak ?? 0),
    cacheFragmentsFromLoginStreak: Number(r.cache_fragments_from_login_streak ?? 0),
    cacheKeysFromLoginStreak: Number(r.cache_keys_from_login_streak ?? 0),
    researchEnrollmentsStarted: Number(r.research_enrollments_started ?? 0),
    researchCoursesCompleted: Number(r.research_courses_completed ?? 0),
    researchCreditsDestroyed: Number(r.research_credits_destroyed ?? 0),
    standingPointsAwarded: {
      turn_in: r.standing_points_awarded?.turn_in ?? {},
      drip: r.standing_points_awarded?.drip ?? {},
    },
    standingItemsDestroyed: Number(r.standing_items_destroyed ?? 0),
    standingTributeCreditsDestroyed: Number(r.standing_tribute_credits_destroyed ?? 0),
    standingCreditsDestroyed: Number(r.standing_credits_destroyed ?? 0),
    standingOrdersFulfilled: Number(r.standing_orders_fulfilled ?? 0),
    standingRankUps: r.standing_rank_ups ?? {},
    slotPulls: Number(r.slot_pulls ?? 0),
    slotCreditsWagered: Number(r.slot_credits_wagered ?? 0),
    slotCreditsPaid: Number(r.slot_credits_paid ?? 0),
    slotBundlesPaid: Number(r.slot_bundles_paid ?? 0),
    slotFragmentsPaid: Number(r.slot_fragments_paid ?? 0),
    slotKeysPaid: Number(r.slot_keys_paid ?? 0),
    slotFragmentFallbacks: Number(r.slot_fragment_fallbacks ?? 0),
    creditsMintedSlots: Number(r.credits_minted_slots ?? 0),
    creditsDestroyedSlots: Number(r.credits_destroyed_slots ?? 0),
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
  reforges_completed, scrap_destroyed_reforge, legendary_cores_destroyed_reforge,
  endless_runs_started, endless_runs_ended, endless_encounters_cleared,
  endless_deepest_depth, endless_credits_paid, endless_xp_paid,
  endless_fees_destroyed, endless_milestone_drops,
  endless_milestone_drops_by_rarity,
  action_skill_fires_gunslinger, action_skill_fires_demolition,
  action_skill_fires_scavenger, action_skill_fires_fixer,
  cache_rank_tokens_granted, cache_rank_tokens_spent,
  credits_minted_dispatch, credits_minted_courier,
  extraction_passes, extraction_xp_awarded, materials_minted_extraction,
  cache_keys_from_leaderboards,
  credits_minted_login_streak, cache_fragments_from_login_streak,
  cache_keys_from_login_streak,
  research_enrollments_started, research_courses_completed,
  research_credits_destroyed,
  standing_points_awarded, standing_items_destroyed,
  standing_tribute_credits_destroyed, standing_credits_destroyed,
  standing_orders_fulfilled, standing_rank_ups,
  slot_pulls, slot_credits_wagered, slot_credits_paid,
  slot_bundles_paid, slot_fragments_paid, slot_keys_paid,
  slot_fragment_fallbacks, credits_minted_slots, credits_destroyed_slots,
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
