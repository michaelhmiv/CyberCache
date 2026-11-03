/**
 * Silver Tongue fee floor (economy redesign brief §5, ruling 2;
 * migration 0064) — the market fee may shrink toward zero under
 * reductions + the Cache Rank uplift, but it may never cross zero
 * into minting:
 *
 *   proceedsBonus = min( fee , floor((price − fee) × bonusRate) )
 *
 * Layers covered:
 *   1. The shared TS owner (src/lib/market/marketFee.ts): a property
 *      grid over price × fee-rate × reduction × bonus-rate asserting
 *      sellerProceeds ≤ price in EVERY cell, plus the brief's pinned
 *      cases (the audit's stacked-maxima sale and the unclamped
 *      rebate point).
 *   2. The shipped wire paths through the real write routes +
 *      InMemoryWriteStore (the twin of cc_accept_listing and of
 *      cc_quickbuy_fill's per-leg fee block): a maxed Silver Tongue
 *      seller nets exactly the buyer's price and the system-wide
 *      credit total is conserved to the credit — no mint.
 *   3. Source pins on db/migrations/0064_silver_tongue_fee_floor.sql
 *      so both SQL settlement paths carry the same clamp.
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
  type WriteListingData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import { marketFeeForPrice } from '../lib/market/marketFee';

const SECRET = 'test-secret-at-least-32-chars-long!!';

const S = '11111111-1111-4111-8111-111111111111'; // maxed Silver Tongue seller
const B = '22222222-2222-4222-8222-222222222222'; // buyer
const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const STACK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

// ---------------------------------------------------------------------------
// 1. Property grid + pinned cases on the shared TS owner
// ---------------------------------------------------------------------------

describe('fee floor — property grid (marketFeeForPrice)', () => {
  const prices = [0, 1, 2, 3, 7, 10, 99, 100, 101, 999, 1_000, 9_999, 10_000, 10_001, 99_999, 100_000, 1_234_567];
  const feeRates = [0, 0.01, 0.0275, 0.05, 0.1, 0.5, 1];
  const reductions = [0, 0.25, 0.4, 0.45, 0.75, 0.99, 1];
  const bonusRates = [0, 0.005, 0.01, 0.05, 0.1, 0.5, 1];

  it('no cell creates credits: bonus ≤ fee and sellerProceeds ≤ price everywhere', () => {
    const violations: string[] = [];
    for (const price of prices) {
      for (const feeRate of feeRates) {
        for (const reduction of reductions) {
          for (const bonusRate of bonusRates) {
            const b = marketFeeForPrice(price, reduction, feeRate, bonusRate);
            const cell = `price=${price} rate=${feeRate} red=${reduction} bonus=${bonusRate}`;
            if (!(b.fee >= 0)) violations.push(`${cell}: negative fee ${b.fee}`);
            if (!(b.proceedsBonus >= 0)) violations.push(`${cell}: negative bonus ${b.proceedsBonus}`);
            if (!(b.proceedsBonus <= b.fee)) violations.push(`${cell}: bonus ${b.proceedsBonus} > fee ${b.fee}`);
            if (!(b.sellerProceeds <= price)) violations.push(`${cell}: proceeds ${b.sellerProceeds} > price ${price}`);
            if (b.sellerProceeds !== price - b.fee + b.proceedsBonus) {
              violations.push(`${cell}: proceeds identity broken`);
            }
            // Per-sale meter invariant: burn − mint ≥ 0.
            if (!(b.fee - b.proceedsBonus >= 0)) violations.push(`${cell}: net mint ${b.proceedsBonus - b.fee}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('pinned audit case: maxed seller, 10,000-cr sale — fee 275, bonus clamped 486 → 275, proceeds exactly 10,000', () => {
    // Best effective fee 2.75% (rate 0.05 × (1 − 0.45 reductions)),
    // Silver Tongue at its 0.05 ceiling.
    const b = marketFeeForPrice(10_000, 0.45, 0.05, 0.05);
    expect(b.fee).toBe(275);
    expect(Math.floor((10_000 - 275) * 0.05)).toBe(486); // the pre-floor mint
    expect(b.proceedsBonus).toBe(275);
    expect(b.sellerProceeds).toBe(10_000);
  });

  it('rebate region preserved: no reductions, the uplift still rebates 475 of a 500 fee', () => {
    const b = marketFeeForPrice(10_000, 0, 0.05, 0.05);
    expect(b.fee).toBe(500);
    expect(b.proceedsBonus).toBe(475);
    expect(b.sellerProceeds).toBe(9_975);
  });

  it('a fully reduced fee leaves nothing to rebate: fee 0 → bonus 0, seller keeps the price via the reduction alone', () => {
    const b = marketFeeForPrice(10_000, 1, 0.05, 0.05);
    expect(b.fee).toBe(0);
    expect(b.proceedsBonus).toBe(0);
    expect(b.sellerProceeds).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// 2. Wire paths (HTTP + InMemoryWriteStore twins)
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
  // Maxed Silver Tongue (10 ranks → 0.05) + Darknet Broker maxed
  // (25% fee reduction). On a 10,000-cr sale: fee 375, raw uplift
  // floor(9625 × 0.05) = 481 — the pre-floor code MINTED 106.
  const maxed = {
    skill_spends: { scav_fee_1: 5 },
    cache_rank_spends: { marketProceeds: 10 },
  } as Partial<ProfileRowData>;
  s.profiles = [
    profile({ id: S, username: 'tongue', credits: 0, materials: { ScrapAlloy: 10 }, ...maxed }),
    profile({ id: B, username: 'buyer', credits: 100_000 }),
  ];
  s.items = [
    // Marketplace source: not personally found, so Market
    // Manipulator stays out — Darknet is the only reduction.
    item({ id: ITEM, owner_user_id: S, payload: { weaponType: 'Pistol', sourceTag: 'Marketplace' } }),
  ];
  s.listings = [
    {
      id: STACK, seller_user_id: S, item_instance_id: null, price_credits: 10_000,
      status: 'active', listed_at: '2026-10-29T11:00:00.000Z', sold_at: null,
      listing_kind: 'material', quantity: 10, material_id: 'ScrapAlloy',
    } as WriteListingData,
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
  await new Promise<void>((res) => server.on('listening', res));
  const { port } = server.address() as AddressInfo;
  const tokens: Record<string, string> = {};
  for (const id of [S, B]) tokens[id] = issueAccessToken(SECRET, id, false);
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((res) => server.close(() => res())),
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
const nonce = () => `floor-nonce-${++nonceCounter}-abcdef`;
const creditsOf = (h: Harness, id: string) => h.store.seed.profiles.find((p) => p.id === id)?.credits ?? 0;
const totalCredits = (h: Harness) => h.store.seed.profiles.reduce((sum, p) => sum + p.credits, 0);

describe('fee floor — wire paths conserve credits exactly', () => {
  let h: Harness;
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('cc_accept_listing twin: maxed seller nets exactly the price; the fee is fully rebated, nothing minted', async () => {
    const before = totalCredits(h);
    const created = await post(h, '/api/ops/market-create', h.tokens[S], {
      nonce: nonce(), item_id: ITEM, price_credits: 10_000,
    });
    expect(created.status).toBe(200);
    const listingId = (created.json.listing as Record<string, unknown>).id as string;

    const bought = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: listingId,
    });
    expect(bought.status).toBe(200);
    expect(bought.json.market_fee).toMatchObject({
      fee_credits: 375,
      cache_rank_proceeds_bonus: 375,
      seller_proceeds: 10_000,
    });
    expect(creditsOf(h, S)).toBe(10_000);
    expect(creditsOf(h, B)).toBe(90_000);
    // Burn (375) − mint (375) = 0: the system total is conserved.
    expect(totalCredits(h)).toBe(before);
  });

  it('cc_quickbuy_fill twin: a full-stack market fill pays the same clamped settlement per leg', async () => {
    const before = totalCredits(h);
    const quoteRes = await post(h, '/api/ops/quickbuy-quote', h.tokens[B], {
      good_kind: 'material', good_id: 'ScrapAlloy', quantity: 10,
    });
    expect(quoteRes.status).toBe(200);
    const market = (quoteRes.json as { market: { total: number } }).market;
    expect(market.total).toBe(10_000);

    const filled = await post(h, '/api/ops/quickbuy-fill', h.tokens[B], {
      nonce: nonce(), source: 'market', good_kind: 'material', good_id: 'ScrapAlloy',
      quantity: 10, quoted_total: market.total,
    });
    expect(filled.status).toBe(200);
    // Same seller, same stack economics: fee 375 on the 10,000
    // charge, uplift clamped to 375 — seller credited the charge.
    expect(creditsOf(h, S)).toBe(20_000);
    expect(creditsOf(h, B)).toBe(80_000);
    expect(totalCredits(h)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 3. SQL pins (0064 carries the clamp in BOTH settlement paths)
// ---------------------------------------------------------------------------

describe('migration 0064 — SQL fee floor pins', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'db/migrations/0064_silver_tongue_fee_floor.sql'),
    'utf8',
  );

  it('restates cc_accept_listing with the uplift clamped to the fee', () => {
    expect(sql).toContain('create or replace function public.cc_accept_listing(p_player_id uuid, nonce text, listing_id uuid)');
    expect(sql).toContain('proceeds_bonus := least(fee_credits, floor((listing.price_credits - fee_credits)');
  });

  it('restates cc_quickbuy_fill with the same clamp on the per-leg charge', () => {
    expect(sql).toContain('create or replace function public.cc_quickbuy_fill(');
    expect(sql).toContain('proceeds_bonus := least(fee_credits, floor((leg.charge - fee_credits)');
  });

  it('no unclamped uplift assignment survives in either restatement', () => {
    expect(sql).not.toContain('proceeds_bonus := floor(');
  });
});
