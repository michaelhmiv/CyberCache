/**
 * Data Slots — the vendor's slot machine (migration 0049).
 *
 * Rulings under test (brief: design-briefs/expansion-pack/
 * slot-machine.md; DECISIONS.md R9 — the strict table stands):
 *  - THE TABLE: the brief §2.2 weights, summed to 10,000, with
 *    credit RTP EXACTLY 50.5% — derived from the table in-test
 *    (never a copied constant), and parity-pinned against the
 *    0049 SQL seed outcome-for-outcome (the vendor-catalog pattern:
 *    the TS twin and the SQL seed are the same data or the test
 *    fails).
 *  - CAPS: 100 pulls per UTC day, server-enforced (lever
 *    slotDailyPullCap, [0, 1000]; 0 closes the machine). No
 *    per-tier caps, no cooldown.
 *  - VERIFIED ONLY: guests and unverified accounts are refused
 *    ('Verified account required') before any charge — the one
 *    surface that stays fully gated. The machine itself stays
 *    visible (panel + read endpoint are guest-readable).
 *  - THE KEY: a cache-key outcome (weight 15 = 0.15%) is charged
 *    against the daily cache budget (cache lane 0037, openings vs
 *    cacheBoxDailyCap). Budget exhausted → 5 cache fragments
 *    instead, with the plain-language note in the payload. The
 *    brief's interim slotKeyDailySubCap lever was NEVER written
 *    (the cache lane landed first, §2.14) — pinned absent.
 *  - THE BUNDLE: flat-100% staple consumables only (never rotation
 *    stock, never vendorExcluded), the smallest combination whose
 *    summed vendor price is >= 2x bet — verified against an
 *    independent brute-force composition in-test.
 *  - NEVER: gear, legendary cores, scrap, essences. The outcome
 *    kinds are exactly none / credits / bundle / fragments / key.
 *  - EXACTLY ONCE: the nonce ledger makes a pull replay-safe — a
 *    replay returns the stored result and charges nothing twice.
 *    A pull that fails any check charges nothing.
 *  - METERS: pulls fold from cc_slot_pull ledger rows into the
 *    slot meters; the fold is GROSS (payouts into
 *    credits_minted_total via credits_minted_slots, wagers into
 *    credits_destroyed_total) with credits_destroyed_slots as the
 *    net memo — net_credit_change stays the true credit delta.
 *  - PRINTED ODDS (law 7): the panel renders percentages from the
 *    same SLOT_OUTCOMES twin the server seeds — never re-typed.
 *
 * The SQL twin is exercised against real Postgres in the slice
 * harness (full chain 0001→0049: RTP derivation from the seeded
 * table, cap, guest refusal, key-vs-fragment fallback at budget
 * exhaustion, idempotent replay, bundle composition parity,
 * metrics fold); its shapes are pinned textually below.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SLOT_KEY_FALLBACK_FRAGMENTS,
  SLOT_KEY_FALLBACK_NOTE,
  SLOT_LEVER_CLAMPS,
  SLOT_LEVER_DEFAULTS,
  SLOT_OUTCOMES,
  SLOT_TABLE_ID,
  SLOT_TABLE_VERSION,
  SLOT_TIER_NAMES,
  composeSlotBundle,
  resolveSlotLevers,
  slotBetForTier,
  slotBundleCoins,
  slotCreditRtp,
  slotOutcomePercent,
  type SlotOutcomeDef,
} from '@/content/slots';
import { VENDOR_STAPLE_DEFS } from '@/lib/vendor/catalog';
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
import { ACTION_SETS } from '@/lib/pixel/grammar';
import { GOLDEN_SCENES } from './golden/goldenScenes';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const G = '33333333-3333-4333-8333-333333333333';
type Json = Record<string, unknown>;

const readSource = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');
const MIGRATION_0049 = readSource('db/migrations/0049_slot_machine.sql');

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

let nonceCounter = 0;
const nonce = () => `slot-nonce-${++nonceCounter}-abcdefgh`;

/** A seed whose slot_machine table holds exactly one outcome — the
 *  draw is forced, the way the SQL harness forces draws by seeding. */
function forcedSeed(outcome: SlotOutcomeDef, profiles: ProfileRowData[]): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = profiles;
  s.oddsOutcomes = [{
    table_id: SLOT_TABLE_ID,
    outcome: outcome.id,
    weight: 10000,
    payload: outcome.kind === 'credits'
      ? { kind: 'credits', multiplier: outcome.creditMultiplier }
      : outcome.kind === 'fragments'
        ? { kind: 'fragments', fragments: outcome.fragments }
        : { kind: outcome.kind },
  }];
  return s;
}

const outcomeById = (id: string): SlotOutcomeDef => {
  const found = SLOT_OUTCOMES.find((o) => o.id === id);
  if (!found) throw new Error(`unknown outcome ${id}`);
  return found;
};

