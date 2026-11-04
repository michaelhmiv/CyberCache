/**
 * Batch salvage (0055) — one ceiling settles the whole eligible set.
 *
 * The owner froze his game scrapping 1,000+ items through the old
 * per-item loop (1,000 requests, 1,000 pop-ups). These tests pin the
 * replacement contract:
 *   - the set is resolved SERVER-side (owned, available, unlocked,
 *     gear kinds, rarity ≤ ceiling) — never from a client list;
 *   - 'Legendary' is not a valid ceiling, and legendaries are never
 *     in a batch at any ceiling;
 *   - the batch yield is the per-item path SUMMED, proven against
 *     sequential recycleItem calls on a twin store with identical
 *     seed + RNG (skill bonuses and King of Scrap material rolls
 *     included);
 *   - a 1,500-item batch settles in ONE call with exact totals;
 *   - nonce replay returns the original settlement, nothing
 *     double-scraps;
 *   - an invalid ceiling fails cleanly and scraps nothing.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import {
  emptyWriteSeed,
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import { salvageScrap } from '../lib/skills/salvageBonuses';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const uid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Deterministic RNG so twin stores consume identical roll streams. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
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
    kind: 'weapon', static_item_id: null, item_level: 5, rarity: 'Common', quality: null,
    material_tier: null, condition_state: null, condition_current: 40, condition_max: 50,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null, payload: { weaponType: 'Pistol' }, runtime_state: 'available',
    is_locked: false, equipped_slot: null, estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

// Fixture ids (id order = the batch's deterministic settle order).
const C1 = uid(1); // Common weapon L5     — eligible
const C2 = uid(2); // Common shield L10    — eligible
const U1 = uid(3); // Uncommon weapon L8   — eligible
const R1 = uid(4); // Rare weapon L12, Market Crash (4x) — eligible
const R2 = uid(5); // Rare relic L3        — eligible
const E1 = uid(6); // Epic weapon L20      — eligible at Epic ceiling
const E2 = uid(7); // Epic classMod L15    — eligible at Epic ceiling
const L1 = uid(8); // Legendary weapon L30 — NEVER in a batch
const LOCKED = uid(9); // Rare, locked     — excluded
const EQUIPPED = uid(10); // Epic, equipped — excluded
const LISTED = uid(11); // Uncommon, listed — excluded
const VEHICLE = uid(12); // Rare vehicle kind — excluded (own lane)
const COSMETIC = uid(13); // Common cosmetic kind — excluded (own lane)
const B1 = uid(14); // B's Common weapon — not A's to scrap

function richSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({
      id: A, username: 'alpha', player_level: 20, credits: 1000, scrap: 100,
      materials: { Scrap: 20 },
      // Salvage skill tree spent: Hoarder's Instinct + King of Scrap
      // both live, so bonuses AND the Common material roll engage.
      skill_spends: { scav_major_1: 1, scav_keystone: 1 },
    }),
    profile({ id: B, username: 'bravo', player_level: 3, credits: 500, scrap: 0 }),
  ];
  s.items = [
    item({ id: C1, owner_user_id: A, rarity: 'Common', item_level: 5 }),
    item({ id: C2, owner_user_id: A, kind: 'shield', rarity: 'Common', item_level: 10, payload: { hp: 90 } }),
    item({ id: U1, owner_user_id: A, rarity: 'Uncommon', item_level: 8 }),
    item({ id: R1, owner_user_id: A, rarity: 'Rare', item_level: 12, payload: { weaponType: 'Pistol', legendaryEffectId: 'market_crash' } }),
    item({ id: R2, owner_user_id: A, kind: 'relic', rarity: 'Rare', item_level: 3, payload: {} }),
    item({ id: E1, owner_user_id: A, rarity: 'Epic', item_level: 20 }),
    item({ id: E2, owner_user_id: A, kind: 'classMod', rarity: 'Epic', item_level: 15, payload: {} }),
    item({ id: L1, owner_user_id: A, rarity: 'Legendary', item_level: 30, payload: { weaponType: 'Pistol', legendaryEffectId: 'some_effect' } }),
    item({ id: LOCKED, owner_user_id: A, rarity: 'Rare', is_locked: true }),
    item({ id: EQUIPPED, owner_user_id: A, rarity: 'Epic', runtime_state: 'equipped', equipped_slot: 'primary' }),
    item({ id: LISTED, owner_user_id: A, rarity: 'Uncommon', runtime_state: 'listed' }),
    item({ id: VEHICLE, owner_user_id: A, kind: 'vehicle', rarity: 'Rare', payload: {} }),
    item({ id: COSMETIC, owner_user_id: A, kind: 'cosmetic', rarity: 'Common', payload: { slot: 'head' } }),
    item({ id: B1, owner_user_id: B, rarity: 'Common', item_level: 4 }),
  ];
  return s;
}

function makeStore(seed: WriteSeed, rngSeed = 42): InMemoryWriteStore {
  return new InMemoryWriteStore(seed, {
    now: () => new Date('2026-11-02T12:00:00.000Z'),
    rng: lcg(rngSeed),
    uuid: () => uid(9999),
  });
}

function itemState(store: InMemoryWriteStore, id: string): string {
  const seed = (store as unknown as { seed: WriteSeed }).seed;
  return seed.items.find((i) => i.id === id)?.runtime_state ?? 'missing';
}

function profileOf(store: InMemoryWriteStore, id: string): ProfileRowData {
  const seed = (store as unknown as { seed: WriteSeed }).seed;
  const row = seed.profiles.find((p) => p.id === id) as ProfileRowData;
  // Econ 5 (0069): the scrap balance lives in materials['Scrap']; the
  // row's scrap field is the retired tombstone (seeds fold + zero it).
  return { ...row, scrap: row.materials['Scrap'] ?? 0 };
}

describe('batch salvage — settlement contract', () => {
  it('settles the Rare ceiling: exact set, counts, and exclusions', async () => {
    const store = makeStore(richSeed());
    const result = (await store.recycleBatch(A, 'batch-nonce-0001', 'Rare')) as Record<string, unknown>;

    expect(result.action_type).toBe('cc_recycle_batch');
    expect(result.scrapped_count).toBe(5);
    expect(result.counts_by_rarity).toEqual({ Common: 2, Uncommon: 1, Rare: 2 });
    expect(result.cores_award).toBe(0); // cores mint from Legendaries only — never in a batch
    expect(Array.isArray(result.items)).toBe(true);
    expect((result.items as unknown[]).length).toBe(5);
    expect(Number(result.scrap_award)).toBeGreaterThan(0);

    for (const id of [C1, C2, U1, R1, R2]) expect(itemState(store, id)).toBe('consumed');
    for (const id of [E1, E2, L1, LOCKED, EQUIPPED, LISTED, VEHICLE, COSMETIC, B1]) {
      expect(itemState(store, id)).not.toBe('consumed');
    }
    expect(itemState(store, EQUIPPED)).toBe('equipped');
    expect(itemState(store, LISTED)).toBe('listed');

    // The profile gained exactly the reported aggregate.
    // Opening balance is the merged 120 (seed column 100 + stack 20).
    expect(profileOf(store, A).scrap).toBe(120 + Number(result.scrap_award));
  });

  it('Epic ceiling takes the epics but never the legendary', async () => {
    const store = makeStore(richSeed());
    const result = (await store.recycleBatch(A, 'batch-nonce-0002', 'Epic')) as Record<string, unknown>;
    expect(result.scrapped_count).toBe(7);
    expect(result.counts_by_rarity).toEqual({ Common: 2, Uncommon: 1, Rare: 2, Epic: 2 });
    expect(itemState(store, E1)).toBe('consumed');
    expect(itemState(store, E2)).toBe('consumed');
    expect(itemState(store, L1)).toBe('available');
  });

  it('rejects Legendary (and junk) ceilings and scraps nothing', async () => {
    const store = makeStore(richSeed());
    await expect(store.recycleBatch(A, 'batch-nonce-0003', 'Legendary')).rejects.toThrow(/Invalid salvage ceiling/);
    await expect(store.recycleBatch(A, 'batch-nonce-0004', 'everything')).rejects.toThrow(/Invalid salvage ceiling/);
    expect(itemState(store, C1)).toBe('available');
    expect(profileOf(store, A).scrap).toBe(120);
  });

  it('nonce replay returns the original settlement without double-scrapping', async () => {
    const store = makeStore(richSeed());
    const first = (await store.recycleBatch(A, 'batch-nonce-0005', 'Common')) as Record<string, unknown>;
    const scrapAfterFirst = profileOf(store, A).scrap;
    const second = (await store.recycleBatch(A, 'batch-nonce-0005', 'Common')) as Record<string, unknown>;
    expect(second.scrapped_count).toBe(first.scrapped_count);
    expect(second.scrap_award).toBe(first.scrap_award);
    expect(profileOf(store, A).scrap).toBe(scrapAfterFirst);
  });

  it("one player's batch never touches another player's items", async () => {
    const store = makeStore(richSeed());
    const result = (await store.recycleBatch(B, 'batch-nonce-0006', 'Epic')) as Record<string, unknown>;
    expect(result.scrapped_count).toBe(1);
    expect(itemState(store, B1)).toBe('consumed');
    expect(itemState(store, C1)).toBe('available');
  });

  it('empty eligible set is a clean zero settlement, not an error', async () => {
    const store = makeStore(richSeed());
    await store.recycleBatch(A, 'batch-nonce-0007', 'Epic');
    const again = (await store.recycleBatch(A, 'batch-nonce-0008', 'Epic')) as Record<string, unknown>;
    expect(again.scrapped_count).toBe(0);
    expect(again.scrap_award).toBe(0);
    expect(again.counts_by_rarity).toEqual({});
  });
});

describe('batch salvage — yield parity with the per-item path', () => {
  it('batch totals equal sequential recycleItem totals on a twin store (bonuses + material rolls live)', async () => {
    const batchStore = makeStore(richSeed(), 1234);
    const seqStore = makeStore(richSeed(), 1234);

    const batch = (await batchStore.recycleBatch(A, 'parity-batch-nonce', 'Epic')) as Record<string, unknown>;

    // Sequential: the same eligible set, in the batch's id order,
    // through the one-at-a-time op with fresh nonces.
    const eligibleInOrder = [C1, C2, U1, R1, R2, E1, E2];
    let seqScrap = 0;
    let seqCores = 0;
    const seqMaterials: Record<string, number> = {};
    for (const [i, id] of eligibleInOrder.entries()) {
      const r = (await seqStore.recycleItem(A, `parity-seq-nonce-${i}`, id)) as Record<string, unknown>;
      seqScrap += Number(r.scrap_award ?? 0);
      seqCores += Number(r.cores_award ?? 0);
      if (typeof r.bonus_material === 'string') {
        seqMaterials[r.bonus_material] = (seqMaterials[r.bonus_material] ?? 0) + 1;
      }
    }

    expect(Number(batch.scrap_award)).toBe(seqScrap);
    expect(Number(batch.cores_award)).toBe(seqCores);
    expect(batch.bonus_materials).toEqual(seqMaterials);
    // End-state profiles agree on every economy field the op touches.
    const bp = profileOf(batchStore, A);
    const sp = profileOf(seqStore, A);
    expect(bp.scrap).toBe(sp.scrap);
    expect(bp.legendary_cores ?? 0).toBe(sp.legendary_cores ?? 0);
    expect(bp.materials).toEqual(sp.materials);
  });
});

describe('batch salvage — 1,500-item settlement', () => {
  // Explicit long timeout: the subject is settlement CORRECTNESS at
  // the owner's scale, and the InMemory twin's shared record() path
  // deep-clones the ledger on every per-item record (O(N^2) in the
  // test double) — 1,500 honest settlements take well over the 5s
  // default even on CI hardware. The Postgres path settles the same
  // batch in a single SQL function call.
  it('settles 1,500 items in ONE call with formula-exact totals', async () => {
    const s = emptyWriteSeed();
    s.profiles = [profile({ id: A, username: 'hoarder', player_level: 50, scrap: 0 })];
    const N = 1500;
    let expectedScrap = 0;
    for (let i = 0; i < N; i++) {
      const level = (i % 40) + 1;
      expectedScrap += salvageScrap('Common', level);
      s.items.push(item({ id: uid(10000 + i), owner_user_id: A, rarity: 'Common', item_level: level }));
    }
    const store = makeStore(s);
    const result = (await store.recycleBatch(A, 'batch-nonce-1500', 'Common')) as Record<string, unknown>;
    expect(result.scrapped_count).toBe(N);
    expect(result.counts_by_rarity).toEqual({ Common: N });
    expect(Number(result.scrap_award)).toBe(expectedScrap);
    expect(profileOf(store, A).scrap).toBe(expectedScrap);
    const storeItems = (store as unknown as { seed: WriteSeed }).seed.items;
    expect(storeItems.every((i) => i.runtime_state === 'consumed')).toBe(true);
  }, 240_000);
});

describe('batch salvage — HTTP route', () => {
  let server: { close: () => Promise<void> };
  let base = '';
  let tokenA = '';

  afterAll(async () => {
    await server?.close();
  });

  it('POST /api/ops/recycle-batch settles and reports aggregates; bad ceiling is a clean failure', async () => {
    const store = makeStore(richSeed());
    const app = express();
    app.use(express.json());
    mountWriteRoutes(app, store, { jwtSecret: SECRET });
    const srv = app.listen(0);
    await new Promise<void>((resolve) => srv.on('listening', resolve));
    server = { close: () => new Promise<void>((resolve) => srv.close(() => resolve())) };
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    tokenA = issueAccessToken(SECRET, A, false);

    const post = async (payload: unknown) => {
      const res = await fetch(`${base}/api/ops/recycle-batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenA}` },
        body: JSON.stringify(payload),
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };

    const bad = await post({ nonce: 'http-batch-nonce-bad', max_rarity: 'Legendary' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(itemState(store, C1)).toBe('available');

    const ok = await post({ nonce: 'http-batch-nonce-ok', max_rarity: 'Uncommon' });
    expect(ok.status).toBe(200);
    expect(ok.json.scrapped_count).toBe(3);
    expect(ok.json.counts_by_rarity).toEqual({ Common: 2, Uncommon: 1 });
    expect(itemState(store, U1)).toBe('consumed');
    expect(itemState(store, R1)).toBe('available');
  });
});
