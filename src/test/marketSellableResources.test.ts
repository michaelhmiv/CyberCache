/**
 * Sellable resources (migration 0050) — fragments, legendary cores,
 * and essences trade on the player market.
 *
 * Layers covered:
 *   1. The shared identity owner (src/lib/market/identityKey.ts): the
 *      three new commodities' identity keys, display names, and Buy
 *      category labels.
 *   2. HTTP through the real write routes + InMemoryWriteStore (the
 *      mirror of the 0050 SQL): per-family escrow at list → delivery
 *      at buy with the 5% fee burned → raw restore at cancel; the
 *      fragment escrow-vs-conversion pin (escrow leaves the balance
 *      at list time, so the 5→1 auto-conversion can only ever see
 *      unescrowed shards; cancel restores raw and never converts);
 *      fragment delivery conversion at buy; forged over-balance
 *      listings rejected; unknown essence rejected; guest lock;
 *      nonce replay never double-escrows.
 *   3. HTTP through the real read routes + InMemoryReadStore: the
 *      three new Buy categories filter, rows carry listing_kind and
 *      essence_id, and price stats fold sold fragment/essence rows.
 *   4. Source pins on db/migrations/0050_sellable_resources.sql, plus
 *      the observability pin: 0049's cc_compute_economy_metrics fold
 *      counts every cc_accept_listing row with NO listing_kind
 *      reference anywhere in the migration, so the new families
 *      register in the daily metrics with no restatement — and 0050
 *      restates neither the metrics function nor the reward
 *      appliers (the 0021/0042 dropped-lines hazard).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
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
  CORE_DISPLAY_NAME,
  CORE_IDENTITY_KEY,
  FRAGMENT_DISPLAY_NAME,
  FRAGMENT_IDENTITY_KEY,
  MARKET_CATEGORY_LABELS,
  MARKET_ESSENCE_IDS,
  essenceDisplayName,
  essenceIdentityKey,
} from '../lib/market/identityKey';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const NOW_ISO = '2026-11-01T12:00:00.000Z';
const NOW = new Date(NOW_ISO);

const S = '11111111-1111-4111-8111-111111111111'; // seller
const B = '22222222-2222-4222-8222-222222222222'; // buyer
const G = '44444444-4444-4444-8444-444444444444'; // guest

// ---------------------------------------------------------------------------
// 1. Shared identity owner
// ---------------------------------------------------------------------------

describe('identityKey — sellable resource commodities (0050)', () => {
  it('keys fragments and cores as single commodities', () => {
    expect(FRAGMENT_IDENTITY_KEY).toBe('frag:cache');
    expect(CORE_IDENTITY_KEY).toBe('core:legendary');
    expect(FRAGMENT_DISPLAY_NAME).toBe('Cache Fragment');
    expect(CORE_DISPLAY_NAME).toBe('Legendary Core');
  });

  it('keys each of the five essences as its own commodity', () => {
    expect(MARKET_ESSENCE_IDS).toEqual(['IgnitionFluid', 'ConduitWire', 'AcidCompound', 'CryoGel', 'VoidEssence']);
    for (const id of MARKET_ESSENCE_IDS) {
      expect(essenceIdentityKey(id)).toBe(`ess:${id}`);
    }
    expect(essenceDisplayName('IgnitionFluid')).toBe('Ignition Fluid');
    expect(essenceDisplayName('ConduitWire')).toBe('Conduit Wire');
    expect(essenceDisplayName('AcidCompound')).toBe('Acid Compound');
    expect(essenceDisplayName('CryoGel')).toBe('Cryo Gel');
    expect(essenceDisplayName('VoidEssence')).toBe('Void Essence');
  });

  it('labels the three new Buy categories', () => {
    expect(MARKET_CATEGORY_LABELS.fragment).toBe('Cache Fragments');
    expect(MARKET_CATEGORY_LABELS.core).toBe('Legendary Cores');
    expect(MARKET_CATEGORY_LABELS.essence).toBe('Essences');
  });
});

// ---------------------------------------------------------------------------
// 2. Write paths (HTTP + InMemoryWriteStore, mirror of the 0050 SQL)
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

function writeSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({
      id: S, username: 'seller', credits: 0,
      cache_token_parts: 4, cache_tokens: 0, legendary_cores: 3,
      essences: { IgnitionFluid: 6, CryoGel: 2 },
    }),
    profile({
      id: B, username: 'buyer', credits: 100_000,
      cache_token_parts: 3, cache_tokens: 1, legendary_cores: 0, essences: {},
    }),
    profile({
      id: G, username: 'guest', account_type: 'guest', email_verified_at: null,
      cache_token_parts: 4, legendary_cores: 2, essences: { CryoGel: 3 },
    }),
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
  await new Promise<void>((resolveListen) => server.on('listening', resolveListen));
  const { port } = server.address() as AddressInfo;
  const tokens: Record<string, string> = {};
  for (const id of [S, B, G]) tokens[id] = issueAccessToken(SECRET, id, id === G);
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
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
  return `res-nonce-${nonceCounter}-abcdef`;
}

describe('sellable resources — write paths', () => {
  let h: WriteHarness;
  beforeAll(async () => { h = await makeWriteServer(); });
  afterAll(async () => { await h.close(); });

  const profileOf = (id: string) => h.store.seed.profiles.find((p) => p.id === id);
  const creditsOf = (id: string) => profileOf(id)?.credits ?? 0;

  it('fragments: escrow at list, delivery converts for the buyer, 5% fee burned', async () => {
    const created = await post(h, '/api/ops/market-create-fragment', h.tokens[S], {
      nonce: nonce(), quantity: 4, price_credits: 2000,
    });
    expect(created.status).toBe(200);
    const listing = created.json.listing as Record<string, unknown>;
    expect(listing.listing_kind).toBe('fragment');
    expect(listing.identity_key).toBe('frag:cache');
    expect(listing.category).toBe('fragment');
    expect(listing.display_name).toBe('Cache Fragment');
    expect(listing.quantity).toBe(4);
    // Escrow left the balance at list time.
    expect(profileOf(S)?.cache_token_parts).toBe(0);

    const accepted = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: listing.id,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json.delivery).toMatchObject({ kind: 'fragment', quantity: 4 });
    // 5% of 2000 = 100 destroyed; seller proceeds 1900.
    expect(accepted.json.market_fee.fee_credits).toBe(100);
    expect(creditsOf(S)).toBe(1900);
    expect(creditsOf(B)).toBe(100_000 - 2000);
    // Buyer held 3 parts + 1 key; delivered 4 shards settle like a
    // reward application: 3 + 4 = 7 -> 2 parts and one more key.
    expect(profileOf(B)?.cache_token_parts).toBe(2);
    expect(profileOf(B)?.cache_tokens).toBe(2);
  });

  it('THE FRAGMENT PIN: escrow is conversion-exempt; cancel restores raw', async () => {
    // Fresh seller balance for the pin: exactly 4 fragments, 0 keys.
    const seller = profileOf(S)!;
    seller.cache_token_parts = 4;
    seller.cache_tokens = 0;
    const created = await post(h, '/api/ops/market-create-fragment', h.tokens[S], {
      nonce: nonce(), quantity: 4, price_credits: 1000,
    });
    expect(created.status).toBe(200);
    // All 4 shards are escrowed: the unescrowed balance is 0, so the
    // 5->1 conversion inside the reward appliers has nothing to see.
    expect(profileOf(S)?.cache_token_parts).toBe(0);
    // The seller earns 1 more fragment (a roaming reward landing):
    // balance 1 — no conversion may fire against the escrowed 4.
    seller.cache_token_parts = (seller.cache_token_parts ?? 0) + 1;
    expect(profileOf(S)?.cache_token_parts).toBe(1);
    expect(profileOf(S)?.cache_tokens).toBe(0);
    // Cancel returns the escrow RAW: balance 5, still 0 keys — the
    // conversion fires on the next reward application, not at cancel.
    const cancelled = await post(h, '/api/ops/market-cancel', h.tokens[S], {
      nonce: nonce(), listing_id: (created.json.listing as Record<string, unknown>).id,
    });
    expect(cancelled.status).toBe(200);
    expect(profileOf(S)?.cache_token_parts).toBe(5);
    expect(profileOf(S)?.cache_tokens).toBe(0);
  });

  it('cores: escrow at list, delivered at buy, 5% fee burned', async () => {
    const created = await post(h, '/api/ops/market-create-core', h.tokens[S], {
      nonce: nonce(), quantity: 2, price_credits: 5000,
    });
    expect(created.status).toBe(200);
    const listing = created.json.listing as Record<string, unknown>;
    expect(listing.listing_kind).toBe('core');
    expect(listing.identity_key).toBe('core:legendary');
    expect(listing.category).toBe('core');
    expect(listing.display_name).toBe('Legendary Core');
    expect(profileOf(S)?.legendary_cores).toBe(1);

    const creditsBefore = creditsOf(S);
    const accepted = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: listing.id,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json.delivery).toMatchObject({ kind: 'core', quantity: 2 });
    expect(accepted.json.market_fee.fee_credits).toBe(250);
    expect(creditsOf(S)).toBe(creditsBefore + 4750);
    expect(profileOf(B)?.legendary_cores).toBe(2);
  });

  it('cores: cancel returns the escrowed cores', async () => {
    const created = await post(h, '/api/ops/market-create-core', h.tokens[S], {
      nonce: nonce(), quantity: 1, price_credits: 3000,
    });
    expect(created.status).toBe(200);
    expect(profileOf(S)?.legendary_cores).toBe(0);
    const cancelled = await post(h, '/api/ops/market-cancel', h.tokens[S], {
      nonce: nonce(), listing_id: (created.json.listing as Record<string, unknown>).id,
    });
    expect(cancelled.status).toBe(200);
    expect(profileOf(S)?.legendary_cores).toBe(1);
  });

  it('essences: each type escrows and delivers independently, fee burned', async () => {
    const created = await post(h, '/api/ops/market-create-essence', h.tokens[S], {
      nonce: nonce(), essence_id: 'IgnitionFluid', quantity: 4, price_credits: 2000,
    });
    expect(created.status).toBe(200);
    const listing = created.json.listing as Record<string, unknown>;
    expect(listing.listing_kind).toBe('essence');
    expect(listing.essence_id).toBe('IgnitionFluid');
    expect(listing.identity_key).toBe('ess:IgnitionFluid');
    expect(listing.category).toBe('essence');
    expect(listing.display_name).toBe('Ignition Fluid');
    expect(profileOf(S)?.essences?.IgnitionFluid).toBe(2);
    // The other essence type is untouched by the escrow.
    expect(profileOf(S)?.essences?.CryoGel).toBe(2);

    const creditsBefore = creditsOf(S);
    const accepted = await post(h, '/api/ops/market-accept', h.tokens[B], {
      nonce: nonce(), listing_id: listing.id,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.json.delivery).toMatchObject({ kind: 'essence', essence_id: 'IgnitionFluid', quantity: 4 });
    expect(accepted.json.market_fee.fee_credits).toBe(100);
    expect(creditsOf(S)).toBe(creditsBefore + 1900);
    expect(profileOf(B)?.essences?.IgnitionFluid).toBe(4);
  });

  it('essences: cancel returns the escrowed units', async () => {
    const created = await post(h, '/api/ops/market-create-essence', h.tokens[S], {
      nonce: nonce(), essence_id: 'CryoGel', quantity: 2, price_credits: 800,
    });
    expect(created.status).toBe(200);
    expect(profileOf(S)?.essences?.CryoGel).toBe(0);
    const cancelled = await post(h, '/api/ops/market-cancel', h.tokens[S], {
      nonce: nonce(), listing_id: (created.json.listing as Record<string, unknown>).id,
    });
    expect(cancelled.status).toBe(200);
    expect(profileOf(S)?.essences?.CryoGel).toBe(2);
  });

  it('forged requests: listing more than the balance is rejected per family', async () => {
    const frag = await post(h, '/api/ops/market-create-fragment', h.tokens[S], {
      nonce: nonce(), quantity: 99, price_credits: 100,
    });
    expect(frag.status).toBe(400);
    const core = await post(h, '/api/ops/market-create-core', h.tokens[S], {
      nonce: nonce(), quantity: 99, price_credits: 100,
    });
    expect(core.status).toBe(400);
    const ess = await post(h, '/api/ops/market-create-essence', h.tokens[S], {
      nonce: nonce(), essence_id: 'IgnitionFluid', quantity: 99, price_credits: 100,
    });
    expect(ess.status).toBe(400);
    const unknown = await post(h, '/api/ops/market-create-essence', h.tokens[S], {
      nonce: nonce(), essence_id: 'Unobtanium', quantity: 1, price_credits: 100,
    });
    expect(unknown.status).toBe(400);
    // Nothing was escrowed by the rejected attempts.
    expect(profileOf(S)?.legendary_cores).toBe(1);
    expect(profileOf(S)?.essences?.IgnitionFluid).toBe(2);
  });

  it('guest lock: guests cannot list any of the three families', async () => {
    const frag = await post(h, '/api/ops/market-create-fragment', h.tokens[G], {
      nonce: nonce(), quantity: 1, price_credits: 100,
    });
    expect(frag.status).toBe(403);
    const core = await post(h, '/api/ops/market-create-core', h.tokens[G], {
      nonce: nonce(), quantity: 1, price_credits: 100,
    });
    expect(core.status).toBe(403);
    const ess = await post(h, '/api/ops/market-create-essence', h.tokens[G], {
      nonce: nonce(), essence_id: 'CryoGel', quantity: 1, price_credits: 100,
    });
    expect(ess.status).toBe(403);
    // The guest's balances never moved.
    expect(profileOf(G)?.cache_token_parts).toBe(4);
    expect(profileOf(G)?.legendary_cores).toBe(2);
    expect(profileOf(G)?.essences?.CryoGel).toBe(3);
  });

  it('nonce replay returns the original listing and never double-escrows', async () => {
    const seller = profileOf(S)!;
    seller.legendary_cores = 2;
    const n = nonce();
    const first = await post(h, '/api/ops/market-create-core', h.tokens[S], {
      nonce: n, quantity: 2, price_credits: 4000,
    });
    expect(first.status).toBe(200);
    expect(profileOf(S)?.legendary_cores).toBe(0);
    const replay = await post(h, '/api/ops/market-create-core', h.tokens[S], {
      nonce: n, quantity: 2, price_credits: 4000,
    });
    expect(replay.status).toBe(200);
    expect((replay.json.listing as Record<string, unknown>).id)
      .toBe((first.json.listing as Record<string, unknown>).id);
    expect(profileOf(S)?.legendary_cores).toBe(0);
    // Clean up so later assertions stay independent.
    await post(h, '/api/ops/market-cancel', h.tokens[S], {
      nonce: nonce(), listing_id: (first.json.listing as Record<string, unknown>).id,
    });
    expect(profileOf(S)?.legendary_cores).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Read paths (HTTP + InMemoryReadStore)
// ---------------------------------------------------------------------------

function readSeed(): ReadSeed {
  const s = emptyReadSeed();
  s.profiles = [profile({ id: S }), profile({ id: B })];
  const listing = (over: Partial<MemListing> & { id: string }): MemListing => ({
    seller_user_id: S, item_instance_id: null, price_credits: 1000, status: 'active',
    listed_at: '2026-10-31T00:00:00.000Z', sold_at: null, ...over,
  });
  s.listings = [
    listing({
      id: 'rr-frag', price_credits: 1250, listed_at: '2026-10-31T10:00:00.000Z',
      listing_kind: 'fragment', quantity: 5,
      identity_key: 'frag:cache', category: 'fragment', display_name: 'Cache Fragment',
    }),
    listing({
      id: 'rr-core', price_credits: 5000, listed_at: '2026-10-31T09:00:00.000Z',
      listing_kind: 'core', quantity: 2,
      identity_key: 'core:legendary', category: 'core', display_name: 'Legendary Core',
    }),
    listing({
      id: 'rr-ess', price_credits: 1500, listed_at: '2026-10-31T08:00:00.000Z',
      listing_kind: 'essence', quantity: 3, essence_id: 'CryoGel',
      identity_key: 'ess:CryoGel', category: 'essence', display_name: 'Cryo Gel',
    }),
    // Completed sales for price stats: fragment 1000/4 = 250 ea;
    // essence 2000/4 = 500 ea.
    listing({
      id: 'rr-frag-sold', status: 'sold', price_credits: 1000, quantity: 4,
      sold_at: '2026-10-31T12:00:00.000Z',
      listing_kind: 'fragment', identity_key: 'frag:cache', category: 'fragment', display_name: 'Cache Fragment',
    }),
    listing({
      id: 'rr-ess-sold', status: 'sold', price_credits: 2000, quantity: 4,
      sold_at: '2026-10-31T12:00:00.000Z', essence_id: 'IgnitionFluid',
      listing_kind: 'essence', identity_key: 'ess:IgnitionFluid', category: 'essence', display_name: 'Ignition Fluid',
    }),
  ];
  return s;
}

describe('sellable resources — read paths', () => {
  let base: string;
  let close: () => Promise<void>;
  let token: string;

  beforeAll(async () => {
    const store = new InMemoryReadStore(readSeed(), () => NOW);
    const app = express();
    app.use(express.json());
    mountReadRoutes(app, store, { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((resolveListen) => server.on('listening', resolveListen));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
    token = issueAccessToken(SECRET, B, false);
    close = () => new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  });
  afterAll(async () => { await close(); });

  async function get(path: string) {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, json: await res.json() };
  }
  const ids = (json: { listings: { id: string }[] }) => json.listings.map((l) => l.id);

  it('the three new categories filter the browse', async () => {
    expect(ids((await get('/api/market/listings?category=fragment')).json)).toEqual(['rr-frag']);
    expect(ids((await get('/api/market/listings?category=core')).json)).toEqual(['rr-core']);
    expect(ids((await get('/api/market/listings?category=essence')).json)).toEqual(['rr-ess']);
    const all = await get('/api/market/listings');
    expect(all.json.total).toBe(3);
  });

  it('browse rows carry the new kinds and the essence id', async () => {
    const res = await get('/api/market/listings?category=essence');
    const row = res.json.listings[0];
    expect(row).toMatchObject({
      listing_kind: 'essence', essence_id: 'CryoGel', quantity: 3,
      identity_key: 'ess:CryoGel', display_name: 'Cryo Gel',
    });
    const frag = (await get('/api/market/listings?category=fragment')).json.listings[0];
    expect(frag).toMatchObject({ listing_kind: 'fragment', quantity: 5, identity_key: 'frag:cache' });
  });

  it('price stats fold sold fragment and essence rows on unit price', async () => {
    const res = await get('/api/market/price-stats?keys=frag:cache,ess:IgnitionFluid,core:legendary');
    expect(res.status).toBe(200);
    const frag = res.json.stats['frag:cache'];
    expect(frag.salesCount).toBe(1);
    expect(frag.medianUnitPrice).toBe(250);
    expect(frag.lastUnitPrice).toBe(250);
    const ess = res.json.stats['ess:IgnitionFluid'];
    expect(ess.salesCount).toBe(1);
    expect(ess.medianUnitPrice).toBe(500);
    const core = res.json.stats['core:legendary'];
    expect(core.salesCount).toBe(0);
    expect(core.medianUnitPrice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. SQL source pins (0050 + the 0049 observability fold)
// ---------------------------------------------------------------------------

describe('migration 0050 — SQL source pins', () => {
  const sql = readFileSync(resolve(__dirname, '../../db/migrations/0050_sellable_resources.sql'), 'utf8');
  const lower = sql.toLowerCase();

  it('creates the three escrow functions and the essence column', () => {
    expect(lower).toContain('function public.cc_market_create_fragment(');
    expect(lower).toContain('function public.cc_market_create_core(');
    expect(lower).toContain('function public.cc_market_create_essence(');
    expect(lower).toContain('add column if not exists essence_id text');
  });

  it('widens the listing_kind check to all seven kinds, normalizing both historical names', () => {
    expect(lower).toContain('drop constraint if exists market_listings_kind_check');
    expect(lower).toContain('drop constraint if exists market_listings_listing_kind_check');
    expect(lower).toContain("check (listing_kind in ('gear', 'consumable', 'material', 'vehicle', 'fragment', 'core', 'essence'))");
  });

  it('fragment escrow leaves cache_token_parts at list time (the conversion exemption)', () => {
    const createFrag = lower.slice(lower.indexOf('function public.cc_market_create_fragment'), lower.indexOf('function public.cc_market_create_core'));
    expect(createFrag).toContain('set cache_token_parts = cache_token_parts - qty');
    expect(createFrag).toContain("'frag:cache'");
    expect(createFrag).toContain('insufficient fragment quantity');
  });

  it('cancel restores fragments RAW — no key conversion in the cancel body', () => {
    const cancel = lower.slice(lower.indexOf('function public.cc_market_cancel'), lower.indexOf('function public.cc_accept_listing'));
    const fragBranch = cancel.slice(cancel.indexOf("listing_kind = 'fragment'"));
    expect(fragBranch).toContain('set cache_token_parts = cache_token_parts + listing.quantity');
    // The whole cancel function never touches cache_tokens: a cancel
    // cannot mint a key out of escrowed shards.
    expect(cancel).not.toContain('cache_tokens');
  });

  it('accept delivers all three families and converts delivered fragments', () => {
    const accept = lower.slice(lower.indexOf('function public.cc_accept_listing'));
    expect(accept).toContain("listing_kind = 'fragment'");
    expect(accept).toContain('while buyer_parts >= 5 loop');
    expect(accept).toContain("listing_kind = 'core'");
    expect(accept).toContain('set legendary_cores = legendary_cores + listing.quantity');
    expect(accept).toContain("listing_kind = 'essence'");
    expect(accept).toContain('cc_jsonb_add_int(essences, listing.essence_id, listing.quantity)');
    expect(accept).toContain("'essence_id', listing.essence_id");
  });

  it('restates NEITHER the metrics fold NOR the reward appliers (0021/0042 hazard)', () => {
    expect(lower).not.toMatch(/create or replace function public\.cc_compute_economy_metrics/);
    expect(lower).not.toMatch(/create or replace function public\.cc_apply_chef_rewards/);
    expect(lower).not.toMatch(/create or replace function public\.cc_settle_offline_roaming/);
  });
});

describe('economy observability — the 0049 metrics fold already counts the new families', () => {
  const files = ['0049_slot_machine.sql'];
  const sql0049 = files
    .map((f) => {
      try {
        return readFileSync(resolve(__dirname, `../../db/migrations/${f}`), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');

  it('0049 folds every cc_accept_listing row with no kind filter anywhere', () => {
    expect(sql0049.length).toBeGreaterThan(0);
    expect(sql0049).toContain("count(*) filter (where action_type = 'cc_accept_listing') as market_sales");
    expect(sql0049).toContain('credits_destroyed_market_fees');
    // The whole migration never references listing_kind: fragment,
    // core, and essence sales land in market_sales / market_volume /
    // credits_destroyed_market_fees exactly like material sales.
    expect(sql0049).not.toContain('listing_kind');
  });
});