// ---------------------------------------------------------------------------
// 1. The table (R9) — weights, RTP derivation, SQL seed parity
// ---------------------------------------------------------------------------

describe('slots — the strict table (R9)', () => {
  it('is the brief §2.2 table, outcome for outcome', () => {
    expect(SLOT_OUTCOMES.map((o) => [o.id, o.weight, o.kind, o.creditMultiplier, o.fragments])).toEqual([
      ['bust', 5480, 'none', 0, 0],
      ['kickback', 2000, 'credits', 0.5, 0],
      ['breakeven', 1200, 'credits', 1, 0],
      ['triple', 600, 'credits', 3, 0],
      ['vendor_bundle', 420, 'bundle', 0, 0],
      ['fragment_drop', 200, 'fragments', 0, 5],
      ['ten_spot', 80, 'credits', 10, 0],
      ['cache_key', 15, 'key', 0, 0],
      ['jackpot', 5, 'credits', 50, 0],
    ]);
    expect(SLOT_OUTCOMES.reduce((sum, o) => sum + o.weight, 0)).toBe(10000);
    expect(SLOT_TABLE_ID).toBe('slot_machine');
    expect(SLOT_TABLE_VERSION).toBe(1);
    // The never-pays list (§2.2.2) is structural: no outcome kind
    // outside the five legal ones exists to pay gear/cores/scrap.
    expect(new Set(SLOT_OUTCOMES.map((o) => o.kind))).toEqual(
      new Set(['none', 'credits', 'bundle', 'fragments', 'key']),
    );
  });

  it('derives credit RTP of exactly 50.5% FROM the table', () => {
    // Exact rational identity over integers: Σ weight × (mult × 10)
    // over the credit outcomes, against 10000 × 10 × RTP.
    const scaledEv = SLOT_OUTCOMES
      .filter((o) => o.kind === 'credits')
      .reduce((sum, o) => sum + o.weight * (o.creditMultiplier * 10), 0);
    expect(scaledEv).toBe(50500); // 0.505 × 10000 × 10 — exact
    expect(slotCreditRtp()).toBeCloseTo(0.505, 12);
    expect(slotCreditRtp()).toBeLessThan(1); // a sink, never a fountain
  });

  it('the cache key sits at exactly 0.15%', () => {
    const key = outcomeById('cache_key');
    expect(key.weight).toBe(15);
    expect(slotOutcomePercent(key)).toBeCloseTo(0.15, 10);
    expect(SLOT_OUTCOMES.reduce((sum, o) => sum + slotOutcomePercent(o), 0)).toBeCloseTo(100, 8);
  });

  it('matches the 0049 SQL seed outcome-for-outcome (parity)', () => {
    expect(MIGRATION_0049).toContain(
      "values ('slot_machine', 1, 'Data Slots payout table v1 (brief §2.2, R9 strict table)', true)",
    );
    const rowPattern = /\('slot_machine', '([a-z_]+)',\s*(\d+), '(.+?)'::jsonb\)/g;
    const seeded = [...MIGRATION_0049.matchAll(rowPattern)].map((m) => ({
      outcome: m[1],
      weight: Number(m[2]),
      payload: JSON.parse(m[3]) as Json,
    }));
    expect(seeded.length).toBe(SLOT_OUTCOMES.length);
    for (const def of SLOT_OUTCOMES) {
      const row = seeded.find((r) => r.outcome === def.id);
      expect(row, def.id).toBeDefined();
      expect(row?.weight, def.id).toBe(def.weight);
      expect(row?.payload.kind, def.id).toBe(def.kind);
      if (def.kind === 'credits') expect(row?.payload.multiplier, def.id).toBe(def.creditMultiplier);
      if (def.kind === 'fragments') expect(row?.payload.fragments, def.id).toBe(def.fragments);
    }
  });

  it('tiers + cap are levers with the ruled defaults and clamps', () => {
    expect(SLOT_LEVER_DEFAULTS).toEqual({
      slotDailyPullCap: 100, slotBetTier1: 50, slotBetTier2: 250, slotBetTier3: 1000,
    });
    expect(SLOT_TIER_NAMES).toEqual({ 1: 'Chump Change', 2: 'Working Stiff', 3: 'High Roller' });
    expect(resolveSlotLevers()).toEqual(SLOT_LEVER_DEFAULTS);
    // Cap: [0, 1000] — 0 is legal and closes the machine.
    expect(resolveSlotLevers({ slotDailyPullCap: 0 }).slotDailyPullCap).toBe(0);
    expect(resolveSlotLevers({ slotDailyPullCap: -5 }).slotDailyPullCap).toBe(0);
    expect(resolveSlotLevers({ slotDailyPullCap: 5000 }).slotDailyPullCap).toBe(1000);
    // Tiers: [1, 100000] integers.
    expect(resolveSlotLevers({ slotBetTier2: 0 }).slotBetTier2).toBe(1);
    expect(resolveSlotLevers({ slotBetTier2: 10 ** 9 }).slotBetTier2).toBe(100000);
    expect(resolveSlotLevers({ slotBetTier2: 299.9 }).slotBetTier2).toBe(299);
    const levers = resolveSlotLevers();
    expect(slotBetForTier(levers, 1)).toBe(50);
    expect(slotBetForTier(levers, 2)).toBe(250);
    expect(slotBetForTier(levers, 3)).toBe(1000);
    expect(slotBetForTier(levers, 4)).toBeNull();
    expect(slotBetForTier(levers, 0)).toBeNull();
  });

  it('the config registry mirrors the content levers exactly', () => {
    expect(ECONOMY_CONFIG_DEFAULTS.slotDailyPullCap).toBe(SLOT_LEVER_DEFAULTS.slotDailyPullCap);
    expect(ECONOMY_CONFIG_DEFAULTS.slotBetTier1).toBe(SLOT_LEVER_DEFAULTS.slotBetTier1);
    expect(ECONOMY_CONFIG_DEFAULTS.slotBetTier2).toBe(SLOT_LEVER_DEFAULTS.slotBetTier2);
    expect(ECONOMY_CONFIG_DEFAULTS.slotBetTier3).toBe(SLOT_LEVER_DEFAULTS.slotBetTier3);
    for (const key of ['slotDailyPullCap', 'slotBetTier1', 'slotBetTier2', 'slotBetTier3'] as const) {
      const spec = ECONOMY_CONFIG_KEYS[key];
      expect(spec.min, key).toBe(SLOT_LEVER_CLAMPS[key].min);
      expect(spec.max, key).toBe(SLOT_LEVER_CLAMPS[key].max);
      expect(spec.integer, key).toBe(true);
    }
    expect(validateEconomyConfigValue('slotDailyPullCap', 0)).toBe(0); // closing is legal
    expect(validateEconomyConfigValue('slotDailyPullCap', -1)).toBeNull();
    expect(validateEconomyConfigValue('slotBetTier1', 0)).toBeNull();
  });

  it('the interim slotKeyDailySubCap lever was never written (§2.14)', () => {
    // The migration's header comment names the retired lever to
    // explain its absence; the pin targets the lever as CODE — a
    // config read, a registry key, a content field.
    expect(MIGRATION_0049).not.toContain("cc_economy_config_number('slotKeyDailySubCap'");
    expect(MIGRATION_0049).not.toContain('slotKeyDailySubCap');
    expect(readSource('src/content/slots.ts')).not.toContain('slotKeyDailySubCap');
    expect(readSource('src/server/economy/config.ts')).not.toContain('slotKeyDailySubCap:');
    expect('slotKeyDailySubCap' in ECONOMY_CONFIG_KEYS).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The vendor bundle — composition rule (§2.2.1)
// ---------------------------------------------------------------------------

/** Independent brute force: the true minimal achievable sum >= target
 *  over the staple prices (plain reachable-set expansion, written
 *  separately from the content DP on purpose). */
function bruteForceMinSum(target: number, prices: number[]): number {
  const maxPrice = Math.max(...prices);
  const reachable = new Set<number>([0]);
  let frontier = [0];
  while (frontier.length) {
    const next: number[] = [];
    for (const sum of frontier) {
      for (const price of prices) {
        const ns = sum + price;
        if (ns <= target + maxPrice && !reachable.has(ns)) {
          reachable.add(ns);
          next.push(ns);
        }
      }
    }
    frontier = next;
  }
  for (let s = target; s <= target + maxPrice; s += 1) {
    if (reachable.has(s)) return s;
  }
  throw new Error('no achievable sum');
}

describe('slots — vendor bundle composition', () => {
  const staplePrices = VENDOR_STAPLE_DEFS.map((d) => d.market.vendorPrice);

  it('coins derive from the vendor staple defs, in canonical order', () => {
    const coins = slotBundleCoins();
    expect(coins.length).toBe(VENDOR_STAPLE_DEFS.length);
    expect(coins.map((c) => c.itemKey).sort()).toEqual(VENDOR_STAPLE_DEFS.map((d) => d.id).sort());
    for (const coin of coins) {
      const def = VENDOR_STAPLE_DEFS.find((d) => d.id === coin.itemKey);
      expect(def?.market.vendorPrice).toBe(coin.price);
      expect(def?.market.vendorStocked).toBe(true);
    }
    const sorted = [...coins].sort((x, y) => y.price - x.price || (x.itemKey < y.itemKey ? -1 : 1));
    expect(coins).toEqual(sorted);
  });

  it('pays the smallest combination >= 2x bet, across all tiers', () => {
    // Exact values at the shipped tiers (brute-force verified below):
    expect(composeSlotBundle(50).totalValue).toBe(120); // 3 × 40cr fuel cells — the only way past 100
    expect(composeSlotBundle(250).totalValue).toBe(500); // exactly 2x: two MedKits
    expect(composeSlotBundle(1000).totalValue).toBe(2000); // exactly 2x
    for (const bet of [50, 250, 1000]) {
      const bundle = composeSlotBundle(bet);
      expect(bundle.target).toBe(bet * 2);
      expect(bundle.totalValue).toBe(bruteForceMinSum(bet * 2, staplePrices));
      // Composition integrity: quantities sum to the stated value at
      // catalog prices, staples only, nothing vendorExcluded.
      const sum = bundle.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
      expect(sum).toBe(bundle.totalValue);
      for (const item of bundle.items) {
        const def = VENDOR_STAPLE_DEFS.find((d) => d.id === item.itemKey);
        expect(def, item.itemKey).toBeDefined();
        expect(def?.market.vendorPrice).toBe(item.unitPrice);
        expect(def?.market.vendorExcluded).toBeFalsy();
        expect(item.quantity).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('is minimal for a sweep of lever-moved bets, and deterministic', () => {
    for (let bet = 1; bet <= 999; bet += 37) {
      const bundle = composeSlotBundle(bet);
      expect(bundle.totalValue, `bet ${bet}`).toBe(bruteForceMinSum(bet * 2, staplePrices));
      expect(composeSlotBundle(bet)).toEqual(bundle);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Write twin: cc_slot_pull in the in-memory store
// ---------------------------------------------------------------------------

describe('slots — write twin', () => {
  const NOW = new Date('2026-10-31T12:00:00.000Z');
  const DAY = '2026-10-31';
  const makeStore = (
    outcomeId: string,
    profiles: ProfileRowData[],
    opts?: { slotLevers?: Json; cacheCap?: number; openings?: number },
  ) => {
    const seed = forcedSeed(outcomeById(outcomeId), profiles);
    if (opts?.openings) {
      for (let i = 0; i < opts.openings; i += 1) {
        seed.cacheBoxOpenings.push({
          user_id: A, open_day: DAY, payment: 'key', ad_unit_id: null, item_id: null,
          opened_at: '2026-10-31T08:00:00.000Z',
        });
      }
    }
    return new InMemoryWriteStore(seed, {
      now: () => NOW,
      rng: () => 0.5,
      slotLeverProvider: opts?.slotLevers ? () => opts.slotLevers as never : undefined,
      cacheLaneLeverProvider: opts?.cacheCap !== undefined ? () => ({ cacheBoxDailyCap: opts.cacheCap }) : undefined,
    });
  };
  const rich = () => profile({ id: A, credits: 100000 });

  it('charges the bet and pays credit outcomes exactly (triple, tier 2)', async () => {
    const store = makeStore('triple', [rich()]);
    const result = (await store.slotPull(A, nonce(), 2)) as Json;
    expect(result).toMatchObject({
      action_type: 'cc_slot_pull', bet_tier: 2, bet_credits: 250, outcome: 'triple',
      pulls_today: 1, pulls_remaining: 99, cap: 100,
    });
    expect(result.payout).toMatchObject({ kind: 'credits', credits_paid: 750, key_paid: false });
    expect((result.profile as Json).credits).toBe(100000 - 250 + 750);
    expect(store.seed.ledger.filter((l) => l.action_type === 'cc_slot_pull').length).toBe(1);
  });

  it('kickback pays floor(bet / 2); jackpot pays 50x; bust pays nothing', async () => {
    const kick = makeStore('kickback', [rich()]);
    const kickResult = (await kick.slotPull(A, nonce(), 1)) as Json;
    expect(kickResult.payout).toMatchObject({ credits_paid: 25 });
    expect((kickResult.profile as Json).credits).toBe(100000 - 50 + 25);

    const jack = makeStore('jackpot', [rich()]);
    const jackResult = (await jack.slotPull(A, nonce(), 3)) as Json;
    expect(jackResult.payout).toMatchObject({ credits_paid: 50000 });
    expect((jackResult.profile as Json).credits).toBe(100000 - 1000 + 50000);

    const bust = makeStore('bust', [rich()]);
    const bustResult = (await bust.slotPull(A, nonce(), 2)) as Json;
    expect(bustResult.payout).toMatchObject({ kind: 'none', credits_paid: 0 });
    expect((bustResult.profile as Json).credits).toBe(100000 - 250);
  });

  it('replay returns the stored result and charges nothing twice', async () => {
    const store = makeStore('triple', [rich()]);
    const key = nonce();
    const first = (await store.slotPull(A, key, 2)) as Json;
    const replay = (await store.slotPull(A, key, 2)) as Json;
    expect(replay).toEqual(first);
    expect(store.seed.profiles[0].credits).toBe(100000 - 250 + 750);
    expect(store.seed.profiles[0].slot_pulls_count).toBe(1);
    expect(store.seed.ledger.filter((l) => l.action_type === 'cc_slot_pull').length).toBe(1);
  });

  it('pays the vendor bundle as flat-100% staple batches', async () => {
    const store = makeStore('vendor_bundle', [rich()]);
    const result = (await store.slotPull(A, nonce(), 2)) as Json;
    const payout = result.payout as Json;
    expect(payout.kind).toBe('bundle');
    expect(payout.bundle_value).toBe(500);
    const batches = store.seed.consumableBatches.filter((b) => b.owner_user_id === A);
    const batchValue = batches.reduce((sum, b) => {
      const def = VENDOR_STAPLE_DEFS.find((d) => d.id === b.consumable_type);
      return sum + (def?.market.vendorPrice ?? 0) * b.quantity;
    }, 0);
    expect(batchValue).toBe(500);
    for (const b of batches) {
      expect(b.quality_percent).toBe(100);
      expect(b.origin).toBe('vendor');
    }
    expect((result.profile as Json).credits).toBe(100000 - 250); // the bet only — no credit prize
  });

  it('pays fragments, and the key when the cache budget has room', async () => {
    const frag = makeStore('fragment_drop', [rich()]);
    const fragResult = (await frag.slotPull(A, nonce(), 1)) as Json;
    expect(fragResult.payout).toMatchObject({ kind: 'fragments', fragments_paid: 5 });
    expect((fragResult.profile as Json).cache_token_parts).toBe(5);

    const keyStore = makeStore('cache_key', [rich()], { openings: 3 });
    const keyResult = (await keyStore.slotPull(A, nonce(), 1)) as Json;
    expect(keyResult.payout).toMatchObject({ kind: 'key', key_paid: true, key_fallback: false, fragments_paid: 0 });
    expect((keyResult.profile as Json).cache_tokens).toBe(1);
    expect(keyResult.cache_budget).toMatchObject({ opened_today: 3, cap: 10, remaining: 7 });
  });

  it('pays the fragment fallback when the cache budget is exhausted', async () => {
    const store = makeStore('cache_key', [rich()], { openings: 10 });
    const result = (await store.slotPull(A, nonce(), 1)) as Json;
    expect(result.payout).toMatchObject({
      kind: 'key', key_paid: false, key_fallback: true,
      fragments_paid: SLOT_KEY_FALLBACK_FRAGMENTS, note: SLOT_KEY_FALLBACK_NOTE,
    });
    expect(SLOT_KEY_FALLBACK_NOTE).toBe('Cache budget full — paid in fragments');
    expect((result.profile as Json).cache_tokens).toBe(0);
    expect((result.profile as Json).cache_token_parts).toBe(5);
  });

  it('refuses guests and unverified accounts before any charge', async () => {
    const guest = profile({ id: G, credits: 100000, account_type: 'guest', email_verified_at: null });
    const guestStore = makeStore('jackpot', [guest]);
    await expect(guestStore.slotPull(G, nonce(), 3)).rejects.toThrow('Verified account required');
    expect(guestStore.seed.profiles[0].credits).toBe(100000);
    expect(guestStore.seed.ledger.length).toBe(0);

    const unverified = profile({ id: A, credits: 100000, account_type: 'registered_unverified', email_verified_at: null });
    const unvStore = makeStore('jackpot', [unverified]);
    await expect(unvStore.slotPull(A, nonce(), 3)).rejects.toThrow('Verified account required');
    expect(unvStore.seed.profiles[0].credits).toBe(100000);
  });

  it('refuses on insufficient credits, unknown tier, closed machine — charging nothing', async () => {
    const poor = makeStore('triple', [profile({ id: A, credits: 100 })]);
    await expect(poor.slotPull(A, nonce(), 3)).rejects.toThrow('Insufficient credits');
    expect(poor.seed.profiles[0].credits).toBe(100);
    expect(poor.seed.profiles[0].slot_pulls_count ?? 0).toBe(0);

    const store = makeStore('triple', [rich()]);
    await expect(store.slotPull(A, nonce(), 4)).rejects.toThrow('Unknown bet tier');
    await expect(store.slotPull(A, nonce(), 0)).rejects.toThrow('Unknown bet tier');

    const closed = makeStore('triple', [rich()], { slotLevers: { slotDailyPullCap: 0 } });
    await expect(closed.slotPull(A, nonce(), 1)).rejects.toThrow('The slot machine is closed');
    expect(closed.seed.profiles[0].credits).toBe(100000);
  });

  it('enforces the daily pull cap and resets on a new UTC day', async () => {
    const store = makeStore('bust', [rich()], { slotLevers: { slotDailyPullCap: 3 } });
    for (let i = 0; i < 3; i += 1) await store.slotPull(A, nonce(), 1);
    await expect(store.slotPull(A, nonce(), 1)).rejects.toThrow('Daily slot pull limit reached');
    expect(store.seed.profiles[0].slot_pulls_count).toBe(3);

    // Yesterday's full counter is not today's: the date key rolls.
    const rolled = makeStore('bust', [
      profile({ id: A, credits: 100000, slot_pulls_day: '2026-10-30', slot_pulls_count: 100 }),
    ]);
    const result = (await rolled.slotPull(A, nonce(), 1)) as Json;
    expect(result.pulls_today).toBe(1);
    expect(rolled.seed.profiles[0].slot_pulls_day).toBe(DAY);
    expect(rolled.seed.profiles[0].slot_pulls_count).toBe(1);
  });

  it('reads levered tier sizes live', async () => {
    const store = makeStore('bust', [rich()], { slotLevers: { slotBetTier2: 300 } });
    const result = (await store.slotPull(A, nonce(), 2)) as Json;
    expect(result.bet_credits).toBe(300);
    expect((result.profile as Json).credits).toBe(100000 - 300);
  });
});

// ---------------------------------------------------------------------------
// 4. HTTP wire: the real routes (JWT identity, guest gate, read state)
// ---------------------------------------------------------------------------

describe('slots — HTTP', () => {
  let base = '';
  let server: ReturnType<typeof express.application.listen>;
  let writeStore: InMemoryWriteStore;
  const tokenA = issueAccessToken(SECRET, A, false);
  const tokenG = issueAccessToken(SECRET, G, false);
  const NOW = new Date('2026-10-31T12:00:00.000Z');

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const writeProfiles = [
      profile({ id: A, credits: 100000 }),
      profile({ id: G, credits: 100000, account_type: 'guest', email_verified_at: null }),
    ];
    writeStore = new InMemoryWriteStore(forcedSeed(outcomeById('jackpot'), writeProfiles), {
      now: () => NOW, rng: () => 0.5,
    });
    mountWriteRoutes(app, writeStore, { jwtSecret: SECRET });
    const today = new Date().toISOString().slice(0, 10);
    const readSeedData: ReadSeed = {
      ...emptyReadSeed(),
      profiles: [
        profile({ id: A, credits: 100000, slot_pulls_day: today, slot_pulls_count: 7 }),
        profile({ id: G, credits: 0, account_type: 'guest', email_verified_at: null }),
      ],
      cacheBoxOpenings: [
        { user_id: A, open_day: today, payment: 'free' },
        { user_id: A, open_day: today, payment: 'key' },
        { user_id: A, open_day: today, payment: 'key' },
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
    try { json = JSON.parse(text) as Json; } catch { /* non-JSON */ }
    return { status: res.status, json };
  }

  it('POST /api/ops/slot-pull pays the server-decided jackpot', async () => {
    const res = await post('/api/ops/slot-pull', tokenA, { nonce: nonce(), bet_tier: 3 });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ action_type: 'cc_slot_pull', outcome: 'jackpot', bet_credits: 1000 });
    expect(res.json.payout).toMatchObject({ kind: 'credits', credits_paid: 50000 });
    expect((res.json.profile as Json).credits).toBe(100000 - 1000 + 50000);
  });

  it('POST /api/ops/slot-pull refuses a guest with the verified gate', async () => {
    const res = await post('/api/ops/slot-pull', tokenG, { nonce: nonce(), bet_tier: 1 });
    expect(res.status).toBe(403);
    expect(String(res.json.message)).toMatch(/Verified account required/);
  });

  it('identity comes from the JWT — a body playerId is ignored', async () => {
    const guestBefore = writeStore.seed.profiles.find((p) => p.id === G)?.credits;
    const res = await post('/api/ops/slot-pull', tokenA, {
      nonce: nonce(), bet_tier: 1, player_id: G, playerId: G,
    });
    expect(res.status).toBe(200);
    // The pull landed on A (the token), at A's tier-1 bet; the guest
    // named in the body was never charged.
    expect(res.json.bet_credits).toBe(50);
    expect(writeStore.seed.profiles.find((p) => p.id === G)?.credits).toBe(guestBefore);
    expect(writeStore.seed.ledger.filter((l) => l.user_id === G).length).toBe(0);
  });

  it('GET /api/slots/me serves tiers, pulls remaining, and the cache budget', async () => {
    const res = await fetch(`${base}/api/slots/me`, { headers: { authorization: `Bearer ${tokenA}` } });
    expect(res.status).toBe(200);
    const state = (await res.json()) as Json;
    expect(state).toMatchObject({
      tiers: [50, 250, 1000], cap: 100, pullsToday: 7, pullsRemaining: 93, machineOpen: true,
    });
    expect(state.cacheBudget).toMatchObject({ openedToday: 3, cap: 10, remaining: 7 });
  });

  it('GET /api/slots/me is guest-readable (the machine is visible; only pulls gate)', async () => {
    const res = await fetch(`${base}/api/slots/me`, { headers: { authorization: `Bearer ${tokenG}` } });
    expect(res.status).toBe(200);
    const state = (await res.json()) as Json;
    expect(state.pullsToday).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Economy fold: the slot meters (gross fold, net memo)
// ---------------------------------------------------------------------------

describe('slots — economy fold', () => {
  it('folds a scripted day of pulls into exactly the slot meters', async () => {
    const seed = emptyEconomySeed();
    const at = '2026-10-31T12:00:00.000Z';
    const pull = (key: string, bet: number, payout: Json) => ({
      user_id: A, action_type: 'cc_slot_pull', idempotency_key: key, created_at: at,
      result_payload: { bet_credits: bet, outcome: 'x', payout },
    });
    seed.ledger = [
      pull('p1', 250, { kind: 'credits', credits_paid: 750, fragments_paid: 0, key_paid: false, key_fallback: false }),
      pull('p2', 1000, { kind: 'none', credits_paid: 0, fragments_paid: 0, key_paid: false, key_fallback: false }),
      pull('p3', 50, { kind: 'fragments', credits_paid: 0, fragments_paid: 5, key_paid: false, key_fallback: false }),
      pull('p4', 50, { kind: 'key', credits_paid: 0, fragments_paid: 0, key_paid: true, key_fallback: false }),
      pull('p5', 50, { kind: 'key', credits_paid: 0, fragments_paid: 5, key_paid: false, key_fallback: true }),
      { user_id: A, action_type: 'cc_slot_pull', idempotency_key: 'p6', created_at: at,
        result_payload: { bet_credits: 250, outcome: 'vendor_bundle', payout: { kind: 'bundle', credits_paid: 0, fragments_paid: 0, key_paid: false, key_fallback: false } } },
    ] as typeof seed.ledger;
    const store = new InMemoryEconomyStore(seed);
    const m = await store.computeMetricsForDay('2026-10-31');
    expect(m.slotPulls).toBe(6);
    expect(m.slotCreditsWagered).toBe(250 + 1000 + 50 + 50 + 50 + 250);
    expect(m.slotCreditsPaid).toBe(750);
    expect(m.creditsMintedSlots).toBe(750);
    expect(m.slotBundlesPaid).toBe(1);
    expect(m.slotFragmentsPaid).toBe(10); // the drop + the fallback
    expect(m.slotKeysPaid).toBe(1);
    expect(m.slotFragmentFallbacks).toBe(1);
    // Gross fold: wagers destroyed, payouts minted, net stays honest.
    expect(m.creditsDestroyedSlots).toBe(1650 - 750);
    expect(m.creditsDestroyedTotal).toBe(1650);
    expect(m.creditsMintedTotal).toBe(750);
    expect(m.netCreditChange).toBe(750 - 1650);
  });
});

// ---------------------------------------------------------------------------
// 6. Migration pins: op shape, writer restatement, metrics no-drop
// ---------------------------------------------------------------------------

describe('slots — migration 0049 pins', () => {
  it('cc_slot_pull carries the gate, cap, draw, and budget fallback', () => {
    for (const needle of [
      'create or replace function public.cc_slot_pull(p_player_id uuid, nonce text, p_bet_tier integer)',
      'if not public.can_use_player_economy(actor) then raise exception \'Verified account required\'',
      "public.cc_economy_config_number('slotDailyPullCap', 100)",
      "raise exception 'Daily slot pull limit reached'",
      "raise exception 'The slot machine is closed'",
      "draw := public.cc_draw_odds('slot_machine')",
      "public.cc_economy_config_number('cacheBoxDailyCap', 10)",
      'Cache budget full — paid in fragments',
      "values (actor, 'cc_slot_pull', nonce, result)",
      'add column if not exists slot_pulls_day date',
      'add column if not exists slot_pulls_count integer not null default 0',
      'create or replace function public.cc_slot_bundle(p_target integer)',
      "where pool = 'staple'",
    ]) {
      expect(MIGRATION_0049, needle).toContain(needle);
    }
    // The pull never writes a cache_box_openings row (keys are a
    // stock; openings stay openings).
    expect(MIGRATION_0049).not.toContain('insert into public.cache_box_openings');
  });

  it('widens BOTH consumable event lists by exactly slot_bundle', () => {
    expect(MIGRATION_0049).toContain("'shieldtech_refund'::text, 'repair_refund'::text, 'slot_bundle'::text");
    expect(MIGRATION_0049).toContain(
      "'standing_buy', 'shieldtech_refund', 'repair_refund', 'slot_bundle') then raise exception 'invalid consumable event type'",
    );
    // The restated writer is the 0045 body verbatim apart from the
    // one list line (the repairRefundEvent pattern).
    const writer = (sql: string) => {
      const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.cc_add_consumable_batch');
      const end = sql.indexOf('$function$;', start);
      return sql.slice(start, end + '$function$;'.length);
    };
    const before = writer(readSource('db/migrations/0045_repair_refund_event.sql'));
    const after = writer(MIGRATION_0049);
    expect(after.replace(", 'slot_bundle'", '')).toBe(before);
  });

  it('the metrics restatement drops no prior panel (0044 → 0049)', () => {
    const fn = (sql: string) => {
      const start = sql.indexOf('create or replace function public.cc_compute_economy_metrics');
      const end = sql.indexOf('end;$$;', start);
      return sql.slice(start, end);
    };
    const before = fn(readSource('db/migrations/0044_shield_tech_services.sql'));
    const after = fn(MIGRATION_0049);
    // Every aliased fold field the 0044 body computed survives.
    const aliases = [...before.matchAll(/ as ([a-z_]+)/g)].map((m) => m[1]);
    expect(aliases.length).toBeGreaterThan(80);
    for (const alias of new Set(aliases)) {
      expect(after, alias).toContain(` as ${alias}`);
    }
    // Every action type the 0044 fold read still appears in 0049.
    const actionTypes = [...before.matchAll(/action_type = '([a-z_]+)'|action_type in \(([^)]+)\)/g)]
      .flatMap((m) => (m[1] ? [m[1]] : m[2].split(',').map((s) => s.trim().replaceAll("'", ''))));
    for (const actionType of new Set(actionTypes)) {
      expect(after, actionType).toContain(actionType);
    }
    // The slot terms join both totals, gross.
    expect(after).toContain('+ m.slot_credits_paid;');
    expect(after).toContain('+ m.slot_wagered;');
    expect(after).toContain('credits_minted_slots');
    expect(after).toContain('greatest(0, m.slot_wagered - m.slot_credits_paid)');
  });

  it('is the chain-final metrics restatement', () => {
    const files = readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const restatements = files.filter((f) =>
      readSource(`db/migrations/${f}`).includes('cc_compute_economy_metrics'));
    expect(restatements[restatements.length - 1]).toBe('0049_slot_machine.sql');
  });
});

// ---------------------------------------------------------------------------
// 7. Printed odds + scenes (law 7 / §2.9)
// ---------------------------------------------------------------------------

describe('slots — printed odds and scenes', () => {
  it('the panel renders the table from the twin, never re-typed percentages', () => {
    const panel = readSource('src/components/vendor/DataSlotsPanel.tsx');
    expect(panel).toContain('SLOT_OUTCOMES');
    expect(panel).toContain('slotOutcomePercent');
    expect(panel).toContain('slotCreditRtp');
    // No hardcoded outcome percentages anywhere in the panel.
    for (const literal of ['54.8', '54.80', '20.00%', '0.15%', '0.05%']) {
      expect(panel, literal).not.toContain(literal);
    }
    // The lock is the #254 transact pattern: the shared economy
    // lock hook (whose decision is the 'market' player-economy
    // gate) guards the lever; the machine and its printed table
    // render for every session, and a locked tap raises the shared
    // SignInLockPrompt. Slots never hide behind a FeatureGate.
    expect(panel).toContain('useEconomyTransactLock');
    expect(panel).toContain("guardTransact('pull the lever'");
    expect(panel).toContain('transactLockPrompt');
    expect(panel).toContain('pulls are verified-only');
    expect(panel).not.toContain('FeatureGate');
    expect(panel).not.toContain('canUseFeature');
    const hook = readSource('src/auth/useEconomyTransactLock.tsx');
    expect(hook).toContain("canUseFeature(account, 'market')");
    expect(hook).toContain('SignInLockPrompt');
    // The panel mounts at the foot of the vendor stall.
    const vendor = readSource('src/screens/VendorScreen.tsx');
    expect(vendor).toContain('<DataSlotsPanel />');
  });

  it('ships the two golden scenes on the vendor grammar set', () => {
    expect(ACTION_SETS.slots).toEqual(['set-vendor-stall', 'set-vendor-sign', 'prop-slot-machine']);
    const ids = GOLDEN_SCENES.map((s) => s.id);
    expect(ids).toContain('slots-idle');
    expect(ids).toContain('slots-key-win');
  });
});
