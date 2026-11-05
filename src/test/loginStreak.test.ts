/**
 * Daily login streak (migration 0036; fragment leg abolished by
 * migration 0082, owner ruling 2026-11-04) — the escalating
 * daily-return ladder: credits across days 1–7, a cache key on
 * day 7, then the cycle repeats at a higher tier (×1.5/step, cap
 * tier 5). The ladder once also paid cache fragments on days 3–7;
 * fragments are abolished as a currency, so those legs are gone
 * (every day still pays credits, so no day went empty).
 *
 * Laws under test:
 *  - THE LADDER: tier-1 week pays exactly 1,900 credits / 1 key;
 *    the key is 1 at EVERY tier (never scaled);
 *    amounts are non-decreasing across the days of a cycle and
 *    across tiers. Sizing reference: baseline roaming pays
 *    ~15 credits/minute, so a tier-1 week ≈ 2 hours of roaming
 *    spread over 7 days.
 *  - STREAK ARITHMETIC: consecutive UTC days increment; a missed
 *    day restarts at 1; the longest streak is kept. Cycle position
 *    derives purely from the streak length (day 8 = tier 2 day 1;
 *    day 36+ stays at the tier-5 ceiling).
 *  - EXACTLY ONCE, TWICE OVER (0079, the TRUE CLAIM): the
 *    (player, day) claim row is the RECORD anchor — a replayed
 *    check-in returns the stored row and records nothing again,
 *    and the check-in credits NOTHING. The row's paid stamp is
 *    the PAYMENT anchor — a replayed claim returns the stored
 *    claim and pays nothing again. Only today's row can be
 *    claimed, so an unclaimed reward expires at the rollover
 *    while the recorded day still counts toward the streak.
 *  - SERVER-ANCHORED: the day comes from the server's clock; the
 *    routes are body-less — identity from the JWT only. Guests
 *    earn identically (grants key on the profile row).
 *  - LEVERS: streakCreditScalar is an economy-config key, default
 *    pinned to the content default, hard-clamped [0, 3] in the
 *    resolver, the config registry, and the SQL call site. (The
 *    streakFragmentScalar lever died with fragments in 0082.)
 *  - METERS: streak grants fold from cc_login_streak_claim ledger
 *    rows into credits_minted_login_streak (inside the minted
 *    total), cache_fragments_from_login_streak, and
 *    cache_keys_from_login_streak — distinct from leaderboard
 *    keys and ad-lane issuance. Since 0079 the ledger row is
 *    written at CLAIM time, so the meters move at claim, not at
 *    check-in.
 *
 * The SQL twin is exercised against real Postgres in the slice
 * harness (0036: full chain, grant walk across days, replay,
 * gap reset, tier ceiling, lever rows, metrics fold, seed parity;
 * 0079: hold/claim/expiry walk); its shapes are pinned textually
 * below.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOGIN_STREAK_CYCLE_DAYS,
  LOGIN_STREAK_LEVER_CLAMPS,
  LOGIN_STREAK_LEVER_DEFAULTS,
  LOGIN_STREAK_MISS_RULE,
  LOGIN_STREAK_REWARD_TABLE,
  LOGIN_STREAK_TIER_CEILING,
  formatLoginStreakReward,
  loginStreakAddDays,
  loginStreakGrantFor,
  loginStreakLengthAfter,
  loginStreakPositionFor,
  loginStreakReward,
  loginStreakStateView,
  loginStreakTierMultiplier,
  loginStreakUtcDay,
  resolveLoginStreakLevers,
  type LoginStreakFacts,
} from '@/content/loginStreak';
import {
  ECONOMY_CONFIG_DEFAULTS,
  ECONOMY_CONFIG_KEYS,
  validateEconomyConfigValue,
} from '../server/economy/config';
import { InMemoryEconomyStore } from '../server/economy/memory';
import { mountChefHealthRoute, mountGameplayRoutes, mountLoginStreakRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 1. Content: the ladder, tiers, streak arithmetic
// ---------------------------------------------------------------------------

describe('login streak content — the ladder', () => {
  it('tier 1 pays the shipped ladder; the week totals 1,900 cr / 1 key', () => {
    const week = Array.from({ length: 7 }, (_, i) => loginStreakReward(i + 1, 1));
    expect(week.map((r) => r.credits)).toEqual([100, 150, 200, 250, 300, 400, 500]);
    expect(week.map((r) => r.cacheKeys)).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(week.reduce((a, r) => a + r.credits, 0)).toBe(1900);
    expect(week.reduce((a, r) => a + r.cacheKeys, 0)).toBe(1);
    // Fragments are abolished: no ladder row carries a fragment leg.
    for (const r of LOGIN_STREAK_REWARD_TABLE) {
      expect(r).not.toHaveProperty('fragments');
    }
  });

  it('tiers scale ×1.5 per step to the tier-5 ceiling (×3); the key never scales', () => {
    expect([1, 2, 3, 4, 5].map(loginStreakTierMultiplier)).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(loginStreakReward(1, 2).credits).toBe(150);
    expect(loginStreakReward(7, 2).credits).toBe(750);
    expect(loginStreakReward(7, 5).credits).toBe(1500);
    for (let tier = 1; tier <= LOGIN_STREAK_TIER_CEILING; tier += 1) {
      expect(loginStreakReward(7, tier).cacheKeys).toBe(1);
      expect(loginStreakReward(6, tier).cacheKeys).toBe(0);
    }
    const week5 = Array.from({ length: 7 }, (_, i) => loginStreakReward(i + 1, 5));
    expect(week5.reduce((a, r) => a + r.credits, 0)).toBe(5700);
    // Out-of-range inputs clamp to the table's edges, never invent rows.
    expect(loginStreakReward(9, 99)).toEqual(loginStreakReward(7, 5));
    expect(loginStreakReward(0, 0)).toEqual(loginStreakReward(1, 1));
  });

  it('amounts never decrease across a cycle or across tiers', () => {
    for (let tier = 1; tier <= LOGIN_STREAK_TIER_CEILING; tier += 1) {
      for (let day = 2; day <= LOGIN_STREAK_CYCLE_DAYS; day += 1) {
        expect(loginStreakReward(day, tier).credits).toBeGreaterThanOrEqual(
          loginStreakReward(day - 1, tier).credits,
        );
      }
      if (tier > 1) {
        for (let day = 1; day <= LOGIN_STREAK_CYCLE_DAYS; day += 1) {
          expect(loginStreakReward(day, tier).credits).toBeGreaterThan(
            loginStreakReward(day, tier - 1).credits,
          );
        }
      }
    }
  });

  it('the seeded table is 5 tiers × 7 days, ordered tier then day', () => {
    expect(LOGIN_STREAK_REWARD_TABLE).toHaveLength(35);
    expect(LOGIN_STREAK_REWARD_TABLE[0]).toEqual(loginStreakReward(1, 1));
    expect(LOGIN_STREAK_REWARD_TABLE[7]).toEqual(loginStreakReward(1, 2));
    expect(LOGIN_STREAK_REWARD_TABLE[34]).toEqual(loginStreakReward(7, 5));
  });
});

describe('login streak content — position + streak arithmetic', () => {
  it('position derives from streak length; tier caps at the ceiling', () => {
    expect(loginStreakPositionFor(1)).toEqual({ cycleDay: 1, tier: 1 });
    expect(loginStreakPositionFor(7)).toEqual({ cycleDay: 7, tier: 1 });
    expect(loginStreakPositionFor(8)).toEqual({ cycleDay: 1, tier: 2 });
    expect(loginStreakPositionFor(14)).toEqual({ cycleDay: 7, tier: 2 });
    expect(loginStreakPositionFor(35)).toEqual({ cycleDay: 7, tier: 5 });
    expect(loginStreakPositionFor(36)).toEqual({ cycleDay: 1, tier: 5 });
    expect(loginStreakPositionFor(365)).toEqual({ cycleDay: 1, tier: 5 });
  });

  it('lengthAfter: yesterday extends, today keeps, a gap or no history restarts', () => {
    const today = '2026-11-01';
    expect(loginStreakLengthAfter('2026-10-31', 6, today)).toBe(7);
    expect(loginStreakLengthAfter(today, 6, today)).toBe(6);
    expect(loginStreakLengthAfter('2026-10-30', 6, today)).toBe(1);
    expect(loginStreakLengthAfter(null, 0, today)).toBe(1);
    // Month and year boundaries are plain UTC-day math.
    expect(loginStreakLengthAfter('2026-12-31', 3, '2027-01-01')).toBe(4);
    expect(loginStreakAddDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(loginStreakUtcDay(new Date('2026-11-01T23:59:59.000Z'))).toBe('2026-11-01');
    expect(loginStreakUtcDay(new Date('2026-11-02T00:00:01.000Z'))).toBe('2026-11-02');
  });
});

// ---------------------------------------------------------------------------
// 2. Levers
// ---------------------------------------------------------------------------

describe('login streak levers', () => {
  it('config defaults are pinned to the content defaults; clamps are [0, 3]', () => {
    expect(ECONOMY_CONFIG_DEFAULTS.streakCreditScalar).toBe(LOGIN_STREAK_LEVER_DEFAULTS.streakCreditScalar);
    expect(ECONOMY_CONFIG_KEYS.streakCreditScalar.min).toBe(LOGIN_STREAK_LEVER_CLAMPS.streakCreditScalar.min);
    expect(ECONOMY_CONFIG_KEYS.streakCreditScalar.max).toBe(LOGIN_STREAK_LEVER_CLAMPS.streakCreditScalar.max);
    expect(validateEconomyConfigValue('streakCreditScalar', 2)).toBe(2);
    expect(validateEconomyConfigValue('streakCreditScalar', 3.5)).toBeNull();
    // The fragment scalar is retired with the currency (0082).
    expect(ECONOMY_CONFIG_KEYS.streakFragmentScalar).toBeUndefined();
  });

  it('resolve clamps into the band and drops non-numbers', () => {
    expect(resolveLoginStreakLevers()).toEqual({ streakCreditScalar: 1 });
    expect(resolveLoginStreakLevers({ streakCreditScalar: 99 })).toEqual({
      streakCreditScalar: 3,
    });
    expect(resolveLoginStreakLevers({ streakCreditScalar: -2 })).toEqual({
      streakCreditScalar: 0,
    });
    expect(resolveLoginStreakLevers({ streakCreditScalar: Number.NaN })).toEqual({
      streakCreditScalar: 1,
    });
  });

  it('grantFor scales and floors credits; the key is never scaled', () => {
    const levers = resolveLoginStreakLevers({ streakCreditScalar: 0.5 });
    expect(loginStreakGrantFor(3, 1, levers)).toEqual({
      cycleDay: 3, tier: 1, credits: 100, cacheKeys: 0,
    });
    const zeroed = resolveLoginStreakLevers({ streakCreditScalar: 0 });
    expect(loginStreakGrantFor(7, 3, zeroed)).toEqual({
      cycleDay: 7, tier: 3, credits: 0, cacheKeys: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// 3. State view derivation
// ---------------------------------------------------------------------------

const LEVERS = resolveLoginStreakLevers();
const TODAY = '2026-11-01';
const facts = (over: Partial<LoginStreakFacts>): LoginStreakFacts => ({
  currentStreak: 0,
  longestStreak: 0,
  lastClaimDay: null,
  todayClaim: null,
  ...over,
});

describe('login streak state view', () => {
  it('fresh player: streak 0, day 1 pending, ladder ahead', () => {
    const view = loginStreakStateView(facts({}), LEVERS, TODAY);
    expect(view.currentStreak).toBe(0);
    expect(view.todayState).toBe('pending');
    expect(view.cycleDay).toBe(1);
    expect(view.tier).toBe(1);
    expect(view.todayReward).toBeNull();
    expect(view.nextStreakLength).toBe(1);
    expect(view.nextReward).toEqual(loginStreakReward(1, 1));
    expect(view.ladder.map((d) => d.state)).toEqual([
      'today', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming',
    ]);
    expect(view.missRule).toBe(LOGIN_STREAK_MISS_RULE);
  });

  it('claimed today at streak 3: earned through today, day 4 is next', () => {
    const view = loginStreakStateView(
      facts({
        currentStreak: 3,
        longestStreak: 3,
        lastClaimDay: TODAY,
        todayClaim: {
          day: TODAY, streakLength: 3, cycleDay: 3, tier: 1,
          creditsAwarded: 200, fragmentsAwarded: 1, cacheKeysAwarded: 0,
          paid: true,
        },
      }),
      LEVERS,
      TODAY,
    );
    expect(view.currentStreak).toBe(3);
    expect(view.todayState).toBe('earned');
    expect(view.todayClaimable).toBe(false);
    expect(view.todayReward?.credits).toBe(200);
    expect(view.ladder.map((d) => d.state)).toEqual([
      'earned', 'earned', 'today', 'upcoming', 'upcoming', 'upcoming', 'upcoming',
    ]);
    expect(view.nextStreakLength).toBe(4);
    expect(view.nextReward).toEqual(loginStreakReward(4, 1));
  });

  it('recorded but UNPAID today (0079): the day is earned, the reward claimable and face-up', () => {
    const view = loginStreakStateView(
      facts({
        currentStreak: 3,
        longestStreak: 3,
        lastClaimDay: TODAY,
        todayClaim: {
          day: TODAY, streakLength: 3, cycleDay: 3, tier: 1,
          creditsAwarded: 200, fragmentsAwarded: 1, cacheKeysAwarded: 0,
          paid: false,
        },
      }),
      LEVERS,
      TODAY,
    );
    expect(view.currentStreak).toBe(3);
    expect(view.todayState).toBe('earned');
    expect(view.todayClaimable).toBe(true);
    expect(view.todayReward?.credits).toBe(200);
    expect(view.ladder.map((d) => d.state)).toEqual([
      'earned', 'earned', 'today', 'upcoming', 'upcoming', 'upcoming', 'upcoming',
    ]);
  });

  it('alive but unclaimed at streak 6: today is the key day', () => {
    const view = loginStreakStateView(
      facts({ currentStreak: 6, longestStreak: 6, lastClaimDay: '2026-10-31' }),
      LEVERS,
      TODAY,
    );
    expect(view.currentStreak).toBe(6);
    expect(view.todayState).toBe('pending');
    expect(view.cycleDay).toBe(7);
    expect(view.nextReward.cacheKeys).toBe(1);
    expect(view.ladder.map((d) => d.state)).toEqual([
      'earned', 'earned', 'earned', 'earned', 'earned', 'earned', 'today',
    ]);
  });

  it('broken streak: current reads 0, longest kept, ladder restarts at tier 1', () => {
    const view = loginStreakStateView(
      facts({ currentStreak: 12, longestStreak: 12, lastClaimDay: '2026-10-29' }),
      LEVERS,
      TODAY,
    );
    expect(view.currentStreak).toBe(0);
    expect(view.longestStreak).toBe(12);
    expect(view.cycleDay).toBe(1);
    expect(view.tier).toBe(1);
    expect(view.nextReward).toEqual(loginStreakReward(1, 1));
  });

  it('day-8 claim shows the tier-2 ladder with its scaled amounts', () => {
    const view = loginStreakStateView(
      facts({
        currentStreak: 8,
        longestStreak: 8,
        lastClaimDay: TODAY,
        todayClaim: {
          day: TODAY, streakLength: 8, cycleDay: 1, tier: 2,
          creditsAwarded: 150, fragmentsAwarded: 0, cacheKeysAwarded: 0,
          paid: true,
        },
      }),
      LEVERS,
      TODAY,
    );
    expect(view.tier).toBe(2);
    expect(view.ladder[0].credits).toBe(150);
    expect(view.ladder[6].credits).toBe(750);
    expect(view.ladder.map((d) => d.state)[0]).toBe('today');
    expect(formatLoginStreakReward(view.ladder[6])).toBe('750 credits · cache key');
  });
});

// ---------------------------------------------------------------------------
// 4. Record holds, claim pays — in-memory gameplay store (the SQL
//    twin's mirror)
// ---------------------------------------------------------------------------

describe('login streak record + claim — in-memory gameplay store', () => {
  function makeStore(startIso: string, levers?: () => { streakCreditScalar?: number }) {
    let now = new Date(startIso);
    const store = new InMemoryChefGameplayStore(
      () => now,
      undefined,
      undefined,
      undefined,
      levers,
    );
    return { store, setNow: (iso: string) => { now = new Date(iso); } };
  }

  it('check-in records day 1 claimable and credits NOTHING; a same-day re-read changes nothing', async () => {
    const { store } = makeStore('2026-11-01T08:00:00.000Z');
    store.seedProfile({ id: A });
    const first = await store.recordLoginStreakDay(A) as Json;
    expect(first.already_claimed).toBe(false);
    expect(first.claimable).toBe(true);
    expect(first.streak_length).toBe(1);
    expect(first.credits_awarded).toBe(100);
    expect(first.day).toBe('2026-11-01');
    const profile = store.profiles.get(A);
    expect(profile?.credits).toBe(0); // held, not paid
    expect(profile?.cache_token_parts).toBe(0);
    expect(profile?.cache_tokens).toBe(0);
    const replay = await store.recordLoginStreakDay(A) as Json;
    expect(replay.already_claimed).toBe(true);
    expect(replay.claimable).toBe(true); // still waiting on the claim
    expect(replay.credits_awarded).toBe(100);
    expect(store.profiles.get(A)?.credits).toBe(0);
    const facts = await store.getLoginStreakFacts(A);
    expect(facts?.current_streak).toBe(1);
    expect(facts?.today_claim?.credits_awarded).toBe(100);
    expect(facts?.today_claim?.paid).toBe(false);
  });

  it('claim pays exactly once; a replayed claim pays nothing and says so', async () => {
    const { store } = makeStore('2026-11-01T08:00:00.000Z');
    store.seedProfile({ id: A });
    await store.recordLoginStreakDay(A);
    const paid = await store.claimLoginStreakDay(A) as Json;
    // The claim result is the meters' input: 0036's action type
    // and payload shape, produced at claim time.
    expect(paid.action_type).toBe('cc_login_streak_claim');
    expect(paid.already_claimed).toBe(false);
    expect(paid.claimable).toBe(false);
    expect(paid.credits_awarded).toBe(100);
    expect(store.profiles.get(A)?.credits).toBe(100);
    const replay = await store.claimLoginStreakDay(A) as Json;
    expect(replay.already_claimed).toBe(true);
    expect(replay.claimable).toBe(false);
    expect(store.profiles.get(A)?.credits).toBe(100); // not paid twice
    const facts = await store.getLoginStreakFacts(A);
    expect(facts?.today_claim?.paid).toBe(true);
    // A check-in read after the claim reports the day paid.
    const reread = await store.recordLoginStreakDay(A) as Json;
    expect(reread.claimable).toBe(false);
  });

  it('claiming with nothing recorded today is refused', async () => {
    const { store } = makeStore('2026-11-01T08:00:00.000Z');
    store.seedProfile({ id: A });
    await expect(store.claimLoginStreakDay(A)).rejects.toThrow('No streak reward recorded today');
  });

  it('a 9-day walk of record + claim: day 7 pays the key, day 8 opens tier 2, totals as 0036', async () => {
    const { store, setNow } = makeStore('2026-11-01T08:00:00.000Z');
    store.seedProfile({ id: A });
    const records: Json[] = [];
    const claims: Json[] = [];
    for (let day = 1; day <= 9; day += 1) {
      setNow(`2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`);
      records.push(await store.recordLoginStreakDay(A) as Json);
      claims.push(await store.claimLoginStreakDay(A) as Json);
    }
    expect(records.map((g) => g.streak_length)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(claims.every((c) => c.already_claimed === false)).toBe(true);
    expect(claims[6].cache_keys_awarded).toBe(1);
    expect(claims[6].credits_awarded).toBe(500);
    expect(claims[7].tier).toBe(2);
    expect(claims[7].credits_awarded).toBe(150);
    const profile = store.profiles.get(A);
    // Tier-1 week (1,900 cr / 1 key) + tier-2 days 1–2 (150 + 225 cr).
    // Fragments are abolished (0082): the parts balance never moves.
    expect(profile?.credits).toBe(2275);
    expect(profile?.cache_token_parts).toBe(0);
    expect(profile?.cache_tokens).toBe(1);
    const facts = await store.getLoginStreakFacts(A);
    expect(facts?.longest_streak).toBe(9);
  });

  it('days recorded but never claimed pay nothing — the streak still grows', async () => {
    const { store, setNow } = makeStore('2026-11-01T08:00:00.000Z');
    store.seedProfile({ id: A });
    for (let day = 1; day <= 3; day += 1) {
      setNow(`2026-11-0${day}T08:00:00.000Z`);
      await store.recordLoginStreakDay(A);
    }
    const profile = store.profiles.get(A);
    expect(profile?.credits).toBe(0);
    expect(profile?.cache_token_parts).toBe(0);
    const facts = await store.getLoginStreakFacts(A);
    expect(facts?.current_streak).toBe(3);
    expect(facts?.today_claim?.paid).toBe(false);
  });

  it('expiry: an unclaimed day-1 reward can never be paid on day 2 — and day 2 still extends the streak', async () => {
    const { store, setNow } = makeStore('2026-11-01T08:00:00.000Z');
    store.seedProfile({ id: A });
    await store.recordLoginStreakDay(A); // day 1 recorded, never claimed
    setNow('2026-11-02T08:00:00.000Z');
    // The claim only ever pays TODAY's row: day 1's reward expired
    // at the rollover.
    await expect(store.claimLoginStreakDay(A)).rejects.toThrow('No streak reward recorded today');
    expect(store.profiles.get(A)?.credits).toBe(0);
    // The recorded day 1 still counted: day 2 records as streak 2
    // and claims its own reward — day 1's 100 is gone for good.
    const day2 = await store.recordLoginStreakDay(A) as Json;
    expect(day2.streak_length).toBe(2);
    const paid = await store.claimLoginStreakDay(A) as Json;
    expect(paid.credits_awarded).toBe(150);
    expect(store.profiles.get(A)?.credits).toBe(150);
    const facts = await store.getLoginStreakFacts(A);
    expect(facts?.current_streak).toBe(2);
    expect(facts?.longest_streak).toBe(2);
  });

  it('a missed day restarts the streak at 1 but keeps the longest', async () => {
    const { store, setNow } = makeStore('2026-11-01T08:00:00.000Z');
    store.seedProfile({ id: A });
    await store.recordLoginStreakDay(A);
    await store.claimLoginStreakDay(A);
    setNow('2026-11-02T08:00:00.000Z');
    await store.recordLoginStreakDay(A);
    setNow('2026-11-04T08:00:00.000Z'); // 11-03 missed
    const restarted = await store.recordLoginStreakDay(A) as Json;
    expect(restarted.streak_length).toBe(1);
    expect(restarted.cycle_day).toBe(1);
    expect(restarted.tier).toBe(1);
    const facts = await store.getLoginStreakFacts(A);
    expect(facts?.current_streak).toBe(1);
    expect(facts?.longest_streak).toBe(2);
  });

  it('lever scalars apply at record time; the claim pays the stored amounts (scalar 2 doubles day 1)', async () => {
    const { store } = makeStore('2026-11-01T08:00:00.000Z', () => ({ streakCreditScalar: 2 }));
    store.seedProfile({ id: A });
    const recorded = await store.recordLoginStreakDay(A) as Json;
    expect(recorded.credits_awarded).toBe(200);
    const paid = await store.claimLoginStreakDay(A) as Json;
    expect(paid.credits_awarded).toBe(200);
    expect(store.profiles.get(A)?.credits).toBe(200);
  });

  it('guest parity: a guest profile records and claims on the same terms (no account-type gate)', async () => {
    const { store } = makeStore('2026-11-01T08:00:00.000Z');
    store.seedProfile({ id: A, account_type: 'guest' } as never);
    const recorded = await store.recordLoginStreakDay(A) as Json;
    expect(recorded.claimable).toBe(true);
    const paid = await store.claimLoginStreakDay(A) as Json;
    expect(paid.credits_awarded).toBe(100);
    expect(store.profiles.get(A)?.credits).toBe(100);
  });

  it('an unknown profile is refused by both ops', async () => {
    const { store } = makeStore('2026-11-01T08:00:00.000Z');
    await expect(store.recordLoginStreakDay(A)).rejects.toThrow('Profile not found');
    await expect(store.claimLoginStreakDay(A)).rejects.toThrow('Profile not found');
    expect(await store.getLoginStreakFacts(A)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Routes — observe-and-record over the real HTTP surface
// ---------------------------------------------------------------------------

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface RouteHarness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
  tokenB: string;
}

async function makeRouteServer(store: InMemoryChefGameplayStore): Promise<RouteHarness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  mountLoginStreakRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, false),
  };
}

async function get(h: RouteHarness, path: string, token?: string) {
  const res = await fetch(`${h.base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: (await res.json()) as Json };
}

describe('login streak routes', () => {
  async function post(
    h: { base: string },
    path: string,
    token?: string,
  ): Promise<{ status: number; json: Json }> {
    const res = await fetch(`${h.base}${path}`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, json: (await res.json()) as Json };
  }

  it('requires auth and 404s without a profile', async () => {
    const store = new InMemoryChefGameplayStore(() => new Date('2026-11-01T08:00:00.000Z'));
    const h = await makeRouteServer(store);
    expect((await get(h, '/api/login-streak/me')).status).toBe(401);
    expect((await get(h, '/api/login-streak/me', h.tokenA)).status).toBe(404);
    expect((await post(h, '/api/login-streak/claim')).status).toBe(401);
    expect((await post(h, '/api/login-streak/claim', h.tokenA)).status).toBe(404);
  });

  it('the first GET records the day claimable and credits NOTHING; the second is a replay', async () => {
    const store = new InMemoryChefGameplayStore(() => new Date('2026-11-01T08:00:00.000Z'));
    store.seedProfile({ id: A });
    const h = await makeRouteServer(store);
    const first = await get(h, '/api/login-streak/me', h.tokenA);
    expect(first.status).toBe(200);
    expect(first.json.verified).toBe(true);
    const granted = first.json.granted as Json;
    expect(granted.alreadyClaimed).toBe(false);
    expect(granted.claimable).toBe(true);
    expect(granted.creditsAwarded).toBe(100);
    const view = first.json.loginStreak as Json;
    expect(view.currentStreak).toBe(1);
    expect(view.todayState).toBe('earned');
    expect(view.todayClaimable).toBe(true);
    expect((first.json.profile as Json).credits).toBe(0); // held, not paid

    const second = await get(h, '/api/login-streak/me', h.tokenA);
    expect((second.json.granted as Json).alreadyClaimed).toBe(true);
    expect((second.json.granted as Json).claimable).toBe(true);
    expect((second.json.profile as Json).credits).toBe(0);
  });

  it('POST /claim pays exactly once (second POST is an honest already-claimed), and credits land in the response profile', async () => {
    const store = new InMemoryChefGameplayStore(() => new Date('2026-11-01T08:00:00.000Z'));
    store.seedProfile({ id: A });
    const h = await makeRouteServer(store);
    await get(h, '/api/login-streak/me', h.tokenA);
    const claim = await post(h, '/api/login-streak/claim', h.tokenA);
    expect(claim.status).toBe(200);
    expect(claim.json.verified).toBe(true);
    const granted = claim.json.granted as Json;
    expect(granted.alreadyClaimed).toBe(false);
    expect(granted.claimable).toBe(false);
    expect(granted.creditsAwarded).toBe(100);
    expect((claim.json.loginStreak as Json).todayClaimable).toBe(false);
    expect((claim.json.profile as Json).credits).toBe(100);

    const replay = await post(h, '/api/login-streak/claim', h.tokenA);
    expect(replay.status).toBe(200);
    expect((replay.json.granted as Json).alreadyClaimed).toBe(true);
    expect((replay.json.profile as Json).credits).toBe(100); // not paid twice
    expect(store.profiles.get(A)?.credits).toBe(100);
  });

  it('POST /claim before any check-in is a 409 (nothing recorded today)', async () => {
    const store = new InMemoryChefGameplayStore(() => new Date('2026-11-01T08:00:00.000Z'));
    store.seedProfile({ id: A });
    const h = await makeRouteServer(store);
    expect((await post(h, '/api/login-streak/claim', h.tokenA)).status).toBe(409);
    expect(store.profiles.get(A)?.credits).toBe(0);
  });

  it('identity comes from the JWT: player B records and claims their own streak', async () => {
    const store = new InMemoryChefGameplayStore(() => new Date('2026-11-01T08:00:00.000Z'));
    store.seedProfile({ id: A });
    store.seedProfile({ id: B });
    const h = await makeRouteServer(store);
    await get(h, '/api/login-streak/me', h.tokenA);
    await get(h, '/api/login-streak/me', h.tokenA);
    const bFirst = await get(h, '/api/login-streak/me', h.tokenB);
    expect((bFirst.json.granted as Json).alreadyClaimed).toBe(false);
    expect((bFirst.json.granted as Json).claimable).toBe(true);
    expect((bFirst.json.loginStreak as Json).currentStreak).toBe(1);
    const bClaim = await post(h, '/api/login-streak/claim', h.tokenB);
    expect((bClaim.json.granted as Json).alreadyClaimed).toBe(false);
    expect(store.profiles.get(B)?.credits).toBe(100); // B paid
    expect(store.profiles.get(A)?.credits).toBe(0); // A never claimed
  });
});

// ---------------------------------------------------------------------------
// 6. Meters — the in-memory economy twin folds the streak rows
// ---------------------------------------------------------------------------

describe('login streak meters — economy twin', () => {
  it('folds cc_login_streak_claim rows into the three meters + the minted total', async () => {
    const store = new InMemoryEconomyStore({
      ledger: [
        {
          action_type: 'cc_login_streak_claim',
          created_at: '2026-11-01T08:00:00.000Z',
          result_payload: { credits_awarded: 200, fragments_awarded: 1, cache_keys_awarded: 0 },
        },
        {
          action_type: 'cc_login_streak_claim',
          created_at: '2026-11-01T09:00:00.000Z',
          result_payload: { credits_awarded: 500, fragments_awarded: 3, cache_keys_awarded: 1 },
        },
        {
          // A leaderboard key the same day must NOT leak into the
          // streak key meter (distinct sources).
          action_type: 'cc_leaderboard_settlement',
          created_at: '2026-11-01T06:00:00.000Z',
          result_payload: { cache_keys_awarded: 6 },
        },
        {
          // Yesterday's claim belongs to yesterday's meters.
          action_type: 'cc_login_streak_claim',
          created_at: '2026-10-31T08:00:00.000Z',
          result_payload: { credits_awarded: 100, fragments_awarded: 0, cache_keys_awarded: 0 },
        },
      ],
      items: [],
      config: {},
    });
    const row = await store.computeMetricsForDay('2026-11-01');
    expect(row.creditsMintedLoginStreak).toBe(700);
    expect(row.cacheFragmentsFromLoginStreak).toBe(4);
    expect(row.cacheKeysFromLoginStreak).toBe(1);
    expect(row.cacheKeysFromLeaderboards).toBe(6);
    expect(row.creditsMintedTotal).toBe(700); // the streak faucet is inside the total
  });
});

// ---------------------------------------------------------------------------
// 7. Migration 0036 — textual pins (the SQL twin's shapes)
// ---------------------------------------------------------------------------

describe('migration 0036 textual pins', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0036_login_streak.sql'), 'utf8');

  it('creates the state, claims, and definitions tables with the exactly-once key', () => {
    expect(sql).toContain('create table if not exists public.login_streak_state');
    expect(sql).toContain('create table if not exists public.login_streak_claims');
    expect(sql).toContain('primary key (player_id, claim_day)');
    expect(sql).toContain('create table if not exists public.login_streak_reward_definitions');
  });

  it('seeds the definitions in parity with LOGIN_STREAK_REWARD_TABLE', () => {
    const start = sql.indexOf('insert into public.login_streak_reward_definitions');
    const end = sql.indexOf('on conflict (cycle_day, tier) do nothing', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const tuples = [...sql.slice(start, end).matchAll(/\((\d+), (\d+), (\d+), (\d+), (\d+)\)/g)]
      .map((m) => m.slice(1).map(Number));
    // Parity on the surviving legs (cycle day, tier, credits, key).
    // The 4th column is 0036's historical fragment seed — migration
    // 0082 zeroes the live definitions table, so it is pinned here
    // only as the record of what 0036 shipped (tier-1 week: 9).
    const expected = LOGIN_STREAK_REWARD_TABLE.map((r) => [
      r.cycleDay, r.tier, r.credits, r.cacheKeys,
    ]);
    expect(tuples.map((t) => [t[0], t[1], t[2], t[4]])).toEqual(expected);
    expect(tuples.filter((t) => t[1] === 1).reduce((a, t) => a + t[3], 0)).toBe(9);
  });

  it('the grant reads the lever scalars in SQL and writes the ledger row', () => {
    expect(sql).toContain('create or replace function public.cc_record_login_streak_day');
    expect(sql).toContain("cc_economy_config_number('streakCreditScalar', 1)");
    expect(sql).toContain("cc_economy_config_number('streakFragmentScalar', 1)");
    expect(sql).toContain("'cc_login_streak_claim'");
    expect(sql).toContain("'login-streak:'");
    expect(sql).toContain('cache_token_parts = cache_token_parts + v_fragments');
    expect(sql).toContain('cache_tokens = cache_tokens + v_keys');
  });

  it('adds the three meter columns and folds them in the restated metrics function', () => {
    expect(sql).toContain('add column if not exists credits_minted_login_streak');
    expect(sql).toContain('add column if not exists cache_fragments_from_login_streak');
    expect(sql).toContain('add column if not exists cache_keys_from_login_streak');
    expect(sql).toContain("filter (where action_type = 'cc_login_streak_claim'), 0) as minted_login_streak");
    expect(sql).toContain('+ m.minted_login_streak');
    expect(sql).toContain('credits_minted_login_streak = excluded.credits_minted_login_streak');
  });
});

// ---------------------------------------------------------------------------
// 8. Migration 0079 — textual pins (the true claim's SQL shapes)
// ---------------------------------------------------------------------------

describe('migration 0079 textual pins', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0079_login_streak_true_claim.sql'), 'utf8');
  const recordStart = sql.indexOf('create or replace function public.cc_record_login_streak_day');
  const claimStart = sql.indexOf('create or replace function public.cc_claim_login_streak_day');
  const recordFn = sql.slice(recordStart, claimStart);
  const claimFn = sql.slice(claimStart);

  it('adds paid_at and backfills every pre-existing row as paid (history reads as banked)', () => {
    expect(sql).toContain('add column if not exists paid_at timestamptz');
    expect(sql).toContain('set paid_at = claimed_at');
    expect(sql).toContain('where paid_at is null');
  });

  it('the record function HOLDS: it computes and stamps amounts but never touches balances or the ledger', () => {
    expect(recordStart).toBeGreaterThan(-1);
    // Still the streak arithmetic + lever scalars of 0036.
    expect(recordFn).toContain("cc_economy_config_number('streakCreditScalar', 1)");
    expect(recordFn).toContain("cc_economy_config_number('streakFragmentScalar', 1)");
    expect(recordFn).toContain('insert into public.login_streak_claims');
    expect(recordFn).toContain("'claimable', c.paid_at is null");
    // And no payment path anywhere inside it.
    expect(recordFn).not.toContain('update public.profiles');
    expect(recordFn).not.toContain('verified_action_ledger');
  });

  it('the claim function PAYS: today’s row only, paid_at as the exactly-once anchor, ledger at claim time', () => {
    expect(claimStart).toBeGreaterThan(recordStart);
    expect(claimFn).toContain('where player_id = p_player_id and claim_day = v_today');
    expect(claimFn).toContain("raise exception 'No streak reward recorded today'");
    expect(claimFn).toContain('if c.paid_at is not null then');
    expect(claimFn).toContain('set paid_at = p_now');
    expect(claimFn).toContain('update public.profiles');
    expect(claimFn).toContain('insert into public.verified_action_ledger');
    expect(claimFn).toContain("'cc_login_streak_claim'");
    expect(claimFn).toContain("'login-streak:'");
    expect(claimFn).toContain('cache_token_parts = cache_token_parts + c.fragments_awarded');
    expect(claimFn).toContain('cache_tokens = cache_tokens + c.cache_keys_awarded');
  });
});
