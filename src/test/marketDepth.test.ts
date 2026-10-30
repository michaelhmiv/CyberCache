/**
 * Market depth & accessibility (migration 0019) — shipped-path tests.
 *
 * Layers covered:
 *   1. The shared TS owners (src/lib/market/identityKey.ts,
 *      priceStats.ts, listingQuery.ts): the identity-key scheme,
 *      median/trend math (odd/even/empty), and the browse fold.
 *   2. HTTP through the real write routes + InMemoryWriteStore (the
 *      mirror of the 0019 SQL): consumable escrow → sale delivers the
 *      exact stack with quality % preserved and the fee charged;
 *      cancel returns escrow; materials by quantity; nonce replay
 *      never double-delivers; guest gating unchanged.
 *   3. HTTP through the real read routes + InMemoryReadStore: every
 *      browse filter against a seeded market, sorts, pagination
 *      totals, and price-stats math over seeded completed sales.
 *   4. Source pins on db/migrations/0019_market_depth.sql so the SQL
 *      path cannot drift from the TS owners silently. (The SQL
 *      functions themselves are exercised against embedded Postgres
 *      in the slice verification harness.)
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import {
  emptyWriteSeed,
  type ConsumableBatchData,
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import { mountReadRoutes } from '../server/reads/routes';
import {
  InMemoryReadStore,
  emptyReadSeed,
  type MemListing,
  type ProfileRowData,
  type ReadSeed,
} from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import {
  consumableIdentityKey,
  gearIdentityFromPayload,
  gearIdentityKey,
  materialIdentityKey,
  qualityBand,
} from '../lib/market/identityKey';
import { computePriceStats, median } from '../lib/market/priceStats';
import { applyListingQuery, type MarketBrowseRow } from '../lib/market/listingQuery';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const NOW_ISO = '2026-10-30T12:00:00.000Z';
const NOW = new Date(NOW_ISO);

const S = '11111111-1111-4111-8111-111111111111'; // seller
const B = '22222222-2222-4222-8222-222222222222'; // buyer
const K = '33333333-3333-4333-8333-333333333333'; // Darknet-maxed seller
const G = '44444444-4444-4444-8444-444444444444'; // guest
const P3 = '55555555-5555-4555-8555-555555555555'; // second seller (reads)
const NPC = '00000000-0000-0000-0000-000000000000';

const BATCH_MEDKIT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const BATCH_LEGACY = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const BATCH_K = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const ITEM_GEAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

// ---------------------------------------------------------------------------
// 1. Shared TS owners
// ---------------------------------------------------------------------------

describe('identityKey — the price-history identity scheme', () => {
  it('keys weapons by type + rarity + 10-level band', () => {
    expect(gearIdentityKey({ category: 'weapon', weaponType: 'Pistol', rarity: 'Rare', level: 5 }))
      .toBe('gear:weapon:Pistol:Rare:b0');
    expect(gearIdentityKey({ category: 'weapon', weaponType: 'Pistol', rarity: 'Rare', level: 10 }))
      .toBe('gear:weapon:Pistol:Rare:b0');
    expect(gearIdentityKey({ category: 'weapon', weaponType: 'Pistol', rarity: 'Rare', level: 11 }))
      .toBe('gear:weapon:Pistol:Rare:b1');
    expect(gearIdentityKey({ category: 'weapon', weaponType: 'Pistol', rarity: 'Rare', level: 25 }))
      .toBe('gear:weapon:Pistol:Rare:b2');
  });

  it('keys non-weapon gear by category + rarity + band', () => {
    expect(gearIdentityKey({ category: 'shield', rarity: 'Epic', level: 12 }))
      .toBe('gear:shield:Epic:b1');
    expect(gearIdentityFromPayload({ mitigation: 0.2, hp: 300, rarity: 'Epic', level: 12 }))
      .toBe('gear:shield:Epic:b1');
    expect(gearIdentityFromPayload({ treeBonus: 'Gunslinger', rarity: 'Rare', level: 3 }))
      .toBe('gear:classMod:Rare:b0');
    expect(gearIdentityFromPayload({ damage: 40, effect: 'burn', rarity: 'Common', level: 1 }))
      .toBe('gear:ordnance:Common:b0');
  });

  it('bands consumable quality around the shipped craft ranges', () => {
    expect(qualityBand(70)).toBe('q0');
    expect(qualityBand(79)).toBe('q0');
    expect(qualityBand(80)).toBe('q1');
    expect(qualityBand(100)).toBe('q1');
    expect(qualityBand(101)).toBe('q2');
    expect(qualityBand(120)).toBe('q2');
    expect(qualityBand(121)).toBe('q3');
    expect(qualityBand(140)).toBe('q3');
    expect(qualityBand(141)).toBe('q4');
    expect(consumableIdentityKey('MedKit', 137.5)).toBe('cons:MedKit:q3');
    expect(materialIdentityKey('ScrapAlloy')).toBe('mat:ScrapAlloy');
  });
});

describe('priceStats — median / trend math', () => {
  const now = Date.parse(NOW_ISO);
  const day = 24 * 60 * 60 * 1000;

  it('median: odd, even, single, empty', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });

  it('folds a key: count, median, last, trend down', () => {
    const key = 'gear:weapon:Pistol:Rare:b0';
    const stats = computePriceStats([
      { identityKey: key, unitPrice: 1000, soldAt: now - 2 * day },
      { identityKey: key, unitPrice: 1200, soldAt: now - 3 * day },
      { identityKey: key, unitPrice: 800, soldAt: now - 10 * day },
      { identityKey: key, unitPrice: 2000, soldAt: now - 12 * day },
    ], [key], now)[key];
    expect(stats.salesCount).toBe(4);
    expect(stats.medianUnitPrice).toBe(1100); // (1000 + 1200) / 2
    expect(stats.lastUnitPrice).toBe(1000);
    expect(stats.lastSoldAt).toBe(now - 2 * day);
    expect(stats.median7d).toBe(1100);
    expect(stats.medianPrev7d).toBe(1400); // (800 + 2000) / 2
    expect(stats.trend).toBe('down');
    expect(stats.trendPct).toBeCloseTo(-300 / 1400, 6);
    expect(stats.recentUnitPrices).toEqual([2000, 800, 1200, 1000]);
  });

  it('trend up and flat bands', () => {
    const up = computePriceStats([
      { identityKey: 'k', unitPrice: 100, soldAt: now - 10 * day },
      { identityKey: 'k', unitPrice: 200, soldAt: now - 1 * day },
    ], ['k'], now).k;
    expect(up.trend).toBe('up');
    const flat = computePriceStats([
      { identityKey: 'k', unitPrice: 100, soldAt: now - 10 * day },
      { identityKey: 'k', unitPrice: 103, soldAt: now - 1 * day },
    ], ['k'], now).k;
    expect(flat.trend).toBe('flat');
  });

  it('an unknown key yields zeroed stats with null prices — no crash', () => {
    const stats = computePriceStats([], ['mat:VoidDust'], now)['mat:VoidDust'];
    expect(stats.salesCount).toBe(0);
    expect(stats.medianUnitPrice).toBeNull();
    expect(stats.lastUnitPrice).toBeNull();
    expect(stats.lastSoldAt).toBeNull();
    expect(stats.trend).toBeNull();
    expect(stats.recentUnitPrices).toEqual([]);
  });

  it('a sale older than 30 days still anchors last-sold but not the median', () => {
    const stats = computePriceStats([
      { identityKey: 'k', unitPrice: 900, soldAt: now - 40 * day },
    ], ['k'], now).k;
    expect(stats.salesCount).toBe(0);
    expect(stats.medianUnitPrice).toBeNull();
    expect(stats.lastUnitPrice).toBe(900);
  });
});

describe('listingQuery — the browse fold', () => {
  const row = (over: Partial<MarketBrowseRow> & { id: string }): MarketBrowseRow => ({
    sellerId: S, sellerType: 'player', kind: 'gear', category: 'weapon',
    displayName: 'Item', weaponType: 'Pistol', element: 'Fire', rarity: 'Rare',
    itemLevel: 5, price: 1000, quantity: 1, unitPrice: 1000, qualityPercent: null,
    consumableType: null, materialId: null, identityKey: 'k', listedAt: 1000,
    ...over,
  });
  const rows = [
    row({ id: 'a', price: 500, listedAt: 3000 }),
    row({ id: 'b', price: 1500, category: 'shield', weaponType: null, element: null, rarity: 'Epic', itemLevel: 20, listedAt: 2000 }),
    row({ id: 'c', price: 250, kind: 'material', category: 'material', displayName: 'ScrapAlloy', weaponType: null, element: null, rarity: null, itemLevel: null, quantity: 10, unitPrice: 25, listedAt: 1000 }),
  ];

  it('filters and reports the full total alongside the page', () => {
    const all = applyListingQuery(rows, {});
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']); // newest first
    expect(applyListingQuery(rows, { category: 'material' }).rows.map((r) => r.id)).toEqual(['c']);
    expect(applyListingQuery(rows, { rarity: 'Epic' }).rows.map((r) => r.id)).toEqual(['b']);
    expect(applyListingQuery(rows, { priceMax: 600 }).total).toBe(2);
    const page = applyListingQuery(rows, { limit: 2, offset: 2 });
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.id)).toEqual(['c']);
  });

  it('sorts by price both directions and by level with nulls last', () => {
    expect(applyListingQuery(rows, { sort: 'price_asc' }).rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(applyListingQuery(rows, { sort: 'price_desc' }).rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(applyListingQuery(rows, { sort: 'level' }).rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// 2. Write paths (HTTP + InMemoryWriteStore, mirror of the 0019 SQL)
// ---------------------------------------------------------------------------

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

function batch(overrides: Partial<ConsumableBatchData> & { id: string; owner_user_id: string }): ConsumableBatchData {
  return {
    consumable_type: 'MedKit', quality_percent: 137.5, quantity: 10, origin: 'crafted',
    creator_user_id: overrides.owner_user_id, source_recipe_id: 'medkit_recipe',
    metadata: {}, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function writeSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({ id: S, username: 'seller', credits: 0, consumables: { MedKit: 10 }, materials: { ScrapAlloy: 40, VoidDust: 3 } }),
    profile({ id: B, username: 'buyer', credits: 100_000 }),
    profile({ id: K, username: 'skilled', credits: 0, consumables: { ShieldCell: 2 }, skill_spends: { scav_fee_1: 5 } }),
    profile({ id: G, username: 'guest', account_type: 'guest', email_verified_at: null, consumables: { MedKit: 5 } }),
  ];
  s.consumableBatches = [
    batch({ id: BATCH_MEDKIT, owner_user_id: S }),
    batch({ id: BATCH_LEGACY, owner_user_id: S, consumable_type: 'ElementalCoating', quality_percent: 100, quantity: 1, origin: 'vendor', creator_user_id: null, source_recipe_id: null }),
    batch({ id: BATCH_K, owner_user_id: K, consumable_type: 'ShieldCell', quality_percent: 100, quantity: 2, origin: 'crafted', source_recipe_id: 'shield_recipe' }),
  ];
  s.items = [
    {
      id: ITEM_GEAR, owner_user_id: S, kind: 'weapon', static_item_id: null, item_level: 5,
      rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
      condition_current: 40, condition_max: 50, supply_mode: 'verified_action', source_id: null,
      creator_user_id: null, tradeable: true, account_bound: false, locked_until: null,
      payload: { name: 'Rusty Pistol', weaponType: 'Pistol', element: 'Fire', rarity: 'Rare', level: 5, sourceTag: 'World Drop' },
      runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 500,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    } satisfies WriteItemData,
  ];
  return s;
}

interface WriteHarness {
  store: InMemoryWriteStore;
  base: string;
  close: () => Promise<void>;
  tokens: Record<string, string>;
}

async function makeWriteServer(): Promise<WriteHarness> {
  const store = new InMemoryWriteStore(writeSeed(), {
    now: () => new Date(NOW),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const tokens: Record<string, string> = {};
  for (const id of [S, B, K, G]) tokens[id] = issueAccessToken(SECRET, id, id === G);
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    tokens,
  };
}

async function post(h: WriteHarness, path: string, token: string, payload: unknown) {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

let nonceCounter = 0;
function nonce(): string {
  nonceCounter += 1;
  return `depth-nonce-${nonceCounter}-abcdef`;
}

describe('market depth — write paths', () => {
  let h: WriteHarness;
  beforeAll(async () => { h = await makeWriteServer(); });
  afterAll(async () => { await h.close(); });

  const creditsOf = (id: string) => h.store.seed.profiles.find((p) => p.id === id)?.credits ?? 0;
  const batchOf = (id: string) => h.store.seed.consumableBatches.find((b) => b.id === id);
  const profileOf = (id: string) => h.store.seed.profiles.find((p) => p.id === id);

  it('gear listings are stamped with browse facts at creation', async () => {
    const created = await post(h, '/api/ops/market-create', h.tokens[S], {
      nonce: nonce(), item_id: ITEM_GEAR, price_credits: 4000,
    });
    expect(created.status).toBe(200);
    const listing = created.json.listing as Record<string, unknown>;
    expect(listing.listing_kind).toBe('gear');
    expect(listing.identity_key).toBe('gear:weapon:Pistol:Rare:b0');
    expect(listing.category).toBe('weapon');
    expect(listing.weapon_type).toBe('Pistol');
    expect(listing.element).toBe('Fire');
    expect(listing.display_name).toBe('Rusty Pistol');
    expect(listing.seller_type).toBe('player');
    const cancel = await post(h, '/api/ops/market-cancel', h.tokens[S], {
      nonce: nonce(), listing_id: listing.id,
    });
    expect(cancel.status).toBe(200);
  });

  it('consumable: escrow at list, exact stack + quality delivered at sale, fee charged', async () => {
    const created = await post(h, '/api/ops/market-create-consumable', h.tokens[S], {
      nonce: nonce(), batch_id: BATCH_MEDKIT, quantity: 4, price_credits: 2000,
    });
    expect(created.status).toBe(200);
    const listing = created.json.listing as Record<string, unknown>;
    expect(listing.listing_kind).toBe('consumable');
    expect(listing.identity_key).toBe('cons:MedKit:q3');
    expect(listing.quality_percent).toBe(137.5);
    expect(listing.quantity).toBe(4);
    // Escrow: the seller's batch and count map drop immediately.
    expect(batchOf(BATCH_MEDKIT)?.quantity).toBe(6);
    expect(profileOf(S)?.consumables.MedKit).toBe(6);

    const accepted = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: 'depth-accept-1-abcdef', listing_id: listing.id,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json.market_fee.fee_credits).toBe(100); // 5% of 2000
    expect(accepted.json.market_fee.seller_proceeds).toBe(1900);
    expect(accepted.json.delivery).toMatchObject({ kind: 'consumable', quantity: 4, quality_percent: 137.5 });
    expect(creditsOf(B)).toBe(98_000);
    expect(creditsOf(S)).toBe(1900);
    // The buyer owns the exact stack: same quality, origin, creator, recipe.
    const delivered = h.store.seed.consumableBatches.find(
      (b) => b.owner_user_id === B && b.consumable_type === 'MedKit',
    );
    expect(delivered).toMatchObject({
      quality_percent: 137.5, quantity: 4, origin: 'crafted',
      creator_user_id: S, source_recipe_id: 'medkit_recipe',
    });
    expect(profileOf(B)?.consumables.MedKit).toBe(4);

    // Replay of the purchase nonce moves nothing a second time.
    const replay = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: 'depth-accept-1-abcdef', listing_id: listing.id,
    });
    expect(replay.status).toBe(200);
    expect(replay.json.market_fee.fee_credits).toBe(100);
    expect(creditsOf(B)).toBe(98_000);
    expect(creditsOf(S)).toBe(1900);
    expect(h.store.seed.consumableBatches.find((b) => b.owner_user_id === B && b.consumable_type === 'MedKit')?.quantity).toBe(4);
  });

  it('consumable: cancelling a listing returns the escrowed stack', async () => {
    const created = await post(h, '/api/ops/market-create-consumable', h.tokens[S], {
      nonce: nonce(), batch_id: BATCH_MEDKIT, quantity: 2, price_credits: 900,
    });
    expect(created.status).toBe(200);
    expect(batchOf(BATCH_MEDKIT)?.quantity).toBe(4);
    expect(profileOf(S)?.consumables.MedKit).toBe(4);
    const cancelled = await post(h, '/api/ops/market-cancel', h.tokens[S], {
      nonce: nonce(), listing_id: (created.json.listing as Record<string, unknown>).id,
    });
    expect(cancelled.status).toBe(200);
    expect(batchOf(BATCH_MEDKIT)?.quantity).toBe(6);
    expect(profileOf(S)?.consumables.MedKit).toBe(6);
  });

  it('material: list by quantity, buy by quantity, fee applies', async () => {
    const created = await post(h, '/api/ops/market-create-material', h.tokens[S], {
      nonce: nonce(), material_id: 'ScrapAlloy', quantity: 10, price_credits: 3000,
    });
    expect(created.status).toBe(200);
    const listing = created.json.listing as Record<string, unknown>;
    expect(listing.listing_kind).toBe('material');
    expect(listing.identity_key).toBe('mat:ScrapAlloy');
    expect(profileOf(S)?.materials.ScrapAlloy).toBe(30);

    const accepted = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: listing.id,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json.market_fee.fee_credits).toBe(150); // 5% of 3000
    expect(profileOf(B)?.materials.ScrapAlloy).toBe(10);
    expect(creditsOf(S)).toBe(1900 + 2850);
    expect(creditsOf(B)).toBe(98_000 - 3000);
  });

  it('Darknet Broker reduction applies to stack sales (no Manipulator term)', async () => {
    const created = await post(h, '/api/ops/market-create-consumable', h.tokens[K], {
      nonce: nonce(), batch_id: BATCH_K, quantity: 1, price_credits: 10_000,
    });
    expect(created.status).toBe(200);
    const accepted = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: (created.json.listing as Record<string, unknown>).id,
    });
    expect(accepted.status).toBe(200);
    // 5% fee, reduced 25% by 5 Darknet points → floor(10000 × .05 × .75) = 375.
    expect(accepted.json.market_fee.fee_credits).toBe(375);
    expect(accepted.json.market_fee.found_item).toBe(false);
    expect(creditsOf(K)).toBe(9625);
  });

  it('validates quantities, eligibility, and materials', async () => {
    const tooMany = await post(h, '/api/ops/market-create-consumable', h.tokens[S], {
      nonce: nonce(), batch_id: BATCH_MEDKIT, quantity: 99, price_credits: 100,
    });
    expect(tooMany.status).toBe(400);
    const legacy = await post(h, '/api/ops/market-create-consumable', h.tokens[S], {
      nonce: nonce(), batch_id: BATCH_LEGACY, quantity: 1, price_credits: 100,
    });
    expect(legacy.status).toBe(400); // ElementalCoating is playerMarketAllowed=false
    const badMaterial = await post(h, '/api/ops/market-create-material', h.tokens[S], {
      nonce: nonce(), material_id: 'Unobtanium', quantity: 1, price_credits: 100,
    });
    expect(badMaterial.status).toBe(400);
    const tooMuchMaterial = await post(h, '/api/ops/market-create-material', h.tokens[S], {
      nonce: nonce(), material_id: 'VoidDust', quantity: 99, price_credits: 100,
    });
    expect(tooMuchMaterial.status).toBe(400);
  });

  it('guest gating is unchanged: guests cannot create listings', async () => {
    const guestBatch = h.store.seed.consumableBatches.find((b) => b.owner_user_id === G);
    const res = await post(h, '/api/ops/market-create-material', h.tokens[G], {
      nonce: nonce(), material_id: 'ScrapAlloy', quantity: 1, price_credits: 100,
    });
    expect(res.status).toBe(403);
    expect(guestBatch).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Read paths (HTTP + InMemoryReadStore)
// ---------------------------------------------------------------------------

function readSeed(): ReadSeed {
  const s = emptyReadSeed();
  s.profiles = [profile({ id: S }), profile({ id: B }), profile({ id: P3 })];
  const item = (over: Record<string, unknown>): ReadSeed['items'][number] => ({
    id: '', owner_user_id: S, kind: 'weapon', item_level: 1, rarity: 'Common', is_locked: false,
    runtime_state: 'listed', equipped_slot: null, payload: {}, created_at: '2026-10-01T00:00:00.000Z',
    ...over,
  } as ReadSeed['items'][number]);
  s.items = [
    item({ id: 'ri-pistol', payload: { name: 'Rusty Pistol', weaponType: 'Pistol', element: 'Fire', rarity: 'Rare', level: 5 }, item_level: 5, rarity: 'Rare' }),
    item({ id: 'ri-sniper', payload: { name: 'Long Void', weaponType: 'Sniper', element: 'Void', rarity: 'Epic', level: 25 }, item_level: 25, rarity: 'Epic' }),
    item({ id: 'ri-shield', kind: 'shield', payload: { name: 'Aegis Wall', mitigation: 0.2, hp: 300, rarity: 'Rare', level: 12 }, item_level: 12, rarity: 'Rare' }),
    item({ id: 'ri-relic', kind: 'relic', payload: { name: 'Old Relic', affixes: [], rarity: 'Epic', level: 25 }, item_level: 25, rarity: 'Epic' }),
    item({ id: 'ri-npc', payload: { name: 'Stock Pistol', weaponType: 'Pistol', element: 'Kinetic', rarity: 'Common', level: 3 }, item_level: 3, rarity: 'Common' }),
  ];
  const listing = (over: Partial<MemListing> & { id: string }): MemListing => ({
    seller_user_id: S, item_instance_id: null, price_credits: 1000, status: 'active',
    listed_at: '2026-10-29T00:00:00.000Z', sold_at: null, ...over,
  });
  s.listings = [
    listing({ id: 'rl-pistol', item_instance_id: 'ri-pistol', price_credits: 1000, listed_at: '2026-10-29T10:00:00.000Z' }),
    listing({ id: 'rl-sniper', item_instance_id: 'ri-sniper', price_credits: 9000, listed_at: '2026-10-28T10:00:00.000Z' }),
    listing({ id: 'rl-shield', seller_user_id: P3, item_instance_id: 'ri-shield', price_credits: 2500, listed_at: '2026-10-27T10:00:00.000Z' }),
    listing({ id: 'rl-relic', seller_user_id: P3, item_instance_id: 'ri-relic', price_credits: 7000, listed_at: '2026-10-26T10:00:00.000Z' }),
    listing({
      id: 'rl-cons', price_credits: 2000, listed_at: '2026-10-29T12:00:00.000Z',
      listing_kind: 'consumable', quantity: 4, quality_percent: 137.5, consumable_type: 'MedKit',
      identity_key: 'cons:MedKit:q3', category: 'consumable', display_name: 'Med Kit',
    }),
    listing({
      id: 'rl-mat', seller_user_id: P3, price_credits: 3000, listed_at: '2026-10-25T10:00:00.000Z',
      listing_kind: 'material', quantity: 10, material_id: 'ScrapAlloy',
      identity_key: 'mat:ScrapAlloy', category: 'material', display_name: 'ScrapAlloy',
    }),
    listing({ id: 'rl-npc', seller_user_id: NPC, item_instance_id: 'ri-npc', price_credits: 500, listed_at: '2026-10-24T10:00:00.000Z', seller_type: 'npc' }),
    // Completed sales for price stats (gear:weapon:Pistol:Rare:b0).
    listing({ id: 'rs-1', status: 'sold', item_instance_id: 'ri-pistol', price_credits: 1000, sold_at: '2026-10-28T12:00:00.000Z' }),
    listing({ id: 'rs-2', status: 'sold', item_instance_id: 'ri-pistol', price_credits: 1200, sold_at: '2026-10-27T12:00:00.000Z' }),
    listing({ id: 'rs-3', status: 'sold', item_instance_id: 'ri-pistol', price_credits: 800, sold_at: '2026-10-20T12:00:00.000Z' }),
    listing({ id: 'rs-4', status: 'sold', item_instance_id: 'ri-pistol', price_credits: 2000, sold_at: '2026-10-18T12:00:00.000Z' }),
    // Consumable sales are compared on UNIT price: 2000/4 = 500, 1200/2 = 600.
    listing({ id: 'rs-c1', status: 'sold', price_credits: 2000, sold_at: '2026-10-29T12:00:00.000Z', listing_kind: 'consumable', quantity: 4, quality_percent: 137.5, consumable_type: 'MedKit', identity_key: 'cons:MedKit:q3' }),
    listing({ id: 'rs-c2', status: 'sold', price_credits: 1200, sold_at: '2026-10-29T13:00:00.000Z', listing_kind: 'consumable', quantity: 2, quality_percent: 130, consumable_type: 'MedKit', identity_key: 'cons:MedKit:q3' }),
  ];
  return s;
}

describe('market depth — read paths', () => {
  let base: string;
  let close: () => Promise<void>;
  let token: string;

  beforeAll(async () => {
    const store = new InMemoryReadStore(readSeed(), () => NOW);
    const app = express();
    app.use(express.json());
    mountReadRoutes(app, store, { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
    token = issueAccessToken(SECRET, B, false);
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });
  afterAll(async () => { await close(); });

  async function get(path: string) {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, json: await res.json() };
  }
  const ids = (json: { listings: { id: string }[] }) => json.listings.map((l) => l.id);

  it('unfiltered browse returns every active listing with the total, newest first', async () => {
    const res = await get('/api/market/listings');
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(7);
    expect(ids(res.json)).toEqual(['rl-cons', 'rl-pistol', 'rl-sniper', 'rl-shield', 'rl-relic', 'rl-mat', 'rl-npc']);
    const cons = res.json.listings.find((l: { id: string }) => l.id === 'rl-cons');
    expect(cons).toMatchObject({ listing_kind: 'consumable', quantity: 4, quality_percent: 137.5, item_instances: null });
  });

  it('each filter returns exactly the matching subset', async () => {
    expect(ids((await get('/api/market/listings?category=weapon')).json)).toEqual(['rl-pistol', 'rl-sniper', 'rl-npc']);
    expect(ids((await get('/api/market/listings?category=consumable')).json)).toEqual(['rl-cons']);
    expect(ids((await get('/api/market/listings?category=material')).json)).toEqual(['rl-mat']);
    expect(ids((await get('/api/market/listings?category=shield')).json)).toEqual(['rl-shield']);
    expect(ids((await get('/api/market/listings?weaponType=Sniper')).json)).toEqual(['rl-sniper']);
    expect(ids((await get('/api/market/listings?element=Fire')).json)).toEqual(['rl-pistol']);
    expect(ids((await get('/api/market/listings?rarity=Epic')).json)).toEqual(['rl-sniper', 'rl-relic']);
    expect(ids((await get('/api/market/listings?levelMin=20')).json)).toEqual(['rl-sniper', 'rl-relic']);
    expect(ids((await get('/api/market/listings?levelMax=10')).json)).toEqual(['rl-pistol', 'rl-npc']);
    expect(ids((await get('/api/market/listings?priceMax=2500')).json)).toEqual(['rl-cons', 'rl-pistol', 'rl-shield', 'rl-npc']);
    expect(ids((await get('/api/market/listings?priceMin=9000')).json)).toEqual(['rl-sniper']);
    expect(ids((await get('/api/market/listings?sellerType=npc')).json)).toEqual(['rl-npc']);
    expect(ids((await get(`/api/market/listings?sellerId=${P3}`)).json)).toEqual(['rl-shield', 'rl-relic', 'rl-mat']);
    expect(ids((await get(`/api/market/listings?excludeSellerId=${S}`)).json)).toEqual(['rl-shield', 'rl-relic', 'rl-mat', 'rl-npc']);
    expect(ids((await get('/api/market/listings?search=pistol')).json)).toEqual(['rl-pistol', 'rl-npc']);
  });

  it('sorts and paginates server-side with stable totals', async () => {
    expect(ids((await get('/api/market/listings?sort=price_asc')).json))
      .toEqual(['rl-npc', 'rl-pistol', 'rl-cons', 'rl-shield', 'rl-mat', 'rl-relic', 'rl-sniper']);
    expect(ids((await get('/api/market/listings?sort=price_desc')).json))
      .toEqual(['rl-sniper', 'rl-relic', 'rl-mat', 'rl-shield', 'rl-cons', 'rl-pistol', 'rl-npc']);
    // Level desc; ties break on price asc (the documented comparator);
    // level-less stacks sort last.
    expect(ids((await get('/api/market/listings?sort=level')).json))
      .toEqual(['rl-relic', 'rl-sniper', 'rl-shield', 'rl-pistol', 'rl-npc', 'rl-cons', 'rl-mat']);
    const page = await get('/api/market/listings?limit=2&offset=2');
    expect(page.json.total).toBe(7);
    expect(ids(page.json)).toEqual(['rl-sniper', 'rl-shield']);
  });

  it('price stats: medians over unit prices, trend, and empty keys', async () => {
    const res = await get('/api/market/price-stats?keys=gear:weapon:Pistol:Rare:b0,cons:MedKit:q3,mat:VoidDust');
    expect(res.status).toBe(200);
    const gear = res.json.stats['gear:weapon:Pistol:Rare:b0'];
    expect(gear.salesCount).toBe(4);
    expect(gear.medianUnitPrice).toBe(1100);
    expect(gear.lastUnitPrice).toBe(1000);
    expect(gear.trend).toBe('down');
    const cons = res.json.stats['cons:MedKit:q3'];
    expect(cons.salesCount).toBe(2);
    expect(cons.medianUnitPrice).toBe(550); // unit prices 500 and 600
    expect(cons.lastUnitPrice).toBe(600);
    const empty = res.json.stats['mat:VoidDust'];
    expect(empty.salesCount).toBe(0);
    expect(empty.medianUnitPrice).toBeNull();
    expect(empty.lastUnitPrice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. SQL source pins
// ---------------------------------------------------------------------------

describe('migration 0019 — SQL source pins', () => {
  const sql = readFileSync(resolve(__dirname, '../../db/migrations/0019_market_depth.sql'), 'utf8');

  it('creates both new listing functions and keeps one completion path', () => {
    expect(sql).toContain('cc_market_create_consumable');
    expect(sql).toContain('cc_market_create_material');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.cc_accept_listing');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.cc_market_cancel');
  });

  it('the fee still reads the economy_config lever in both branches', () => {
    const matches = sql.match(/cc_economy_config_number\('marketFeeRate', 0\.05\)/g) ?? [];
    expect(matches.length).toBe(2); // gear branch + stack branch
  });

  it('backfills legacy rows and restates the def-owned exclusions', () => {
    expect(sql).toContain('ml.identity_key is null');
    expect(sql).toContain("'ElementalCoating'");
    expect(sql).toContain("'ScrapAlloy','BallisticParts','ReactiveComponents','TechFragments','VoidDust'");
    expect(sql).toContain('cc_add_consumable_batch');
  });
});
