/**
 * QuickBuy (QB-1, migration 0060) — shipped-path tests.
 *
 * Layers covered:
 *   1. The shared sweep planner (src/lib/market/quickBuy.ts): the
 *      partial-stack split rule, sweep order, own-listing exclusion,
 *      and the default-tab rule — the ONE planner the sheet, the
 *      InMemory twin and (by construction) the SQL quote all follow.
 *   2. HTTP through the real write routes + InMemoryWriteStore:
 *      quote shapes, atomic fills at boundary quantities, the
 *      quote-as-hard-ceiling rule (drift requotes, nothing moves),
 *      fee parity, the NPC sourcing exclusion, insufficient-credits
 *      atomicity, vendor rotation edge (quote day D, buy day D+1),
 *      guest quote open / guest fill refused, nonce replay.
 *   3. Source pins on db/migrations/0060_quickbuy_fill.sql. (The SQL
 *      functions themselves are exercised against embedded Postgres
 *      in the slice verification harness — 30 checks.)
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
  type WriteListingData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import {
  defaultQuickBuyTab,
  planMarketSweep,
  quickBuyIdentityKey,
  splitStackCharge,
  type QuickBuyListingRow,
  type QuickBuyQuote,
} from '../lib/market/quickBuy';
import { vendorOfferFor, vendorRotationForDate } from '../lib/vendor/catalog';

const SECRET = 'test-secret-at-least-32-chars-long!!';
// Pinned clock: a Wednesday. Rotation picks derive from the date.
let nowMs = new Date('2026-11-04T12:00:00.000Z').getTime();
const nowFn = () => new Date(nowMs);
const dateKeyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const S = '11111111-1111-4111-8111-111111111111'; // seller 1
const S2 = '22222222-2222-4222-8222-222222222222'; // seller 2
const B = '33333333-3333-4333-8333-333333333333'; // buyer
const G = '44444444-4444-4444-8444-444444444444'; // guest
const NPCBACK = '55555555-5555-4555-8555-555555555555'; // NPC-listing backing profile

const L_CHEAP = '99999999-9999-4999-8999-000000000001';
const L_DEAR = '99999999-9999-4999-8999-000000000002';
const L_OWN = '99999999-9999-4999-8999-000000000003';
const L_FRAG = '99999999-9999-4999-8999-000000000004';
const L_FRAG_NPC = '99999999-9999-4999-8999-000000000014';
const L_MEDKIT_HI = '99999999-9999-4999-8999-000000000005';
const L_MEDKIT_LO = '99999999-9999-4999-8999-000000000006';

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

function listing(overrides: Partial<WriteListingData> & { id: string; seller_user_id: string }): WriteListingData {
  return {
    item_instance_id: null,
    price_credits: 100,
    status: 'active',
    listed_at: '2026-11-04T08:00:00.000Z',
    sold_at: null,
    listing_kind: 'material',
    quantity: 1,
    material_id: 'Scrap',
    ...overrides,
  };
}

function writeSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({ id: S, username: 'seller1', credits: 0, materials: { Scrap: 50 } }),
    profile({ id: S2, username: 'seller2', credits: 0 }),
    profile({ id: B, username: 'buyer', credits: 100_000 }),
    profile({ id: G, username: 'guest', account_type: 'guest', email_verified_at: null, credits: 5_000 }),
    profile({ id: NPCBACK, username: 'npcbank', credits: 0 }),
  ];
  s.listings = [
    // Scrap sweep for the buyer: 4 @ 10cr (stack 40) then 6 @ 15cr (stack 90).
    listing({ id: L_CHEAP, seller_user_id: S, quantity: 4, price_credits: 40, listed_at: '2026-11-04T07:00:00.000Z' }),
    listing({ id: L_DEAR, seller_user_id: S2, quantity: 6, price_credits: 90, listed_at: '2026-11-04T08:00:00.000Z' }),
    // The buyer's own dirt-cheap stack — invisible to their own sweep.
    listing({ id: L_OWN, seller_user_id: B, quantity: 100, price_credits: 100, listed_at: '2026-11-04T06:00:00.000Z' }),
    // Player-listed cache fragments: 10 for 100cr.
    listing({
      id: L_FRAG, seller_user_id: S2, seller_type: 'player', listing_kind: 'fragment',
      material_id: null, quantity: 10, price_credits: 100, listed_at: '2026-11-04T05:00:00.000Z',
    }),
    // Legacy NPC-seeded fragment stack, CHEAPER than the player's
    // (10 for 50cr): under the pure player market (2026-11-04)
    // Quick-Buy must never quote or fill from it.
    listing({
      id: L_FRAG_NPC, seller_user_id: NPCBACK, seller_type: 'npc', listing_kind: 'fragment',
      material_id: null, quantity: 10, price_credits: 50, listed_at: '2026-11-04T04:00:00.000Z',
    }),
    // MedKit consumable stacks across quality bands: dearer unit but
    // higher quality listed first — the sweep must still take the
    // cheaper unit price first.
    listing({
      id: L_MEDKIT_HI, seller_user_id: S, listing_kind: 'consumable', material_id: null,
      consumable_type: 'MedKit', quality_percent: 140, batch_origin: 'crafted',
      quantity: 3, price_credits: 900, listed_at: '2026-11-04T05:30:00.000Z',
    }),
    listing({
      id: L_MEDKIT_LO, seller_user_id: S2, listing_kind: 'consumable', material_id: null,
      consumable_type: 'MedKit', quality_percent: 80, batch_origin: 'crafted',
      quantity: 3, price_credits: 600, listed_at: '2026-11-04T05:45:00.000Z',
    }),
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
  const store = new InMemoryWriteStore(writeSeed(), {
    now: nowFn,
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
  for (const id of [S, S2, B, G, NPCBACK]) tokens[id] = issueAccessToken(SECRET, id, id === G);
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
const nonce = () => `qb-nonce-${++nonceCounter}-abcdef`;

const quote = (h: Harness, token: string, kind: string, id: string, quantity: number) =>
  post(h, '/api/ops/quickbuy-quote', token, { good_kind: kind, good_id: id, quantity });
const fill = (
  h: Harness, token: string,
  input: { source: string; kind: string; id: string; quantity: number; quotedTotal: number; nonce?: string },
) =>
  post(h, '/api/ops/quickbuy-fill', token, {
    nonce: input.nonce ?? nonce(),
    source: input.source,
    good_kind: input.kind,
    good_id: input.id,
    quantity: input.quantity,
    quoted_total: input.quotedTotal,
  });

// ---------------------------------------------------------------------------
// 1. The shared planner
// ---------------------------------------------------------------------------

describe('quickBuy planner — split rule', () => {
  it('charges floor(P × q / Q) for a partial take, exactly P for a full take', () => {
    expect(splitStackCharge(90, 1, 6)).toBe(15);
    expect(splitStackCharge(100, 5, 10)).toBe(50);
    expect(splitStackCharge(90, 6, 6)).toBe(90);
    expect(splitStackCharge(7, 1, 3)).toBe(2);
    expect(splitStackCharge(7, 2, 3)).toBe(4);
  });

  it('draining a stack leg-by-leg sums exactly to the listed price', () => {
    for (const [price, qty] of [[100, 7], [7, 3], [999, 13], [40, 4], [1, 5]] as const) {
      let restPrice = price;
      let restQty = qty;
      let sum = 0;
      while (restQty > 0) {
        const charge = splitStackCharge(restPrice, 1, restQty);
        sum += charge;
        restPrice -= charge;
        restQty -= 1;
      }
      expect(sum).toBe(price);
      expect(restPrice).toBe(0);
    }
  });
});

describe('quickBuy planner — sweep + default tab', () => {
  const row = (over: Partial<QuickBuyListingRow>): QuickBuyListingRow => ({
    id: 'x', sellerUserId: S, sellerKind: 'player', quantity: 1, priceCredits: 10,
    listedAt: '2026-11-04T08:00:00.000Z', qualityPercent: null, ...over,
  });

  it('sweeps cheapest unit first, excludes own listings, states partial honestly', () => {
    const plan = planMarketSweep([
      row({ id: 'dear', sellerUserId: S2, quantity: 6, priceCredits: 90, listedAt: '2026-11-04T07:00:00.000Z' }),
      row({ id: 'cheap', quantity: 4, priceCredits: 40, listedAt: '2026-11-04T09:00:00.000Z' }),
      row({ id: 'own', sellerUserId: B, quantity: 100, priceCredits: 100 }),
    ], 5, B);
    expect(plan.supplyQty).toBe(10);
    expect(plan.fillableQty).toBe(5);
    expect(plan.partial).toBe(false);
    expect(plan.total).toBe(55);
    expect(plan.fills.map((f) => f.listingId)).toEqual(['cheap', 'dear']);
    const big = planMarketSweep([
      row({ id: 'cheap', quantity: 4, priceCredits: 40 }),
    ], 9, B);
    expect(big.partial).toBe(true);
    expect(big.fillableQty).toBe(4);
    expect(big.total).toBe(40);
  });

  it('never plans a fill from an NPC listing (pure player market, 2026-11-04)', () => {
    // A legacy seeded stack row must not be quoted or filled even if
    // it is the cheapest supply on the lane.
    const plan = planMarketSweep([
      row({ id: 'npc-cheap', sellerUserId: '00000000-0000-0000-0000-000000000000', sellerKind: 'npc', quantity: 100, priceCredits: 100, listedAt: '2026-11-04T06:00:00.000Z' }),
      row({ id: 'player', sellerUserId: S2, quantity: 3, priceCredits: 60, listedAt: '2026-11-04T07:00:00.000Z' }),
    ], 10, B);
    expect(plan.supplyQty).toBe(3);
    expect(plan.fills.map((f) => f.listingId)).toEqual(['player']);
    expect(plan.total).toBe(60);
  });

  it('identity keys: commodities collapse, goods keep their id', () => {
    expect(quickBuyIdentityKey({ kind: 'fragment', id: 'cache' })).toBe('frag:cache');
    expect(quickBuyIdentityKey({ kind: 'core', id: 'legendary' })).toBe('core:legendary');
    expect(quickBuyIdentityKey({ kind: 'material', id: 'Scrap' })).toBe('mat:Scrap');
  });

  const quoteShape = (market: Partial<QuickBuyQuote['market']>, vendor: QuickBuyQuote['vendor']): QuickBuyQuote => ({
    action_type: 'cc_quickbuy_quote',
    good: { kind: 'material', id: 'Scrap' },
    requested_qty: 5,
    balance: 1000,
    market: {
      supplyQty: 10, fillableQty: 5, partial: false, total: 100, worstUnitPrice: 20,
      fills: [], listings: [], ...market,
    },
    vendor,
  });
  const vendorQuote = (total: number): QuickBuyQuote['vendor'] => ({
    unitPrice: total / 5, basePrice: total / 5, itemOfTheDay: false, staple: false, total,
  });

  it('default tab: cheaper complete fill wins; the only complete source wins; partial falls to market', () => {
    expect(defaultQuickBuyTab(quoteShape({}, vendorQuote(80)))).toBe('vendor');
    expect(defaultQuickBuyTab(quoteShape({}, vendorQuote(120)))).toBe('market');
    expect(defaultQuickBuyTab(quoteShape({}, null))).toBe('market');
    expect(defaultQuickBuyTab(quoteShape({ partial: true, fillableQty: 3, total: 60 }, vendorQuote(200)))).toBe('vendor');
    expect(defaultQuickBuyTab(quoteShape({ partial: true, fillableQty: 3, total: 60 }, null))).toBe('market');
    expect(defaultQuickBuyTab(quoteShape({ supplyQty: 0, fillableQty: 0, total: 0 }, null))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP through the real write routes + InMemoryWriteStore
// ---------------------------------------------------------------------------

describe('quickBuy — write paths', () => {
  let h: Harness;
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  const profileOf = (id: string) => h.store.seed.profiles.find((p) => p.id === id);
  const creditsOf = (id: string) => profileOf(id)?.credits ?? 0;
  const listingOf = (id: string) => h.store.seed.listings.find((l) => l.id === id);
  const ledgerEntries = () =>
    [...(h.store as unknown as { ledger: Map<string, { action_type: string; idempotency_key: string }> }).ledger.values()];

  it('quote: sweep totals, own listing excluded, partial stated honestly', async () => {
    const res = await quote(h, h.tokens[B], 'material', 'Scrap', 5);
    expect(res.status).toBe(200);
    const q = res.json as unknown as QuickBuyQuote;
    expect(q.balance).toBe(100_000);
    expect(q.market.supplyQty).toBe(10);
    expect(q.market.fillableQty).toBe(5);
    expect(q.market.partial).toBe(false);
    expect(q.market.total).toBe(55);
    expect(q.market.fills.map((f) => [f.listingId, f.takeQty, f.charge])).toEqual([
      [L_CHEAP, 4, 40],
      [L_DEAR, 1, 15],
    ]);
    // The sheet re-plans locally from the full eligible row set.
    expect(q.market.listings.map((l) => l.id)).toEqual([L_CHEAP, L_DEAR]);

    const big = await quote(h, h.tokens[B], 'material', 'Scrap', 25);
    const bq = big.json as unknown as QuickBuyQuote;
    expect(bq.market.partial).toBe(true);
    expect(bq.market.fillableQty).toBe(10);
    expect(bq.market.total).toBe(130);
  });

  it('quote: vendor half matches the catalog for today; commodities have none', async () => {
    const key = dateKeyOf(nowMs);
    const med = await quote(h, h.tokens[B], 'consumable', 'MedKit', 2);
    const mq = med.json as unknown as QuickBuyQuote;
    const offer = vendorOfferFor('MedKit', key);
    expect(offer).not.toBeNull();
    expect(mq.vendor?.unitPrice).toBe(offer!.unitPrice);
    expect(mq.vendor?.total).toBe(offer!.unitPrice * 2);
    expect(mq.vendor?.staple).toBe(true);

    const scrap = await quote(h, h.tokens[B], 'material', 'Scrap', 1);
    const sq = scrap.json as unknown as QuickBuyQuote;
    const scrapOffer = vendorOfferFor('Scrap', key);
    expect(sq.vendor?.unitPrice ?? null).toBe(scrapOffer?.unitPrice ?? null);

    const frag = await quote(h, h.tokens[B], 'fragment', 'cache', 5);
    expect((frag.json as unknown as QuickBuyQuote).vendor).toBeNull();
  });

  it('guest: the quote is fully visible; the fill refuses with the sign-in remedy', async () => {
    const res = await quote(h, h.tokens[G], 'material', 'Scrap', 5);
    expect(res.status).toBe(200);
    const gq = res.json as unknown as QuickBuyQuote;
    // Real numbers, swept for the GUEST: the buyer's own stack is a
    // legitimate source for everyone else (exclusion is per-buyer),
    // so the guest's cheapest fill is 5 from that 100 @ 100 stack.
    expect(gq.market.total).toBe(5);
    expect(gq.market.fills[0]?.listingId).toBe(L_OWN);
    expect(gq.balance).toBe(5_000);

    const blocked = await fill(h, h.tokens[G], {
      source: 'market', kind: 'material', id: 'Scrap', quantity: 1, quotedTotal: 10,
    });
    expect(blocked.status).toBe(403);
    expect(blocked.json.message).toContain('Verified account required');
  });

  it('ceiling: a stale low quote requotes and moves nothing', async () => {
    const before = creditsOf(B);
    const res = await fill(h, h.tokens[B], {
      source: 'market', kind: 'material', id: 'Scrap', quantity: 5, quotedTotal: 54,
    });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('requote');
    expect(res.json.reason).toBe('price_moved');
    expect((res.json.quote as QuickBuyQuote).market.total).toBe(55);
    expect(creditsOf(B)).toBe(before);
    expect(listingOf(L_CHEAP)?.quantity).toBe(4);
    expect(profileOf(B)?.materials.Scrap ?? 0).toBe(0);
  });

  it('race: the cheap stack sells out between quote and fill — requote, nothing moves', async () => {
    const cancel = await post(h, '/api/ops/market-cancel', h.tokens[S], {
      nonce: nonce(), listing_id: L_CHEAP,
    });
    expect(cancel.status).toBe(200);
    const before = creditsOf(B);
    const res = await fill(h, h.tokens[B], {
      source: 'market', kind: 'material', id: 'Scrap', quantity: 5, quotedTotal: 55,
    });
    expect(res.json.status).toBe('requote');
    expect(res.json.reason).toBe('price_moved');
    expect((res.json.quote as QuickBuyQuote).market.total).toBe(75);
    expect(creditsOf(B)).toBe(before);
    expect(listingOf(L_DEAR)?.quantity).toBe(6);
  });

  it('fill: sweeps the remaining stack, splits it, pays the seller net of the 5% fee', async () => {
    const fillNonce = 'qb-replay-check-0001';
    const s2Before = creditsOf(S2);
    const bBefore = creditsOf(B);
    const res = await fill(h, h.tokens[B], {
      source: 'market', kind: 'material', id: 'Scrap', quantity: 5, quotedTotal: 75, nonce: fillNonce,
    });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('filled');
    expect(res.json.total_charged).toBe(75);
    expect(creditsOf(B)).toBe(bBefore - 75);
    expect(profileOf(B)?.materials.Scrap).toBe(5);
    // Partial take: 5 of 6 at floor(90 × 5/6) = 75; remainder 1 @ 15.
    expect(listingOf(L_DEAR)?.status).toBe('active');
    expect(listingOf(L_DEAR)?.quantity).toBe(1);
    expect(listingOf(L_DEAR)?.price_credits).toBe(15);
    // Fee: floor(75 × 0.05) = 3 destroyed; the seller nets 72.
    expect(creditsOf(S2)).toBe(s2Before + 72);
    // Ledger parity: a per-leg accept row + the fill's own row.
    const entries = ledgerEntries().filter((e) => e.idempotency_key.startsWith(fillNonce));
    expect(entries.some((e) => e.action_type === 'cc_quickbuy_fill')).toBe(true);
    expect(entries.filter((e) => e.action_type === 'cc_accept_listing')).toHaveLength(1);

    // Replay: the same nonce returns the settled answer, nothing moves twice.
    const replay = await fill(h, h.tokens[B], {
      source: 'market', kind: 'material', id: 'Scrap', quantity: 5, quotedTotal: 75, nonce: fillNonce,
    });
    expect(replay.json.status).toBe('filled');
    expect(replay.json.total_charged).toBe(75);
    expect(creditsOf(B)).toBe(bBefore - 75);
    expect(listingOf(L_DEAR)?.quantity).toBe(1);
  });

  it('Quick-Buy never sources the NPC fragment stack, however cheap (pure player market, 2026-11-04)', async () => {
    // The quote for 5 fragments prices off the PLAYER stack only:
    // 5 @ 10cr = 50, never the NPC stack's 5 @ 5cr.
    const res = await quote(h, h.tokens[B], 'fragment', 'cache', 5);
    const q = res.json as unknown as QuickBuyQuote;
    expect(q.market.total).toBe(50);
    expect(q.market.fills.map((f) => f.listingId)).toEqual([L_FRAG]);
    // A fill attempted at the NPC-implied price requotes and moves
    // nothing — the server re-plans player-only at fill time too.
    const bankBefore = creditsOf(NPCBACK);
    const bBefore = creditsOf(B);
    const filled = await fill(h, h.tokens[B], {
      source: 'market', kind: 'fragment', id: 'cache', quantity: 5, quotedTotal: 25,
    });
    expect(filled.json.status).toBe('requote');
    expect(creditsOf(B)).toBe(bBefore);
    expect(creditsOf(NPCBACK)).toBe(bankBefore);
    expect(listingOf(L_FRAG_NPC)?.quantity).toBe(10);
    expect(listingOf(L_FRAG_NPC)?.status).toBe('active');
  });

  it('fill: fragment stack — split charge, 5:1 conversion, seller paid net of the 5% fee', async () => {
    const s2Before = creditsOf(S2);
    const res = await fill(h, h.tokens[B], {
      source: 'market', kind: 'fragment', id: 'cache', quantity: 5, quotedTotal: 50,
    });
    expect(res.json.status).toBe('filled');
    expect(res.json.total_charged).toBe(50);
    expect(profileOf(B)?.cache_tokens).toBe(1);
    expect(profileOf(B)?.cache_token_parts).toBe(0);
    expect(listingOf(L_FRAG)?.quantity).toBe(5);
    expect(listingOf(L_FRAG)?.price_credits).toBe(50);
    // Player sale: floor(50 × 0.05) = 2 destroyed, seller nets 48.
    expect(creditsOf(S2)).toBe(s2Before + 48);
  });

  it('insufficient credits: requote names the gap via the fresh quote; nothing moves', async () => {
    const buyer = profileOf(B)!;
    const saved = buyer.credits;
    buyer.credits = 5;
    try {
      const res = await fill(h, h.tokens[B], {
        source: 'market', kind: 'fragment', id: 'cache', quantity: 5, quotedTotal: 50,
      });
      expect(res.json.status).toBe('requote');
      expect(res.json.reason).toBe('insufficient_credits');
      const fresh = res.json.quote as QuickBuyQuote;
      expect(fresh.balance).toBe(5);
      expect(fresh.market.total).toBe(50);
      expect(listingOf(L_FRAG)?.quantity).toBe(5);
      expect(profileOf(B)?.cache_tokens).toBe(1);
    } finally {
      buyer.credits = saved;
    }
  });

  it('consumable sweep crosses quality bands cheapest-unit-first and delivers each band intact', async () => {
    const res = await quote(h, h.tokens[B], 'consumable', 'MedKit', 4);
    const q = res.json as unknown as QuickBuyQuote;
    expect(q.market.fills.map((f) => [f.listingId, f.takeQty, f.charge])).toEqual([
      [L_MEDKIT_LO, 3, 600],
      [L_MEDKIT_HI, 1, 300],
    ]);
    const sBefore = creditsOf(S);
    const s2Before = creditsOf(S2);
    const filled = await fill(h, h.tokens[B], {
      source: 'market', kind: 'consumable', id: 'MedKit', quantity: 4, quotedTotal: 900,
    });
    expect(filled.json.status).toBe('filled');
    expect(profileOf(B)?.consumables.MedKit).toBe(4);
    const batches = h.store.seed.consumableBatches.filter(
      (b) => b.owner_user_id === B && b.consumable_type === 'MedKit',
    );
    expect(batches.reduce((sum, b) => sum + b.quantity, 0)).toBe(4);
    expect(batches.map((b) => b.quality_percent).sort((a, b) => a - b)).toEqual([80, 140]);
    // Fees: floor(600 × .05) = 30 and floor(300 × .05) = 15 destroyed.
    expect(creditsOf(S2)).toBe(s2Before + 570);
    expect(creditsOf(S)).toBe(sBefore + 285);
  });

  it('vendor fill settles through the vendor op at the quoted unit price', async () => {
    const offer = vendorOfferFor('MedKit', dateKeyOf(nowMs))!;
    const bBefore = creditsOf(B);
    const res = await fill(h, h.tokens[B], {
      source: 'vendor', kind: 'consumable', id: 'MedKit', quantity: 2, quotedTotal: offer.unitPrice * 2,
    });
    expect(res.json.status).toBe('filled');
    expect(res.json.source).toBe('vendor');
    expect(res.json.total_charged).toBe(offer.unitPrice * 2);
    expect(creditsOf(B)).toBe(bBefore - offer.unitPrice * 2);
    expect(profileOf(B)?.consumables.MedKit).toBe(6);
    expect(
      ledgerEntries().some(
        (e) => e.action_type === 'cc_vendor_buy' && e.idempotency_key.endsWith(':vendor'),
      ),
    ).toBe(true);
  });

  it('vendor rotation edge: quoted on day D, bought on day D+1 after the item rotated out', async () => {
    // Find a rotating consumable that is stocked one day and gone the next.
    let found: { itemKey: string; dayMs: number; unitPrice: number } | null = null;
    for (let offset = 0; offset < 60 && !found; offset += 1) {
      const dayMs = Date.UTC(2026, 10, 4 + offset, 12);
      const nextMs = dayMs + 86_400_000;
      for (const def of vendorRotationPool()) {
        const today = vendorOfferFor(def, dateKeyOf(dayMs));
        if (today && !vendorOfferFor(def, dateKeyOf(nextMs))) {
          found = { itemKey: def, dayMs, unitPrice: today.unitPrice };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const { itemKey, dayMs, unitPrice } = found!;
    const savedNow = nowMs;
    try {
      nowMs = dayMs;
      const quoted = await quote(h, h.tokens[B], 'consumable', itemKey, 1);
      expect((quoted.json as unknown as QuickBuyQuote).vendor?.unitPrice).toBe(unitPrice);
      // Midnight UTC passes; the rotation moves on before the tap.
      nowMs = dayMs + 86_400_000;
      const res = await fill(h, h.tokens[B], {
        source: 'vendor', kind: 'consumable', id: itemKey, quantity: 1, quotedTotal: unitPrice,
      });
      expect(res.json.status).toBe('requote');
      expect(res.json.reason).toBe('vendor_unavailable');
      expect((res.json.quote as QuickBuyQuote).vendor).toBeNull();
    } finally {
      nowMs = savedNow;
    }
  });
});

/** The rotating consumable ids (the vendor catalog's rotation pool). */
function vendorRotationPool(): string[] {
  const ids = new Set<string>();
  for (let offset = 0; offset < 40; offset += 1) {
    const rotation = vendorRotationForDate(dateKeyOf(Date.UTC(2026, 10, 4 + offset, 12)));
    for (const id of rotation.consumables) ids.add(id);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// 3. SQL source pins — migration 0060 cannot drift silently
// ---------------------------------------------------------------------------

describe('migration 0060 — source pins', () => {
  const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0060_quickbuy_fill.sql'), 'utf8');

  it('splits stacks with the floor rule and keeps the remainder priced', () => {
    expect(sql).toContain('floor(listing.price_credits::numeric * take / listing.quantity)::bigint');
    expect(sql).toContain('price_credits = listing.price_credits - leg.charge');
  });

  it('excludes the buyer\'s own listings in quote and fill alike', () => {
    expect(sql.match(/seller_user_id <> actor/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('gates the fill on the player economy and enforces the ceiling before charging', () => {
    expect(sql).toContain("if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;");
    expect(sql).toContain('if plan_total > ceiling then');
    expect(sql).toContain('pg_advisory_xact_lock(hashtext(actor::text))');
  });

  it('settles the vendor leg through cc_vendor_buy itself', () => {
    expect(sql).toContain("public.cc_vendor_buy(actor, nonce || ':vendor', p_good_id, qty)");
    expect(sql).toContain("nonce || ':leg:' || leg.listing_id::text");
  });
});
