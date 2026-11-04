/**
 * Profile lifetime counters (migration 0051) — the three #234 gaps.
 *
 * The laws under test:
 *  - The read carries the counters as RECORDED facts: deaths from
 *    player_lifetime_counters, credits earned/spent with the
 *    tracking start the counter row carries, kills by element from
 *    player_kill_element_stats. Another player's rows never leak;
 *    a player with no counter row reads zeros and a null since —
 *    never an estimate.
 *  - Kills by element accrue at the SAME choke point as the 0034
 *    weapon record (the twin's recordKillStats here; cc_record_
 *    kill_stats in SQL), attributed to the equipped weapon's
 *    payload element — two different elements must both land — and
 *    never twice for one claim.
 *  - Lifetime deaths increment ONLY when a death is recorded
 *    (first death wins): a re-report of a standing death adds
 *    nothing; a death after resurrection adds one more.
 *  - The counter and the 0051 backfill rule agree: at every point,
 *    deaths = successful resurrections + (a death stands ? 1 : 0)
 *    — the identity the migration's backfill is built on, checked
 *    here against the twin's ledger.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountReadRoutes } from '../server/reads/routes';
import {
  InMemoryReadStore, emptyReadSeed,
  type ProfileRowData, type ReadSeed,
} from '../server/reads/store';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import type { ChefRewardsInput } from '../server/gameplay/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 60, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-11-02T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 3, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function counterSeed(): ReadSeed {
  const seed = emptyReadSeed();
  seed.profiles = [profile({ id: A }), profile({ id: B })];
  seed.killElementStats = [
    { user_id: A, element: 'Fire', kills: 30 },
    { user_id: A, element: 'Shock', kills: 12 },
    { user_id: A, element: 'unarmed', kills: 3 },
    { user_id: B, element: 'Fire', kills: 999 },
  ];
  seed.lifetimeCounters = [
    {
      user_id: A, deaths: 7, credits_earned: 152_300, credits_spent: 141_900,
      tracking_started_at: '2026-11-02T12:00:00.000Z',
    },
    {
      user_id: B, deaths: 1, credits_earned: 5000, credits_spent: 0,
      tracking_started_at: '2026-11-02T12:00:00.000Z',
    },
  ];
  return seed;
}

describe('lifetime counters — the read carries recorded facts only', () => {
  it('surfaces deaths, credits with their tracking start, and kills by element', async () => {
    const stats = await new InMemoryReadStore(counterSeed()).getProfileStats(A);
    expect(stats).not.toBeNull();
    expect(stats!.deaths).toBe(7);
    expect(stats!.credits).toEqual({
      earned: 152_300, spent: 141_900, since: '2026-11-02T12:00:00.000Z',
    });
    expect(stats!.kills.by_element).toEqual({ Fire: 30, Shock: 12, unarmed: 3 });
  });

  it('never leaks another player\'s counters', async () => {
    const store = new InMemoryReadStore(counterSeed());
    const stats = await store.getProfileStats(B);
    expect(stats!.deaths).toBe(1);
    expect(stats!.kills.by_element).toEqual({ Fire: 999 });
    expect(stats!.credits.earned).toBe(5000);
  });

  it('a player with no counter row reads zeros and a null tracking start', async () => {
    const seed = emptyReadSeed();
    seed.profiles = [profile({ id: A })];
    const stats = await new InMemoryReadStore(seed).getProfileStats(A);
    expect(stats!.deaths).toBe(0);
    expect(stats!.credits).toEqual({ earned: 0, spent: 0, since: null });
    expect(stats!.kills.by_element).toEqual({});
  });
});

describe('GET /api/profile/stats — the counters ride the shipped read', () => {
  let base = '';
  let close: () => Promise<void> = async () => undefined;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountReadRoutes(app, new InMemoryReadStore(counterSeed()), { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    close = () => new Promise<void>((r) => server.close(() => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await close(); });

  it('serves deaths, credits, and by_element in the payload', async () => {
    const res = await fetch(`${base}/api/profile/stats`, {
      headers: { authorization: `Bearer ${issueAccessToken(SECRET, A, false)}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      deaths: number;
      credits: { earned: number; spent: number; since: string | null };
      kills: { by_element: Record<string, number> };
    };
    expect(json.deaths).toBe(7);
    expect(json.credits).toEqual({
      earned: 152_300, spent: 141_900, since: '2026-11-02T12:00:00.000Z',
    });
    expect(json.kills.by_element).toEqual({ Fire: 30, Shock: 12, unarmed: 3 });
  });
});

// ─── Element accrual — the 0034 choke point, second dimension ────

const rewards = (kills: number): ChefRewardsInput => ({
  credits: 0, scrap: 0, xp: 0, fragments: 0,
  materials: {} as ChefRewardsInput['materials'], essences: {} as ChefRewardsInput['essences'], kills,
});

describe('kill element record (0051 twin) — same choke point as weapon type', () => {
  // Fixture correction (gear-truth slice): the weapons below were
  // seeded at equipped_slot 'weapon' — a slot the equip RPC can
  // never write (valid: primary/secondary/heavy/ordnance/shield/
  // classMod/relic), which is why production attributed every kill
  // to 'unarmed'. Fixtures now use the real primary slot;
  // assertions unchanged.
  it('attributes claim kills to the equipped weapon\'s element, alongside its type', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A });
    store.seedItem({
      id: 'gun-fire', owner_user_id: A, runtime_state: 'equipped', equipped_slot: 'primary',
      payload: { weaponType: 'Rifle', element: 'Fire' },
    });
    await store.applyChefRewards(A, rewards(7), 1, 'redline_circuit');
    expect(store.killStatsFor(A)).toEqual({ Rifle: 7 });
    expect(store.killElementStatsFor(A)).toEqual({ Fire: 7 });
    await store.applyChefRewards(A, rewards(7), 1, 'redline_circuit'); // replay of tick 1
    expect(store.killElementStatsFor(A)).toEqual({ Fire: 7 });
  });

  it('two elements both land when the equipped weapon changes between claims', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A });
    store.seedItem({
      id: 'gun-fire', owner_user_id: A, runtime_state: 'equipped', equipped_slot: 'primary',
      payload: { weaponType: 'Rifle', element: 'Fire' },
    });
    await store.applyChefRewards(A, rewards(5), 1, 'redline_circuit');
    // Swap the held weapon: unequip the rifle, equip a Shock pistol.
    store.seedItem({
      id: 'gun-fire', owner_user_id: A, runtime_state: 'available', equipped_slot: null,
      payload: { weaponType: 'Rifle', element: 'Fire' },
    });
    store.seedItem({
      id: 'gun-shock', owner_user_id: A, runtime_state: 'equipped', equipped_slot: 'primary',
      payload: { weaponType: 'Pistol', element: 'Shock' },
    });
    await store.applyChefRewards(A, rewards(3), 2, 'redline_circuit');
    expect(store.killElementStatsFor(A)).toEqual({ Fire: 5, Shock: 3 });
    expect(store.killStatsFor(A)).toEqual({ Rifle: 5, Pistol: 3 });
  });

  it('records unarmed in both dimensions when no weapon is equipped', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: B });
    await store.applyChefRewards(B, rewards(4), 1, 'redline_circuit');
    expect(store.killElementStatsFor(B)).toEqual({ unarmed: 4 });
    expect(store.killStatsFor(B)).toEqual({ unarmed: 4 });
  });

  it('attributes offline-settled kills by element too; a nonce replay never double-counts', async () => {
    let now = new Date('2026-11-02T12:00:00.000Z');
    const store = new InMemoryChefGameplayStore(() => now);
    store.seedProfile({ id: A });
    store.seedItem({
      id: 'gun-cryo', owner_user_id: A, runtime_state: 'equipped', equipped_slot: 'primary',
      payload: { weaponType: 'Sniper', element: 'Cryo' },
    });
    store.seedActiveAction({
      user_id: A, active_action: 'roaming_loot', target_id: 'redline_circuit',
      started_at: '2026-11-02T11:58:00.000Z', last_heartbeat_at: '2026-11-02T11:58:00.000Z',
      activity_payload: {},
    });
    await store.settleOfflineRoaming(A, 'offline-nonce-51', rewards(6));
    expect(store.killElementStatsFor(A)).toEqual({ Cryo: 6 });
    now = new Date('2026-11-02T12:05:00.000Z');
    await store.settleOfflineRoaming(A, 'offline-nonce-51', rewards(6)); // replay
    expect(store.killElementStatsFor(A)).toEqual({ Cryo: 6 });
  });
});

// ─── Death counter — recorded deaths only ─────────────────────────

const DEATH = { diedAtMs: 1_000_000, areaId: 'redline_circuit', monsterId: 'm-1', monsterName: 'Heap Mauler' };

describe('lifetime death counter (0051 twin) — first death wins', () => {
  it('increments on a recorded death, and not on a re-report of the standing death', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A });
    const first = await store.recordDeath(A, DEATH);
    expect(first.recorded).toBe(true);
    expect(store.lifetimeDeathsFor(A)).toBe(1);
    const again = await store.recordDeath(A, { ...DEATH, diedAtMs: 2_000_000, monsterName: 'Other' });
    expect(again.recorded).toBe(false);
    expect(store.lifetimeDeathsFor(A)).toBe(1);
  });

  it('the counter always equals the backfill identity: resurrections + standing death', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, credits: 100_000 });
    const resurrections = async (): Promise<number> => {
      // Count successful resurrections from the twin's own ledger —
      // the keys carry the same '<actor>:resurrect:<nonce>' shape
      // whose SQL rows the 0051 backfill counts. A failed resurrect
      // writes no row in either store, so keys = successes exactly.
      let n = 0;
      for (const key of store.ledger.keys()) {
        if (key.startsWith(`${A}:resurrect:`)) n += 1;
      }
      return n;
    };
    const standing = async (): Promise<number> => ((await store.getDeathRecord(A)) ? 1 : 0);

    await store.recordDeath(A, DEATH);
    expect(store.lifetimeDeathsFor(A)).toBe(await resurrections() + await standing());

    const revived = await store.resurrect(A, { nonce: 'death-counter-1', method: 'free', paidCost: 0, freeTimerMs: 0 });
    expect((revived as { resurrected?: boolean }).resurrected).toBe(true);
    expect(store.lifetimeDeathsFor(A)).toBe(await resurrections() + await standing());

    await store.recordDeath(A, { ...DEATH, diedAtMs: 3_000_000 });
    expect(store.lifetimeDeathsFor(A)).toBe(2);
    expect(store.lifetimeDeathsFor(A)).toBe(await resurrections() + await standing());
  });
});
