/**
 * Cache box lane (migration 0037) — the monetization lane for Data
 * Caches, distinct from loot drops.
 *
 * Laws under test:
 *  - ONE DAILY BUDGET: 10 openings per UTC day (cacheBoxDailyCap
 *    lever, default 10, hard clamp [1, 30]), counting EVERY
 *    opening, the free one included. An 11th opening is refused.
 *  - FREE-FIRST: the day's first opening resolves 'free' whatever
 *    the caller asked to pay — a key or an ad is never consumed
 *    for it. A 'free' request after it is refused.
 *  - PAID OPENINGS: 2..cap are paid per opening by the player's
 *    choice — 1 cache key, or one watch-ad attestation (the open
 *    call carrying the ad unit id; client-attested, no SSV).
 *  - EXACTLY ONCE: the nonce ledger makes an opening replay-safe —
 *    a replay returns the stored result, records no second
 *    opening, spends nothing twice.
 *  - KEYS STAY A STOCK: leaderboard (0035) / streak (0036) /
 *    fragment keys buy ad-free openings INSIDE the budget; they
 *    never buy an opening past the cap.
 *  - THE OLD LANE IS GONE: cc_claim_rewarded_cache_key (3 keys/day
 *    + cooldown) is dropped by 0037, its route is unmounted, the
 *    client op is deleted, and the ad offer lives ONLY on the
 *    cache surface (ChestScreen) — ResourceBar is display-only.
 *  - DRAW INVARIANCE: the opening still draws through
 *    cc_draw_odds('cache_primary_rarity', cache_quality) — odds
 *    weights untouched (6000/3200/800 from 0004), the 0031 quality
 *    computation (skill cacheQuality + Cache Rank Optimizer)
 *    byte-identical in both twins (the cacheRank suite's makeItem
 *    quality test staying green is the behavioral proof).
 *  - METERS: lane issuance folds from cc_make_item ledger rows
 *    into cache_boxes_opened_free / _ad / _key; pre-0037 rows
 *    carry no payment and count as key.
 *
 * The SQL twin is exercised against real Postgres in the slice
 * harness (0037: full chain 0001→0037, budget walk, free-first,
 * replay, rollover, lever row, claim-function drop, metrics fold);
 * its shapes are pinned textually below.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CACHE_BOX_DAILY_CAP_DEFAULT,
  CACHE_BOX_FREE_PER_DAY,
  CACHE_LANE_LEVER_CLAMPS,
  CACHE_LANE_LEVER_DEFAULTS,
  CACHE_LANE_RULE,
  cacheBoxOpenedTotal,
  cacheLaneResetsAt,
  cacheLaneUtcDay,
  cacheLaneView,
  resolveCacheBoxPayment,
  resolveCacheLaneLevers,
} from '@/content/cacheLane';
import {
  ECONOMY_CONFIG_DEFAULTS,
  ECONOMY_CONFIG_KEYS,
  validateEconomyConfigValue,
} from '../server/economy/config';
import { InMemoryEconomyStore, emptyEconomySeed } from '../server/economy/memory';
import { mountReadRoutes } from '../server/reads/routes';
import { InMemoryReadStore, emptyReadSeed, type ProfileRowData, type ReadSeed } from '../server/reads/store';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
type Json = Record<string, unknown>;

const readSource = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');

function profile(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 5, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2026-10-31T10:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-10-31T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0,
    ...overrides,
  } as ProfileRowData;
}

const ODDS = [
  { table_id: 'cache_primary_rarity', outcome: 'Common', weight: 70, payload: {} },
  { table_id: 'cache_primary_rarity', outcome: 'Rare', weight: 30, payload: {} },
];

let nonceCounter = 0;
const nonce = () => `lane-nonce-${++nonceCounter}-abcdefgh`;

function writeSeed(cacheTokens: number): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [profile({ id: A, cache_tokens: cacheTokens }), profile({ id: B, cache_tokens: 0 })];
  s.oddsOutcomes = [...ODDS];
  return s;
}

// ---------------------------------------------------------------------------
// 1. Content: the budget, the lever, free-first resolution
// ---------------------------------------------------------------------------

describe('cache lane content', () => {
  it('ships the ruled constants: cap 10 total, 1 free', () => {
    expect(CACHE_BOX_DAILY_CAP_DEFAULT).toBe(10);
    expect(CACHE_BOX_FREE_PER_DAY).toBe(1);
    expect(CACHE_LANE_LEVER_DEFAULTS.cacheBoxDailyCap).toBe(10);
    expect(CACHE_LANE_RULE).toContain('free');
  });

  it('the lever clamps to [1, 30] and truncates to an integer', () => {
    expect(CACHE_LANE_LEVER_CLAMPS.cacheBoxDailyCap).toEqual({ min: 1, max: 30, integer: true });
    expect(resolveCacheLaneLevers().cacheBoxDailyCap).toBe(10);
    expect(resolveCacheLaneLevers({ cacheBoxDailyCap: 0 }).cacheBoxDailyCap).toBe(1);
    expect(resolveCacheLaneLevers({ cacheBoxDailyCap: 99 }).cacheBoxDailyCap).toBe(30);
    expect(resolveCacheLaneLevers({ cacheBoxDailyCap: 7.9 }).cacheBoxDailyCap).toBe(7);
    expect(resolveCacheLaneLevers({ cacheBoxDailyCap: Number.NaN }).cacheBoxDailyCap).toBe(10);
  });

  it('the config registry mirrors the content lever exactly', () => {
    expect(ECONOMY_CONFIG_DEFAULTS.cacheBoxDailyCap).toBe(CACHE_LANE_LEVER_DEFAULTS.cacheBoxDailyCap);
    const spec = ECONOMY_CONFIG_KEYS.cacheBoxDailyCap;
    expect(spec.min).toBe(CACHE_LANE_LEVER_CLAMPS.cacheBoxDailyCap.min);
    expect(spec.max).toBe(CACHE_LANE_LEVER_CLAMPS.cacheBoxDailyCap.max);
    expect(spec.integer).toBe(true);
    expect(validateEconomyConfigValue('cacheBoxDailyCap', 12)).toBe(12);
    expect(validateEconomyConfigValue('cacheBoxDailyCap', 0)).toBeNull();
    expect(validateEconomyConfigValue('cacheBoxDailyCap', 31)).toBeNull();
    expect(validateEconomyConfigValue('cacheBoxDailyCap', 2.5)).toBeNull();
  });

  it('UTC day + reset: the budget resets at the next UTC midnight', () => {
    expect(cacheLaneUtcDay(new Date('2026-10-31T23:59:59.000Z'))).toBe('2026-10-31');
    expect(cacheLaneResetsAt('2026-10-31')).toBe('2026-11-01T00:00:00.000Z');
    expect(cacheLaneResetsAt('2026-12-31')).toBe('2027-01-01T00:00:00.000Z');
  });

  it('the view derives opened / remaining / free from the counts', () => {
    const fresh = cacheLaneView(
      { day: '2026-10-31', keys: 3, byPayment: { free: 0, ad: 0, key: 0 } },
      resolveCacheLaneLevers(),
    );
    expect(fresh).toMatchObject({
      day: '2026-10-31', cap: 10, freePerDay: 1, openedToday: 0,
      remaining: 10, freeAvailable: true, keys: 3,
      resetsAt: '2026-11-01T00:00:00.000Z',
    });
    const mid = cacheLaneView(
      { day: '2026-10-31', keys: 1, byPayment: { free: 1, ad: 2, key: 3 } },
      resolveCacheLaneLevers(),
    );
    expect(mid.openedToday).toBe(6);
    expect(mid.remaining).toBe(4);
    expect(mid.freeAvailable).toBe(false);
    const done = cacheLaneView(
      { day: '2026-10-31', keys: 9, byPayment: { free: 1, ad: 0, key: 9 } },
      resolveCacheLaneLevers(),
    );
    expect(done.remaining).toBe(0);
    expect(cacheBoxOpenedTotal(done.byPayment)).toBe(10);
  });

  it('free-first: any request resolves free while the free box remains', () => {
    const fresh = { free: 0, ad: 0, key: 0 };
    expect(resolveCacheBoxPayment('free', fresh)).toBe('free');
    expect(resolveCacheBoxPayment('key', fresh)).toBe('free');
    expect(resolveCacheBoxPayment('ad', fresh)).toBe('free');
    expect(resolveCacheBoxPayment('anything', fresh)).toBe('free');
    const used = { free: 1, ad: 0, key: 0 };
    expect(resolveCacheBoxPayment('key', used)).toBe('key');
    expect(resolveCacheBoxPayment('ad', used)).toBe('ad');
    expect(resolveCacheBoxPayment('free', used)).toBeNull();
    expect(resolveCacheBoxPayment('scrip', used)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Write twin: the lane inside cc_make_item (InMemoryWriteStore)
// ---------------------------------------------------------------------------

describe('cache lane — write twin', () => {
  const NOW = new Date('2026-10-31T12:00:00.000Z');
  const makeStore = (tokens: number, opts?: { cap?: number; now?: () => Date }) =>
    new InMemoryWriteStore(writeSeed(tokens), {
      now: opts?.now ?? (() => NOW),
      rng: () => 0.5,
      cacheLaneLeverProvider: opts?.cap !== undefined ? () => ({ cacheBoxDailyCap: opts.cap }) : undefined,
    });

  it('free-first: a key request on a fresh day resolves free and spends nothing', async () => {
    const store = makeStore(2);
    const first = (await store.makeItem(A, nonce(), 'key', null)) as Json;
    expect(first.payment).toBe('free');
    expect((first.profile as Json).cache_tokens).toBe(2);
    const lane = first.cache_lane as Json;
    expect(lane).toMatchObject({ day: '2026-10-31', cap: 10, opened_today: 1, remaining: 9, free_available: false });
    expect(lane.by_payment).toEqual({ free: 1, ad: 0, key: 0 });

    const second = (await store.makeItem(A, nonce(), 'key', null)) as Json;
    expect(second.payment).toBe('key');
    expect((second.profile as Json).cache_tokens).toBe(1);
    expect(store.seed.cacheBoxOpenings.map((o) => o.payment)).toEqual(['free', 'key']);
  });

  it('an ad request on a fresh day also resolves free (no attestation consumed)', async () => {
    const store = makeStore(0);
    const res = (await store.makeItem(A, nonce(), 'ad', 'ca-app-pub-x/y')) as Json;
    expect(res.payment).toBe('free');
    expect(store.seed.cacheBoxOpenings[0].ad_unit_id).toBeNull();
  });

  it('a free request after the free box is used is refused', async () => {
    const store = makeStore(5);
    await store.makeItem(A, nonce(), 'key', null);
    await expect(store.makeItem(A, nonce(), 'free', null)).rejects.toThrow('Free cache box already used today');
  });

  it('ad openings require the attestation (ad unit id) and record it', async () => {
    const store = makeStore(0);
    await store.makeItem(A, nonce(), 'key', null); // the free box
    await expect(store.makeItem(A, nonce(), 'ad', null)).rejects.toThrow('ad_unit_id is required');
    await expect(store.makeItem(A, nonce(), 'ad', '   ')).rejects.toThrow('ad_unit_id is required');
    const ad = (await store.makeItem(A, nonce(), 'ad', 'ca-app-pub-x/y')) as Json;
    expect(ad.payment).toBe('ad');
    expect(store.seed.cacheBoxOpenings[1]).toMatchObject({ payment: 'ad', ad_unit_id: 'ca-app-pub-x/y' });
  });

  it('key openings spend exactly one key; a keyless key opening is refused', async () => {
    const store = makeStore(1);
    await store.makeItem(A, nonce(), 'key', null); // free
    const keyed = (await store.makeItem(A, nonce(), 'key', null)) as Json;
    expect(keyed.payment).toBe('key');
    await expect(store.makeItem(A, nonce(), 'key', null)).rejects.toThrow('Not enough tokens');
  });

  it('the cap refuses the 11th opening of the day, however it would be paid', async () => {
    const store = makeStore(50);
    for (let i = 0; i < 10; i++) {
      const res = (await store.makeItem(A, nonce(), i % 2 ? 'ad' : 'key', 'ca-app-pub-x/y')) as Json;
      expect((res.cache_lane as Json).opened_today).toBe(i + 1);
    }
    await expect(store.makeItem(A, nonce(), 'key', null)).rejects.toThrow('Daily cache box limit reached');
    await expect(store.makeItem(A, nonce(), 'ad', 'ca-app-pub-x/y')).rejects.toThrow('Daily cache box limit reached');
    expect(store.seed.cacheBoxOpenings).toHaveLength(10);
    // Keys were spent only on key-paid openings: 1 free + 5 ad + 4 key… the
    // walk alternates key/ad starting with key (which resolved free).
    const p = store.seed.profiles.find((row) => row.id === A);
    expect(p?.cache_tokens).toBe(46);
  });

  it('the cap is the lever: cap 3 refuses the 4th opening', async () => {
    const store = makeStore(50, { cap: 3 });
    await store.makeItem(A, nonce(), 'key', null);
    await store.makeItem(A, nonce(), 'key', null);
    const third = (await store.makeItem(A, nonce(), 'key', null)) as Json;
    expect((third.cache_lane as Json).cap).toBe(3);
    expect((third.cache_lane as Json).remaining).toBe(0);
    await expect(store.makeItem(A, nonce(), 'key', null)).rejects.toThrow('Daily cache box limit reached');
  });

  it('a replayed nonce returns the stored opening and records nothing twice', async () => {
    const store = makeStore(3);
    const n = nonce();
    const first = (await store.makeItem(A, n, 'key', null)) as Json;
    const replay = (await store.makeItem(A, n, 'key', null)) as Json;
    expect(replay).toEqual(first);
    expect(store.seed.cacheBoxOpenings).toHaveLength(1);
    expect(store.seed.items.filter((i) => i.owner_user_id === A)).toHaveLength(1);
  });

  it('the budget rolls over at UTC midnight: yesterday’s openings do not count', async () => {
    let now = new Date('2026-10-31T23:30:00.000Z');
    const store = makeStore(0, { now: () => now });
    const dayOne = (await store.makeItem(A, nonce(), 'key', null)) as Json;
    expect(dayOne.payment).toBe('free');
    await expect(store.makeItem(A, nonce(), 'key', null)).rejects.toThrow('Not enough tokens');
    now = new Date('2026-11-01T00:00:01.000Z');
    const dayTwo = (await store.makeItem(A, nonce(), 'key', null)) as Json;
    expect(dayTwo.payment).toBe('free');
    expect((dayTwo.cache_lane as Json).day).toBe('2026-11-01');
    expect((dayTwo.cache_lane as Json).opened_today).toBe(1);
    expect(store.seed.cacheBoxOpenings.map((o) => o.open_day)).toEqual(['2026-10-31', '2026-11-01']);
  });

  it('budgets are per-player: B’s free box is independent of A’s', async () => {
    const store = makeStore(0);
    await store.makeItem(A, nonce(), 'key', null);
    const bFirst = (await store.makeItem(B, nonce(), 'key', null)) as Json;
    expect(bFirst.payment).toBe('free');
  });

  it('an unknown payment is refused once the free box is used', async () => {
    const store = makeStore(5);
    await store.makeItem(A, nonce(), 'key', null);
    await expect(store.makeItem(A, nonce(), 'scrip', null)).rejects.toThrow('Unknown cache box payment');
  });
});

// ---------------------------------------------------------------------------
// 3. HTTP: the open op's wire contract + the budget read
// ---------------------------------------------------------------------------

describe('cache lane — HTTP', () => {
  let base = '';
  let server: ReturnType<typeof express.application.listen>;
  const tokenA = issueAccessToken(SECRET, A, false);
  const tokenD = issueAccessToken(SECRET, '44444444-4444-4444-8444-444444444444', false);
  const NOW = new Date('2026-10-31T12:00:00.000Z');

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const writeStore = new InMemoryWriteStore(writeSeed(2), { now: () => NOW, rng: () => 0.5 });
    mountWriteRoutes(app, writeStore, { jwtSecret: SECRET });
    // The route reads the budget for the REAL current UTC day (the
    // same wall-clock pattern as the weekly boards route), so the
    // seed is dated relative to today.
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const readSeedData: ReadSeed = {
      ...emptyReadSeed(),
      profiles: [profile({ id: A, cache_tokens: 2 })],
      cacheBoxOpenings: [
        { user_id: A, open_day: today, payment: 'free' },
        { user_id: A, open_day: today, payment: 'key' },
        { user_id: A, open_day: yesterday, payment: 'ad' },
      ],
    };
    mountReadRoutes(app, new InMemoryReadStore(readSeedData, () => NOW), { jwtSecret: SECRET });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function post(path: string, token: string, payload?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const text = await res.text();
    let json: Json = {};
    try { json = JSON.parse(text) as Json; } catch { /* non-JSON (404 page) */ }
    return { status: res.status, json };
  }

  it('POST /api/ops/make-item takes the payment fields and resolves free-first', async () => {
    const res = await post('/api/ops/make-item', tokenA, { nonce: nonce(), payment: 'key' });
    expect(res.status).toBe(200);
    expect(res.json.payment).toBe('free');
    expect((res.json.profile as Json).cache_tokens).toBe(2);
    const keyed = await post('/api/ops/make-item', tokenA, { nonce: nonce(), payment: 'key' });
    expect(keyed.status).toBe(200);
    expect(keyed.json.payment).toBe('key');
    expect((keyed.json.profile as Json).cache_tokens).toBe(1);
  });

  it('the retired rewarded-key claim route is not mounted', async () => {
    const res = await post('/api/ops/claim-rewarded-cache-key', tokenA, {
      nonce: nonce(), ad_unit_id: 'ca-app-pub-x/y', reward_source: 'admob_rewarded',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/caches/me serves the caller’s budget (JWT identity only)', async () => {
    const res = await fetch(`${base}/api/caches/me`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(200);
    const lane = (await res.json()) as Json;
    // Seeded: today's free + key openings count; yesterday's ad does not.
    const today = new Date().toISOString().slice(0, 10);
    expect(lane).toMatchObject({
      day: today, cap: 10, freePerDay: 1, openedToday: 2,
      remaining: 8, freeAvailable: false, keys: 2,
      byPayment: { free: 1, ad: 0, key: 1 },
      resetsAt: cacheLaneResetsAt(today),
    });
  });

  it('GET /api/caches/me 404s for a token with no profile', async () => {
    const res = await fetch(`${base}/api/caches/me`, {
      headers: { authorization: `Bearer ${tokenD}` },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 4. Economy fold: lane issuance meters
// ---------------------------------------------------------------------------

describe('cache lane — economy fold', () => {
  it('counts openings by payment; pre-lane rows count as key', async () => {
    const seed = emptyEconomySeed();
    const at = '2026-10-31T12:00:00.000Z';
    seed.ledger = [
      { user_id: A, action_type: 'cc_make_item', idempotency_key: 'f1', created_at: at, result_payload: { payment: 'free' } },
      { user_id: A, action_type: 'cc_make_item', idempotency_key: 'a1', created_at: at, result_payload: { payment: 'ad' } },
      { user_id: A, action_type: 'cc_make_item', idempotency_key: 'a2', created_at: at, result_payload: { payment: 'ad' } },
      { user_id: A, action_type: 'cc_make_item', idempotency_key: 'k1', created_at: at, result_payload: { payment: 'key' } },
      { user_id: A, action_type: 'cc_make_item', idempotency_key: 'legacy', created_at: at, result_payload: {} },
      { user_id: A, action_type: 'cc_claim_rewarded_cache_key', idempotency_key: 'old', created_at: at, result_payload: {} },
    ] as typeof seed.ledger;
    const store = new InMemoryEconomyStore(seed);
    const m = await store.computeMetricsForDay('2026-10-31');
    expect(m.cacheBoxesOpenedFree).toBe(1);
    expect(m.cacheBoxesOpenedAd).toBe(2);
    expect(m.cacheBoxesOpenedKey).toBe(2); // the explicit key + the legacy row
    expect(m.cacheOpens).toBe(5);
    expect(m.cacheKeysFromAds).toBe(1); // the historical claim fold still reads old rows
  });
});

// ---------------------------------------------------------------------------
// 5. Authority + invariance pins (textual, the rewarded test's successor)
// ---------------------------------------------------------------------------

describe('cache lane — authority pins', () => {
  const migration = readSource('db/migrations/0037_cache_lane.sql');

  it('the ad offer lives ONLY on the cache surface', () => {
    const chest = readSource('src/screens/ChestScreen.tsx');
    expect(chest).toContain('showRewardedCacheAd');
    expect(chest).toContain('fetchCacheLane');
    const bar = readSource('src/components/layout/ResourceBar.tsx');
    expect(bar).not.toContain('rewardedCacheAd');
    expect(bar).not.toContain('Watch Ad');
    expect(bar).not.toContain('claimRewardedCacheKey');
    // No other screen or component imports the ads module.
    for (const p of [
      'src/screens/HomeScreen.tsx',
      'src/components/dashboard/DashboardDeck.tsx',
      'src/screens/ActionScreenContextual.tsx',
      'src/screens/MarketScreen.tsx',
      'src/screens/InventoryScreen.tsx',
      'src/screens/ProfileScreen.tsx',
    ]) {
      expect(readSource(p), p).not.toContain('ads/rewardedCacheAd');
    }
  });

  it('the retired claim is gone from every live path', () => {
    expect(readSource('src/lib/api/verifiedOps.ts')).not.toContain('claimRewardedCacheKey');
    expect(readSource('src/lib/api/verifiedOps.ts')).not.toContain('claim-rewarded-cache-key');
    expect(readSource('src/server/writes/routes.ts')).not.toContain("op('/api/ops/claim-rewarded-cache-key'");
    expect(readSource('src/server/writes/store.ts')).not.toContain('cc_claim_rewarded_cache_key');
    expect(readSource('src/server/writes/memory.ts')).not.toContain('cc_claim_rewarded_cache_key');
    expect(migration).toContain('drop function if exists public.cc_claim_rewarded_cache_key(uuid, text, text, text)');
    // No zombie 3/day cap or 5-minute cooldown survives in live code.
    for (const p of ['src/server/writes/memory.ts', 'src/server/writes/routes.ts']) {
      expect(readSource(p), p).not.toContain('Daily rewarded cache key limit reached');
      expect(readSource(p), p).not.toContain('Rewarded cache key cooldown active');
    }
    expect(migration).not.toContain('Daily rewarded cache key limit reached');
  });

  it('the draw is untouched: same odds call, same quality inputs, no odds reseeding', () => {
    expect(migration).toContain("public.cc_draw_odds('cache_primary_rarity', cache_quality)");
    expect(migration).not.toContain('insert into public.odds_outcomes');
    expect(migration).not.toContain('update public.odds_outcomes');
    const mem = readSource('src/server/writes/memory.ts');
    expect(mem).toContain('cacheQualityAdjustedWeights(outcomes, cacheQuality)');
    // The error vocabulary is shared verbatim by both twins.
    for (const message of [
      'Daily cache box limit reached',
      'Free cache box already used today',
      'Unknown cache box payment',
      'ad_unit_id is required',
      'Not enough tokens',
    ]) {
      expect(migration, message).toContain(message);
      expect(mem, message).toContain(message);
    }
  });

  it('0037 carries the budget record, the lever read, and the lane meters', () => {
    expect(migration).toContain('create table if not exists public.cache_box_openings');
    expect(migration).toContain("cc_economy_config_number('cacheBoxDailyCap', 10)");
    expect(migration).toContain('cache_boxes_opened_free');
    expect(migration).toContain('cache_boxes_opened_ad');
    expect(migration).toContain('cache_boxes_opened_key');
    expect(migration).toContain("coalesce(result_payload ->> 'payment', 'key')");
    expect(migration).toContain('drop function if exists public.cc_make_item(uuid, text)');
  });
});
