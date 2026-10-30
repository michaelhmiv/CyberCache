/**
 * Economy observability + live tuning levers (migration 0018).
 *
 * Covered:
 *  1. Lever defaults pinned to the shipped constants they mirror
 *     (MARKET_FEE_RATE, FRAGMENT_CHANCE, BOSS_DEDICATED_DROP_CHANCE,
 *     REMATCH_FEE_MAX_MULTIPLIER) + per-key validation ranges.
 *  2. EconomyConfig accessor: ≤60s cache, invalid stored values
 *     dropped, read failure → defaults / last good (never a crash).
 *  3. Daily metrics: a hand-seeded ledger day computes EXACTLY the
 *     expected mint/sink attribution, and recompute is idempotent.
 *  4. Shipped path over HTTP: the daily-heartbeat job computes the
 *     meters; the admin routes sit behind the job secret (401
 *     without/wrong, unmounted when unset); a marketFeeRate lever
 *     change flows into a REAL purchase end-to-end (write routes +
 *     in-memory mirror wired through the accessor).
 *  5. Source pins on 0018 so the SQL cannot drift silently (the SQL
 *     itself is verified against real Postgres in the slice harness).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ECONOMY_CONFIG_DEFAULTS,
  EconomyConfig,
  resolveEconomyConfigValues,
  validateEconomyConfigValue,
  type EconomyConfigSource,
} from '../server/economy/config';
import {
  InMemoryEconomyStore,
  emptyEconomySeed,
  type EconomyLedgerRow,
  type EconomySeed,
} from '../server/economy/memory';
import { mountJobRoutes } from '../server/jobs/routes';
import { InMemoryJobStore, emptyJobSeed } from '../server/jobs/memory';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import { MARKET_FEE_RATE } from '../lib/market/marketFee';
import { BOSS_DEDICATED_DROP_CHANCE, FRAGMENT_CHANCE } from '../server/chef';
import { REMATCH_FEE_MAX_MULTIPLIER, escalatedBossFee } from '../lib/bossFees';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const JOB_SECRET = 'test-job-secret-value';

const S = '11111111-1111-4111-8111-111111111111'; // seller
const B = '22222222-2222-4222-8222-222222222222'; // buyer
const ITEM_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ITEM_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolveListen) => {
    const server = app.listen(0);
    server.on('listening', () => {
      const { port } = server.address() as AddressInfo;
      const close = () => new Promise<void>((r) => server.close(() => r()));
      openServers.push(close);
      resolveListen({ base: `http://127.0.0.1:${port}`, close });
    });
  });
}

async function call(
  base: string,
  method: 'GET' | 'POST',
  path: string,
  headers: Record<string, string>,
  payload?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // 404 from express default handler is HTML; status is asserted.
  }
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// 1. Defaults + validation
// ---------------------------------------------------------------------------

describe('economy config defaults + validation', () => {
  it('pins every default to the shipped constant it mirrors', () => {
    expect(ECONOMY_CONFIG_DEFAULTS.marketFeeRate).toBe(MARKET_FEE_RATE);
    expect(MARKET_FEE_RATE).toBe(0.05);
    expect(ECONOMY_CONFIG_DEFAULTS.fragmentChance).toBe(FRAGMENT_CHANCE);
    expect(FRAGMENT_CHANCE).toBe(0.008);
    expect(ECONOMY_CONFIG_DEFAULTS.bossDedicatedChance).toBe(BOSS_DEDICATED_DROP_CHANCE);
    expect(BOSS_DEDICATED_DROP_CHANCE).toBe(0.1);
    expect(ECONOMY_CONFIG_DEFAULTS.rematchEscalationCap).toBe(REMATCH_FEE_MAX_MULTIPLIER);
    expect(REMATCH_FEE_MAX_MULTIPLIER).toBe(8);
    expect(ECONOMY_CONFIG_DEFAULTS.roamingLegendaryScalar).toBe(1.0);
  });

  it('the escalation cap lever actually caps escalatedBossFee', () => {
    expect(escalatedBossFee(100, 10)).toBe(800); // shipped cap ×8
    expect(escalatedBossFee(100, 10, 3)).toBe(300); // levered cap ×3
    expect(escalatedBossFee(100, 1, 64)).toBe(200);
  });

  it('validation enforces per-key ranges and rejects unknown keys', () => {
    expect(validateEconomyConfigValue('marketFeeRate', 0)).toBe(0);
    expect(validateEconomyConfigValue('marketFeeRate', 1)).toBe(1);
    expect(validateEconomyConfigValue('marketFeeRate', 1.5)).toBeNull();
    expect(validateEconomyConfigValue('marketFeeRate', -0.1)).toBeNull();
    expect(validateEconomyConfigValue('marketFeeRate', '0.2')).toBeNull();
    expect(validateEconomyConfigValue('roamingLegendaryScalar', 5)).toBe(5);
    expect(validateEconomyConfigValue('roamingLegendaryScalar', 5.1)).toBeNull();
    expect(validateEconomyConfigValue('rematchEscalationCap', 1)).toBe(1);
    expect(validateEconomyConfigValue('rematchEscalationCap', 64)).toBe(64);
    expect(validateEconomyConfigValue('rematchEscalationCap', 0)).toBeNull();
    expect(validateEconomyConfigValue('rematchEscalationCap', 2.5)).toBeNull();
    expect(validateEconomyConfigValue('nope', 1)).toBeNull();
  });

  it('stored junk resolves to defaults; stored valid values win', () => {
    expect(resolveEconomyConfigValues(null)).toEqual(ECONOMY_CONFIG_DEFAULTS);
    expect(resolveEconomyConfigValues({ marketFeeRate: 7 })).toEqual(ECONOMY_CONFIG_DEFAULTS);
    expect(resolveEconomyConfigValues({ unknownKey: 1 })).toEqual(ECONOMY_CONFIG_DEFAULTS);
    const resolved = resolveEconomyConfigValues({ marketFeeRate: 0.2, fragmentChance: 0 });
    expect(resolved.marketFeeRate).toBe(0.2);
    expect(resolved.fragmentChance).toBe(0);
    expect(resolved.bossDedicatedChance).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// 2. Accessor cache + failure behavior
// ---------------------------------------------------------------------------

describe('EconomyConfig accessor', () => {
  it('caches within the TTL and re-reads after it', async () => {
    let loads = 0;
    let now = 1_000_000;
    const source: EconomyConfigSource = {
      async loadConfigValues() {
        loads += 1;
        return { marketFeeRate: 0.3 };
      },
    };
    const config = new EconomyConfig(source, () => now);
    expect((await config.snapshot()).marketFeeRate).toBe(0.3);
    expect((await config.snapshot()).marketFeeRate).toBe(0.3);
    expect(loads).toBe(1);
    now += 61_000;
    await config.snapshot();
    expect(loads).toBe(2);
    config.invalidate();
    await config.snapshot();
    expect(loads).toBe(3);
  });

  it('a read failure resolves to the defaults — never a crash', async () => {
    const broken: EconomyConfigSource = {
      async loadConfigValues() {
        throw new Error('db down');
      },
    };
    const config = new EconomyConfig(broken);
    await expect(config.snapshot()).resolves.toEqual(ECONOMY_CONFIG_DEFAULTS);
    await expect(config.get('marketFeeRate')).resolves.toBe(0.05);
  });

  it('a read failure after a good load serves the last good snapshot', async () => {
    let fail = false;
    let now = 0;
    const flaky: EconomyConfigSource = {
      async loadConfigValues() {
        if (fail) throw new Error('db down');
        return { fragmentChance: 0.5 };
      },
    };
    const config = new EconomyConfig(flaky, () => now);
    expect((await config.snapshot()).fragmentChance).toBe(0.5);
    fail = true;
    now += 61_000;
    expect((await config.snapshot()).fragmentChance).toBe(0.5);
  });

  it('no source at all resolves to the defaults', async () => {
    const config = new EconomyConfig(null);
    await expect(config.snapshot()).resolves.toEqual(ECONOMY_CONFIG_DEFAULTS);
  });
});

// ---------------------------------------------------------------------------
// 3. Metrics attribution — hand-seeded day must match EXACTLY
// ---------------------------------------------------------------------------

const DAY = '2026-10-29';
const at = (hhmmss: string) => `${DAY}T${hhmmss}.000Z`;

function seededDay(): EconomySeed {
  const seed = emptyEconomySeed();
  const row = (action_type: string, result_payload: Record<string, unknown>, ts = at('12:00:00')): EconomyLedgerRow => ({
    action_type,
    created_at: ts,
    result_payload,
  });
  seed.ledger = [
    row('cc_apply_chef_rewards', { rewards: { credits_awarded: 1000, cache_fragments_awarded: 3 } }),
    row('cc_apply_chef_rewards', { rewards: { credits_awarded: 2500, cache_fragments_awarded: 0 } }),
    row('cc_settle_offline_roaming', { rewards: { credits_awarded: 4000, cache_fragments_awarded: 5 } }),
    row('cc_settle_offline_roaming', { settled: false }), // no rewards key: mints nothing
    row('cc_apply_boss_attempt', {
      entry_fee: 500, scrap_awarded: 10, xp_awarded: 999,
      attempt: { victory: true, creditsGained: 1200, creditsLost: 0 },
    }),
    row('cc_apply_boss_attempt', {
      entry_fee: 300, scrap_awarded: 0, xp_awarded: 5,
      attempt: { victory: false, creditsGained: 0, creditsLost: 800 },
    }),
    row('cc_accept_listing', {
      listing: { price_credits: 10000 }, item: { rarity: 'Rare' },
      market_fee: { fee_credits: 500, seller_proceeds: 9500 },
    }),
    row('cc_accept_listing', {
      listing: { price_credits: 3000 }, item: { rarity: 'Epic' },
      market_fee: { fee_credits: 150, seller_proceeds: 2850 },
    }),
    row('cc_accept_listing', {
      listing: { price_credits: 5000 }, item: { rarity: 'Rare' },
      market_fee: { fee_credits: 250, seller_proceeds: 4750 },
    }),
    row('cc_market_create', { listing: { price_credits: 10000 } }),
    row('cc_market_create', { listing: { price_credits: 3000 } }),
    row('cc_vendor_buy', { total_price: 1200 }),
    row('cc_resurrect', { creditsCharged: 700 }),
    row('cc_retrain', { total_price: 250 }),
    row('cc_idle_claim', { rewards: { credits: 100 } }),
    row('cc_claim_roaming_rewards', { rewards: { credits_awarded: 60, cache_fragments_awarded: 2 } }),
    row('cc_initial_bundle', {}), // flat 5000-credit grant, literal in the function
    row('cc_claim_rewarded_cache_key', {}),
    row('cc_make_item', {}),
    row('cc_draw_item', {}),
    // Yesterday's roaming row must NOT leak into today's metrics.
    row('cc_apply_chef_rewards', { rewards: { credits_awarded: 99999 } }, '2026-10-28T23:59:59.000Z'),
  ];
  seed.items = [
    { rarity: 'Legendary', created_at: at('09:00:00'), payload: { sourceTag: 'World Drop' } },
    { rarity: 'Legendary', created_at: at('10:00:00'), payload: { sourceTag: 'World Drop' } },
    { rarity: 'Legendary', created_at: at('11:00:00'), payload: { sourceTag: 'Boss Drop' } },
    { rarity: 'Legendary', created_at: at('12:00:00'), payload: { sourceTag: 'Cache-Forged' } },
    { rarity: 'Legendary', created_at: at('13:00:00'), payload: { sourceTag: 'Event' } },
    { rarity: 'Epic', created_at: at('14:00:00'), payload: { sourceTag: 'World Drop' } },
  ];
  return seed;
}

describe('daily economy metrics — attribution', () => {
  it('computes the seeded day exactly (mint/sink/net, legendaries, market, cache)', async () => {
    const store = new InMemoryEconomyStore(seededDay());
    const m = await store.computeMetricsForDay(DAY);
    expect(m.creditsMintedRoaming).toBe(3500);
    expect(m.creditsMintedBoss).toBe(1700); // victory grossed up: 1200 net + 500 fee
    expect(m.creditsMintedOffline).toBe(4000);
    expect(m.creditsMintedOther).toBe(5160); // 100 idle + 60 legacy roaming + 5000 bundle
    expect(m.creditsMintedTotal).toBe(14360);
    expect(m.creditsDestroyedMarketFees).toBe(900);
    expect(m.creditsDestroyedVendor).toBe(1200);
    expect(m.creditsDestroyedResurrection).toBe(700);
    expect(m.creditsDestroyedRespec).toBe(250);
    expect(m.creditsDestroyedBossEntryFees).toBe(800);
    expect(m.creditsDestroyedBossDeathFees).toBe(500); // defeat: 800 lost − 300 entry
    expect(m.creditsDestroyedTotal).toBe(4350);
    expect(m.netCreditChange).toBe(10010);
    expect(m.legendariesRoaming).toBe(2);
    expect(m.legendariesBoss).toBe(1);
    expect(m.legendariesCache).toBe(1);
    expect(m.legendariesTotal).toBe(4); // the Event legendary is not a roaming/boss/cache source
    expect(m.marketListingsCreated).toBe(2);
    expect(m.marketSales).toBe(3);
    expect(m.marketVolume).toBe(18000);
    expect(m.marketMedianPrice).toBe(5000);
    expect(m.marketMedianByRarity).toEqual({ Rare: 7500, Epic: 3000 });
    expect(m.cacheKeysFromAds).toBe(1);
    expect(m.cacheOpens).toBe(2);
    expect(m.cacheFragmentsAwarded).toBe(10);
  });

  it('recompute is idempotent — the same day twice yields the same stored row', async () => {
    const store = new InMemoryEconomyStore(seededDay());
    const first = await store.computeMetricsForDay(DAY);
    const second = await store.computeMetricsForDay(DAY);
    // Every metric value is identical across a recompute; only the
    // computedAt stamp changes — the SQL upsert does the same
    // (0018: `computed_at = excluded.computed_at`). Comparing the
    // stamps made this assertion a wall-clock race (fixed in 0019's
    // slice, which needed a deterministically green gate).
    expect({ ...second, computedAt: first.computedAt }).toEqual(first);
    const listed = await store.listMetrics(7);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(second);
  });

  it('a quiet day computes zeros with a null median', async () => {
    const store = new InMemoryEconomyStore(emptyEconomySeed());
    const m = await store.computeMetricsForDay(DAY);
    expect(m.creditsMintedTotal).toBe(0);
    expect(m.creditsDestroyedTotal).toBe(0);
    expect(m.netCreditChange).toBe(0);
    expect(m.marketMedianPrice).toBeNull();
    expect(m.marketMedianByRarity).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 4. Shipped path — heartbeat meters, admin gate, lever → real purchase
// ---------------------------------------------------------------------------

function utcDay(offsetDays: number): string {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - offsetDays);
  return day.toISOString().slice(0, 10);
}

function profile(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 1, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2026-10-29T10:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-10-28T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0,
    ...overrides,
  };
}

function gearItem(overrides: Partial<WriteItemData> & { id: string; owner_user_id: string }): WriteItemData {
  return {
    kind: 'weapon', static_item_id: null, item_level: 5, rarity: 'Rare', quality: null,
    material_tier: null, condition_state: null, condition_current: 40, condition_max: 50,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null, payload: { weaponType: 'Pistol', sourceTag: 'World Drop' },
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

interface AdminHarness {
  base: string;
  economyStore: InMemoryEconomyStore;
  economyConfig: EconomyConfig;
  writeStore: InMemoryWriteStore;
  tokens: Record<string, string>;
}

async function makeAdminServer(opts: { jobSecret?: string } = {}): Promise<AdminHarness> {
  const economyStore = new InMemoryEconomyStore(emptyEconomySeed());
  const economyConfig = new EconomyConfig(economyStore);
  const writeSeed: WriteSeed = emptyWriteSeed();
  writeSeed.profiles = [
    profile({ id: S, username: 'seller', credits: 0 }),
    profile({ id: B, username: 'buyer', credits: 100_000 }),
  ];
  writeSeed.items = [
    gearItem({ id: ITEM_1, owner_user_id: S }),
    gearItem({ id: ITEM_2, owner_user_id: S }),
  ];
  const writeStore = new InMemoryWriteStore(writeSeed, {
    now: () => new Date(),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
    // The TS mirror reads the fee lever through the accessor, exactly
    // as cc_accept_listing reads the table inside its transaction.
    feeRateProvider: () => economyConfig.get('marketFeeRate'),
  });
  const app = express();
  app.use(express.json());
  mountJobRoutes(app, new InMemoryJobStore(emptyJobSeed()), {
    jwtSecret: SECRET,
    jobSecret: opts.jobSecret ?? JOB_SECRET,
    economyStore,
    economyConfig,
  });
  mountWriteRoutes(app, writeStore, { jwtSecret: SECRET });
  const { base } = await listen(app);
  return {
    base,
    economyStore,
    economyConfig,
    writeStore,
    tokens: { [S]: issueAccessToken(SECRET, S, false), [B]: issueAccessToken(SECRET, B, false) },
  };
}

let purchaseNonce = 0;
async function buy(h: AdminHarness, itemId: string, price: number) {
  purchaseNonce += 1;
  const created = await call(h.base, 'POST', '/api/ops/market-create', {
    authorization: `Bearer ${h.tokens[S]}`,
  }, { nonce: `econ-create-${purchaseNonce}`, item_id: itemId, price_credits: price });
  expect(created.status).toBe(200);
  const listingId = (created.json.listing as Record<string, unknown>).id as string;
  purchaseNonce += 1;
  return call(h.base, 'POST', '/api/ops/market-accept', {
    authorization: `Bearer ${h.tokens[B]}`,
  }, { nonce: `econ-accept-${purchaseNonce}`, listing_id: listingId });
}

describe('economy admin — shipped path', () => {
  it('admin routes 401 without the secret and with a wrong secret', async () => {
    const h = await makeAdminServer();
    expect((await call(h.base, 'GET', '/api/admin/economy', {})).status).toBe(401);
    expect((await call(h.base, 'GET', '/api/admin/economy', { 'x-chef-job-secret': 'wrong' })).status).toBe(401);
    expect((await call(h.base, 'POST', '/api/admin/economy/config', {}, { key: 'marketFeeRate', value: 0.2 })).status).toBe(401);
    expect((await call(h.base, 'POST', '/api/admin/economy/config', { 'x-chef-job-secret': 'wrong' }, { key: 'marketFeeRate', value: 0.2 })).status).toBe(401);
    // A player JWT is not a job secret.
    expect((await call(h.base, 'GET', '/api/admin/economy', { authorization: `Bearer ${h.tokens[B]}` })).status).toBe(401);
  });

  it('admin routes are not mounted when the job secret is unset (fail closed)', async () => {
    const h = await makeAdminServer({ jobSecret: '' });
    expect((await call(h.base, 'GET', '/api/admin/economy', { 'x-chef-job-secret': JOB_SECRET })).status).toBe(404);
    expect((await call(h.base, 'POST', '/api/admin/economy/config', { 'x-chef-job-secret': JOB_SECRET }, { key: 'marketFeeRate', value: 0.2 })).status).toBe(404);
  });

  it('heartbeat computes the meters; the admin report serves them + defaults', async () => {
    const h = await makeAdminServer();
    const yesterday = utcDay(1);
    h.economyStore.addLedgerRow({
      action_type: 'cc_apply_chef_rewards',
      created_at: `${yesterday}T08:00:00.000Z`,
      result_payload: { rewards: { credits_awarded: 777, cache_fragments_awarded: 1 } },
    });
    const beat = await call(h.base, 'POST', '/api/jobs/daily-heartbeat', { 'x-chef-job-secret': JOB_SECRET });
    expect(beat.status).toBe(200);
    const metrics = beat.json.economyMetrics as { computedDays: string[] };
    expect(metrics.computedDays).toHaveLength(7);
    expect(metrics.computedDays).toContain(yesterday);

    const report = await call(h.base, 'GET', '/api/admin/economy?days=7', { 'x-chef-job-secret': JOB_SECRET });
    expect(report.status).toBe(200);
    expect(report.json.config).toEqual(ECONOMY_CONFIG_DEFAULTS);
    const rows = report.json.metrics as Array<Record<string, unknown>>;
    const yRow = rows.find((r) => r.day === yesterday);
    expect(yRow).toBeDefined();
    expect(yRow!.creditsMintedRoaming).toBe(777);
    expect(yRow!.cacheFragmentsAwarded).toBe(1);

    // Idempotent: a second heartbeat recomputes the same values.
    await call(h.base, 'POST', '/api/jobs/daily-heartbeat', { 'x-chef-job-secret': JOB_SECRET });
    const report2 = await call(h.base, 'GET', '/api/admin/economy?days=7', { 'x-chef-job-secret': JOB_SECRET });
    const rows2 = report2.json.metrics as Array<Record<string, unknown>>;
    expect(rows2.find((r) => r.day === yesterday)!.creditsMintedRoaming).toBe(777);
  });

  it('a fee lever change flows into a real purchase end-to-end', async () => {
    const h = await makeAdminServer();
    // Default lever: 5% of 10,000 = 500 destroyed.
    const first = await buy(h, ITEM_1, 10_000);
    expect(first.status).toBe(200);
    expect(first.json.market_fee).toMatchObject({ fee_credits: 500, fee_rate: 0.05, seller_proceeds: 9_500 });

    // Move the lever through the admin API.
    const moved = await call(h.base, 'POST', '/api/admin/economy/config', { 'x-chef-job-secret': JOB_SECRET }, { key: 'marketFeeRate', value: 0.2 });
    expect(moved.status).toBe(200);
    expect((moved.json.config as Record<string, unknown>).marketFeeRate).toBe(0.2);
    expect(h.economyStore.history).toHaveLength(1);
    expect(h.economyStore.history[0]).toMatchObject({ key: 'marketFeeRate', old_value: null, new_value: 0.2 });

    // The next real purchase charges the new rate.
    const second = await buy(h, ITEM_2, 10_000);
    expect(second.status).toBe(200);
    expect(second.json.market_fee).toMatchObject({ fee_credits: 2000, fee_rate: 0.2, seller_proceeds: 8_000 });
    const seller = h.writeStore.seed.profiles.find((p) => p.id === S);
    expect(seller!.credits).toBe(9_500 + 8_000);
  });

  it('invalid lever writes are rejected and change nothing', async () => {
    const h = await makeAdminServer();
    const bad: Array<Record<string, unknown>> = [
      { key: 'unknownKey', value: 1 },
      { key: 'marketFeeRate', value: 1.5 },
      { key: 'marketFeeRate', value: -1 },
      { key: 'marketFeeRate', value: '0.2' },
      { key: 'roamingLegendaryScalar', value: 6 },
      { key: 'rematchEscalationCap', value: 0 },
      { key: 'rematchEscalationCap', value: 2.5 },
      { key: 'fragmentChance' }, // missing value
    ];
    for (const payload of bad) {
      const res = await call(h.base, 'POST', '/api/admin/economy/config', { 'x-chef-job-secret': JOB_SECRET }, payload);
      expect(res.status).toBe(400);
    }
    expect(h.economyStore.history).toHaveLength(0);
    const report = await call(h.base, 'GET', '/api/admin/economy', { 'x-chef-job-secret': JOB_SECRET });
    expect(report.json.config).toEqual(ECONOMY_CONFIG_DEFAULTS);
  });
});

// ---------------------------------------------------------------------------
// 5. Migration 0018 — SQL source pins
// ---------------------------------------------------------------------------

describe('migration 0018 — SQL pins', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'db/migrations/0018_economy_observability.sql'),
    'utf8',
  );

  it('creates the config, history, and metrics tables', () => {
    expect(sql).toContain('create table if not exists public.economy_config');
    expect(sql).toContain('create table if not exists public.economy_config_history');
    expect(sql).toContain('create table if not exists public.economy_metrics');
    expect(sql).toContain('create or replace function public.cc_set_economy_config');
    expect(sql).toContain('create or replace function public.cc_compute_economy_metrics');
    expect(sql).toContain('on conflict (day) do update'); // idempotent recompute
  });

  it('cc_accept_listing reads the fee lever from the table with the 0.05 fallback', () => {
    expect(sql).toContain("cc_economy_config_number('marketFeeRate', 0.05)");
    expect(sql).toContain('credits + (listing.price_credits - fee_credits)');
    // The Darknet Broker 0.05-per-point effect is NOT the fee rate.
    expect(sql).toContain('0.05 * darknet_pts');
  });

  it('metrics attribution reads the verified ledger action types', () => {
    for (const actionType of [
      'cc_apply_chef_rewards',
      'cc_settle_offline_roaming',
      'cc_apply_boss_attempt',
      'cc_accept_listing',
      'cc_vendor_buy',
      'cc_resurrect',
      'cc_retrain',
      'cc_initial_bundle',
    ]) {
      expect(sql).toContain(actionType);
    }
    expect(sql).toContain('percentile_cont(0.5)');
    expect(sql).toContain("'World Drop'");
    expect(sql).toContain("'Boss Drop'");
    expect(sql).toContain("'Cache-Forged'");
  });
});
