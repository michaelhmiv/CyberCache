import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountReadRoutes } from '../server/reads/routes';
import {
  InMemoryReadStore, emptyReadSeed,
  type ProgressionSnapshotData, type ProfileRowData, type ReadSeed,
} from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const NOW = new Date('2026-10-29T12:00:00Z');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444'; // valid id, no data anywhere

function profile(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 1, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2026-10-01T00:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-10-28T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: null,
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0,
    ...overrides,
  };
}

let snapId = 0;
function snap(overrides: Partial<ProgressionSnapshotData> & { player_id: string; snapshot_at: string }): ProgressionSnapshotData {
  snapId += 1;
  return {
    id: snapId, source: 'daily', snapshot_version: 1, level: null, xp: null, credits: null,
    scrap: null, total_kills: null, total_deaths: null, net_worth: null, total_items: null,
    weapons_owned: null, legendary_items: null, highest_item_level: null, total_mastery_xp: null,
    highest_mastery_level: null, highest_boss_tier: null, active_action: null, metadata: {},
    ...overrides,
  };
}

function seed(): ReadSeed {
  const s = emptyReadSeed();
  s.profiles = [
    profile({
      id: A, username: 'alpha_hunter', display_name: 'Alpha', player_level: 10, player_xp: 2000,
      credits: 700, scrap: 55, email: 'alpha@example.com', username_updated_at: '2026-10-20T00:00:00.000Z',
    }),
    profile({
      id: B, username: 'bravo_hunter', display_name: 'Bravo', player_level: 12, player_xp: 3000,
      credits: 900, scrap: 80, email: 'bravo@example.com',
    }),
    profile({ id: C, username: 'charlie', display_name: null, player_level: 4, player_xp: 500 }),
  ];
  s.snapshots = [
    snap({ player_id: A, snapshot_at: '2026-10-01T00:00:00.000Z', xp: 1000, total_kills: 100, total_deaths: 50, level: 8, net_worth: 2000 }),
    snap({ player_id: A, snapshot_at: '2026-10-25T00:00:00.000Z', source: 'manual', xp: 1500, total_kills: 200, total_deaths: 55, level: 9, net_worth: 3500 }),
    snap({ player_id: A, snapshot_at: '2026-10-28T00:00:00.000Z', xp: 2000, total_kills: 300, total_deaths: 60, level: 10, net_worth: 5000 }),
    snap({ player_id: B, snapshot_at: '2026-10-28T00:00:00.000Z', xp: 3000, total_kills: 150, total_deaths: 0, level: 12, net_worth: 8000 }),
    snap({ player_id: C, snapshot_at: '2026-10-27T00:00:00.000Z', xp: 500, total_kills: 20, total_deaths: 2, level: 4, net_worth: 900 }),
  ];
  s.masteryDefinitions = [
    { id: 'slayer', category: 'combat', label: 'Slayer', is_ranked: true, is_active: true },
    { id: 'scavenger', category: 'economy', label: 'Scavenger', is_ranked: true, is_active: true },
    { id: 'secret', category: 'combat', label: 'Secret', is_ranked: false, is_active: true },
    { id: 'retired', category: 'combat', label: 'Retired', is_ranked: true, is_active: false },
  ];
  s.playerMasteries = [
    { user_id: A, mastery_id: 'slayer', mastery_xp: 500, mastery_level: 5 },
    { user_id: A, mastery_id: 'scavenger', mastery_xp: 100, mastery_level: 2 },
    { user_id: B, mastery_id: 'slayer', mastery_xp: 900, mastery_level: 7 },
    { user_id: C, mastery_id: 'slayer', mastery_xp: 900, mastery_level: 7 },
  ];
  s.combatStats = [
    {
      user_id: A, total_kills: 300, total_deaths: 60, longest_kill_streak: 12, highest_boss_tier: 3,
      active_play_seconds: 3600, idle_play_seconds: 7200,
      kills_by_area: { rust_flats: 200 }, kills_by_weapon_type: {}, kills_by_element: {},
    },
    {
      user_id: B, total_kills: 150, total_deaths: 30, longest_kill_streak: 4, highest_boss_tier: 1,
      active_play_seconds: 60, idle_play_seconds: 60,
      kills_by_area: {}, kills_by_weapon_type: {}, kills_by_element: {},
    },
  ];
  s.netWorth = { [A]: 5000, [B]: 8000 };
  s.items = [
    // Weapon payloads carry the full combat number set, as every real
    // stored weapon does — the CONS-04 counting rule (migration 0040)
    // excludes payload-sparse weapon rows as bootstrap phantoms.
    { id: 'item-a1', owner_user_id: A, kind: 'weapon', item_level: 40, rarity: 'Legendary', is_locked: false, runtime_state: 'available', equipped_slot: 'primary', payload: { name: 'A Rifle', weaponType: 'Rifle', baseDamage: 300, attackSpeed: 2.5, critChance: 0.2, critDamage: 1.8, combatPower: 200, bossPower: 120, farmPower: 90 }, created_at: '2026-10-20T00:00:00.000Z' },
    { id: 'item-a2', owner_user_id: A, kind: 'shield', item_level: 10, rarity: 'Rare', is_locked: false, runtime_state: 'available', equipped_slot: null, payload: {}, created_at: '2026-10-21T00:00:00.000Z' },
    { id: 'item-a3', owner_user_id: A, kind: 'weapon', item_level: 5, rarity: 'Common', is_locked: false, runtime_state: 'salvaged', equipped_slot: null, payload: { weaponType: 'Pistol', baseDamage: 40, attackSpeed: 1.8, critChance: 0.08, critDamage: 1.4, combatPower: 30, bossPower: 15, farmPower: 12 }, created_at: '2026-10-19T00:00:00.000Z' },
    { id: 'item-a4', owner_user_id: A, kind: 'relic', item_level: 15, rarity: 'Epic', is_locked: false, runtime_state: 'listed', equipped_slot: null, payload: {}, created_at: '2026-10-22T00:00:00.000Z' },
    { id: 'item-b1', owner_user_id: B, kind: 'weapon', item_level: 20, rarity: 'Epic', is_locked: false, runtime_state: 'listed', equipped_slot: null, payload: { name: 'B Rifle' }, created_at: '2026-10-18T00:00:00.000Z' },
    { id: 'item-b2', owner_user_id: B, kind: 'shield', item_level: 8, rarity: 'Common', is_locked: true, runtime_state: 'available', equipped_slot: null, payload: {}, created_at: '2026-10-23T00:00:00.000Z' },
  ];
  s.listings = [
    { id: 'listing-1', seller_user_id: B, item_instance_id: 'item-b1', price_credits: 1500, status: 'active', listed_at: '2026-10-25T00:00:00.000Z' },
    { id: 'listing-2', seller_user_id: A, item_instance_id: 'item-a4', price_credits: 2500, status: 'active', listed_at: '2026-10-26T00:00:00.000Z' },
    { id: 'listing-3', seller_user_id: A, item_instance_id: 'item-a3', price_credits: 100, status: 'sold', listed_at: '2026-10-24T00:00:00.000Z' },
  ];
  return s;
}

