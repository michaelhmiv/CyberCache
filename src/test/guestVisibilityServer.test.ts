/**
 * Guest-visibility law (owner ruling, 2026-11-01) — server half.
 *
 * Guests SEE everything; only transacting requires sign-in. The
 * board/listing READ routes accept any authenticated Chef session
 * (guest sessions are real JWT accounts), while every transact op
 * still refuses guests at the server — the client lock is a courtesy,
 * never the enforcement.
 *
 * Pinned here:
 *  - guest GET /api/market/listings → 200 with a REAL listing
 *  - guest GET /api/market/price-stats → 200
 *  - guest GET /api/leaderboard → 200 with real standings
 *  - guest GET /api/repair/board → 200 with a REAL open job
 *  - guest GET /api/shieldtech/board → 200 with a REAL open job
 *  - guest POST /api/ops/market-accept → 403 (buy stays verified)
 *  - guest POST /api/ops/market-create-material → 403 (sell stays verified)
 *  - no token at all → 401 (reads are session-wide, not public)
 *
 * The sibling refusals are pinned where their slices landed:
 * market-create gear (chefWrites), market-create-consumable
 * (marketDepth), repair post/accept (repairServices),
 * shield-tech post/accept (shieldTechServices). This file fills the
 * two gaps (accept + material create) and proves the reads.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountReadRoutes } from '../server/reads/routes';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryReadStore, emptyReadSeed, type ProfileRowData, type ReadSeed } from '../server/reads/store';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const NOW = new Date('2026-11-01T12:00:00.000Z');
const NOW_MS = NOW.getTime();

const SELLER = '11111111-1111-4111-8111-111111111111';
const GUEST = '44444444-4444-4444-8444-444444444444';

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 25, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-11-01T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    username_updated_at: null, username_change_count: 0,
    ...over,
  } as ProfileRowData;
}

function item(over: Partial<WriteItemData> & { id: string; owner_user_id: string; kind: string }): WriteItemData {
  return {
    static_item_id: null, item_level: 25, rarity: 'Rare', quality: null,
    material_tier: null, condition_state: null, condition_current: null,
    condition_max: null, supply_mode: 'verified_action', source_id: null,
    creator_user_id: null, tradeable: true, account_bound: false,
    locked_until: null, payload: {}, runtime_state: 'available',
    is_locked: false, equipped_slot: null, estimated_value: 4000,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  } as WriteItemData;
}

describe('guest visibility — read routes serve guests real data', () => {
  let server: Server;
  let base = '';
  let guestToken = '';

  beforeAll(async () => {
    const seed: ReadSeed = {
      ...emptyReadSeed(),
      profiles: [
        profile({ id: SELLER, username: 'seller_hunter', credits: 9000 }),
        profile({ id: GUEST, username: null, account_type: 'guest', email: null, email_verified_at: null }),
      ],
      snapshots: [{
        id: 1, player_id: SELLER, source: 'daily', snapshot_version: 1,
        snapshot_at: '2026-10-29T00:00:00.000Z', level: 25, xp: 3000, credits: 9000,
        scrap: 0, total_kills: 10, total_deaths: 1, net_worth: 20000, total_items: 3,
        weapons_owned: 1, legendary_items: 0, highest_item_level: 25,
        total_mastery_xp: 0, highest_mastery_level: 1, highest_boss_tier: 1,
        active_action: null, metadata: {},
      }],
      items: [{
        id: 'read-item-1', owner_user_id: SELLER, kind: 'weapon', item_level: 25,
        rarity: 'Rare', is_locked: false, runtime_state: 'listed', equipped_slot: null,
        payload: { name: 'Visible Rifle', weaponType: 'Rifle', baseDamage: 300, attackSpeed: 2, critChance: 0.1, critDamage: 1.5, combatPower: 200, bossPower: 100, farmPower: 80 },
        created_at: '2026-10-20T00:00:00.000Z',
      }],
      listings: [{
        id: 'read-listing-1', seller_user_id: SELLER, item_instance_id: 'read-item-1',
        price_credits: 1500, status: 'active', listed_at: '2026-10-29T00:00:00.000Z',
      }],
    };
    const app = express();
    mountReadRoutes(app, new InMemoryReadStore(seed, () => NOW), { jwtSecret: SECRET });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    guestToken = issueAccessToken(SECRET, GUEST, true);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function get(path: string, token?: string) {
    const res = await fetch(`${base}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  it('guest GET /api/market/listings returns the real active listing', async () => {
    const r = await get('/api/market/listings?kind=gear', guestToken);
    expect(r.status).toBe(200);
    const data = r.body as unknown as { listings: Array<{ id: string; price_credits: number }> };
    expect(data.listings.map((l) => l.id)).toContain('read-listing-1');
    expect(data.listings.find((l) => l.id === 'read-listing-1')!.price_credits).toBe(1500);
  });

  it('guest GET /api/market/price-stats answers (empty history is data, not a lock)', async () => {
    const r = await get('/api/market/price-stats?key=weapon%7CRifle%7CRare', guestToken);
    expect(r.status).toBe(200);
  });

  it('guest GET /api/leaderboard returns real standings', async () => {
    const r = await get('/api/leaderboard?metric=xp&period=weekly', guestToken);
    expect(r.status).toBe(200);
    const entries = r.body as unknown as Array<{ player_id: string; value: number }>;
    expect(entries.some((e) => e.player_id === SELLER && e.value === 3000)).toBe(true);
  });

  it('the same reads without any session are still 401 — session-wide, not public', async () => {
    expect((await get('/api/market/listings?kind=gear')).status).toBe(401);
    expect((await get('/api/leaderboard?metric=xp&period=weekly')).status).toBe(401);
  });
});

describe('guest visibility — boards serve guests; writes still refuse them', () => {
  const VEH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const SHIELD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const WEAPON = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  let server: Server;
  let base = '';
  let sellerToken = '';
  let guestToken = '';
  let repairJobId = '';
  let shieldJobId = '';
  let listingId = '';
  let nonceN = 0;
  const nonce = () => `guestvis-nonce-${++nonceN}-abcdefgh`;

  beforeAll(async () => {
    const store = new InMemoryWriteStore(storeSeed(), { now: () => new Date(NOW_MS) });
    const app = express();
    app.use(express.json());
    mountWriteRoutes(app, store, { jwtSecret: SECRET });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    sellerToken = issueAccessToken(SECRET, SELLER, false);
    guestToken = issueAccessToken(SECRET, GUEST, true);

    // The verified seller seeds the boards through the real ops.
    const repair = await post('/api/ops/repair-post', sellerToken, {
      nonce: nonce(), item_id: VEH, target_points: 30, price_credits: 600,
    });
    expect(repair.status).toBe(200);
    repairJobId = String((repair.body as unknown as { job: { id: string } }).job.id);
    const shield = await post('/api/ops/shieldtech-post', sellerToken, {
      nonce: nonce(), item_id: SHIELD, to_behavior: 'nova', price_credits: 900,
    });
    expect(shield.status).toBe(200);
    shieldJobId = String((shield.body as unknown as { job: { id: string } }).job.id);

    // …and lists a weapon for the guest accept attempt.
    const listing = await post('/api/ops/market-create', sellerToken, {
      nonce: nonce(), item_id: WEAPON, price_credits: 1500,
    });
    expect(listing.status).toBe(200);
    listingId = String((listing.body as unknown as { listing: { id: string } }).listing.id);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  function storeSeed(): WriteSeed {
    return {
      ...emptyWriteSeed(),
      profiles: [
        profile({ id: SELLER, credits: 100_000 }),
        profile({
          id: GUEST, username: null, account_type: 'guest', email: null, email_verified_at: null,
          credits: 100_000, materials: { ScrapAlloy: 5 },
        }),
      ],
      items: [
        item({
          id: VEH, owner_user_id: SELLER, kind: 'vehicle',
          condition_current: 20, condition_max: 50,
          payload: { vehicleClass: 'dune_buggy', name: 'Dune Buggy' },
        }),
        item({
          id: SHIELD, owner_user_id: SELLER, kind: 'shield',
          payload: { name: 'Guest Gaze Shield', behavior: 'standard', hp: 1500, rechargeRate: 10 },
        }),
        item({
          id: WEAPON, owner_user_id: SELLER, kind: 'weapon',
          payload: { name: 'Visible Rifle', weaponType: 'Rifle', baseDamage: 300, attackSpeed: 2, critChance: 0.1, critDamage: 1.5, combatPower: 200, bossPower: 100, farmPower: 80 },
        }),
      ],
    } as WriteSeed;
  }

  async function get(path: string, token: string) {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function post(path: string, token: string, payload: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  it('guest GET /api/repair/board returns the real open job', async () => {
    const r = await get('/api/repair/board', guestToken);
    expect(r.status).toBe(200);
    const board = r.body as unknown as { open: Array<{ id: string }> };
    expect(board.open.map((j) => j.id)).toContain(repairJobId);
  });

  it('guest GET /api/shieldtech/board returns the real open job', async () => {
    const r = await get('/api/shieldtech/board', guestToken);
    expect(r.status).toBe(200);
    const board = r.body as unknown as { open: Array<{ id: string }> };
    expect(board.open.map((j) => j.id)).toContain(shieldJobId);
  });

  it('guest market-accept (buy) is refused at the server: 403', async () => {
    expect(listingId).not.toBe('');
    const r = await post('/api/ops/market-accept', guestToken, { nonce: nonce(), listing_id: listingId });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('Verified account required');
  });

  it('guest market-create-material (sell) is refused at the server: 403', async () => {
    const r = await post('/api/ops/market-create-material', guestToken, {
      nonce: nonce(), material_id: 'ScrapAlloy', quantity: 1, price_credits: 50,
    });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('Verified account required');
  });

  it('guest board writes are refused too (post + accept on both boards)', async () => {
    const postRepair = await post('/api/ops/repair-post', guestToken, {
      nonce: nonce(), item_id: VEH, target_points: 10, price_credits: 100,
    });
    expect(postRepair.status).toBe(403);
    const acceptRepair = await post('/api/ops/repair-accept', guestToken, {
      nonce: nonce(), job_id: repairJobId, item_key: 'PatchKit',
    });
    expect(acceptRepair.status).toBe(403);
    const postShield = await post('/api/ops/shieldtech-post', guestToken, {
      nonce: nonce(), item_id: SHIELD, to_behavior: 'nova', price_credits: 100,
    });
    expect(postShield.status).toBe(403);
    const acceptShield = await post('/api/ops/shieldtech-accept', guestToken, {
      nonce: nonce(), job_id: shieldJobId,
    });
    expect(acceptShield.status).toBe(403);
  });
});
