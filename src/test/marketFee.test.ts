/**
 * Market sale fee (migration 0017) — shipped-path tests.
 *
 * The fee: 5% of the listed price on a COMPLETED player-market sale,
 * destroyed. Buyer pays list price; seller receives price − fee. The
 * seller's Scavenger fee-reduction nodes (Darknet Broker /
 * Market Manipulator) reduce the fee as their defs describe.
 *
 * Layers covered:
 *   1. The shared TS owner (src/lib/market/marketFee.ts) — rate pin
 *      and the reduction matrix from the skill defs.
 *   2. HTTP through the real write routes + InMemoryWriteStore (the
 *      mirror of cc_accept_listing): balances, system-wide credit
 *      destruction, nonce replay, skill wiring, the
 *      bought-and-relisted Manipulator denial, class mod derivation,
 *      and the NPC exemption.
 *   3. Source pins on db/migrations/0017_market_sale_fee.sql so the
 *      SQL completion path cannot drift from the TS owner silently.
 *      (The SQL function itself is exercised against embedded
 *      Postgres in the slice verification harness.)
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
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import {
  MARKET_FEE_RATE,
  isFoundSource,
  marketFeeForPrice,
  marketFeeForSeller,
} from '../lib/market/marketFee';

const SECRET = 'test-secret-at-least-32-chars-long!!';

const S = '11111111-1111-4111-8111-111111111111'; // plain seller
const B = '22222222-2222-4222-8222-222222222222'; // buyer / relister
const K = '33333333-3333-4333-8333-333333333333'; // skilled seller
const M = '44444444-4444-4444-8444-444444444444'; // class-mod seller
const C2 = '55555555-5555-4555-8555-555555555555'; // second buyer
const NPC = '00000000-0000-0000-0000-000000000000'; // npc service account
const NPC_NOPROFILE = '99999999-9999-4999-8999-999999999999';

const ITEM_S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ITEM_K1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const ITEM_M1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const ITEM_MOD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const ITEM_NPC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const ITEM_NPC2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const LISTING_NPC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const LISTING_NPC2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

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
    profile({ id: S, username: 'seller', credits: 0 }),
    profile({ id: B, username: 'buyer', credits: 100_000, skill_spends: { scav_major_3: 1 } }),
    profile({
      id: K, username: 'skilled', credits: 0,
      skill_spends: { scav_fee_1: 5, scav_major_3: 1 },
    }),
    profile({ id: M, username: 'modded', credits: 0 }),
    profile({ id: C2, username: 'second', credits: 100_000 }),
    profile({ id: NPC, username: 'npc-market', credits: 0 }),
  ];
  s.items = [
    item({ id: ITEM_S1, owner_user_id: S, payload: { weaponType: 'Pistol', sourceTag: 'World Drop' } }),
    item({ id: ITEM_K1, owner_user_id: K, payload: { weaponType: 'SMG', sourceTag: 'Boss Drop' } }),
    item({ id: ITEM_M1, owner_user_id: M, payload: { weaponType: 'Sniper', sourceTag: 'World Drop' } }),
    item({
      id: ITEM_MOD, owner_user_id: M, kind: 'classMod', runtime_state: 'equipped', equipped_slot: 'classMod',
      payload: { treeBonus: 'Scavenger', nodeBoosts: {} },
    }),
    item({
      id: ITEM_NPC, owner_user_id: NPC, runtime_state: 'listed', supply_mode: 'npc_market',
      payload: { weaponType: 'Pistol', sourceTag: 'Marketplace' },
    }),
    item({
      id: ITEM_NPC2, owner_user_id: NPC_NOPROFILE, runtime_state: 'listed', supply_mode: 'npc_market',
      payload: { weaponType: 'Pistol', sourceTag: 'Marketplace' },
    }),
  ];
  s.listings = [
    {
      id: LISTING_NPC, seller_user_id: NPC, item_instance_id: ITEM_NPC, price_credits: 1000,
      status: 'active', listed_at: '2026-10-29T11:00:00.000Z', sold_at: null,
    },
    {
      id: LISTING_NPC2, seller_user_id: NPC_NOPROFILE, item_instance_id: ITEM_NPC2, price_credits: 1000,
      status: 'active', listed_at: '2026-10-29T11:00:00.000Z', sold_at: null,
    },
  ];
  return s;
}

interface Harness {
  store: InMemoryWriteStore;
  base: string;
  close: () => Promise<void>;
  tokens: Record<string, string>;
}

async function makeServer(): Promise<Harness> {
  const store = new InMemoryWriteStore(baseSeed(), {
    now: () => new Date(Date.parse('2026-10-30T12:00:00.000Z')),
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
  for (const id of [S, B, K, M, C2]) tokens[id] = issueAccessToken(SECRET, id, false);
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    tokens,
  };
}

async function post(h: Harness, path: string, token: string, payload: unknown) {
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
  return `fee-nonce-${nonceCounter}-abcdef`;
}

function creditsOf(h: Harness, id: string): number {
  return h.store.seed.profiles.find((p) => p.id === id)?.credits ?? 0;
}

function totalCredits(h: Harness): number {
  return h.store.seed.profiles.reduce((sum, p) => sum + p.credits, 0);
}

async function listItem(h: Harness, seller: string, itemId: string, price: number): Promise<string> {
  const created = await post(h, '/api/ops/market-create', h.tokens[seller], {
    nonce: nonce(), item_id: itemId, price_credits: price,
  });
  expect(created.status).toBe(200);
  return (created.json.listing as Record<string, unknown>).id as string;
}

// ---------------------------------------------------------------------------
// 1. Shared TS owner
// ---------------------------------------------------------------------------

describe('marketFee shared computation', () => {
  it('pins MARKET_FEE_RATE at 0.05', () => {
    expect(MARKET_FEE_RATE).toBe(0.05);
  });

  it('base fee: 10,000cr sale destroys 500, seller receives 9,500', () => {
    const b = marketFeeForPrice(10_000, 0);
    expect(b.fee).toBe(500);
    expect(b.sellerProceeds).toBe(9_500);
  });

  it('Darknet Broker maxed (5 pts × 5%) cuts the fee by 25%: 375 on 10,000', () => {
    const b = marketFeeForSeller({
      price: 10_000, skillSpends: { scav_fee_1: 5 }, foundBySeller: false,
    });
    expect(b.feeReduction).toBeCloseTo(0.25);
    expect(b.fee).toBe(375);
    expect(b.sellerProceeds).toBe(9_625);
  });

  it('Market Manipulator adds 15% on personally found items: 300 on 10,000', () => {
    const b = marketFeeForSeller({
      price: 10_000, skillSpends: { scav_fee_1: 5, scav_major_3: 1 }, foundBySeller: true,
    });
    expect(b.feeReduction).toBeCloseTo(0.40);
    expect(b.fee).toBe(300);
    expect(b.sellerProceeds).toBe(9_700);
  });

  it('Market Manipulator does nothing for items the seller did not find', () => {
    const b = marketFeeForSeller({
      price: 10_000, skillSpends: { scav_fee_1: 5, scav_major_3: 1 }, foundBySeller: false,
    });
    expect(b.fee).toBe(375);
  });

  it('Scavenger treeBonus class mod grants +1 to both fee nodes', () => {
    const found = marketFeeForSeller({
      price: 10_000, skillSpends: {},
      classModBoosts: { treeBonus: 'Scavenger', nodeBoosts: {} },
      foundBySeller: true,
    });
    // Darknet 1pt (5%) + Manipulator 1pt (15%) = 20% reduction.
    expect(found.fee).toBe(400);
    const notFound = marketFeeForSeller({
      price: 10_000, skillSpends: {},
      classModBoosts: { treeBonus: 'Scavenger', nodeBoosts: {} },
      foundBySeller: false,
    });
    expect(notFound.fee).toBe(475);
  });

  it('class mod nodeBoosts stack past maxPoints like computeSkillBonuses', () => {
    const b = marketFeeForSeller({
      price: 10_000, skillSpends: { scav_fee_1: 5 },
      classModBoosts: { nodeBoosts: { scav_fee_1: 2 } },
      foundBySeller: false,
    });
    // 7 effective points × 5% = 35% reduction.
    expect(b.feeReduction).toBeCloseTo(0.35);
    expect(b.fee).toBe(325);
  });

  it('find sources are exactly the drop sources', () => {
    expect(isFoundSource('World Drop')).toBe(true);
    expect(isFoundSource('Boss Drop')).toBe(true);
    expect(isFoundSource('Cache-Forged')).toBe(true);
    expect(isFoundSource('Event')).toBe(true);
    expect(isFoundSource('Marketplace')).toBe(false);
    expect(isFoundSource('Crafted')).toBe(false);
    expect(isFoundSource(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Shipped path (HTTP + in-memory WriteStore mirror of cc_accept_listing)
// ---------------------------------------------------------------------------

describe('market fee — shipped path', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('completed sale: buyer pays list, seller receives 95%, 500cr destroyed', async () => {
    const before = totalCredits(h);
    const listingId = await listItem(h, S, ITEM_S1, 10_000);
    const acceptNonce = nonce();
    const bought = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: acceptNonce, listing_id: listingId,
    });
    expect(bought.status).toBe(200);
    expect(bought.json.market_fee).toMatchObject({
      fee_credits: 500, seller_proceeds: 9_500, fee_rate: 0.05, fee_reduction: 0,
    });
    expect(creditsOf(h, B)).toBe(90_000);
    expect(creditsOf(h, S)).toBe(9_500);
    expect(totalCredits(h)).toBe(before - 500);

    // Replay with the same nonce returns the recorded result and
    // moves nothing (no double-charge, no double-pay).
    const replay = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: acceptNonce, listing_id: listingId,
    });
    expect(replay.status).toBe(200);
    expect(replay.json.market_fee).toMatchObject({ fee_credits: 500 });
    expect(creditsOf(h, B)).toBe(90_000);
    expect(creditsOf(h, S)).toBe(9_500);

    // A fresh nonce against the sold listing fails.
    const again = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: listingId,
    });
    expect(again.status).toBe(404);
  });

  it('skilled seller: Darknet + Manipulator on a found item → fee 300', async () => {
    const listingId = await listItem(h, K, ITEM_K1, 10_000);
    const bought = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: listingId,
    });
    expect(bought.status).toBe(200);
    expect(bought.json.market_fee).toMatchObject({
      fee_credits: 300, seller_proceeds: 9_700, found_item: true,
    });
    expect(bought.json.market_fee.fee_reduction).toBeCloseTo(0.40);
    expect(creditsOf(h, K)).toBe(9_700);
  });

  it('class mod treeBonus is derived from server records, not the body', async () => {
    const listingId = await listItem(h, M, ITEM_M1, 10_000);
    const bought = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: listingId,
    });
    expect(bought.status).toBe(200);
    // Scavenger treeBonus: Darknet +1 (5%) and Manipulator +1 (15%)
    // on a personally found item → 20% reduction → fee 400.
    expect(bought.json.market_fee).toMatchObject({ fee_credits: 400, seller_proceeds: 9_600 });
    expect(creditsOf(h, M)).toBe(9_600);
  });

  it('bought-and-relisted items do NOT get the Manipulator reduction', async () => {
    // B bought ITEM_S1 in the first test and owns Manipulator
    // (scav_major_3: 1) but no Darknet Broker. Relisting it must pay
    // the full 5% fee: B acquired it from another player, so it is
    // not "personally found" even though its sourceTag is a drop.
    const listingId = await listItem(h, B, ITEM_S1, 10_000);
    const bBefore = creditsOf(h, B);
    const bought = await post(h, '/api/ops/market-accept', h.tokens[C2], {
      nonce: nonce(), listing_id: listingId,
    });
    expect(bought.status).toBe(200);
    expect(bought.json.market_fee).toMatchObject({
      fee_credits: 500, seller_proceeds: 9_500, found_item: false,
    });
    expect(creditsOf(h, B)).toBe(bBefore + 9_500);
    expect(creditsOf(h, C2)).toBe(90_000);
  });

  it('NPC-seeded listing: purchase completes, NPC paid in full, no fee', async () => {
    const bought = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: LISTING_NPC,
    });
    expect(bought.status).toBe(200);
    expect(bought.json.market_fee).toMatchObject({ fee_credits: 0, seller_proceeds: 1000 });
    expect(creditsOf(h, NPC)).toBe(1000);
  });

  it('NPC listing whose seller has no profile still completes', async () => {
    const bBefore = creditsOf(h, B);
    const bought = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: LISTING_NPC2,
    });
    expect(bought.status).toBe(200);
    expect(bought.json.market_fee).toMatchObject({ fee_credits: 0 });
    expect(creditsOf(h, B)).toBe(bBefore - 1000);
    const moved = h.store.seed.items.find((i) => i.id === ITEM_NPC2);
    expect(moved?.owner_user_id).toBe(B);
  });
});

// ---------------------------------------------------------------------------
// 3. SQL parity pins (0017 cannot drift from the TS owner silently)
// ---------------------------------------------------------------------------

describe('migration 0017 — SQL fee path pins', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'db/migrations/0017_market_sale_fee.sql'),
    'utf8',
  );

  it('recreates cc_accept_listing and credits the seller price − fee', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.cc_accept_listing');
    expect(sql).toContain('credits + (listing.price_credits - fee_credits)');
    expect(sql).toContain('credits - listing.price_credits');
  });

  it('applies the shared rate with floor, matching marketFeeForPrice', () => {
    expect(MARKET_FEE_RATE).toBe(0.05);
    expect(sql).toContain('floor(listing.price_credits * 0.05 * (1 - fee_reduction))');
  });

  it('derives both fee nodes from the seller skill_spends at def values', () => {
    expect(sql).toContain("seller.skill_spends ->> 'scav_fee_1'");
    expect(sql).toContain("seller.skill_spends ->> 'scav_major_3'");
    expect(sql).toContain('0.05 * darknet_pts');
    expect(sql).toContain('0.15 * manip_pts');
    expect(sql).toContain("payload ? 'treeBonus'");
  });

  it('gates the found-item term on drop source + no prior market acquisition', () => {
    expect(sql).toContain("item.payload ->> 'sourceTag'");
    expect(sql).toContain("'World Drop', 'Boss Drop', 'Cache-Forged', 'Event'");
    expect(sql).toContain("l.action_type = 'cc_accept_listing'");
    expect(sql).toContain("l.result_payload -> 'item' ->> 'id' = item.id::text");
  });

  it('exempts NPC-seeded listings via supply_mode', () => {
    expect(sql).toContain("coalesce(item.supply_mode, '') <> 'npc_market'");
  });
});