describe('InMemoryReadStore semantics (mirror of the ported SQL)', () => {
  const store = new InMemoryReadStore(seed(), () => NOW);

  it('leaderboard uses the latest in-window snapshot and prior-window trend', async () => {
    const board = await store.getLeaderboard('xp', 'weekly', 100);
    expect(board.map((e) => [e.player_id, e.value, e.rank])).toEqual([
      [B, 3000, 1], [A, 2000, 2], [C, 500, 3],
    ]);
    const a = board.find((e) => e.player_id === A)!;
    expect(a.previous_value).toBe(1000);
    expect(a.trend).toBe(1);
    expect(board.find((e) => e.player_id === B)!.previous_value).toBeNull();
  });

  it('all_time has no prior window, so previous values are null', async () => {
    const board = await store.getLeaderboard('xp', 'all_time', 100);
    expect(board.every((e) => e.previous_value === null && e.trend === 0)).toBe(true);
  });

  it('kdr excludes players whose latest snapshot has zero deaths', async () => {
    const board = await store.getLeaderboard('kdr', 'weekly', 100);
    expect(board.map((e) => e.player_id)).toEqual([C, A]);
    expect(board[0].value).toBe(10);
    expect(board[1].value).toBe(5);
  });

  it('my rank reports board totals; unknown players have no rank', async () => {
    await expect(store.getMyLeaderboardRank(A, 'xp', 'weekly')).resolves.toEqual({
      rank: 2, value: 2000, previous_value: 1000, trend: 1, total_players: 3,
    });
    await expect(store.getMyLeaderboardRank(D, 'xp', 'weekly')).resolves.toBeNull();
  });

  it('mastery summary is caller-scoped and globally ranked', async () => {
    const summary = await store.getMyMasterySummary(A);
    expect(summary.map((r) => [r.mastery_id, r.rank])).toEqual([['slayer', 3], ['scavenger', 1]]);
    const bSummary = await store.getMyMasterySummary(B);
    expect(bSummary.map((r) => r.mastery_id)).toEqual(['slayer']);
  });

  it('mastery leaderboard shares ranks on ties and hides unranked/inactive masteries', async () => {
    const board = await store.getMasteryLeaderboard('slayer', 25);
    expect(board.map((r) => [r.user_id, r.rank, r.display_name])).toEqual([
      [B, 1, 'Bravo'], [C, 1, 'charlie'], [A, 3, 'Alpha'],
    ]);
    await expect(store.getMasteryLeaderboard('secret', 25)).resolves.toEqual([]);
    await expect(store.getMasteryLeaderboard('retired', 25)).resolves.toEqual([]);
  });

  it('username availability mirrors validation, reservations, and taken names', async () => {
    await expect(store.isUsernameAvailable('alpha_hunter')).resolves.toBe(false);
    await expect(store.isUsernameAvailable('ALPHA_HUNTER')).resolves.toBe(false);
    await expect(store.isUsernameAvailable('admin')).resolves.toBe(false);
    await expect(store.isUsernameAvailable('ab')).resolves.toBe(false);
    await expect(store.isUsernameAvailable('bad name!')).resolves.toBe(false);
    await expect(store.isUsernameAvailable('new_hunter-1')).resolves.toBe(true);
    await expect(store.isUsernameAvailable('  padded_name  ')).resolves.toBe(true);
  });

  it('public stats aggregate items and masteries like the view', async () => {
    const stats = await store.getPublicStats(A);
    expect(stats).toMatchObject({
      total_items: 4, weapons_owned: 2, legendary_items: 1, highest_item_level: 40,
      total_mastery_xp: 600, highest_mastery_level: 5, net_worth: 5000,
      total_kills: 300, total_deaths: 60, kill_death_ratio: 5,
    });
  });
});

