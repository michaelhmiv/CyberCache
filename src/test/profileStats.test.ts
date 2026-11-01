/**
 * Profile showcase + lifetime stats (migration 0034) — shipped-path tests.
 *
 * The laws under test:
 *  - The lifetime record is a FOLD over server records only: the
 *    verified-action ledger's result payloads, collection discovery
 *    rows, endless/dispatch/craft/service rows, consumable events,
 *    extraction state, sold listings, and the 0034 kill record. The
 *    client-mutable combat_stats surface is never read.
 *  - Every figure is proven or absent: the fold counts only what the
 *    rows say (an ACTIVE endless run proves no depth; a repair board
 *    job counts only when completed; market fees come from the
 *    buyer's accept row naming the seller, because that payload is
 *    the only place the fee exists).
 *  - Kills per weapon type accrue at ONE choke point — the roaming
 *    claim/offline-settle appliers (cc_record_kill_stats in SQL, the
 *    twin's recordKillStats here) — attributed to the weapon equipped
 *    when the claim settles, 'unarmed' when none, and never twice
 *    for one claim (the appliers' idempotency early-returns run
 *    first).
 *  - The trophy shelf is the SERVER's top-3 weapons (rarity → level
 *    → newest) as full runtime-item rows — the real instances the
 *    compositor renders. No pin choice exists in v1.
 *  - GET /api/profile/stats resolves identity from the JWT only; a
 *    query/body playerId can never name another player's record.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountReadRoutes } from '../server/reads/routes';
import {
  InMemoryReadStore, emptyReadSeed, rankShowcaseWeapons,
  type MemItem, type ProfileRowData, type ReadSeed, type RuntimeItemData,
} from '../server/reads/store';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import type { ChefRewardsInput } from '../server/gameplay/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const D = '44444444-4444-4444-8444-444444444444'; // valid id, no profile

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 60, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 3, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function richSeed(): ReadSeed {
  const seed = emptyReadSeed();
  seed.profiles = [
    profile({ id: A, legendary_cores: 1, cache_rank_tokens: 9, cache_rank_spends: { alpha: 2, beta: 3 } }),
    profile({ id: B }),
  ];
  seed.ledger = [
    // Roaming: two claims + one offline settle for A (10 + 5 + 4 kills).
    { user_id: A, action_type: 'cc_apply_chef_rewards', result_payload: { area_id: 'redline_circuit', rewards: { kills_recorded: 10 } } },
    { user_id: A, action_type: 'cc_apply_chef_rewards', result_payload: { area_id: 'ironwood_bastion', rewards: { kills_recorded: 5 } } },
    { user_id: A, action_type: 'cc_settle_offline_roaming', result_payload: { area_id: 'redline_circuit', rewards: { kills_recorded: 4 } } },
    // B's claim must never leak into A's record.
    { user_id: B, action_type: 'cc_apply_chef_rewards', result_payload: { area_id: 'redline_circuit', rewards: { kills_recorded: 999 } } },
    // Elites: two telemetry rows.
    { user_id: A, action_type: 'roaming.elite_kill', result_payload: { elite_kills: 2 } },
    { user_id: A, action_type: 'roaming.elite_kill', result_payload: { elite_kills: 3 } },
    // Bosses: 3 attempts, 2 victories (ashgut + dune_tyrant), 1 defeat.
    { user_id: A, action_type: 'cc_apply_boss_attempt', result_payload: { boss_id: 'ashgut', attempt: { victory: true } } },
    { user_id: A, action_type: 'cc_apply_boss_attempt', result_payload: { boss_id: 'ashgut', attempt: { victory: false } } },
    { user_id: A, action_type: 'cc_apply_boss_attempt', result_payload: { boss_id: 'dune_tyrant', attempt: { victory: true } } },
    // Caches: 2 forged, 1 rewarded key.
    { user_id: A, action_type: 'cc_make_item', result_payload: {} },
    { user_id: A, action_type: 'cc_make_item', result_payload: {} },
    { user_id: A, action_type: 'cc_claim_rewarded_cache_key', result_payload: {} },
    // Salvage: one Legendary (3 cores minted), one Epic.
    { user_id: A, action_type: 'cc_recycle_item', result_payload: { item: { rarity: 'Legendary' }, scrap_award: 500, cores_award: 3 } },
    { user_id: A, action_type: 'cc_recycle_item', result_payload: { item: { rarity: 'Epic' }, scrap_award: 120, cores_award: 0 } },
    // A buys once (from B, 800 cr).
    { user_id: A, action_type: 'cc_accept_listing', result_payload: { listing: { seller_user_id: B, price_credits: 800 }, market_fee: { fee_credits: 40 } } },
    // B buys from A: the 40-cr seller fee exists ONLY in this cross row.
    { user_id: B, action_type: 'cc_accept_listing', result_payload: { listing: { seller_user_id: A, price_credits: 1000 }, market_fee: { fee_credits: 40 } } },
    { user_id: A, action_type: 'cc_reforge_item', result_payload: {} },
    { user_id: A, action_type: 'cc_resurrect', result_payload: {} },
    { user_id: A, action_type: 'cc_resurrect', result_payload: {} },
  ];
  seed.listings = [
    { id: 'l1', seller_user_id: A, item_instance_id: 'i1', price_credits: 1000, status: 'sold', listed_at: '2026-10-20T00:00:00.000Z' },
    { id: 'l2', seller_user_id: A, item_instance_id: 'i2', price_credits: 2500, status: 'sold', listed_at: '2026-10-21T00:00:00.000Z' },
    { id: 'l3', seller_user_id: A, item_instance_id: 'i3', price_credits: 700, status: 'active', listed_at: '2026-10-22T00:00:00.000Z' },
  ];
  seed.discoveries = [
    { user_id: A, family: 'boss', entry_key: 'ashgut', source: 'boss_victory', discovered_at: '2026-10-30T00:00:00.000Z' },
    { user_id: A, family: 'named_elite', entry_key: 'redline_circuit', source: 'elite_kill', discovered_at: '2026-10-30T00:00:00.000Z' },
    { user_id: A, family: 'legendary_effect', entry_key: 'salvage_rights', source: 'boss_loot', discovered_at: '2026-10-30T00:00:00.000Z' },
    { user_id: A, family: 'weapon_frame', entry_key: 'Shotgun:BlastForge', source: 'boss_loot', discovered_at: '2026-10-30T00:00:00.000Z' },
    { user_id: A, family: 'weapon_frame', entry_key: 'Sniper:Prismatek', source: 'roaming_drop', discovered_at: '2026-10-30T00:00:00.000Z' },
  ];
  seed.endlessRuns = [
    { user_id: A, status: 'active', depth_reached: 99 }, // proves nothing yet
    { user_id: A, status: 'died', depth_reached: 12 },
    { user_id: A, status: 'banked', depth_reached: 7 },
    { user_id: A, status: 'abandoned', depth_reached: 3 },
  ];
  seed.dispatchMissions = [
    { user_id: A, contract_family: 'foot', status: 'settled', payout_credits: 1000, payout_fraction: 0.9 },
    { user_id: A, contract_family: 'courier', status: 'settled', payout_credits: 500, payout_fraction: null },
    { user_id: A, contract_family: 'foot', status: 'active', payout_credits: 5000, payout_fraction: 1 },
  ];
  seed.craftJobs = [
    { user_id: A, kind: 'consumable', units_completed: 12, outputs: [] },
    { user_id: A, kind: 'gear', units_completed: 3, outputs: [] },
    { user_id: A, kind: 'repair', units_completed: 2, outputs: [{ pointsRestored: 30 }, { pointsRestored: 45 }] },
  ];
  seed.serviceJobs = [
    { provider_user_id: A, status: 'completed', points_restored: 120, paid_credits: 900 },
    { provider_user_id: A, status: 'completed', points_restored: 30, paid_credits: 200 },
    { provider_user_id: A, status: 'open', points_restored: 999, paid_credits: 999 },
  ];
  seed.consumableEvents = [
    { user_id: A, consumable_type: 'stim_pack', quantity_delta: -3, event_type: 'used' },
    { user_id: A, consumable_type: 'stim_pack', quantity_delta: -2, event_type: 'used' },
    { user_id: A, consumable_type: 'rage_serum', quantity_delta: -1, event_type: 'used' },
    { user_id: A, consumable_type: 'stim_pack', quantity_delta: 5, event_type: 'crafted' },
    { user_id: A, consumable_type: 'stim_pack', quantity_delta: 4, event_type: 'used' }, // positive 'used' delta is not a use
  ];
  seed.extractionStates = [{ user_id: A, finalized_passes: 4, total_xp_awarded: 2600 }];
  seed.killStats = [
    { user_id: A, weapon_type: 'Sniper', kills: 40 },
    { user_id: A, weapon_type: 'Pistol', kills: 15 },
    { user_id: B, weapon_type: 'Sniper', kills: 999 },
  ];
  const item = (over: Partial<MemItem> & { id: string }): MemItem => ({
    owner_user_id: A, kind: 'weapon', item_level: 1, rarity: 'Common', is_locked: false,
    runtime_state: 'available', equipped_slot: null, payload: {},
    created_at: '2026-10-01T00:00:00.000Z', ...over,
  });
  seed.items = [
    item({ id: 'w-old-legendary', rarity: 'Legendary', item_level: 40, created_at: '2026-10-02T00:00:00.000Z', payload: { weaponType: 'Sniper' } }),
    item({ id: 'w-new-legendary', rarity: 'Legendary', item_level: 40, created_at: '2026-10-05T00:00:00.000Z', payload: { weaponType: 'Pistol' } }),
    item({ id: 'w-epic', rarity: 'Epic', item_level: 60, payload: { weaponType: 'Rifle' } }),
    item({ id: 'w-rare', rarity: 'Rare', item_level: 10, payload: { weaponType: 'Shotgun' } }),
    item({ id: 'a-legendary', kind: 'armor', rarity: 'Legendary', item_level: 99 }),
  ];
  return seed;
}

describe('profile lifetime fold — server records only', () => {
  it('folds every section from the seeded records, and nothing from anyone else', async () => {
    const store = new InMemoryReadStore(richSeed());
    const stats = await store.getProfileStats(A);
    expect(stats).not.toBeNull();
    const s = stats!;

    expect(s.kills.roaming).toBe(19);
    expect(s.kills.by_area).toEqual({ redline_circuit: 14, ironwood_bastion: 5 });
    expect(s.kills.by_weapon_type).toEqual({ Sniper: 40, Pistol: 15 });
    expect(s.kills.elites).toBe(5);
    expect(s.kills.named_elites_downed).toBe(1);

    expect(s.bosses).toEqual({ attempts: 3, victories: 2, by_boss: { ashgut: 1, dune_tyrant: 1 }, downed: 1 });

    // The active depth-99 run proves nothing: best depth is the died run's 12.
    expect(s.endless).toEqual({ runs: 3, best_depth: 12, deaths: 1, banked: 1, abandoned: 1 });

    // Cores: minted 3, balance 1 → spent 2.
    expect(s.legendaries.salvaged).toBe(1);
    expect(s.legendaries.cores_minted).toBe(3);
    expect(s.legendaries.cores_spent).toBe(2);
    expect(s.legendaries.cores_balance).toBe(1);
    expect(s.legendaries.discoveries_by_source).toEqual({ boss_loot: 2, roaming_drop: 1 });

    expect(s.caches).toEqual({ opened: 2, rewarded_keys: 1 });
    expect(s.crafting).toEqual({ total_units: 17, units_by_kind: { consumable: 12, gear: 3, repair: 2 } });
    expect(s.consumables.used_total).toBe(6);
    expect(s.consumables.top_used).toEqual([
      { type: 'stim_pack', count: 5 },
      { type: 'rage_serum', count: 1 },
    ]);
    expect(s.repair).toEqual({
      board_points_restored: 150, board_jobs_completed: 2, board_credits_earned: 1100,
      self_points_restored: 75, self_jobs: 1,
    });
    // Dispatch credits recompute the settler's floor(payout × fraction).
    expect(s.dispatch).toEqual({ completed: 2, foot: 1, courier: 1, credits_earned: 1400 });
    expect(s.extraction).toEqual({ passes: 4, xp_awarded: 2600 });

    // Sales from A's sold listings; the fee from B's accept row naming A.
    expect(s.market).toEqual({ sales: 2, sales_volume: 3500, fees_paid: 40, purchases: 1, purchases_volume: 800 });
    expect(s.salvage).toEqual({ items: 2, scrap_earned: 620 });
    expect(s.reforges).toBe(1);
    expect(s.resurrections).toBe(2);
    expect(s.collections).toEqual({
      discovered: 5,
      by_family: { boss: 1, named_elite: 1, legendary_effect: 1, weapon_frame: 2 },
    });

    expect(s.showcase.best_endless_depth).toBe(12);
    expect(s.showcase.cache_rank_tokens).toBe(9);
    expect(s.showcase.cache_rank_total_ranks).toBe(5);
    expect(s.showcase.collections_discovered).toBe(5);
    // Rarity beats level; equal rarity+level breaks on newest first;
    // the Legendary ARMOR never shelves (weapons only).
    expect(s.showcase.top_weapons.map((w) => w.id)).toEqual(['w-new-legendary', 'w-old-legendary', 'w-epic']);
  });

  it('returns null for a player with no profile', async () => {
    const store = new InMemoryReadStore(richSeed());
    expect(await store.getProfileStats(D)).toBeNull();
  });

  it('an empty record folds to zeros, never to guesses', async () => {
    const seed = emptyReadSeed();
    seed.profiles = [profile({ id: A })];
    const stats = await new InMemoryReadStore(seed).getProfileStats(A);
    expect(stats!.kills.roaming).toBe(0);
    expect(stats!.kills.by_weapon_type).toEqual({});
    expect(stats!.endless.best_depth).toBe(0);
    expect(stats!.legendaries.cores_spent).toBe(0);
    expect(stats!.showcase.top_weapons).toEqual([]);
  });
});

describe('rankShowcaseWeapons — rarity, then level, then newest', () => {
  const weapon = (over: Partial<RuntimeItemData> & { id: string }): RuntimeItemData => ({
    owner_user_id: A, kind: 'weapon', item_level: null, rarity: 'Common', is_locked: false,
    runtime_state: 'available', equipped_slot: null, payload: {},
    created_at: '2026-10-01T00:00:00.000Z', ...over,
  } as RuntimeItemData);

  it('falls back to payload.level when the column is null, and caps at the limit', () => {
    const ranked = rankShowcaseWeapons([
      weapon({ id: 'a', rarity: 'Rare', payload: { level: 30 } }),
      weapon({ id: 'b', rarity: 'Rare', payload: { level: 12 } }),
      weapon({ id: 'c', rarity: 'Epic', payload: { level: 1 } }),
      weapon({ id: 'd', rarity: 'Common', item_level: 99 }),
      weapon({ id: 'e', kind: 'shield', rarity: 'Legendary', item_level: 99 }),
    ]);
    expect(ranked.map((w) => w.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('GET /api/profile/stats — JWT identity only', () => {
  let base = '';
  let close: () => Promise<void> = async () => undefined;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountReadRoutes(app, new InMemoryReadStore(richSeed(), () => new Date('2026-10-31T12:00:00.000Z')), { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    close = () => new Promise<void>((r) => server.close(() => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tokens[A] = issueAccessToken(SECRET, A, false);
    tokens[D] = issueAccessToken(SECRET, D, false);
  });
  afterAll(async () => { await close(); });

  it('serves the caller their folded record', async () => {
    const res = await fetch(`${base}/api/profile/stats`, { headers: { authorization: `Bearer ${tokens[A]}` } });
    expect(res.status).toBe(200);
    const json = await res.json() as { kills: { roaming: number }; showcase: { top_weapons: Array<{ id: string }> } };
    expect(json.kills.roaming).toBe(19);
    expect(json.showcase.top_weapons.map((w) => w.id)).toEqual(['w-new-legendary', 'w-old-legendary', 'w-epic']);
  });

  it('a query playerId can never name another player\'s record', async () => {
    const res = await fetch(`${base}/api/profile/stats?playerId=${B}`, { headers: { authorization: `Bearer ${tokens[A]}` } });
    expect(res.status).toBe(200);
    const json = await res.json() as { kills: { roaming: number } };
    expect(json.kills.roaming).toBe(19); // A's record, not B's 999-kill claim
  });

  it('404s for a token whose profile does not exist; 401s without a token', async () => {
    const missing = await fetch(`${base}/api/profile/stats`, { headers: { authorization: `Bearer ${tokens[D]}` } });
    expect(missing.status).toBe(404);
    const anon = await fetch(`${base}/api/profile/stats`);
    expect(anon.status).toBe(401);
  });
});

// ─── The 0034 kill record — gameplay twin choke point ──────────────

const rewards = (kills: number): ChefRewardsInput => ({
  credits: 0, scrap: 0, xp: 0, fragments: 0,
  materials: {} as ChefRewardsInput['materials'], essences: {} as ChefRewardsInput['essences'], kills,
});

describe('kill record (0034 twin) — claim + offline settle appliers', () => {
  it('attributes claim kills to the equipped weapon; a tick replay never double-counts', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A });
    store.seedItem({
      id: 'gun-1', owner_user_id: A, runtime_state: 'equipped', equipped_slot: 'weapon',
      payload: { weaponType: 'Sniper' },
    });
    await store.applyChefRewards(A, rewards(7), 1, 'redline_circuit');
    expect(store.killStatsFor(A)).toEqual({ Sniper: 7 });
    await store.applyChefRewards(A, rewards(7), 1, 'redline_circuit'); // replay of tick 1
    expect(store.killStatsFor(A)).toEqual({ Sniper: 7 });
    await store.applyChefRewards(A, rewards(3), 2, 'redline_circuit');
    expect(store.killStatsFor(A)).toEqual({ Sniper: 10 });
  });

  it('records unarmed when no weapon is equipped', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: B });
    await store.applyChefRewards(B, rewards(4), 1, 'redline_circuit');
    expect(store.killStatsFor(B)).toEqual({ unarmed: 4 });
  });

  it('attributes offline-settled kills too; a nonce replay never double-counts', async () => {
    let now = new Date('2026-10-31T12:00:00.000Z');
    const store = new InMemoryChefGameplayStore(() => now);
    store.seedProfile({ id: A });
    store.seedItem({
      id: 'gun-2', owner_user_id: A, runtime_state: 'equipped', equipped_slot: 'weapon',
      payload: { weaponType: 'Pistol' },
    });
    store.seedActiveAction({
      user_id: A, active_action: 'roaming_loot', target_id: 'redline_circuit',
      started_at: '2026-10-31T11:58:00.000Z', last_heartbeat_at: '2026-10-31T11:58:00.000Z',
      activity_payload: {},
    });
    await store.settleOfflineRoaming(A, 'offline-nonce-1', rewards(6));
    expect(store.killStatsFor(A)).toEqual({ Pistol: 6 });
    now = new Date('2026-10-31T12:05:00.000Z');
    await store.settleOfflineRoaming(A, 'offline-nonce-1', rewards(6)); // replay
    expect(store.killStatsFor(A)).toEqual({ Pistol: 6 });
  });

  it('zero-kill claims record nothing', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A });
    await store.applyChefRewards(A, rewards(0), 1, 'redline_circuit');
    expect(store.killStatsFor(A)).toEqual({});
  });
});
