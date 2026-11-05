/**
 * Activity Log read (AL-2) — through the mounted read route.
 *
 * The seeded history is one player's story told by the verified
 * ledger + the domain rows AL-1 stamps: a while-away settlement
 * (kills lumped, earnings marked away-era), a roaming claim with a
 * stamped drop standing beside it, a boss kill whose loot is
 * explained by the boss record (never double-listed), a cache
 * opening, a sale whose fee/buyer live only in the BUYER's accept
 * row, a player purchase (the bought item's old roam stamp must
 * NOT turn it into the buyer's drop), a pre-stamp veteran item
 * with no receipt, and the craft / dispatch / endless settlements.
 * Another player's JWT must see none of it.
 */
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountReadRoutes } from '../server/reads/routes';
import {
  InMemoryReadStore, emptyReadSeed,
  type MemItem, type MemListing, type ProfileRowData, type ReadSeed,
} from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111'; // the hunter under test
const B = '22222222-2222-4222-8222-222222222222'; // counterparty / other player
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
    ...over,
  } as ProfileRowData;
}

function item(over: Partial<MemItem> & { id: string; owner_user_id: string }): MemItem {
  return {
    kind: 'weapon', item_level: 10, rarity: 'Rare', is_locked: false,
    runtime_state: {}, equipped_slot: null, payload: {}, created_at: '2026-10-30T00:00:00.000Z',
    ...over,
  } as MemItem;
}

