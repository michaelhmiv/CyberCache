/**
 * Chef write routes (Route B, slice B3) — HTTP + InMemoryWriteStore tests.
 *
 * The InMemory store mirrors the SQL functions in
 * db/migrations/0004_write_apis.sql; the real-Postgres harness verifies the
 * PgWriteStore against those functions directly. Covered here: mutation
 * semantics per route family, insufficient-funds/validation failures,
 * cross-player isolation, nonce replay (no double-pay), and 401s.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import {
  emptyWriteSeed,
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333'; // guest: economy gate closed
const D = '44444444-4444-4444-8444-444444444444'; // valid id, no profile

const ITEM_A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_A2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ITEM_A3 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ITEM_B1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let nowMs = Date.parse('2026-10-29T12:00:00.000Z');
let rngQueue: number[] = [];
let uuidCounter = 0;

function rng(): number {
  return rngQueue.length ? (rngQueue.shift() as number) : 0.5;
}

function nextUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
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

function item(overrides: Partial<WriteItemData> & { id: string; owner_user_id: string }): WriteItemData {
  return {
    kind: 'weapon', static_item_id: null, item_level: 5, rarity: 'Rare', quality: null,
    material_tier: null, condition_state: null, condition_current: 40, condition_max: 50,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null, payload: { weaponType: 'Pistol' }, runtime_state: 'available',
    is_locked: false, equipped_slot: null, estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function baseSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({
      id: A, username: 'alpha', player_level: 5, player_xp: 100, credits: 1000, scrap: 100,
      cache_tokens: 2, materials: { ScrapAlloy: 20, BallisticParts: 5, ReactiveComponents: 10 },
      consumables: { repair_kit: 2 },
    }),
    profile({ id: B, username: 'bravo', player_level: 3, credits: 500, scrap: 0 }),
    profile({ id: C, username: 'guest_c', account_type: 'guest', email_verified_at: null, credits: 100 }),
  ];
  s.items = [
    item({ id: ITEM_A1, owner_user_id: A }),
    item({ id: ITEM_A2, owner_user_id: A, kind: 'shield', payload: { hp: 100, mitigation: 0.2 } }),
    item({ id: ITEM_A3, owner_user_id: A }),
    item({ id: ITEM_B1, owner_user_id: B }),
  ];
  s.oddsOutcomes = [
    { table_id: 'cache_primary_rarity', outcome: 'Common', weight: 70, payload: {} },
    { table_id: 'cache_primary_rarity', outcome: 'Rare', weight: 30, payload: {} },
    { table_id: 'boss_attempt_balanced', outcome: 'defeat', weight: 50, payload: { xp_mult: 0.5, credit_mult: 0, fragment_reward: 0 } },
    { table_id: 'boss_attempt_balanced', outcome: 'victory', weight: 50, payload: { xp_mult: 1, credit_mult: 1, fragment_reward: 2 } },
  ];
  s.skillNodes = [
    { id: 'dmg1', tree: 'combat', tier: 1, slot_index: 0, name: 'Damage 1', description: '', node_type: 'stat', max_points: 2, per_point_cost: 1, effects: {}, requires: [] },
    { id: 'dmg2', tree: 'combat', tier: 2, slot_index: 0, name: 'Damage 2', description: '', node_type: 'stat', max_points: 1, per_point_cost: 1, effects: {}, requires: ['dmg1'] },
  ];
  s.roamingAreas = [
    { id: 'dustwaste', display_name: 'Dustwaste', unlock_level: 1, payload: { credits_per_tick: 2, scrap_per_tick: 1, xp_per_tick: 3, material_bias: ['ScrapAlloy'], essence_bias: [] } },
  ];
  s.activeActions = [
    {
      user_id: A, active_action: 'roaming_loot', started_at: '2026-10-29T11:00:00.000Z',
      completes_at: null, target_type: null, target_id: 'dustwaste', target_label: null,
      scene_key: null, notes: null, activity_payload: {}, public_payload: {},
      last_heartbeat_at: '2026-10-29T11:00:00.000Z', public_visible: true, schema_version: 1,
      updated_at: '2026-10-29T11:00:00.000Z',
    },
  ];
  s.usernameReservations = ['admin', 'support'];
  return s;
}

interface Harness {
  store: InMemoryWriteStore;
  base: string;
  close: () => Promise<void>;
  tokenA: string;
  tokenB: string;
  tokenC: string;
  tokenD: string;
}

async function makeServer(seed: WriteSeed = baseSeed()): Promise<Harness> {
  const store = new InMemoryWriteStore(seed, { now: () => new Date(nowMs), rng, uuid: nextUuid });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, false),
    tokenC: issueAccessToken(SECRET, C, false),
    tokenD: issueAccessToken(SECRET, D, false),
  };
}

interface Reply {
  status: number;
  json: Record<string, unknown> & { [k: string]: unknown };
}

async function call(h: Harness, method: string, path: string, token: string | null, payload?: unknown): Promise<Reply> {
  const res = await fetch(`${h.base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

const post = (h: Harness, path: string, token: string | null, payload?: unknown) => call(h, 'POST', path, token, payload);

let nonceCounter = 0;
function nonce(): string {
  nonceCounter += 1;
  return `test-nonce-${nonceCounter}-abcdef`;
}

beforeAll(() => {
  nowMs = Date.parse('2026-10-29T12:00:00.000Z');
});

describe('auth gate', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('returns 401 without a token on every write route', async () => {
    const routes: [string, string, unknown][] = [
      ['POST', '/api/ops/initial-bundle', { nonce: nonce() }],
      ['POST', '/api/ops/make-item', { nonce: nonce() }],
      ['POST', '/api/ops/vendor-buy', { nonce: nonce(), item_key: 'stim_pack', quantity: 1 }],
      ['POST', '/api/ops/recycle-item', { nonce: nonce(), item_id: ITEM_A1 }],
      ['POST', '/api/ops/market-create', { nonce: nonce(), item_id: ITEM_A1, price_credits: 10 }],
      ['POST', '/api/ops/reset-progress', { nonce: nonce() }],
      ['POST', '/api/activity/set', { nonce: nonce(), activity_kind: 'crafting' }],
      ['POST', '/api/activity/clear', { nonce: nonce() }],
      ['POST', '/api/activity/heartbeat', {}],
      ['GET', '/api/activity/me', undefined],
      ['POST', '/api/profile/set-username', { username: 'new_name' }],
      ['POST', '/api/profile/mark-reminder-seen', {}],
      ['GET', '/api/runtime/snapshot', undefined],
      ['PUT', '/api/runtime/snapshot', { snapshot: {} }],
      ['DELETE', '/api/runtime/snapshot', undefined],
      ['POST', '/api/push/register', { token: 'push-token-1234567890' }],
    ];
    for (const [method, path, payload] of routes) {
      const res = await call(h, method, path, null, payload);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.json.error).toBe('unauthorized');
    }
  });

  it('rejects a short nonce with the SQL validation message', async () => {
    const res = await post(h, '/api/ops/idle-claim', h.tokenA, { nonce: 'short' });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'validation', message: 'nonce is required' });
  });
});

describe('initial bundle + idle claim', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('grants the bundle once and replays the same nonce without double-paying', async () => {
    const n = nonce();
    const first = await post(h, '/api/ops/initial-bundle', h.tokenA, { nonce: n });
    expect(first.status).toBe(200);
    expect(first.json.action_type).toBe('cc_initial_bundle');
    const prof = first.json.profile as Record<string, unknown>;
    expect(prof.credits).toBe(6000);
    expect(prof.scrap).toBe(600);
    expect(prof.cache_tokens).toBe(5);
    expect((prof.boss_state as Record<string, unknown>).initial_bundle_claimed).toBe(true);

    const replay = await post(h, '/api/ops/initial-bundle', h.tokenA, { nonce: n });
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual(first.json);
    expect(h.store.seed.profiles.find((p) => p.id === A)?.credits).toBe(6000);

    const again = await post(h, '/api/ops/initial-bundle', h.tokenA, { nonce: nonce() });
    expect(again.status).toBe(400);
    expect(again.json.message).toBe('Initial bundle already claimed');
  });

  it('idle claim pays 10 credits per xp minute, capped at 2 hours', async () => {
    // last_idle_claim_at is 2026-10-29T10:00Z, clock is 12:00Z -> 120 xp.
    const res = await post(h, '/api/ops/idle-claim', h.tokenB, { nonce: nonce() });
    expect(res.status).toBe(200);
    expect(res.json.rewards).toEqual({ xp: 120, credits: 1200 });
    const prof = res.json.profile as Record<string, unknown>;
    expect(prof.credits).toBe(1700);
  });
});

describe('cache draws, vendor, crafting, consumables', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('make-item spends a token, mints a weapon, and replays safely', async () => {
    rngQueue = [0.75]; // rarity roll -> Rare (71..100 of 100)
    const n = nonce();
    const res = await post(h, '/api/ops/make-item', h.tokenA, { nonce: n });
    expect(res.status).toBe(200);
    expect(res.json.action_type).toBe('cc_make_item');
    const minted = res.json.item as Record<string, unknown>;
    expect(minted.kind).toBe('weapon');
    expect(minted.rarity).toBe('Rare');
    expect((minted.payload as Record<string, unknown>).weaponType).toBeDefined();
    const prof = res.json.profile as Record<string, unknown>;
    expect(prof.cache_tokens).toBe(1);

    const replay = await post(h, '/api/ops/make-item', h.tokenA, { nonce: n });
    expect(replay.json).toEqual(res.json);
    expect(h.store.seed.items.filter((i) => i.owner_user_id === A)).toHaveLength(4);
  });

  it('make-item without tokens fails', async () => {
    const res = await post(h, '/api/ops/make-item', h.tokenB, { nonce: nonce() });
    expect(res.status).toBe(400);
    expect(res.json.message).toBe('Not enough tokens');
  });

  it('vendor-buy deducts credits and stocks a batch; failures are stable', async () => {
    const res = await post(h, '/api/ops/vendor-buy', h.tokenA, { nonce: nonce(), item_key: 'MedKit', quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.json.total_price).toBe(500);
    const prof = res.json.profile as Record<string, unknown>;
    expect(prof.credits).toBe(500);
    expect((prof.consumables as Record<string, number>).MedKit).toBe(2);
    const batches = prof.consumable_batches as Record<string, unknown>[];
    expect(batches.some((b) => b.consumable_type === 'MedKit' && b.quantity === 2 && b.quality_percent === 100)).toBe(true);

    const broke = await post(h, '/api/ops/vendor-buy', h.tokenB, { nonce: nonce(), item_key: 'BossScanner', quantity: 1 });
    expect(broke.status).toBe(400);
    expect(broke.json).toMatchObject({ error: 'insufficient_funds', message: 'Insufficient credits' });

    const unknown = await post(h, '/api/ops/vendor-buy', h.tokenA, { nonce: nonce(), item_key: 'nope', quantity: 1 });
    expect(unknown.status).toBe(400);
    expect(unknown.json.message).toBe('Unknown vendor item');
  });

  it('crafting consumes materials and fails cleanly without them', async () => {
    rngQueue = [0.5];
    const res = await post(h, '/api/ops/claim-crafted-consumable', h.tokenA, {
      nonce: nonce(), recipe_id: 'recipe_medkit', item_key: 'MedKit', quantity: 1,
    });
    expect(res.status).toBe(200);
    const prof = res.json.profile as Record<string, unknown>;
    // Recipe materials are charged once per craft, not per unit.
    expect((prof.materials as Record<string, number>).ScrapAlloy).toBe(5);
    expect((prof.materials as Record<string, number>).ReactiveComponents).toBe(2);
    // 2 from the vendor-buy test above (shared store in this describe) + 1 crafted.
    expect((prof.consumables as Record<string, number>).MedKit).toBe(3);

    const poor = await post(h, '/api/ops/claim-crafted-consumable', h.tokenB, {
      nonce: nonce(), recipe_id: 'recipe_medkit', item_key: 'MedKit', quantity: 1,
    });
    expect(poor.status).toBe(400);
    expect(poor.json.message).toBe('Insufficient material ScrapAlloy');
  });

  it('consume decrements the profile count and drains batches FIFO', async () => {
    // Isolated server: the seeded profile holds a legacy count (2) with no
    // batches, which the SQL backfills into a 100% batch before consuming.
    const h2 = await makeServer();
    try {
      const res = await post(h2, '/api/ops/consume-consumable', h2.tokenA, { nonce: nonce(), item_key: 'repair_kit', quantity: 1 });
      expect(res.status).toBe(200);
      const prof = res.json.profile as Record<string, unknown>;
      expect((prof.consumables as Record<string, number>).repair_kit).toBe(1);
      const consumed = (res.json.consumed_batches as Record<string, unknown>).consumed as Record<string, unknown>[];
      expect(consumed).toHaveLength(1);
      expect(consumed[0].quality_percent).toBe(100);
      expect(consumed[0].quantity).toBe(1);

      const tooMany = await post(h2, '/api/ops/consume-consumable', h2.tokenA, { nonce: nonce(), item_key: 'repair_kit', quantity: 5 });
      expect(tooMany.status).toBe(400);
      expect(tooMany.json.message).toBe('Insufficient consumable quantity for repair_kit');
    } finally {
      await h2.close();
    }
  });

  it('rewarded cache key honours the 5-minute cooldown', async () => {
    const res = await post(h, '/api/ops/claim-rewarded-cache-key', h.tokenA, { nonce: nonce(), ad_unit_id: 'ca-app-pub-x/y' });
    expect(res.status).toBe(200);
    expect(res.json.daily_grants_used).toBe(1);
    const second = await post(h, '/api/ops/claim-rewarded-cache-key', h.tokenA, { nonce: nonce(), ad_unit_id: 'ca-app-pub-x/y' });
    expect(second.status).toBe(400);
    expect(second.json.message).toBe('Rewarded cache key cooldown active');
  });
});

describe('inventory mutations', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('recycle pays the salvage formula and consumes the item', async () => {
    const res = await post(h, '/api/ops/recycle-item', h.tokenA, { nonce: nonce(), item_id: ITEM_A1 });
    expect(res.status).toBe(200);
    // Rare lvl5: round((10 + 5*5) * 2.5) = 88
    expect(res.json.scrap_award).toBe(88);
    const prof = res.json.profile as Record<string, unknown>;
    expect(prof.scrap).toBe(188);
    const recycled = res.json.item as Record<string, unknown>;
    expect(recycled.runtime_state).toBe('consumed');

    const again = await post(h, '/api/ops/recycle-item', h.tokenA, { nonce: nonce(), item_id: ITEM_A1 });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ error: 'conflict', message: 'Item state invalid' });
  });

  it('cross-player recycle is a 404, not a leak', async () => {
    const res = await post(h, '/api/ops/recycle-item', h.tokenB, { nonce: nonce(), item_id: ITEM_A2 });
    expect(res.status).toBe(404);
    expect(res.json.message).toBe('Item not found');
  });

  it('equip validates slot + payload fit, unequip restores availability', async () => {
    const wrongSlot = await post(h, '/api/ops/equip-item', h.tokenA, { nonce: nonce(), item_id: ITEM_A2, slot_name: 'primary' });
    expect(wrongSlot.status).toBe(400);
    expect(wrongSlot.json.message).toBe('Item type does not match loadout slot');

    const badSlot = await post(h, '/api/ops/equip-item', h.tokenA, { nonce: nonce(), item_id: ITEM_A3, slot_name: 'hat' });
    expect(badSlot.status).toBe(400);
    expect(badSlot.json.message).toBe('Invalid slot');

    const ok = await post(h, '/api/ops/equip-item', h.tokenA, { nonce: nonce(), item_id: ITEM_A3, slot_name: 'primary' });
    expect(ok.status).toBe(200);
    expect((ok.json.loadout as Record<string, unknown>).primary).toBe(ITEM_A3);

    const out = await post(h, '/api/ops/unequip-slot', h.tokenA, { nonce: nonce(), slot_name: 'primary' });
    expect(out.status).toBe(200);
    expect((out.json.loadout as Record<string, unknown>).primary).toBeNull();
    expect((out.json.item as Record<string, unknown>).runtime_state).toBe('available');
  });

  it('lock toggles state and preserves the recycle lock error', async () => {
    const locked = await post(h, '/api/ops/item-lock', h.tokenA, { nonce: nonce(), item_id: ITEM_A3, locked: true });
    expect(locked.status).toBe(200);
    expect((locked.json.item as Record<string, unknown>).runtime_state).toBe('locked');

    const salvage = await post(h, '/api/ops/recycle-item', h.tokenA, { nonce: nonce(), item_id: ITEM_A3 });
    expect(salvage.status).toBe(400);
    expect(salvage.json.message).toBe('Locked item');

    const unlocked = await post(h, '/api/ops/item-lock', h.tokenA, { nonce: nonce(), item_id: ITEM_A3, locked: false });
    expect((unlocked.json.item as Record<string, unknown>).runtime_state).toBe('available');
  });
});

describe('roaming claims (removed fallback)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('the /api/ops/claim-roaming route no longer exists', async () => {
    // The cc_claim_roaming_rewards route existed only as the idle
    // ticker's silent error fallback, paying stale flat rates (seed:
    // 1 credit/tick, 0 scrap, no mods). It was removed with the
    // fallback; roaming claims go through the Chef (/api/claim) only.
    // (Raw fetch: the unrouted path returns Express's HTML 404, which
    // the JSON `call` helper cannot parse.)
    const res = await fetch(`${h.base}/api/ops/claim-roaming`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${h.tokenA}` },
      body: JSON.stringify({ ticks: 10, area_id: 'dustwaste', tick_count: 10 }),
    });
    expect(res.status).toBe(404);
    // Nothing was paid: the seeded profile balance is untouched.
    expect(h.store.seed.profiles.find((p) => p.id === A)?.credits).toBe(1000);
  });
});

describe('skills + battle', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('trains within budget and prerequisites, then retrain refunds points for credits', async () => {
    const noPrereq = await post(h, '/api/ops/train-skill', h.tokenB, { nonce: nonce(), node_id: 'dmg2' });
    expect(noPrereq.status).toBe(400);
    expect(noPrereq.json.message).toBe('Missing prerequisites: dmg1');

    const first = await post(h, '/api/ops/train-skill', h.tokenA, { nonce: nonce(), node_id: 'dmg1' });
    expect(first.status).toBe(200);
    expect(first.json.node_points).toBe(1);
    const second = await post(h, '/api/ops/train-skill', h.tokenA, { nonce: nonce(), node_id: 'dmg1' });
    expect(second.json.node_points).toBe(2);
    const maxed = await post(h, '/api/ops/train-skill', h.tokenA, { nonce: nonce(), node_id: 'dmg1' });
    expect(maxed.status).toBe(400);
    expect(maxed.json.message).toBe('Skill node dmg1 is already maxed');

    const child = await post(h, '/api/ops/train-skill', h.tokenA, { nonce: nonce(), node_id: 'dmg2' });
    expect(child.status).toBe(200);
    expect(child.json.total_spent).toBe(3);

    const retrain = await post(h, '/api/ops/retrain', h.tokenA, { nonce: nonce() });
    expect(retrain.status).toBe(200);
    expect(retrain.json.total_price).toBe(300);
    const prof = retrain.json.profile as Record<string, unknown>;
    expect(prof.credits).toBe(700);
    expect(prof.skill_spends).toEqual({});
  });

  it('battle result draws odds and converts fragments into tokens', async () => {
    rngQueue = [0.9]; // sorted outcomes: defeat(50), victory(50) -> roll 91..100? floor(0.9*100)+1 = 91 -> victory
    const res = await post(h, '/api/ops/battle-result', h.tokenA, { nonce: nonce(), target_id: 'boss-1', stance: 'balanced' });
    expect(res.status).toBe(200);
    expect((res.json.draw as Record<string, unknown>).outcome).toBe('victory');
    expect(res.json.rewards).toEqual({ xp: 75, credits: 125, parts: 2 });
    const prof = res.json.profile as Record<string, unknown>;
    expect(prof.cache_token_parts).toBe(2);
    expect((prof.boss_state as Record<string, unknown>).last_target_id).toBe('boss-1');
  });
});

describe('market + services', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('economy gate blocks guests before any mutation', async () => {
    const res = await post(h, '/api/ops/market-create', h.tokenC, { nonce: nonce(), item_id: ITEM_B1, price_credits: 10 });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ error: 'forbidden', message: 'Verified account required' });
  });

  it('full listing lifecycle: create, cross-player cannot cancel, buyer purchases', async () => {
    const badPrice = await post(h, '/api/ops/market-create', h.tokenA, { nonce: nonce(), item_id: ITEM_A1, price_credits: 0 });
    expect(badPrice.status).toBe(400);
    expect(badPrice.json.message).toBe('price_credits must be positive');

    const created = await post(h, '/api/ops/market-create', h.tokenA, { nonce: nonce(), item_id: ITEM_A1, price_credits: 300 });
    expect(created.status).toBe(200);
    const listing = created.json.listing as Record<string, unknown>;
    const listingId = listing.id as string;
    expect((created.json.item as Record<string, unknown>).runtime_state).toBe('listed');

    const foreignCancel = await post(h, '/api/ops/market-cancel', h.tokenB, { nonce: nonce(), listing_id: listingId });
    expect(foreignCancel.status).toBe(404);
    expect(foreignCancel.json.message).toBe('Listing not found');

    const ownBuy = await post(h, '/api/ops/market-accept', h.tokenA, { nonce: nonce(), listing_id: listingId });
    expect(ownBuy.status).toBe(403);
    expect(ownBuy.json.message).toBe('Cannot accept own listing');

    const bought = await post(h, '/api/ops/market-accept', h.tokenB, { nonce: nonce(), listing_id: listingId });
    expect(bought.status).toBe(200);
    const buyerProfile = bought.json.profile as Record<string, unknown>;
    expect(buyerProfile.credits).toBe(200);
    // 0017 market fee: the buyer pays the full 300cr list price; the
    // seller is credited 300 − 5% fee (15cr destroyed) = 285 → 1285.
    // (Was 1300 before the fee existed.) Fee math is pinned end-to-end
    // in marketFee.test.ts.
    expect(h.store.seed.profiles.find((p) => p.id === A)?.credits).toBe(1285);
    const moved = h.store.seed.items.find((i) => i.id === ITEM_A1);
    expect(moved?.owner_user_id).toBe(B);
    expect(moved?.runtime_state).toBe('available');

    const soldOut = await post(h, '/api/ops/market-accept', h.tokenB, { nonce: nonce(), listing_id: listingId });
    expect(soldOut.status).toBe(404);
    expect(soldOut.json.message).toBe('Active listing not found');
  });

  it('cancel returns the item to available', async () => {
    const created = await post(h, '/api/ops/market-create', h.tokenA, { nonce: nonce(), item_id: ITEM_A2, price_credits: 100 });
    const listingId = (created.json.listing as Record<string, unknown>).id as string;
    const cancelled = await post(h, '/api/ops/market-cancel', h.tokenA, { nonce: nonce(), listing_id: listingId });
    expect(cancelled.status).toBe(200);
    expect((cancelled.json.item as Record<string, unknown>).runtime_state).toBe('available');
    const again = await post(h, '/api/ops/market-cancel', h.tokenA, { nonce: nonce(), listing_id: listingId });
    expect(again.status).toBe(409);
    expect(again.json.message).toBe('Listing not active');
  });

  it('service flow: request locks the item, provider finishes and gets paid', async () => {
    const requested = await post(h, '/api/ops/service-request', h.tokenA, { nonce: nonce(), item_id: ITEM_A2, service_id: 'repair' });
    expect(requested.status).toBe(200);
    const job = requested.json.job as Record<string, unknown>;
    const jobId = job.id as string;
    expect(job.status).toBe('listed');
    expect((requested.json.item as Record<string, unknown>).runtime_state).toBe('locked');

    const ownAccept = await post(h, '/api/ops/service-accept', h.tokenA, { nonce: nonce(), job_id: jobId, price_credits: 100 });
    expect(ownAccept.status).toBe(403);
    expect(ownAccept.json.message).toBe('Cannot accept own job');

    const accepted = await post(h, '/api/ops/service-accept', h.tokenB, { nonce: nonce(), job_id: jobId, price_credits: 100, duration_minutes: 30 });
    expect(accepted.status).toBe(200);
    expect((accepted.json.job as Record<string, unknown>).status).toBe('accepted');

    const wrongFinisher = await post(h, '/api/ops/service-finish', h.tokenA, { nonce: nonce(), job_id: jobId });
    expect(wrongFinisher.status).toBe(404);
    expect(wrongFinisher.json.message).toBe('Job not found');

    const ownerBefore = h.store.seed.profiles.find((p) => p.id === A)?.credits ?? 0;
    const providerBefore = h.store.seed.profiles.find((p) => p.id === B)?.credits ?? 0;
    const finished = await post(h, '/api/ops/service-finish', h.tokenB, { nonce: nonce(), job_id: jobId });
    expect(finished.status).toBe(200);
    expect(finished.json.price_credits).toBe(100);
    expect((finished.json.profile as Record<string, unknown>).credits).toBe(providerBefore + 100);
    expect((finished.json.owner_profile as Record<string, unknown>).credits).toBe(ownerBefore - 100);
    const item = finished.json.item as Record<string, unknown>;
    expect(item.runtime_state).toBe('available');
    expect(item.condition_current).toBe(50);
  });
});

describe('activity, username, snapshots, push, reset', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('activity set/get/clear/heartbeat round-trips and validates kinds', async () => {
    const bad = await post(h, '/api/activity/set', h.tokenB, { nonce: nonce(), activity_kind: 'dance' });
    expect(bad.status).toBe(400);
    expect(bad.json.message).toBe('Unsupported active action: dance');

    const set = await post(h, '/api/activity/set', h.tokenB, {
      nonce: nonce(), activity_kind: 'roaming_loot', target_id: 'dustwaste',
    });
    expect(set.status).toBe(200);
    expect((set.json.activity as Record<string, unknown>).active_action).toBe('roaming_loot');

    const mine = await call(h, 'GET', '/api/activity/me', h.tokenB);
    expect((mine.json as Record<string, unknown>).target_id).toBe('dustwaste');
    const other = await call(h, 'GET', '/api/activity/me', h.tokenC);
    expect(other.json).toBeNull();

    const beat = await post(h, '/api/activity/heartbeat', h.tokenB, {});
    expect(beat.status).toBe(200);
    expect(beat.json.action_type).toBe('cc_active_action_heartbeat');

    const cleared = await post(h, '/api/activity/clear', h.tokenB, { nonce: nonce() });
    expect((cleared.json.activity as Record<string, unknown>).active_action).toBe('idle_standby');
  });

  it('set-username reports validation as data, enforces uniqueness + cooldown', async () => {
    const ok = await post(h, '/api/profile/set-username', h.tokenA, { username: 'Alpha New' });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ ok: true });
    expect(h.store.seed.profiles.find((p) => p.id === A)?.username).toBe('Alpha New');

    const cooldown = await post(h, '/api/profile/set-username', h.tokenA, { username: 'Another Name' });
    expect(cooldown.json.ok).toBe(false);
    expect(String(cooldown.json.error)).toContain('You can rename again after');

    const invalid = await post(h, '/api/profile/set-username', h.tokenB, { username: 'ab' });
    expect(invalid.json).toEqual({ ok: false, error: 'Username must be between 3 and 24 characters.' });

    const taken = await post(h, '/api/profile/set-username', h.tokenB, { username: 'admin' });
    expect(taken.json).toEqual({ ok: false, error: 'That username is already taken.' });

    const sameName = await post(h, '/api/profile/set-username', h.tokenB, { username: 'bravo' });
    expect(sameName.json).toEqual({ ok: true });
  });

  it('mark-reminder-seen stamps the caller profile; unknown profile 404s', async () => {
    const res = await post(h, '/api/profile/mark-reminder-seen', h.tokenA, {});
    expect(res.status).toBe(200);
    expect(res.json.verification_reminder_last_seen_at).toBe('2026-10-29T12:00:00.000Z');
    const missing = await post(h, '/api/profile/mark-reminder-seen', h.tokenD, {});
    expect(missing.status).toBe(404);
    expect(missing.json.message).toBe('Profile not found');
  });

  it('runtime snapshots are per-player and round-trip', async () => {
    const empty = await call(h, 'GET', '/api/runtime/snapshot', h.tokenA);
    expect(empty.json).toBeNull();

    const put = await call(h, 'PUT', '/api/runtime/snapshot', h.tokenA, { snapshot: { gold: 42, nested: { x: [1, 2] } } });
    expect(put.json).toEqual({ ok: true });
    const got = await call(h, 'GET', '/api/runtime/snapshot', h.tokenA);
    expect(got.json).toEqual({ gold: 42, nested: { x: [1, 2] } });

    const foreign = await call(h, 'GET', '/api/runtime/snapshot', h.tokenB);
    expect(foreign.json).toBeNull();

    await call(h, 'DELETE', '/api/runtime/snapshot', h.tokenA);
    const after = await call(h, 'GET', '/api/runtime/snapshot', h.tokenA);
    expect(after.json).toBeNull();
  });

  it('push register/disable validate the token and track the device', async () => {
    const short = await post(h, '/api/push/register', h.tokenA, { token: 'tiny' });
    expect(short.status).toBe(400);
    expect(short.json.message).toBe('token is required');

    const reg = await post(h, '/api/push/register', h.tokenA, { token: 'push-token-1234567890', platform: 'ios', app_version: '1.2.3' });
    expect(reg.status).toBe(200);
    const device = reg.json.device as Record<string, unknown>;
    expect(device.platform).toBe('ios');
    expect(device.enabled).toBe(true);

    const off = await post(h, '/api/push/disable', h.tokenA, { token: 'push-token-1234567890' });
    expect(off.json).toEqual({ action_type: 'cc_disable_push_device' });
    expect(h.store.seed.pushDevices[0]?.enabled).toBe(false);
  });

  it('reset-progress restores the starter economy and wipes owned state', async () => {
    const n = nonce();
    const res = await post(h, '/api/ops/reset-progress', h.tokenA, { nonce: n });
    expect(res.status).toBe(200);
    const prof = res.json.profile as Record<string, unknown>;
    expect(prof.credits).toBe(5000);
    expect(prof.player_level).toBe(1);
    expect(prof.cache_tokens).toBe(3);
    expect(h.store.seed.items.filter((i) => i.owner_user_id === A)).toHaveLength(0);

    const replay = await post(h, '/api/ops/reset-progress', h.tokenA, { nonce: n });
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual(res.json);
  });

  it('ledger side effects track stats for verified actions', async () => {
    const h2 = await makeServer();
    try {
      await post(h2, '/api/ops/vendor-buy', h2.tokenA, { nonce: nonce(), item_key: 'MedKit', quantity: 1 });
      const stats = h2.store.seed.statCounters.filter((s) => s.user_id === A);
      expect(stats.find((s) => s.stat_key === 'actions.total')?.stat_value).toBe(1);
      expect(stats.find((s) => s.stat_key === 'economy.vendor_buys')?.stat_value).toBe(1);
      const mastery = h2.store.seed.masteries.find((m) => m.user_id === A && m.mastery_id === 'economy.vendor_buys');
      expect(mastery?.mastery_xp).toBe(15);
    } finally {
      await h2.close();
    }
  });
});
