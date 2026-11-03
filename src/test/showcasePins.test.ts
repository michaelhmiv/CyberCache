/**
 * Trophy Shelf hand-pinning (migration 0058) — shipped-path tests.
 *
 * The laws under test:
 *  - Pins headline the shelf IN PIN ORDER; the server rank
 *    (rarity → level → newest) fills the remaining slots and never
 *    repeats a pinned weapon.
 *  - A pin that no longer resolves (item gone, or a sparse payload
 *    that can never headline) is skipped silently — the shelf
 *    always shows the best three it honestly can.
 *  - The write is full-list replace with validation as data: only
 *    the caller's OWN weapons, only showable ones, at most three.
 *    Identity comes from the JWT; a body player id names no one.
 *  - The public profile read exposes the showcase and NOTHING
 *    private: its exact key set is pinned below — no email, no
 *    credit/scrap balances, no lifetime credit/market folds.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryReadStore, emptyReadSeed,
  type MemItem, type ProfileRowData, type ReadSeed,
} from '../server/reads/store';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import {
  emptyWriteSeed, type WriteItemData, type WriteSeed,
} from '../server/writes/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const D = '44444444-4444-4444-8444-444444444444'; // valid id, no profile

const WA1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const WA2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const WA3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const WA4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const WARMOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const WSPARSE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const WB1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

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

/** A real rolled weapon payload (isUsableWeaponPayload's rule). */
const fullPayload = (weaponType: string) => ({
  weaponType, baseDamage: 120, attackSpeed: 1.4, critChance: 0.12,
  critDamage: 1.6, combatPower: 90, bossPower: 45, farmPower: 40,
});

function readSeed(pins: Array<{ user_id: string; item_id: string; pin_order: number }> = []): ReadSeed {
  const seed = emptyReadSeed();
  seed.profiles = [profile({ id: A, username: 'alpha' }), profile({ id: B, username: 'bravo' })];
  const item = (over: Partial<MemItem> & { id: string }): MemItem => ({
    owner_user_id: A, kind: 'weapon', item_level: 1, rarity: 'Common', is_locked: false,
    runtime_state: 'available', equipped_slot: null, payload: {},
    created_at: '2026-10-01T00:00:00.000Z', ...over,
  });
  seed.items = [
    item({ id: 'w-rank1', rarity: 'Legendary', item_level: 40, payload: fullPayload('Sniper') }),
    item({ id: 'w-rank2', rarity: 'Epic', item_level: 60, payload: fullPayload('Rifle') }),
    item({ id: 'w-pin', rarity: 'Rare', item_level: 10, payload: fullPayload('Pistol') }),
    item({ id: 'w-c4', rarity: 'Common', item_level: 5, payload: fullPayload('Shotgun') }),
    item({ id: 'w-sparse', rarity: 'Common', item_level: 1, payload: { weaponType: 'Pistol' } }),
    item({ id: 'a-armor', kind: 'armor', rarity: 'Legendary', item_level: 99 }),
    item({ id: 'w-b1', owner_user_id: B, rarity: 'Epic', item_level: 20, payload: fullPayload('Rifle') }),
  ];
  seed.showcasePins = pins;
  return seed;
}

