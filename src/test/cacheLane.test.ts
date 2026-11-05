/**
 * Cache box lane (migration 0082 rebuild; originally 0037) — the
 * monetization lane for Data Caches, distinct from loot drops.
 *
 * Owner rulings of 2026-11-04 under test:
 *  - THE DAILY BUDGET IS DEAD: no daily cap, no free daily box, no
 *    "openings today", no 00:00 UTC reset. Every opening is PAID —
 *    1 cache key OR one rewarded-ad attestation, player's choice
 *    per opening, unlimited while they can pay.
 *  - NO PAYMENT, NO OPENING: a 'free' request is refused like any
 *    other unknown payment; a key opening with no keys is refused;
 *    an ad opening without the attestation (ad unit id) is refused.
 *  - EXACTLY ONCE: the nonce ledger makes an opening replay-safe —
 *    a replay returns the stored result and spends nothing twice.
 *  - KEYS ARE THE ONLY CACHE CURRENCY: fragments are abolished —
 *    no accrual, no display, no 5:1 conversion anywhere. Roaming
 *    pays WHOLE keys at CACHE_KEY_CHANCE (0.00012/tick) through
 *    silent remainder bookkeeping (pinned in the chef suites; the
 *    lever + content pins live here).
 *  - GRANDFATHERING (migration 0082): stranded fragment balances
 *    converted to keys at 5:1 floor; parts zeroed; nobody lost keys.
 *  - THE OLD LANES STAY GONE: cc_claim_rewarded_cache_key (3/day +
 *    cooldown) was dropped by 0037 and its route stays unmounted;
 *    the ad offer lives ONLY on the cache surface (ChestScreen) —
 *    ResourceBar is display-only; no ads on the play screen ever.
 *  - DRAW INVARIANCE: the opening still draws through
 *    cc_draw_odds('cache_primary_rarity', cache_quality) — odds
 *    weights untouched, the 0031 quality computation byte-identical
 *    in both twins (the cacheRank suite's makeItem quality test
 *    staying green is the behavioral proof).
 *  - METERS: lane issuance folds from cc_make_item ledger rows into
 *    cache_boxes_opened_free / _ad / _key (pre-0082 history keeps
 *    folding; new rows are only ad/key); roaming key issuance folds
 *    into cache_keys_from_roaming.
 *
 * The SQL twin is exercised against real Postgres by the parent's
 * staging-first migration routine; its shapes are pinned textually
 * below against db/migrations/0082_cache_lane_rebuild.sql.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CACHE_LANE_RULE,
  cacheLaneView,
  resolveCacheBoxPayment,
} from '@/content/cacheLane';
import { CACHE_KEY_CHANCE } from '@/content/roamingRates';
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
// 1. Content: the rule, the payment resolution, the key chance
// ---------------------------------------------------------------------------

describe('cache lane content', () => {
  it('the rule says what the owner ruled: paid per opening, no daily limit', () => {
    expect(CACHE_LANE_RULE).toBe(
      'Every cache box costs 1 cache key or one short ad — no daily limit. ' +
      'Keys are rare: roaming drops one now and then, and the login streak, ' +
      'contracts, and leaderboards pay them too.',
    );
    expect(CACHE_LANE_RULE).not.toMatch(/free/i);
    expect(CACHE_LANE_RULE).not.toMatch(/fragment/i);
  });

  it('payment resolution is exact: ad stays ad, key stays key, everything else refused', () => {
    expect(resolveCacheBoxPayment('ad')).toBe('ad');
    expect(resolveCacheBoxPayment('key')).toBe('key');
    expect(resolveCacheBoxPayment('free')).toBeNull();
    expect(resolveCacheBoxPayment('scrip')).toBeNull();
    expect(resolveCacheBoxPayment('')).toBeNull();
    expect(resolveCacheBoxPayment(null)).toBeNull();
    expect(resolveCacheBoxPayment(undefined)).toBeNull();
  });

  it('the lane view is keys + rule and nothing else', () => {
    expect(cacheLaneView({ keys: 3 })).toEqual({ keys: 3, rule: CACHE_LANE_RULE });
    expect(cacheLaneView({ keys: 0 })).toEqual({ keys: 0, rule: CACHE_LANE_RULE });
  });

  it('the roaming key chance is pinned at the ruled 0.00012 and levered', () => {
    expect(CACHE_KEY_CHANCE).toBe(0.00012);
    expect(ECONOMY_CONFIG_DEFAULTS.cacheKeyChance).toBe(0.00012);
    const spec = ECONOMY_CONFIG_KEYS.cacheKeyChance;
    expect(spec.min).toBe(0);
    expect(spec.max).toBe(1);
    expect(validateEconomyConfigValue('cacheKeyChance', 0.00012)).toBe(0.00012);
    expect(validateEconomyConfigValue('cacheKeyChance', 2)).toBeNull();
  });

  it('the retired levers are gone from the registry', () => {
    for (const key of ['fragmentChance', 'cacheBoxDailyCap', 'streakFragmentScalar']) {
      expect(ECONOMY_CONFIG_KEYS[key as keyof typeof ECONOMY_CONFIG_KEYS]).toBeUndefined();
      expect(ECONOMY_CONFIG_DEFAULTS[key as keyof typeof ECONOMY_CONFIG_DEFAULTS]).toBeUndefined();
    }
  });

  it('fragment accrual and conversion are GONE from the claim + write paths', () => {
    for (const p of ['src/server/chef.ts', 'src/server/writes/memory.ts', 'src/server/gameplay/memory.ts']) {
      expect(readSource(p), p).not.toContain('cacheFragmentsAwarded');
    }
    // The 5:1 conversion helper survives nowhere in the lane.
    expect(readSource('src/content/cacheLane.ts')).not.toContain('FRAGMENTS_PER_KEY');
    expect(readSource('src/server/writes/memory.ts')).not.toContain('applyCacheFragmentRollup');
  });
});

// ---------------------------------------------------------------------------
// 2. Write twin: the lane inside cc_make_item (InMemoryWriteStore)
// ---------------------------------------------------------------------------

describe('cache lane — write twin', () => {
  const NOW = new Date('2026-10-31T12:00:00.000Z');
  const makeStore = (tokens: number) =>
    new InMemoryWriteStore(writeSeed(tokens), { now: () => NOW, rng: () => 0.5 });

  it('key openings spend exactly one key each', async () => {
    const store = makeStore(2);
    const first = (await store.makeItem(A, nonce(), 'key', null)) as Json;
    expect(first.payment).toBe('key');
    expect((first.profile as Json).cache_tokens).toBe(1);
    expect(first.cache_lane).toEqual({ keys: 1, rule: CACHE_LANE_RULE });
    const second = (await store.makeItem(A, nonce(), 'key', null)) as Json;
    expect(second.payment).toBe('key');
    expect((second.profile as Json).cache_tokens).toBe(0);
    expect(store.seed.cacheBoxOpenings.map((o) => o.payment)).toEqual(['key', 'key']);
  });

  it('a key opening with no keys is refused — no payment, no opening', async () => {
    const store = makeStore(0);
    await expect(store.makeItem(A, nonce(), 'key', null)).rejects.toThrow('Not enough tokens');
    expect(store.seed.cacheBoxOpenings).toHaveLength(0);
  });

  it('a free request is refused outright', async () => {
    const store = makeStore(5);
    await expect(store.makeItem(A, nonce(), 'free', null)).rejects.toThrow('Unknown cache box payment');
    await expect(store.makeItem(A, nonce(), 'scrip', null)).rejects.toThrow('Unknown cache box payment');
    expect(store.seed.cacheBoxOpenings).toHaveLength(0);
  });

  it('ad openings require the attestation (ad unit id) and record it', async () => {
    const store = makeStore(0);
    await expect(store.makeItem(A, nonce(), 'ad', null)).rejects.toThrow('ad_unit_id is required');
    await expect(store.makeItem(A, nonce(), 'ad', '   ')).rejects.toThrow('ad_unit_id is required');
    const ad = (await store.makeItem(A, nonce(), 'ad', 'ca-app-pub-x/y')) as Json;
    expect(ad.payment).toBe('ad');
    expect(store.seed.cacheBoxOpenings[0]).toMatchObject({ payment: 'ad', ad_unit_id: 'ca-app-pub-x/y' });
  });

  it('UNCAPPED: 15 openings in one day all settle while the player can pay', async () => {
    const store = makeStore(8);
    for (let i = 0; i < 15; i++) {
      const useKey = i % 2 === 0; // 8 key openings (i even), 7 ad openings
      const res = (await store.makeItem(A, nonce(), useKey ? 'key' : 'ad', 'ca-app-pub-x/y')) as Json;
      expect(res.payment).toBe(useKey ? 'key' : 'ad');
    }
    expect(store.seed.cacheBoxOpenings).toHaveLength(15);
    const p = store.seed.profiles.find((row) => row.id === A);
    expect(p?.cache_tokens).toBe(0); // exactly the 8 key openings debited
    // And the 16th key opening is refused only for lack of payment.
    await expect(store.makeItem(A, nonce(), 'key', null)).rejects.toThrow('Not enough tokens');
    const sixteenth = (await store.makeItem(A, nonce(), 'ad', 'ca-app-pub-x/y')) as Json;
    expect(sixteenth.payment).toBe('ad');
  });

  it('a replayed nonce returns the stored opening and records nothing twice', async () => {
    const store = makeStore(3);
    const n = nonce();
    const first = (await store.makeItem(A, n, 'key', null)) as Json;
    const replay = (await store.makeItem(A, n, 'key', null)) as Json;
    expect(replay).toEqual(first);
    expect(store.seed.cacheBoxOpenings).toHaveLength(1);
    expect(store.seed.items.filter((i) => i.owner_user_id === A)).toHaveLength(1);
    const p = store.seed.profiles.find((row) => row.id === A);
    expect(p?.cache_tokens).toBe(2);
  });

  it('payments are per-player: B pays their own way regardless of A', async () => {
    const store = makeStore(0);
    await store.makeItem(A, nonce(), 'ad', 'ca-app-pub-x/y');
    await expect(store.makeItem(B, nonce(), 'key', null)).rejects.toThrow('Not enough tokens');
    const bAd = (await store.makeItem(B, nonce(), 'ad', 'ca-app-pub-x/y')) as Json;
    expect(bAd.payment).toBe('ad');
  });
});

// ---------------------------------------------------------------------------
// 3. HTTP: the open op's wire contract + the lane read
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
    const readSeedData: ReadSeed = {
      ...emptyReadSeed(),
      profiles: [profile({ id: A, cache_tokens: 2 })],
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

  it('POST /api/ops/make-item resolves the payment the player chose — no free-first', async () => {
    const keyed = await post('/api/ops/make-item', tokenA, { nonce: nonce(), payment: 'key' });
    expect(keyed.status).toBe(200);
    expect(keyed.json.payment).toBe('key');
    expect((keyed.json.profile as Json).cache_tokens).toBe(1);
    const free = await post('/api/ops/make-item', tokenA, { nonce: nonce(), payment: 'free' });
    expect(free.status).toBe(400);
  });

  it('the retired rewarded-key claim route is not mounted', async () => {
    const res = await post('/api/ops/claim-rewarded-cache-key', tokenA, {
      nonce: nonce(), ad_unit_id: 'ca-app-pub-x/y', reward_source: 'admob_rewarded',
    });
    expect(res.status).toBe(404);
  });

  it('the fragment listing op is refused — fragments no longer exist', async () => {
    const res = await post('/api/ops/market-create-fragment', tokenA, {
      nonce: nonce(), quantity: 5, price_credits: 100,
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/caches/me serves keys + rule (JWT identity only)', async () => {
    const res = await fetch(`${base}/api/caches/me`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(200);
    const lane = (await res.json()) as Json;
    expect(lane).toEqual({ keys: 2, rule: CACHE_LANE_RULE });
  });

  it('GET /api/caches/me 404s for a token with no profile', async () => {
    const res = await fetch(`${base}/api/caches/me`, {
      headers: { authorization: `Bearer ${tokenD}` },
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 4. Economy fold: lane issuance meters (history keeps folding)
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

  it('roaming key issuance folds into cache_keys_from_roaming; fragment history stays readable', async () => {
    const seed = emptyEconomySeed();
    const at = '2026-10-31T12:00:00.000Z';
    seed.ledger = [
      { user_id: A, action_type: 'cc_apply_chef_rewards', idempotency_key: 'c1', created_at: at, result_payload: { rewards: { cache_keys_awarded: 2 } } },
      { user_id: A, action_type: 'cc_settle_offline_roaming', idempotency_key: 'c2', created_at: at, result_payload: { rewards: { cache_keys_awarded: 1 } } },
      { user_id: A, action_type: 'cc_apply_chef_rewards', idempotency_key: 'old', created_at: at, result_payload: { rewards: { cache_fragments_awarded: 7 } } },
    ] as typeof seed.ledger;
    const store = new InMemoryEconomyStore(seed);
    const m = await store.computeMetricsForDay('2026-10-31');
    expect(m.cacheKeysFromRoaming).toBe(3);
    expect(m.cacheFragmentsAwarded).toBe(7); // historical rows remain history
  });
});

// ---------------------------------------------------------------------------
// 5. Authority + invariance pins (textual)
// ---------------------------------------------------------------------------

describe('cache lane — authority pins', () => {
  const migration = readSource('db/migrations/0082_cache_lane_rebuild.sql');
  const migration0037 = readSource('db/migrations/0037_cache_lane.sql');

  it('the ad offer lives ONLY on the cache surface', () => {
    const chest = readSource('src/screens/ChestScreen.tsx');
    expect(chest).toContain('showRewardedCacheAd');
    expect(chest).toContain('fetchCacheLane');
    const bar = readSource('src/components/layout/ResourceBar.tsx');
    expect(bar).not.toContain('rewardedCacheAd');
    expect(bar).not.toContain('Watch Ad');
    expect(bar).not.toContain('claimRewardedCacheKey');
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

  it('the retired rewarded-key claim stays gone from every live path', () => {
    expect(readSource('src/lib/api/verifiedOps.ts')).not.toContain('claimRewardedCacheKey');
    expect(readSource('src/lib/api/verifiedOps.ts')).not.toContain('claim-rewarded-cache-key');
    expect(readSource('src/server/writes/routes.ts')).not.toContain("op('/api/ops/claim-rewarded-cache-key'");
    expect(readSource('src/server/writes/store.ts')).not.toContain('cc_claim_rewarded_cache_key');
    expect(readSource('src/server/writes/memory.ts')).not.toContain('cc_claim_rewarded_cache_key');
    expect(migration0037).toContain('drop function if exists public.cc_claim_rewarded_cache_key(uuid, text, text, text)');
  });

  it('no daily language survives on the cache screen', () => {
    const chest = readSource('src/screens/ChestScreen.tsx');
    expect(chest).not.toContain('Cache Boxes Today');
    expect(chest).not.toContain('openedToday');
    expect(chest).not.toContain('resetsAt');
    expect(chest).not.toContain('CACHE_BOX_FREE_PER_DAY');
    expect(chest).toContain('OPEN WITH KEY');
    expect(chest).toContain('CACHE_LANE_RULE');
  });

  it('the draw is untouched: same odds call, same quality inputs, no odds reseeding in 0082', () => {
    expect(migration).toContain("public.cc_draw_odds('cache_primary_rarity', cache_quality)");
    expect(migration).not.toContain('insert into public.odds_outcomes');
    const mem = readSource('src/server/writes/memory.ts');
    expect(mem).toContain('cacheQualityAdjustedWeights(outcomes, cacheQuality)');
    // The error vocabulary is shared verbatim by both twins.
    for (const message of ['Unknown cache box payment', 'ad_unit_id is required', 'Not enough tokens']) {
      expect(migration, message).toContain(message);
      expect(mem, message).toContain(message);
    }
    // …and the budget error vocabulary is gone from BOTH twins (the
    // migration legitimately NAMES the retired levers in its config
    // cleanup; what must not survive is the enforcement language).
    for (const message of ['Daily cache box limit reached', 'Free cache box already used today']) {
      expect(migration, message).not.toContain(message);
      expect(mem, message).not.toContain(message);
    }
    expect(mem).not.toContain('cacheBoxDailyCap');
  });

  it('0082 grandfathers balances: stranded fragments convert at 5:1 floor, parts zeroed', () => {
    expect(migration).toContain('floor(coalesce(cache_token_parts, 0) / 5)::integer');
    expect(migration).toContain('cache_token_parts = 0');
    expect(migration).toContain('add column if not exists cache_key_remainder');
  });

  it('0082 retires the fragment market and zeroes the seeded fragment pays', () => {
    expect(migration).toContain('drop function if exists public.cc_market_create_fragment');
    expect(migration).toContain('login_streak_reward_definitions');
    expect(migration).toContain('fragment_parts_daily = 0');
    expect(migration).toContain('cc_record_login_streak_day');
  });

  it('0082 embeds the same lane rule the content module ships', () => {
    expect(migration).toContain(CACHE_LANE_RULE);
    expect(migration).toContain('cache_keys_from_roaming');
    expect(migration).toContain("delete from public.economy_config");
  });
});