function seed(): ReadSeed {
  const s = emptyReadSeed();
  s.profiles = [
    profile({ id: A, username: 'ash_hunter', display_name: 'Ash' }),
    profile({ id: B, username: 'blaze_runner', display_name: 'Blaze' }),
  ];

  s.items = [
    // Ambient roam drop beside the claim — AL-1 stamped, relation engaged.
    item({
      id: 'item-roam-drop', owner_user_id: A, item_level: 25, created_at: '2026-10-30T10:00:00.000Z',
      payload: {
        id: 'item-roam-drop', name: 'Acid Crimson Scatter', weaponType: 'shotgun', rarity: 'Rare', level: 25,
        foundVia: 'roam', foundContext: 'dustwaste_frontier',
        foundEnemy: { id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' },
        dropOdds: { gearChance: 0.26, kind: 'weapon', luck: 0.1 },
      },
    }),
    // While-away drop stamped by the offline grant.
    item({
      id: 'item-offline-drop', owner_user_id: A, kind: 'shield', item_level: 18, created_at: '2026-10-30T08:00:00.000Z',
      payload: {
        id: 'item-offline-drop', name: 'Offline Find', rarity: 'Rare', level: 18,
        foundVia: 'offline', foundContext: 'dustwaste_frontier',
        dropOdds: { gearChance: 0.22, kind: 'shield' },
      },
    }),
    // Boss loot — explained by the boss record, never double-listed.
    item({
      id: 'item-bossloot', owner_user_id: A, item_level: 30, rarity: 'Legendary', created_at: '2026-10-30T11:00:00.000Z',
      payload: {
        id: 'item-bossloot', name: 'Tyrant Fang', weaponType: 'pistol', rarity: 'Legendary', level: 30,
        foundVia: 'boss', foundContext: 'dune_tyrant',
        foundEnemy: { id: 'dune_tyrant', name: 'Dune Tyrant', relation: 'killed' },
        dropOdds: { dedicatedChance: 0.11, dedicatedHit: true, dropLuckBonus: 0.25 },
      },
    }),
    // Cache product — explained by the cache record (cc_make_item embed).
    item({
      id: 'item-cache', owner_user_id: A, item_level: 40, rarity: 'Legendary', created_at: '2026-10-30T12:00:00.000Z',
      payload: { id: 'item-cache', name: 'Surging Throwtech Longshot', weaponType: 'sniper', rarity: 'Legendary', level: 40 },
    }),
    // Player-bought — carries the ORIGINAL hunter's roam stamp, but for
    // the buyer it is a market record, never a drop.
    item({
      id: 'item-bought', owner_user_id: A, item_level: 25, rarity: 'Epic', created_at: '2026-10-29T09:00:00.000Z',
      payload: {
        id: 'item-bought', name: 'Bought Blaster', weaponType: 'pistol', rarity: 'Epic', level: 25,
        foundVia: 'roam', foundContext: 'dustwaste_frontier',
        foundEnemy: { id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' },
        dropOdds: { gearChance: 0.3, kind: 'weapon' },
      },
    }),
    // Pre-stamp veteran item — no receipt fields anywhere. Honest record.
    item({
      id: 'item-prestamp', owner_user_id: A, item_level: 12, rarity: 'Epic', created_at: '2026-10-29T08:00:00.000Z',
      payload: { id: 'item-prestamp', name: 'Old Gun', weaponType: 'pistol', rarity: 'Epic', level: 12 },
    }),
    // Crafted — explained by the craft record.
    item({
      id: 'item-crafted', owner_user_id: A, item_level: 5, created_at: '2026-10-30T09:30:00.000Z',
      payload: { id: 'item-crafted', name: 'Forged Blade', weaponType: 'sword', rarity: 'Rare', level: 5, origin: 'crafted', craftedBy: A },
    }),
    // B's own drop — isolation evidence.
    item({
      id: 'item-b', owner_user_id: B, item_level: 9, created_at: '2026-10-30T10:30:00.000Z',
      payload: {
        id: 'item-b', name: 'Blaze Prize', weaponType: 'rifle', rarity: 'Rare', level: 9,
        foundVia: 'roam', foundContext: 'dustwaste_frontier',
        foundEnemy: { id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' },
      },
    }),
  ];

  s.listings = [
    {
      id: 'listing-sold', seller_user_id: A, item_instance_id: 'item-sold',
      consumable_type: null, quantity: 1, price_credits: 7500, status: 'sold',
      listing_kind: 'gear', display_name: 'Sold Rifle', rarity: 'Rare', item_level: 18,
      listed_at: '2026-10-30T13:30:00.000Z', sold_at: '2026-10-30T14:00:00.000Z',
    } as MemListing,
    {
      id: 'listing-active', seller_user_id: A, item_instance_id: 'item-roam-drop',
      consumable_type: null, quantity: 1, price_credits: 9999, status: 'active',
      listing_kind: 'gear', display_name: 'Acid Crimson Scatter', rarity: 'Rare', item_level: 25,
      listed_at: '2026-10-30T15:00:00.000Z', sold_at: null,
    } as MemListing,
  ];

  s.activityLedger = [
    { id: 'L-settle1', user_id: A, action_type: 'cc_settle_offline_roaming', created_at: '2026-10-30T08:00:00.000Z',
      result_payload: {
        area_id: 'dustwaste_frontier', elapsed_ms: 7_200_000, cap_hours: 2, cap_reached: true,
        rewards: { credits_awarded: 300, scrap_awarded: 20, xp_awarded: 50, cache_fragments_awarded: 4, kills_recorded: 9, ticks: 2400 },
      } },
    { id: 'L-recycle1', user_id: A, action_type: 'cc_recycle_item', created_at: '2026-10-30T09:00:00.000Z',
      result_payload: { item: { id: 'item-salvaged', name: 'Worn Pistol', rarity: 'Common', level: 3 }, scrap_award: 45, cores_award: 0 } },
    { id: 'L-claim1', user_id: A, action_type: 'cc_apply_chef_rewards', created_at: '2026-10-30T10:00:00.000Z',
      result_payload: { area_id: 'dustwaste_frontier', rewards: { credits: 412, scrap: 38, xp: 96, kills_recorded: 12 } } },
    { id: 'L-boss1', user_id: A, action_type: 'cc_apply_boss_attempt', created_at: '2026-10-30T11:00:00.000Z',
      result_payload: {
        boss_id: 'dune_tyrant',
        attempt: {
          victory: true, winChance: 0.64, dedicatedChance: 0.11, dedicatedDropAwarded: true,
          dropLuckBonus: 0.25, creditsGained: 1240, creditsLost: 0, loot: ['item-bossloot'],
        },
      } },
    { id: 'L-cache1', user_id: A, action_type: 'cc_make_item', created_at: '2026-10-30T12:00:00.000Z',
      result_payload: {
        odds: { table_id: 'cache_primary_rarity', outcome: 'Legendary', roll: 9500, total_weight: 10000, odds_table_version: 3 },
        cache_quality: 0, payment: 'free',
        item: { id: 'item-cache', kind: 'weapon', rarity: 'Legendary', item_level: 40, payload: { id: 'item-cache', name: 'Surging Throwtech Longshot' } },
      } },
    { id: 'L-accept1', user_id: A, action_type: 'cc_accept_listing', created_at: '2026-10-30T13:00:00.000Z',
      result_payload: {
        listing: { id: 'listing-bought', seller_user_id: B, price_credits: 5000, item_instance_id: 'item-bought' },
        item: { id: 'item-bought', kind: 'weapon', rarity: 'Epic', item_level: 25, payload: { id: 'item-bought', name: 'Bought Blaster' } },
        market_fee: { fee_credits: 250 },
      } },
    // B bought A's listing — this row is where the seller's fee + buyer live.
    { id: 'L-accept2', user_id: B, action_type: 'cc_accept_listing', created_at: '2026-10-30T14:00:00.000Z',
      result_payload: {
        listing: { id: 'listing-sold', seller_user_id: A, price_credits: 7500, item_instance_id: 'item-sold' },
        item: { id: 'item-sold', kind: 'weapon', rarity: 'Rare', item_level: 18, payload: { id: 'item-sold', name: 'Sold Rifle' } },
        // The Chef's settlement at the base rate: fee = floor(7500 × 5%)
        // = 375, so the seller was credited 7500 − 375 = 7125.
        market_fee: { fee_credits: 375, seller_proceeds: 7125 },
      } },
    { id: 'L-vendorbuy', user_id: A, action_type: 'cc_vendor_buy', created_at: '2026-10-30T07:00:00.000Z',
      result_payload: { item_key: 'MedKit', kind: 'consumable', quantity: 2, unit_price: 250, total_price: 500 } },
    { id: 'L-resurrect', user_id: A, action_type: 'cc_resurrect', created_at: '2026-10-30T06:00:00.000Z',
      result_payload: {} },
    { id: 'L-contract', user_id: A, action_type: 'cc_claim_contract_reward', created_at: '2026-10-30T05:00:00.000Z',
      result_payload: { reward: { credits: 800 } } },
    // B's own claim — isolation evidence (999 kills must never leak to A).
    { id: 'L-claimB', user_id: B, action_type: 'cc_apply_chef_rewards', created_at: '2026-10-30T10:30:00.000Z',
      result_payload: { area_id: 'dustwaste_frontier', rewards: { credits: 5, scrap: 1, xp: 1, kills_recorded: 999 } } },
  ];

  s.activityCraftJobs = [
    { id: 'job-1', user_id: A, bench: 1, kind: 'craft', recipe_id: 'recipe_medkit', units_total: 3, units_completed: 3,
      outputs: [{ consumableType: 'MedKit', count: 3 }], xp_awarded: 120, completed_at: '2026-10-30T09:30:00.000Z' },
  ];
  s.activityDispatchMissions = [
    { id: 'mission-1', user_id: A, contract_family: 'foot', payout_credits: 1000, payout_fraction: 0.8,
      departed_at: '2026-10-30T02:00:00.000Z', settled_at: '2026-10-30T04:00:00.000Z' },
  ];
  s.activityEndlessRuns = [
    { id: 'run-1', user_id: A, status: 'banked', depth_reached: 25,
      started_at: '2026-10-29T20:00:00.000Z', ended_at: '2026-10-29T21:00:00.000Z' },
    { id: 'run-active', user_id: A, status: 'active', depth_reached: 3,
      started_at: '2026-10-30T16:00:00.000Z', ended_at: '2026-10-30T16:00:00.000Z' },
  ];
  return s;
}

interface Rec {
  id: string; kind: string; at: string; label: string; away: boolean;
  areaName?: string | null;
  kills?: { count: number } | null;
  item?: { id: string; name: string } | null;
  receipt?: { foundVia: string | null; foundEnemy: { id: string; name: string; relation: string } | null; dropOdds: Record<string, unknown> | null } | null;
  boss?: { bossName: string | null; victory: boolean; dedicatedChance: number | null; dedicatedDropAwarded: boolean | null; dropLuckBonus: number | null; loot: Array<{ id: string; name: string }> } | null;
  cache?: { outcome: string | null; oddsTableVersion: number | null; payment: string | null } | null;
  craft?: { recipeName: string | null } | null;
  market?: { direction: string; feeCredits: number | null; proceedsCredits?: number | null; counterpartyName: string | null } | null;
  settlement?: { capReached: boolean | null; ticks: number | null } | null;
}
interface Page { records: Rec[]; nextCursor: string | null }

describe('activity log read API (AL-2)', () => {
  let base = '';
  let close: () => Promise<void> = async () => undefined;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountReadRoutes(app, new InMemoryReadStore(seed()), { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    close = () => new Promise<void>((r) => server.close(() => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tokens[A] = issueAccessToken(SECRET, A, false);
    tokens[B] = issueAccessToken(SECRET, B, false);
    tokens[D] = issueAccessToken(SECRET, D, false);
  });
  afterAll(async () => { await close(); });

  async function get(path: string, who: string = A): Promise<{ status: number; body: Page & { error?: string } }> {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: res.status, body: await res.json() as Page & { error?: string } };
  }

  it('walks the full history by cursor — no repeats, no gaps, newest first', async () => {
    const full = await get('/api/activity-log/me?limit=100');
    expect(full.status).toBe(200);
    expect(full.body.records.length).toBe(19);
    expect(full.body.nextCursor).toBeNull();

    const walked: Rec[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { status: number; body: Page } = await get(`/api/activity-log/me?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(page.status).toBe(200);
      walked.push(...page.body.records);
      cursor = page.body.nextCursor;
      pages += 1;
      if (pages > 12) throw new Error('pagination did not terminate');
    } while (cursor);

    expect(pages).toBe(7);
    expect(walked.map((r) => r.id)).toEqual(full.body.records.map((r) => r.id));
    expect(new Set(walked.map((r) => r.id)).size).toBe(walked.length);
    for (let i = 1; i < walked.length; i += 1) {
      const prev = walked[i - 1]; const cur = walked[i];
      expect(prev.at > cur.at || (prev.at === cur.at && prev.id > cur.id)).toBe(true);
    }
  });

  it('lumps kills per roaming stretch — one aggregate record per claim', async () => {
    const { body } = await get('/api/activity-log/me?kind=kills&limit=100');
    expect(body.records.length).toBe(2);
    const online = body.records.find((r) => r.id.endsWith('L-claim1#kills'));
    expect(online?.kills?.count).toBe(12);
    expect(online?.areaName).toBe('Dustwaste Frontier');
    expect(online?.away).toBe(false);
  });

  it('marks the while-away era — settlement, its kills/earnings, offline drops', async () => {
    const { body } = await get('/api/activity-log/me?kind=away&limit=100');
    expect(body.records.map((r) => r.id).sort()).toEqual([
      'item:item-offline-drop',
      'ledger:L-settle1',
      'ledger:L-settle1#earnings',
      'ledger:L-settle1#kills',
    ]);
    expect(body.records.every((r) => r.away)).toBe(true);
    const settlement = body.records.find((r) => r.kind === 'settlement');
    expect(settlement?.settlement?.capReached).toBe(true);
    expect(settlement?.settlement?.ticks).toBe(2400);
    const settleKills = body.records.find((r) => r.id.endsWith('#kills'));
    expect(settleKills?.kills?.count).toBe(9);
  });

  it('emits each explained item exactly once — no double-listed boss/cache/bought/crafted loot', async () => {
    const { body } = await get('/api/activity-log/me?kind=drop&limit=100');
    expect(body.records.map((r) => r.item?.id).sort()).toEqual([
      'item-offline-drop', 'item-prestamp', 'item-roam-drop',
    ]);
    const { body: all } = await get('/api/activity-log/me?limit=100');
    const itemRefs = all.records.flatMap((r) => [
      ...(r.item ? [r.item.id] : []),
      ...(r.boss?.loot.map((l) => l.id) ?? []),
      ...(r.cache ? [] : []),
    ]);
    // item-bossloot appears exactly once overall (as boss loot).
    expect(itemRefs.filter((id) => id === 'item-bossloot').length).toBe(1);
  });

  it('surfaces AL-1 receipts honestly — engaged is never a named kill, pre-stamp items carry none', async () => {
    const { body } = await get('/api/activity-log/me?kind=drop&limit=100');
    const roam = body.records.find((r) => r.item?.id === 'item-roam-drop');
    expect(roam?.receipt?.foundVia).toBe('roam');
    expect(roam?.receipt?.foundEnemy).toEqual({ id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' });
    expect(roam?.label).toContain('while fighting Rust Vulture');
    expect(roam?.label).not.toContain('killed');
    expect((roam?.receipt?.dropOdds as { gearChance?: number } | null)?.gearChance).toBe(0.26);
    const prestamp = body.records.find((r) => r.item?.id === 'item-prestamp');
    expect(prestamp?.receipt).toBeNull();
    expect(prestamp?.label).toBe('Drop — predates item records');
  });

  it('boss and cache records carry their verdicts and odds stamps', async () => {
    const boss = (await get('/api/activity-log/me?kind=boss')).body.records;
    expect(boss.length).toBe(1);
    expect(boss[0].boss?.bossName).toBe('Dune Tyrant');
    expect(boss[0].boss?.victory).toBe(true);
    expect(boss[0].boss?.dedicatedChance).toBe(0.11);
    expect(boss[0].boss?.dedicatedDropAwarded).toBe(true);
    expect(boss[0].boss?.dropLuckBonus).toBe(0.25);
    expect(boss[0].boss?.loot).toEqual([{ id: 'item-bossloot', name: 'Tyrant Fang', kind: 'weapon', rarity: 'Legendary', level: 30 }]);

    const cache = (await get('/api/activity-log/me?kind=cache')).body.records;
    expect(cache.length).toBe(1);
    expect(cache[0].cache?.outcome).toBe('Legendary');
    expect(cache[0].cache?.oddsTableVersion).toBe(3);
    expect(cache[0].cache?.payment).toBe('free');
    expect(cache[0].item?.name).toBe('Surging Throwtech Longshot');
  });

  it('market records name counterparties and the seller fee from the buyer row', async () => {
    const { body } = await get('/api/activity-log/me?kind=market&limit=100');
    expect(body.records.length).toBe(3);
    const sold = body.records.find((r) => r.id === 'listing:listing-sold');
    expect(sold?.label).toContain('Sold');
    expect(sold?.market?.counterpartyName).toBe('Blaze');
    expect(sold?.market?.feeCredits).toBe(375);
    // The credited amount rides along proven by the accept row:
    // 7500 price − 375 fee (the 5% base settlement) = 7125.
    expect(sold?.market?.proceedsCredits).toBe(7125);
    const bought = body.records.find((r) => r.id === 'ledger:L-accept1');
    expect(bought?.market?.counterpartyName).toBe('Blaze');
    expect(bought?.item?.name).toBe('Bought Blaster');
  });

  it('craft, dispatch, and endless settlements land as their own records', async () => {
    const craft = (await get('/api/activity-log/me?kind=craft')).body.records;
    expect(craft.length).toBe(1);
    expect(craft[0].craft?.recipeName).toBe('Med Kit');
    const dispatch = (await get('/api/activity-log/me?kind=dispatch')).body.records;
    expect(dispatch.length).toBe(1);
    const endless = (await get('/api/activity-log/me?kind=endless')).body.records;
    expect(endless.length).toBe(1);
    expect(endless[0].label).toContain('depth 25');
  });

  it('one search box matches item names, enemy names, and area names together', async () => {
    const byItem = await get(`/api/activity-log/me?q=${encodeURIComponent('longshot')}`);
    expect(byItem.body.records.map((r) => r.kind)).toEqual(['cache']);
    const byEnemy = await get(`/api/activity-log/me?q=${encodeURIComponent('rust vulture')}`);
    expect(byEnemy.body.records.map((r) => r.item?.id)).toEqual(['item-roam-drop']);
    const byArea = await get(`/api/activity-log/me?q=${encodeURIComponent('dustwaste')}`);
    expect(byArea.body.records.length).toBe(7);
    expect(byArea.body.records.every((r) => r.areaName === 'Dustwaste Frontier' || r.item?.id === 'item-offline-drop' || r.item?.id === 'item-roam-drop')).toBe(true);
    const byBoss = await get(`/api/activity-log/me?q=${encodeURIComponent('tyrant')}`);
    expect(byBoss.body.records.map((r) => r.kind)).toEqual(['boss']);
    const byCounterparty = await get(`/api/activity-log/me?q=${encodeURIComponent('blaze')}`);
    expect(byCounterparty.body.records.length).toBe(2);
  });

  it('rejects a foreign cursor and an unknown kind with 400s', async () => {
    expect((await get('/api/activity-log/me?cursor=garbage!!')).status).toBe(400);
    expect((await get('/api/activity-log/me?kind=bogus')).status).toBe(400);
  });

  it('isolates players — B sees only B, a body/query playerId is ignored, anonymous is 401', async () => {
    const bView = await get('/api/activity-log/me?limit=100', B);
    expect(bView.status).toBe(200);
    const bIds = bView.body.records.map((r) => r.id);
    expect(bIds).not.toContain('ledger:L-claim1#kills');
    expect(bView.body.records.some((r) => r.kills?.count === 12)).toBe(false);
    expect(bView.body.records.some((r) => r.kills?.count === 999)).toBe(true);
    expect(bIds.some((id) => id.includes('item-roam-drop'))).toBe(false);

    // A asking with B's id in the query still gets A's record.
    const spoof = await get(`/api/activity-log/me?playerId=${B}&limit=100`, A);
    expect(spoof.body.records.some((r) => r.kills?.count === 12)).toBe(true);
    expect(spoof.body.records.some((r) => r.kills?.count === 999)).toBe(false);

    expect((await get('/api/activity-log/me', D)).status).toBe(404);
    const anon = await fetch(`${base}/api/activity-log/me`);
    expect(anon.status).toBe(401);
  });
});