describe('shelf composition — pins first, rank fills', () => {
  it('no pins: the pure server rank, pinned_item_ids empty', async () => {
    const stats = await new InMemoryReadStore(readSeed()).getProfileStats(A);
    expect(stats!.showcase.top_weapons.map((w) => w.id)).toEqual(['w-rank1', 'w-rank2', 'w-pin']);
    expect(stats!.showcase.pinned_item_ids).toEqual([]);
  });

  it('one pin headlines; the rank fills behind it without repeating it', async () => {
    const stats = await new InMemoryReadStore(
      readSeed([{ user_id: A, item_id: 'w-pin', pin_order: 0 }]),
    ).getProfileStats(A);
    expect(stats!.showcase.top_weapons.map((w) => w.id)).toEqual(['w-pin', 'w-rank1', 'w-rank2']);
    expect(stats!.showcase.pinned_item_ids).toEqual(['w-pin']);
  });

  it('pin order wins over rank order', async () => {
    const stats = await new InMemoryReadStore(
      readSeed([
        { user_id: A, item_id: 'w-pin', pin_order: 0 },
        { user_id: A, item_id: 'w-rank2', pin_order: 1 },
      ]),
    ).getProfileStats(A);
    expect(stats!.showcase.top_weapons.map((w) => w.id)).toEqual(['w-pin', 'w-rank2', 'w-rank1']);
    expect(stats!.showcase.pinned_item_ids).toEqual(['w-pin', 'w-rank2']);
  });

  it('dead pins are skipped: sparse payloads and missing items never headline', async () => {
    const stats = await new InMemoryReadStore(
      readSeed([
        { user_id: A, item_id: 'w-sparse', pin_order: 0 },
        { user_id: A, item_id: 'w-gone', pin_order: 1 },
        { user_id: A, item_id: 'w-pin', pin_order: 2 },
      ]),
    ).getProfileStats(A);
    expect(stats!.showcase.top_weapons.map((w) => w.id)).toEqual(['w-pin', 'w-rank1', 'w-rank2']);
    expect(stats!.showcase.pinned_item_ids).toEqual(['w-pin']);
  });

  it('more stored pins than slots: only the first three headline', async () => {
    const stats = await new InMemoryReadStore(
      readSeed([
        { user_id: A, item_id: 'w-pin', pin_order: 0 },
        { user_id: A, item_id: 'w-rank2', pin_order: 1 },
        { user_id: A, item_id: 'w-rank1', pin_order: 2 },
        { user_id: A, item_id: 'w-c4', pin_order: 3 },
      ]),
    ).getProfileStats(A);
    expect(stats!.showcase.top_weapons.map((w) => w.id)).toEqual(['w-pin', 'w-rank2', 'w-rank1']);
    expect(stats!.showcase.pinned_item_ids).toEqual(['w-pin', 'w-rank2', 'w-rank1']);
  });

  it("another player's pins never touch this shelf", async () => {
    const store = new InMemoryReadStore(
      readSeed([{ user_id: B, item_id: 'w-b1', pin_order: 0 }]),
    );
    const a = await store.getProfileStats(A);
    expect(a!.showcase.pinned_item_ids).toEqual([]);
    const b = await store.getProfileStats(B);
    expect(b!.showcase.top_weapons.map((w) => w.id)).toEqual(['w-b1']);
    expect(b!.showcase.pinned_item_ids).toEqual(['w-b1']);
  });
});

describe('public profile — the exposure contract', () => {
  it('carries the showcase with its pins, and exactly the public keys', async () => {
    const store = new InMemoryReadStore(
      readSeed([{ user_id: A, item_id: 'w-pin', pin_order: 0 }]),
    );
    const pub = await store.getPublicProfile(A);
    expect(pub).not.toBeNull();
    expect(pub!.showcase.top_weapons.map((w) => w.id)).toEqual(['w-pin', 'w-rank1', 'w-rank2']);
    expect(pub!.showcase.pinned_item_ids).toEqual(['w-pin']);
    // The exposure contract: this key set, nothing more. No email,
    // no credit/scrap balances, no lifetime credit/market folds.
    expect(Object.keys(pub!).sort()).toEqual([
      'display_name', 'highest_boss_tier', 'highest_item_level', 'highest_mastery_level',
      'joined_at', 'kill_death_ratio', 'last_active_at', 'legendary_items', 'level',
      'net_worth', 'player_id', 'showcase', 'total_deaths', 'total_items', 'total_kills',
      'total_mastery_xp', 'username', 'weapons_owned', 'xp',
    ]);
    const wire = JSON.stringify(pub);
    expect(wire).not.toContain('hunter@example.com');
    expect(wire).not.toContain('"credits"');
    expect(wire).not.toContain('"scrap"');
    expect(Object.keys(pub!.showcase).sort()).toEqual([
      'best_endless_depth', 'cache_rank_tokens', 'cache_rank_total_ranks',
      'collections_discovered', 'pinned_item_ids', 'top_weapons',
    ]);
  });

  it('unknown player: null, never a fabricated profile', async () => {
    const store = new InMemoryReadStore(readSeed());
    expect(await store.getPublicProfile(D)).toBeNull();
  });
});

// ─── The write path ────────────────────────────────────────────────

