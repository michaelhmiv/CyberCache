/**
 * QuickBuy QB-3 — the wire-contract fill for the QB-3 good.
 *
 * QB-3 mounts no new server surface: the dispatch fuel line and
 * the boss/endless belt rows all fill Generic Fuel Cells and belt
 * consumables through the QB-1 quote/fill routes (migration 0060).
 * Belt consumables are the same consumable fills QB-1/QB-2 pinned;
 * the one good no earlier slice covered is the Generic Fuel Cell
 * itself — the dispatch surface's shortfall good. This file pins
 * its fills through the real write routes + InMemoryWriteStore:
 * the vendor staple leg (40cr flat, flat-100% batches) and a
 * market leg with the standard split + fee treatment, plus the
 * guest rule (quotes openly, fill refuses with the remedy).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
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
import type { QuickBuyQuote } from '../lib/market/quickBuy';
import { vendorOfferFor } from '../lib/vendor/catalog';

const SECRET = 'test-secret-at-least-32-chars-long!!';
// Pinned clock: the same Wednesday the QB-1/QB-2 harnesses use, so
// the vendor rotation derives identically on both sides.
const nowMs = new Date('2026-11-04T12:00:00.000Z').getTime();
const nowFn = () => new Date(nowMs);
const dateKey = '2026-11-04';

const S = '11111111-1111-4111-8111-111111111111'; // seller
const B = '33333333-3333-4333-8333-333333333333'; // buyer
const G = '44444444-4444-4444-8444-444444444444'; // guest

const L_FC = '99999999-9999-4999-8999-000000000201';

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
    listing_kind: 'consumable',
    quantity: 1,
    material_id: null,
    ...overrides,
  };
}

function writeSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({ id: S, username: 'seller1', credits: 0 }),
    profile({ id: B, username: 'buyer', credits: 100_000 }),
    profile({ id: G, username: 'guest', account_type: 'guest', email_verified_at: null, credits: 5_000 }),
  ];
  s.listings = [
    // Generic Fuel Cells: 5 for 250cr (50/unit) — above the vendor's
    // 40cr staple, the usual player-market shape for a staple.
    listing({
      id: L_FC, seller_user_id: S, consumable_type: 'GenericFuelCell', quality_percent: 100,
      batch_origin: 'crafted', quantity: 5, price_credits: 250,
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
  for (const id of [S, B, G]) tokens[id] = issueAccessToken(SECRET, id, id === G);
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
const nonce = () => `qb3-nonce-${++nonceCounter}-abcdef`;

const quote = (h: Harness, token: string, quantity: number) =>
  post(h, '/api/ops/quickbuy-quote', token, { good_kind: 'consumable', good_id: 'GenericFuelCell', quantity });
const fill = (
  h: Harness, token: string,
  input: { source: string; quantity: number; quotedTotal: number },
) =>
  post(h, '/api/ops/quickbuy-fill', token, {
    nonce: nonce(),
    source: input.source,
    good_kind: 'consumable',
    good_id: 'GenericFuelCell',
    quantity: input.quantity,
    quoted_total: input.quotedTotal,
  });

describe('quickBuy QB-3 good (GenericFuelCell) — wire fills', () => {
  let h: Harness;
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  const profileOf = (id: string) => h.store.seed.profiles.find((p) => p.id === id);
  const creditsOf = (id: string) => profileOf(id)?.credits ?? 0;
  const listingOf = (id: string) => h.store.seed.listings.find((l) => l.id === id);
  const batchesOf = () =>
    h.store.seed.consumableBatches.filter(
      (b) => b.owner_user_id === B && b.consumable_type === 'GenericFuelCell',
    );

  it('quote: the vendor staple leg and the market sweep both price', async () => {
    const res = await quote(h, h.tokens[B], 2);
    expect(res.status).toBe(200);
    const q = res.json as unknown as QuickBuyQuote;
    const offer = vendorOfferFor('GenericFuelCell', dateKey);
    expect(offer).not.toBeNull();
    expect(offer!.staple).toBe(true);
    expect(q.vendor?.unitPrice).toBe(offer!.unitPrice);
    expect(q.vendor?.total).toBe(offer!.unitPrice * 2);
    expect(q.market.total).toBe(100); // floor(250 × 2/5)
    expect(q.market.supplyQty).toBe(5);
  });

  it('vendor fill: delivers flat-100% cells at the quoted staple price', async () => {
    const offer = vendorOfferFor('GenericFuelCell', dateKey)!;
    const before = creditsOf(B);
    const res = await fill(h, h.tokens[B], {
      source: 'vendor', quantity: 2, quotedTotal: offer.unitPrice * 2,
    });
    expect(res.json.status).toBe('filled');
    expect(res.json.source).toBe('vendor');
    expect(creditsOf(B)).toBe(before - offer.unitPrice * 2);
    expect(profileOf(B)?.consumables.GenericFuelCell).toBe(2);
    const batches = batchesOf();
    expect(batches.reduce((sum, b) => sum + b.quantity, 0)).toBe(2);
    expect(batches.every((b) => b.quality_percent === 100)).toBe(true);
  });

  it('market fill: splits the stack, pays the seller net of fee, delivers the cells', async () => {
    const sBefore = creditsOf(S);
    const res = await fill(h, h.tokens[B], {
      source: 'market', quantity: 2, quotedTotal: 100,
    });
    expect(res.json.status).toBe('filled');
    expect(res.json.total_charged).toBe(100);
    // Partial take: floor(250 × 2/5) = 100; remainder 3 @ 150.
    expect(listingOf(L_FC)?.quantity).toBe(3);
    expect(listingOf(L_FC)?.price_credits).toBe(150);
    // Fee: floor(100 × .05) = 5 destroyed; the seller nets 95.
    expect(creditsOf(S)).toBe(sBefore + 95);
    expect(profileOf(B)?.consumables.GenericFuelCell).toBe(4);
    expect(batchesOf().reduce((sum, b) => sum + b.quantity, 0)).toBe(4);
  });

  it('guest: quotes openly and the fill refuses with the sign-in remedy', async () => {
    const offer = vendorOfferFor('GenericFuelCell', dateKey)!;
    const res = await quote(h, h.tokens[G], 1);
    expect(res.status).toBe(200);
    expect((res.json as unknown as QuickBuyQuote).vendor?.unitPrice).toBe(offer.unitPrice);

    const blocked = await fill(h, h.tokens[G], {
      source: 'vendor', quantity: 1, quotedTotal: offer.unitPrice,
    });
    expect(blocked.status).toBe(403);
    expect(blocked.json.message).toContain('Verified account required');
  });
});
