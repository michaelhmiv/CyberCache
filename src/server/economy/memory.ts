/**
 * InMemoryEconomyStore — test mirror of PgEconomyStore.
 *
 * Mirrors the observable semantics of migration 0018:
 *  - computeMetricsForDay applies the SAME attribution rules as
 *    cc_compute_economy_metrics over the seeded ledger + item rows
 *    (the SQL function itself is verified against real Postgres in
 *    the slice harness; the rules here are kept in lockstep and the
 *    shared cases are pinned by the same fixtures);
 *  - setConfigValue upserts and appends to the history log, like
 *    cc_set_economy_config;
 *  - compute is a full recompute per day (idempotent), like the SQL.
 */
import type { EconomyMetricsRow, EconomyStore } from './store';

export interface EconomyLedgerRow {
  action_type: string;
  created_at: string; // ISO timestamp
  result_payload: Record<string, unknown>;
}

export interface EconomyItemRow {
  rarity: string | null;
  created_at: string; // ISO timestamp
  payload: Record<string, unknown>;
}

export interface EconomySeed {
  ledger: EconomyLedgerRow[];
  items: EconomyItemRow[];
  config: Record<string, unknown>;
}

export function emptyEconomySeed(): EconomySeed {
  return { ledger: [], items: [], config: {} };
}