function writeItem(overrides: Partial<WriteItemData> & { id: string; owner_user_id: string }): WriteItemData {
  return {
    kind: 'weapon', static_item_id: null, item_level: 5, rarity: 'Rare', quality: null,
    material_tier: null, condition_state: null, condition_current: 40, condition_max: 50,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null, payload: fullPayload('Pistol'), runtime_state: 'available',
    is_locked: false, equipped_slot: null, estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function writeSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [profile({ id: A, username: 'alpha' }), profile({ id: B, username: 'bravo' })];
  s.items = [
    writeItem({ id: WA1, owner_user_id: A }),
    writeItem({ id: WA2, owner_user_id: A, rarity: 'Epic' }),
    writeItem({ id: WA3, owner_user_id: A, rarity: 'Common' }),
    writeItem({ id: WA4, owner_user_id: A, rarity: 'Common' }),
    writeItem({ id: WARMOR, owner_user_id: A, kind: 'armor', payload: { hp: 100 } }),
    writeItem({ id: WSPARSE, owner_user_id: A, payload: { weaponType: 'Pistol' } }),
    writeItem({ id: WB1, owner_user_id: B }),
  ];
  return s;
}

describe('setShowcasePins — replace, validate, persist', () => {
  it('stores the list in pin order; a second save replaces it whole', async () => {
    const store = new InMemoryWriteStore(writeSeed());
    const first = await store.setShowcasePins(A, [WA2, WA1]);
    expect(first).toEqual({ ok: true, pinned_item_ids: [WA2, WA1] });
    expect(store.seed.showcasePins).toEqual([
      { user_id: A, item_id: WA2, pin_order: 0 },
      { user_id: A, item_id: WA1, pin_order: 1 },
    ]);
    const second = await store.setShowcasePins(A, [WA3]);
    expect(second).toEqual({ ok: true, pinned_item_ids: [WA3] });
    expect(store.seed.showcasePins).toEqual([{ user_id: A, item_id: WA3, pin_order: 0 }]);
    const cleared = await store.setShowcasePins(A, []);
    expect(cleared).toEqual({ ok: true, pinned_item_ids: [] });
    expect(store.seed.showcasePins).toEqual([]);
  });

  it('dedupes repeats, keeping the first position', async () => {
    const store = new InMemoryWriteStore(writeSeed());
    expect(await store.setShowcasePins(A, [WA1, WA1, WA2])).toEqual({
      ok: true, pinned_item_ids: [WA1, WA2],
    });
  });

  it("rejects another player's item, a non-weapon, a sparse weapon, and a fourth pin", async () => {
    const store = new InMemoryWriteStore(writeSeed());
    const foreign = await store.setShowcasePins(A, [WB1]);
    expect(foreign.ok).toBe(false);
    expect(foreign.error).toContain('your own items');
    const armor = await store.setShowcasePins(A, [WARMOR]);
    expect(armor.ok).toBe(false);
    expect(armor.error).toContain('Only weapons');
    const sparse = await store.setShowcasePins(A, [WSPARSE]);
    expect(sparse.ok).toBe(false);
    const four = await store.setShowcasePins(A, [WA1, WA2, WA3, WA4]);
    expect(four.ok).toBe(false);
    expect(four.error).toContain('up to 3');
    // Nothing was written by any rejection.
    expect(store.seed.showcasePins).toEqual([]);
  });

  it('an unknown profile is a data refusal, not a throw', async () => {
    const store = new InMemoryWriteStore(writeSeed());
    expect(await store.setShowcasePins(D, [WA1])).toEqual({ ok: false, error: 'Profile not found.' });
  });
});

describe('POST /api/profile/showcase-pins — JWT identity only', () => {
  let base = '';
  let close: () => Promise<void> = async () => undefined;
  let store: InMemoryWriteStore;

  beforeAll(async () => {
    store = new InMemoryWriteStore(writeSeed());
    const app = express();
    app.use(express.json());
    mountWriteRoutes(app, store, { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    close = () => new Promise<void>((r) => server.close(() => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await close(); });

  const post = (token: string | null, payload: unknown) =>
    fetch(`${base}/api/profile/showcase-pins`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

  it("a body player id names no one — the JWT's pins are written", async () => {
    const res = await post(issueAccessToken(SECRET, A, false), { player_id: B, playerId: B, item_ids: [WA1] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pinned_item_ids: [WA1] });
    expect(store.seed.showcasePins).toEqual([{ user_id: A, item_id: WA1, pin_order: 0 }]);
  });

  it("validation failures are data (200 {ok:false}), malformed ids are 400, no token is 401", async () => {
    const foreign = await post(issueAccessToken(SECRET, A, false), { item_ids: [WB1] });
    expect(foreign.status).toBe(200);
    expect((await foreign.json() as { ok: boolean }).ok).toBe(false);
    const malformed = await post(issueAccessToken(SECRET, A, false), { item_ids: ['not-a-uuid'] });
    expect(malformed.status).toBe(400);
    const anon = await post(null, { item_ids: [WA1] });
    expect(anon.status).toBe(401);
  });
});
