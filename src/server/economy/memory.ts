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
      + 5000 * rows.filter((r) => r.action_type === 'cc_initial_bundle').length;

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

    const creditsMintedTotal =
      creditsMintedRoaming + creditsMintedBoss + creditsMintedOffline + creditsMintedOther;
    const creditsDestroyedTotal =
      creditsDestroyedMarketFees + creditsDestroyedVendor + creditsDestroyedResurrection
      + creditsDestroyedRespec + creditsDestroyedBossEntryFees + creditsDestroyedBossDeathFees;

    const row: EconomyMetricsRow = {
      day,
      creditsMintedRoaming,
      creditsMintedBoss,
      creditsMintedOffline,
      creditsMintedOther,
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
      computedAt: new Date().toISOString(),
    };
    this.metrics.set(day, row);
    return row;
  }
}