describe('read routes (HTTP)', () => {
  let base = '';
  let server: ReturnType<typeof express.application.listen>;
  const tokenA = issueAccessToken(SECRET, A, false);
  const tokenB = issueAccessToken(SECRET, B, false);
  const tokenD = issueAccessToken(SECRET, D, false);

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountReadRoutes(app, new InMemoryReadStore(seed(), () => NOW), { jwtSecret: SECRET });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function get(path: string, token?: string) {
    const res = await fetch(`${base}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, json: res.status === 204 ? null : await res.json() };
  }

  const PROTECTED = [
    '/api/profile/me', '/api/profile/summary', '/api/progression/snapshots',
    '/api/mastery/summary', '/api/mastery/leaderboard?masteryId=slayer',
    '/api/leaderboard?metric=xp', '/api/leaderboard/me?metric=xp',
    `/api/players/${B}/public-profile`, '/api/stats/me', `/api/players/${B}/public-stats`,
    '/api/usernames/availability?username=x', '/api/market/listings', '/api/runtime/items',
    '/api/market/price-stats?keys=mat:ScrapAlloy', '/api/caches/me',
  ];

  it('every route requires a valid Chef token (none, garbage, and expired all 401)', async () => {
    const expired = issueAccessToken(SECRET, A, false, new Date(Date.now() - 2 * 60 * 60 * 1000));
    for (const path of PROTECTED) {
      expect((await get(path)).status, `no token: ${path}`).toBe(401);
      expect((await get(path, 'garbage.token.here')).status, `garbage: ${path}`).toBe(401);
      expect((await get(path, expired)).status, `expired: ${path}`).toBe(401);
    }
  });

  it('profile/me returns only the caller\'s row — a ?playerId for someone else is ignored', async () => {
    const mine = await get('/api/profile/me', tokenA);
    expect(mine.status).toBe(200);
    expect(mine.json.id).toBe(A);
    expect(mine.json.email).toBe('alpha@example.com');

    const spoof = await get(`/api/profile/me?playerId=${B}`, tokenA);
    expect(spoof.status).toBe(200);
    expect(spoof.json.id).toBe(A);
    expect(spoof.json.email).toBe('alpha@example.com');

    const other = await get('/api/profile/me', tokenB);
    expect(other.json.id).toBe(B);

    expect((await get('/api/profile/me', tokenD)).status).toBe(404);
  });

  it('public profile exposes the public subset only — no wallet or account fields', async () => {
    const res = await get(`/api/players/${B}/public-profile`, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.player_id).toBe(B);
    expect(res.json.level).toBe(12);
    expect(res.json.net_worth).toBe(8000);
    for (const forbidden of ['credits', 'scrap', 'email', 'boss_state', 'cache_tokens', 'materials']) {
      expect(res.json).not.toHaveProperty(forbidden);
    }
    expect((await get('/api/players/not-a-uuid/public-profile', tokenA)).status).toBe(400);
    expect((await get(`/api/players/${D}/public-profile`, tokenA)).status).toBe(404);
  });

  it('public stats returns exactly the player_public_stats field set', async () => {
    const res = await get(`/api/players/${B}/public-stats`, tokenA);
    expect(res.status).toBe(200);
    expect(Object.keys(res.json).sort()).toEqual([
      'active_play_seconds', 'cache_token_parts', 'cache_tokens', 'credits', 'display_name',
      'highest_boss_tier', 'highest_item_level', 'highest_mastery_level', 'idle_play_seconds',
      'joined_at', 'kill_death_ratio', 'kills_by_area', 'kills_by_element', 'kills_by_weapon_type',
      'last_active_at', 'legendary_items', 'longest_kill_streak', 'net_worth', 'player_level',
      'player_xp', 'scrap', 'total_deaths', 'total_items', 'total_kills', 'total_mastery_xp',
      'user_id', 'username', 'weapons_owned',
    ]);
    expect(res.json.credits).toBe(900); // exposed by cc_public_stats today — mirrored, not widened
  });

  it('own snapshots are caller-scoped and honor source/since/limit filters', async () => {
    const all = await get('/api/progression/snapshots', tokenA);
    expect(all.json.map((s: { snapshot_at: string }) => s.snapshot_at)).toEqual([
      '2026-10-01T00:00:00.000Z', '2026-10-25T00:00:00.000Z', '2026-10-28T00:00:00.000Z',
    ]);
    const daily = await get('/api/progression/snapshots?source=daily', tokenA);
    expect(daily.json).toHaveLength(2);
    const since = await get('/api/progression/snapshots?since=2026-10-20T00:00:00.000Z', tokenA);
    expect(since.json).toHaveLength(2);
    const limited = await get('/api/progression/snapshots?limit=1', tokenA);
    expect(limited.json).toHaveLength(1);
    const bView = await get('/api/progression/snapshots', tokenB);
    expect(bView.json.every((s: { player_id: string }) => s.player_id === B)).toBe(true);
  });

  it('leaderboard validates metric/period and ranks; /me is caller-scoped', async () => {
    const board = await get('/api/leaderboard?metric=xp&period=weekly', tokenA);
    expect(board.status).toBe(200);
    expect(board.json.map((e: { player_id: string }) => e.player_id)).toEqual([B, A, C]);
    expect((await get('/api/leaderboard?metric=bogus', tokenA)).status).toBe(400);
    expect((await get('/api/leaderboard?metric=xp&period=bogus', tokenA)).status).toBe(400);

    const mine = await get('/api/leaderboard/me?metric=xp&period=weekly', tokenA);
    expect(mine.json).toEqual({ rank: 2, value: 2000, previous_value: 1000, trend: 1, total_players: 3 });
    expect((await get('/api/leaderboard/me?metric=xp&period=weekly', tokenD)).status).toBe(404);
  });

  it('mastery routes: summary is the caller\'s, leaderboard is public', async () => {
    const summary = await get('/api/mastery/summary', tokenB);
    expect(summary.json.map((r: { mastery_id: string }) => r.mastery_id)).toEqual(['slayer']);
    const board = await get('/api/mastery/leaderboard?masteryId=slayer', tokenA);
    expect(board.json).toHaveLength(3);
    expect((await get('/api/mastery/leaderboard', tokenA)).status).toBe(400);
  });

  it('market listings show active listings from all sellers, newest first, sold excluded', async () => {
    const res = await get('/api/market/listings', tokenA);
    expect(res.status).toBe(200);
    // 0019: the browse response is a page object ({ listings, total }),
    // not a bare array — filtering/sorting/pagination are server-side.
    expect(res.json.total).toBe(2);
    expect(res.json.listings.map((l: { id: string }) => l.id)).toEqual(['listing-2', 'listing-1']);
    const foreign = res.json.listings.find((l: { id: string }) => l.id === 'listing-1');
    expect(foreign.seller_user_id).toBe(B);
    expect(foreign.item_instances.id).toBe('item-b1');
    expect(foreign.price_credits).toBe(1500);
  });

  it('runtime items are caller-scoped and exclude salvaged/consumed/listed', async () => {
    const res = await get('/api/runtime/items', tokenA);
    expect(res.json.map((i: { id: string }) => i.id)).toEqual(['item-a2', 'item-a1']);
    const bRes = await get('/api/runtime/items', tokenB);
    expect(bRes.json.map((i: { id: string }) => i.id)).toEqual(['item-b2']);
  });

  it('profile summary and stats/me are caller-scoped', async () => {
    const summary = await get('/api/profile/summary', tokenA);
    expect(summary.json).toEqual({
      user_id: A, username: 'alpha_hunter', display_name: 'Alpha', account_type: 'verified',
      has_username: true, username_updated_at: '2026-10-20T00:00:00.000Z',
      can_rename_at: '2026-10-27T00:00:00.000Z',
    });
    const stats = await get('/api/stats/me', tokenA);
    expect(stats.json.user_id).toBe(A);
    expect(stats.json.total_kills).toBe(300);
    expect((await get('/api/stats/me', tokenD)).status).toBe(404);
  });

  it('username availability over HTTP', async () => {
    expect((await get('/api/usernames/availability?username=alpha_hunter', tokenA)).json.available).toBe(false);
    expect((await get('/api/usernames/availability?username=fresh_name', tokenA)).json.available).toBe(true);
    expect((await get('/api/usernames/availability', tokenA)).status).toBe(400);
  });
});