interface ConfigHistoryEntry {
  key: string;
  old_value: unknown;
  new_value: unknown;
  updated_by: string;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function dig(payload: Record<string, unknown>, ...path: string[]): unknown {
  let cur: unknown = payload;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class InMemoryEconomyStore implements EconomyStore {
  readonly history: ConfigHistoryEntry[] = [];
  private readonly metrics = new Map<string, EconomyMetricsRow>();
  private readonly config: Record<string, unknown>;
  private readonly ledger: EconomyLedgerRow[];
  private readonly items: EconomyItemRow[];

  constructor(seed: EconomySeed = emptyEconomySeed()) {
    this.config = { ...seed.config };
    this.ledger = [...seed.ledger];
    this.items = [...seed.items];
  }

  addLedgerRow(row: EconomyLedgerRow): void {
    this.ledger.push(row);
  }

  addItemRow(row: EconomyItemRow): void {
    this.items.push(row);
  }

  async loadConfigValues(): Promise<Record<string, unknown>> {
    return { ...this.config };
  }

  async setConfigValue(key: string, value: number, updatedBy: string): Promise<void> {
    const old = this.config[key] ?? null;
    this.config[key] = value;
    this.history.push({ key, old_value: old, new_value: value, updated_by: updatedBy });
  }

  async listMetrics(limitDays: number): Promise<EconomyMetricsRow[]> {
    const days = [...this.metrics.keys()].sort();
    return days.slice(-Math.max(1, limitDays)).map((d) => this.metrics.get(d)!);
  }

  async computeMetricsForDay(day: string): Promise<EconomyMetricsRow> {
    const start = Date.parse(`${day}T00:00:00.000Z`);
    const end = start + 24 * 60 * 60 * 1000;
    const inDay = (iso: string) => {
      const t = Date.parse(iso);
      return t >= start && t < end;
    };
    const rows = this.ledger.filter((r) => inDay(r.created_at));
    const sumBy = (
      types: string[],
      extract: (p: Record<string, unknown>) => number,
    ): number =>
      rows
        .filter((r) => types.includes(r.action_type))
        .reduce((acc, r) => acc + extract(r.result_payload), 0);

    const creditsMintedRoaming = sumBy(['cc_apply_chef_rewards'], (p) =>
      num(dig(p, 'rewards', 'credits_awarded')));
    const creditsMintedBoss = sumBy(['cc_apply_boss_attempt'], (p) => {
      const victory = dig(p, 'attempt', 'victory') === true;
      return victory ? num(dig(p, 'attempt', 'creditsGained')) + num(dig(p, 'entry_fee')) : 0;
    });
    const creditsMintedOffline = sumBy(['cc_settle_offline_roaming'], (p) =>
      num(dig(p, 'rewards', 'credits_awarded')));
    const creditsMintedOther =
      sumBy(['cc_idle_claim'], (p) => num(dig(p, 'rewards', 'credits')))
      + sumBy(['cc_claim_roaming_rewards'], (p) => num(dig(p, 'rewards', 'credits_awarded')))
      + 5000 * rows.filter((r) => r.action_type === 'cc_initial_bundle').length
      // Cache Rank Silver Tongue (0031): the minted proceeds uplift
      // folds into minted_other, exactly as in SQL.
      + sumBy(['cc_accept_listing'], (p) => num(dig(p, 'market_fee', 'cache_rank_proceeds_bonus')));

    const creditsDestroyedMarketFees = sumBy(['cc_accept_listing'], (p) =>
      num(dig(p, 'market_fee', 'fee_credits')));
    const creditsDestroyedVendor = sumBy(['cc_vendor_buy'], (p) => num(dig(p, 'total_price')));
    const creditsDestroyedResurrection = sumBy(['cc_resurrect'], (p) =>
      num(dig(p, 'creditsCharged')));
    const creditsDestroyedRespec = sumBy(['cc_retrain'], (p) => num(dig(p, 'total_price')));
    const creditsDestroyedBossEntryFees = sumBy(['cc_apply_boss_attempt'], (p) =>
      num(dig(p, 'entry_fee')));
    const creditsDestroyedBossDeathFees = sumBy(['cc_apply_boss_attempt'], (p) => {
      const victory = dig(p, 'attempt', 'victory') === true;
      return victory
        ? 0
        : Math.max(0, num(dig(p, 'attempt', 'creditsLost')) - num(dig(p, 'entry_fee')));
    });

    const sales = rows.filter((r) => r.action_type === 'cc_accept_listing');
    const salePrices = sales.map((r) => num(dig(r.result_payload, 'listing', 'price_credits')));
    const byRarity = new Map<string, number[]>();
    for (const sale of sales) {
      const rarity = dig(sale.result_payload, 'item', 'rarity');
      if (typeof rarity !== 'string') continue;
      const list = byRarity.get(rarity) ?? [];
      list.push(num(dig(sale.result_payload, 'listing', 'price_credits')));
      byRarity.set(rarity, list);
    }
    const marketMedianByRarity: Record<string, number> = {};
    for (const [rarity, prices] of byRarity) {
      const m = median(prices);
      if (m !== null) marketMedianByRarity[rarity] = m;
    }

    const legendaryItems = this.items.filter((i) => i.rarity === 'Legendary' && inDay(i.created_at));
    const legendariesRoaming = legendaryItems.filter((i) => i.payload.sourceTag === 'World Drop').length;
    const legendariesBoss = legendaryItems.filter((i) => i.payload.sourceTag === 'Boss Drop').length;
    const legendariesCache = legendaryItems.filter((i) => i.payload.sourceTag === 'Cache-Forged').length;

    // Craft meters (0024): materials destroyed net of cancel refunds
    // and crafted market sales read from the ledger payloads, crafted
    // gear from item payloads — the SQL function's attribution rules.
    // Job/unit/XP/refined meters read craft_jobs, which this double's
    // seed does not model; they stay 0 here (the SQL side is verified
    // against embedded Postgres in the slice harness).
    const materialsDestroyedCrafting: Record<string, number> = {};
    const addEscrow = (map: unknown, sign: number) => {
      if (!map || typeof map !== 'object') return;
      for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
        materialsDestroyedCrafting[key] =
          (materialsDestroyedCrafting[key] ?? 0) + sign * (Number(value) || 0);
      }
    };
    for (const row of rows) {
      if (row.action_type === 'cc_enqueue_craft_job') {
        addEscrow(dig(row.result_payload, 'job', 'escrow_inputs'), 1);
        addEscrow(dig(row.result_payload, 'job', 'escrow_catalyst'), 1);
      } else if (row.action_type === 'cc_cancel_craft_job') {
        addEscrow(dig(row.result_payload, 'refunded_inputs'), -1);
      }
    }
    for (const key of Object.keys(materialsDestroyedCrafting)) {
      if (materialsDestroyedCrafting[key] <= 0) delete materialsDestroyedCrafting[key];
    }
    const isCraftedSale = (p: Record<string, unknown>): boolean =>
      dig(p, 'listing', 'batch_origin') === 'crafted'
      || dig(p, 'item', 'payload', 'origin') === 'crafted';
    const craftedSales = sales.filter((r) => isCraftedSale(r.result_payload));
    const gearItemsCrafted = this.items.filter(
      (i) => i.payload.origin === 'crafted' && inDay(i.created_at),
    ).length;

    // Legendary salvage + cores (0026): recycle rows carry the
    // consumed item + cores_award; core spend nets enqueue escrows
    // against cancel refunds — the SQL function's attribution rules.
    const recycleRows = rows.filter((r) => r.action_type === 'cc_recycle_item');
    const legendariesSalvaged = recycleRows.filter(
      (r) => dig(r.result_payload, 'item', 'rarity') === 'Legendary',
    ).length;
    const legendaryCoresMinted = sumBy(['cc_recycle_item'], (p) => num(dig(p, 'cores_award')));
    // Reforge meters (0027): reforge destroys cores outright, so its
    // cores extend legendary_cores_spent (each core counted once);
    // the dedicated columns break the reforge share out for the sink
    // report. Scrap destroyed by reforge is its own meter — scrap is
    // not a credits meter and never enters credits_destroyed_total.
    const reforgesCompleted = rows.filter((r) => r.action_type === 'cc_reforge_item').length;
    const scrapDestroyedReforge = sumBy(['cc_reforge_item'], (p) => num(dig(p, 'scrap_charged')));
    const legendaryCoresDestroyedReforge = sumBy(['cc_reforge_item'], (p) => num(dig(p, 'cores_charged')));
    const legendaryCoresSpent =
      sumBy(['cc_enqueue_craft_job'], (p) => num(dig(p, 'job', 'escrow_cores')))
      - sumBy(['cc_cancel_craft_job'], (p) => num(dig(p, 'cores_refunded')))
      + legendaryCoresDestroyedReforge;

    // Endless meters (0028): ledger facts from the three endless
    // appliers — starts, endings (bank rows + encounter rows that
    // closed a run + abandonments carried in start payloads), cleared
    // encounters, fees, payouts, deepest ended depth, milestone
    // drops by rarity. Payouts fold into credits_minted_total (a
    // real faucet); fees fold into credits_destroyed_total.
    const endlessStartRows = rows.filter((r) => r.action_type === 'cc_start_endless_run');
    const endlessEndRows = rows.filter(
      (r) => r.action_type === 'cc_end_endless_run' && dig(r.result_payload, 'ended') === true,
    );
    const endlessEncounterRows = rows.filter((r) => r.action_type === 'cc_apply_endless_encounter');
    const endlessClosingEncounters = endlessEncounterRows.filter((r) => {
      const status = dig(r.result_payload, 'run_status');
      return status === 'died' || status === 'banked';
    });
    const endlessRunsStarted = endlessStartRows.length;
    const endlessRunsEnded = endlessEndRows.length + endlessClosingEncounters.length;
    const endlessEncountersCleared = endlessEncounterRows.filter(
      (r) => dig(r.result_payload, 'victory') === true,
    ).length;
    const endlessFeesDestroyed = sumBy(['cc_start_endless_run'], (p) => num(dig(p, 'entry_fee')));
    const endlessCreditsPaid =
      sumBy(['cc_end_endless_run', 'cc_apply_endless_encounter'], (p) => num(dig(p, 'payout', 'credits')))
      + sumBy(['cc_start_endless_run'], (p) => num(dig(p, 'abandoned_settlement', 'payout', 'credits')));
    const endlessXpPaid =
      sumBy(['cc_end_endless_run', 'cc_apply_endless_encounter'], (p) => num(dig(p, 'payout', 'xp')))
      + sumBy(['cc_start_endless_run'], (p) => num(dig(p, 'abandoned_settlement', 'payout', 'xp')));
    const endlessDepths: number[] = [
      ...endlessEndRows.map((r) => num(dig(r.result_payload, 'depth_reached'))),
      ...endlessClosingEncounters.map((r) => num(dig(r.result_payload, 'depth'))),
      ...endlessStartRows
        .map((r) => dig(r.result_payload, 'abandoned_settlement', 'depth_reached'))
        .filter((d) => d !== undefined)
        .map((d) => num(d)),
    ];
    const endlessDeepestDepth = endlessDepths.length ? Math.max(...endlessDepths) : 0;
    const endlessMilestoneDropsByRarity: Record<string, number> = {};
    for (const r of endlessEncounterRows) {
      const rarity = dig(r.result_payload, 'milestone_drop', 'rarity');
      if (typeof rarity === 'string' && rarity.length > 0) {
        endlessMilestoneDropsByRarity[rarity] = (endlessMilestoneDropsByRarity[rarity] ?? 0) + 1;
      }
    }
    const endlessMilestoneDrops = Object.values(endlessMilestoneDropsByRarity).reduce((a, b) => a + b, 0);

    // Action skill fires (0030): the same ledger folds as SQL —
    // fired action_skill blocks on boss/endless results, workshop
    // fire rows as Fixer fires.
    const countFires = (tree: string) =>
      rows.filter((r) =>
        (r.action_type === 'cc_apply_boss_attempt' || r.action_type === 'cc_apply_endless_encounter')
        && dig(r.result_payload, 'action_skill', 'fired') === true
        && dig(r.result_payload, 'action_skill', 'tree') === tree,
      ).length;
    const actionSkillFiresGunslinger = countFires('Gunslinger');
    const actionSkillFiresDemolition = countFires('Demolition');
    const actionSkillFiresScavenger = countFires('Scavenger');
    const actionSkillFiresFixer = countFires('Fixer')
      + rows.filter((r) => r.action_type === 'cc_fire_overclock_workshop').length;

    // Cache Rank token meters (0031): grants/spends from their
    // ledger payloads — tokens, never credits.
    const cacheRankTokensGranted = sumBy(['cc_cache_rank_grant'], (p) =>
      num(dig(p, 'tokens_granted')));
    const cacheRankTokensSpent = sumBy(['cc_cache_rank_spend'], (p) => num(dig(p, 'cost')));

    // Dispatch mint meters (0032): foot + courier settle payouts
    // from the cc_dispatch_settle ledger payloads — real mints,
    // folded into the minted total exactly as in SQL.
    const creditsMintedDispatch = rows
      .filter((r) => r.action_type === 'cc_dispatch_settle' && dig(r.result_payload, 'family') === 'foot')
      .reduce((acc, r) => acc + num(dig(r.result_payload, 'payout', 'credits')), 0);
    const creditsMintedCourier = rows
      .filter((r) => r.action_type === 'cc_dispatch_settle' && dig(r.result_payload, 'family') === 'courier')
      .reduce((acc, r) => acc + num(dig(r.result_payload, 'payout', 'credits')), 0);

    // Extraction meters (0033): passes + XP from the
    // cc_apply_extraction ledger payloads; the mint map folds the
    // payloads' finds_materials and finds_essences maps per id
    // (disjoint id spaces) — the SQL function's attribution rules.
    const extractionRows = rows.filter((r) => r.action_type === 'cc_apply_extraction');
    const extractionPasses = extractionRows.reduce(
      (acc, r) => acc + num(dig(r.result_payload, 'passes_completed')), 0);
    const extractionXpAwarded = extractionRows.reduce(
      (acc, r) => acc + num(dig(r.result_payload, 'xp_awarded')), 0);
    const materialsMintedExtraction: Record<string, number> = {};
    for (const r of extractionRows) {
      for (const mapKey of ['finds_materials', 'finds_essences'] as const) {
        const map = dig(r.result_payload, mapKey);
        if (!map || typeof map !== 'object') continue;
        for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
          materialsMintedExtraction[key] =
            (materialsMintedExtraction[key] ?? 0) + (Number(value) || 0);
        }
      }
    }

    // Weekly leaderboards (0035): cache keys paid by the day's
    // cc_leaderboard_settlement rows — metered distinctly from
    // ad-lane issuance (cacheKeysFromAds), never in credit totals.
    const cacheKeysFromLeaderboards = rows
      .filter((r) => r.action_type === 'cc_leaderboard_settlement')
      .reduce((acc, r) => acc + num(dig(r.result_payload, 'cache_keys_awarded')), 0);

    const creditsMintedVendorBuyback = sumBy(['cc_vendor_sell'], (p) =>
      num(dig(p, 'total_payout')));
    const creditsMintedTotal =
      creditsMintedRoaming + creditsMintedBoss + creditsMintedOffline + creditsMintedOther
      + creditsMintedVendorBuyback + endlessCreditsPaid + creditsMintedDispatch + creditsMintedCourier;
    const creditsDestroyedTotal =
      creditsDestroyedMarketFees + creditsDestroyedVendor + creditsDestroyedResurrection
      + creditsDestroyedRespec + creditsDestroyedBossEntryFees + creditsDestroyedBossDeathFees
      + endlessFeesDestroyed;

    const row: EconomyMetricsRow = {
      day,
      creditsMintedRoaming,
      creditsMintedBoss,
      creditsMintedOffline,
      creditsMintedOther,
      creditsMintedVendorBuyback,
      creditsMintedTotal,
      creditsDestroyedMarketFees,
      creditsDestroyedVendor,
      creditsDestroyedResurrection,
      creditsDestroyedRespec,
      creditsDestroyedBossEntryFees,
      creditsDestroyedBossDeathFees,
      creditsDestroyedTotal,
      netCreditChange: creditsMintedTotal - creditsDestroyedTotal,
      legendariesRoaming,
      legendariesBoss,
      legendariesCache,
      legendariesTotal: legendariesRoaming + legendariesBoss + legendariesCache,
      marketListingsCreated: rows.filter((r) => r.action_type === 'cc_market_create').length,
      marketSales: sales.length,
      marketVolume: salePrices.reduce((a, b) => a + b, 0),
      marketMedianPrice: median(salePrices),
      marketMedianByRarity,
      cacheKeysFromAds: rows.filter((r) => r.action_type === 'cc_claim_rewarded_cache_key').length,
      cacheOpens: rows.filter(
        (r) => r.action_type === 'cc_make_item' || r.action_type === 'cc_draw_item',
      ).length,
      cacheFragmentsAwarded: sumBy(
        ['cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards'],
        (p) => num(dig(p, 'rewards', 'cache_fragments_awarded')),
      ),
      craftJobsCompleted: 0,
      craftUnitsCompleted: 0,
      craftXpAwarded: 0,
      materialsDestroyedCrafting,
      refinedUnitsProduced: 0,
      gearItemsCrafted,
      craftedMarketSales: craftedSales.length,
      craftedMarketVolume: craftedSales.reduce(
        (acc, r) => acc + num(dig(r.result_payload, 'listing', 'price_credits')),
        0,
      ),
      legendariesSalvaged,
      legendaryCoresMinted,
      legendaryCoresSpent,
      reforgesCompleted,
      scrapDestroyedReforge,
      legendaryCoresDestroyedReforge,
      endlessRunsStarted,
      endlessRunsEnded,
      endlessEncountersCleared,
      endlessDeepestDepth,
      endlessCreditsPaid,
      endlessXpPaid,
      endlessFeesDestroyed,
      endlessMilestoneDrops,
      endlessMilestoneDropsByRarity,
      actionSkillFiresGunslinger,
      actionSkillFiresDemolition,
      actionSkillFiresScavenger,
      actionSkillFiresFixer,
      cacheRankTokensGranted,
      cacheRankTokensSpent,
      creditsMintedDispatch,
      creditsMintedCourier,
      extractionPasses,
      extractionXpAwarded,
      materialsMintedExtraction,
      cacheKeysFromLeaderboards,
      computedAt: new Date().toISOString(),
    };
    this.metrics.set(day, row);
    return row;
  }
}
