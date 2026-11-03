/**
 * QuickBuy QB-4 — wire-contract fills for the two QB-4 goods.
 *
 * QB-4 mounts no new server surface: the tint flow's Chromaweave
 * line and the reforge bench's Legendary Core line both fill
 * through the QB-1 quote/fill routes (migration 0060). Neither good
 * was covered by an earlier slice, so this file pins their fills
 * through the real write routes + InMemoryWriteStore:
 *   - Chromaweave (kind 'material'): market-only (the vendor price
 *     table has no Chromaweave — it is a refined material), the fill
 *     lands in the buyer's material column the tint escrow reads.
 *   - Legendary Core (kind 'core'): the fill credits the same
 *     profile counter cc_reforge_item spends — proven end-to-end by
 *     reforging with the filled cores — with the standard split +
 *     seller-side fee, and the quote-as-hard-ceiling rule (drift
 *     requotes, nothing moves).
 *   - Guests quote both goods openly; fills refuse.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
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
import type { QuickBuyQuote } from '../lib/market/quickBuy';
import { vendorOfferFor } from '../lib/vendor/catalog';
import { reforgeCostFor } from '../content/reforge';
import { isReforgeableAffix } from '../lib/gear/affixPools';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { createRNG } from '../lib/utils/rng';
import { DropSource, Rarity } from '../types/game';
import type { GearItem, Weapon } from '../types/items';

const SECRET = 'test-secret-at-least-32-chars-long!!';
// Pinned clock: the same Wednesday the QB-1/QB-2/QB-3 harnesses
// use, so the vendor rotation derives identically on both sides.
const nowMs = new Date('2026-11-04T12:00:00.000Z').getTime();
const nowFn = () => new Date(nowMs);
const dateKey = '2026-11-04';

const S = '11111111-1111-4111-8111-111111111111'; // seller 1
const S2 = '22222222-2222-4222-8222-222222222222'; // seller 2
const B = '33333333-3333-4333-8333-333333333333'; // buyer
const G = '44444444-4444-4444-8444-444444444444'; // guest

const L_CW = '99999999-9999-4999-8999-000000000401';
const L_CORE1 = '99999999-9999-4999-8999-000000000402';
const L_CORE2 = '99999999-9999-4999-8999-000000000403';
const WPN = '99999999-9999-4999-8999-000000000404';

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
  } as ProfileRowData;
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
    material_id: null,
    ...overrides,
  } as WriteListingData;
}

function writeSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({ id: S, username: 'seller1', credits: 0 }),
    profile({ id: S2, username: 'seller2', credits: 0 }),
    profile({ id: B, username: 'buyer', credits: 100_000, scrap: 100_000, legendary_cores: 0 }),
    profile({ id: G, username: 'guest', account_type: 'guest', email_verified_at: null, credits: 5_000 }),
  ];
  s.listings = [
    // Chromaweave: 5 for 500cr (100/unit) — a refined material,
    // market-only (no vendor price exists for it).
    listing({
      id: L_CW, seller_user_id: S, listing_kind: 'material', material_id: 'Chromaweave',
      quantity: 5, price_credits: 500,
    }),
    // Legendary Cores: two stacks — 3 @ 3,500 and 2 @ 3,700.
    listing({
      id: L_CORE1, seller_user_id: S, listing_kind: 'core', material_id: null,
      quantity: 3, price_credits: 10_500, listed_at: '2026-11-04T08:00:00.000Z',
    }),
    listing({
      id: L_CORE2, seller_user_id: S2, listing_kind: 'core', material_id: null,
      quantity: 2, price_credits: 7_400, listed_at: '2026-11-04T09:00:00.000Z',
    }),
  ];
  // The buyer's Legendary weapon — the reforge bench's customer
  // once the core fill lands.
  const legendaryWeapon = generateWeapon(
    { source: DropSource.WorldDrop, level: 50, forcedRarity: Rarity.Legendary },
    createRNG(9001),
  ) as Weapon;
  const wpnPayload = { ...legendaryWeapon, rarity: Rarity.Legendary, level: 50 } as Weapon;
  s.items = [{
    id: WPN, owner_user_id: B, kind: 'weapon', static_item_id: null,
    item_level: 50, rarity: Rarity.Legendary,
    quality: null, material_tier: null, condition_state: null,
    condition_current: null, condition_max: null,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null,
    payload: wpnPayload as unknown as Record<string, unknown>,
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 5000,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteItemData];
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
  for (const id of [S, S2, B, G]) tokens[id] = issueAccessToken(SECRET, id, id === G);
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
const nonce = () => `qb4-nonce-${++nonceCounter}-abcdef`;

const quote = (h: Harness, token: string, kind: string, id: string, quantity: number) =>
  post(h, '/api/ops/quickbuy-quote', token, { good_kind: kind, good_id: id, quantity });
const fill = (
  h: Harness, token: string,
  input: { kind: string; id: string; source: string; quantity: number; quotedTotal: number },
) =>
  post(h, '/api/ops/quickbuy-fill', token, {
    nonce: nonce(),
    source: input.source,
    good_kind: input.kind,
    good_id: input.id,
    quantity: input.quantity,
    quoted_total: input.quotedTotal,
  });

describe('quickBuy QB-4 goods (Chromaweave + Legendary Core) — wire fills', () => {
  let h: Harness;
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  const profileOf = (id: string) => h.store.seed.profiles.find((p) => p.id === id);
  const creditsOf = (id: string) => profileOf(id)?.credits ?? 0;
  const coresOf = (id: string) => profileOf(id)?.legendary_cores ?? 0;
  const listingOf = (id: string) => h.store.seed.listings.find((l) => l.id === id);

  it('chromaweave quote: no vendor leg exists — the market sweep prices alone', async () => {
    expect(vendorOfferFor('Chromaweave', dateKey)).toBeNull();
    const res = await quote(h, h.tokens[B], 'material', 'Chromaweave', 2);
    expect(res.status).toBe(200);
    const q = res.json as unknown as QuickBuyQuote;
    expect(q.vendor).toBeNull();
    expect(q.market.supplyQty).toBe(5);
    expect(q.market.total).toBe(200); // floor(500 × 2/5)
    expect(q.market.partial).toBe(false);
  });

  it('chromaweave fill: delivers into the material column the tint escrow reads', async () => {
    const bBefore = creditsOf(B);
    const sBefore = creditsOf(S);
    const res = await fill(h, h.tokens[B], {
      kind: 'material', id: 'Chromaweave', source: 'market', quantity: 2, quotedTotal: 200,
    });
    expect(res.json.status).toBe('filled');
    expect(res.json.total_charged).toBe(200);
    expect(profileOf(B)?.materials.Chromaweave).toBe(2);
    // Partial take: floor(500 × 2/5) = 200; remainder 3 @ 300.
    expect(listingOf(L_CW)?.quantity).toBe(3);
    expect(listingOf(L_CW)?.price_credits).toBe(300);
    // Fee: floor(200 × .05) = 10 destroyed; the seller nets 190.
    expect(creditsOf(S)).toBe(sBefore + 190);
    expect(creditsOf(B)).toBe(bBefore - 200);
  });

  it('core quote: the sweep prices the cheapest stack first, no vendor leg', async () => {
    const res = await quote(h, h.tokens[B], 'core', 'legendary', 2);
    expect(res.status).toBe(200);
    const q = res.json as unknown as QuickBuyQuote;
    expect(q.vendor).toBeNull(); // the vendor never sells cores
    expect(q.market.supplyQty).toBe(5);
    expect(q.market.total).toBe(7_000); // 2 from the 3,500 stack
    expect(q.market.fills[0]?.listingId).toBe(L_CORE1);
  });

  it('core fill: credits the profile counter the reforge op spends', async () => {
    const sBefore = creditsOf(S);
    const res = await fill(h, h.tokens[B], {
      kind: 'core', id: 'legendary', source: 'market', quantity: 2, quotedTotal: 7_000,
    });
    expect(res.json.status).toBe('filled');
    expect(res.json.total_charged).toBe(7_000);
    expect(coresOf(B)).toBe(2);
    // Partial take: floor(10,500 × 2/3) = 7,000; remainder 1 @ 3,500.
    expect(listingOf(L_CORE1)?.quantity).toBe(1);
    expect(listingOf(L_CORE1)?.price_credits).toBe(3_500);
    // Fee: floor(7,000 × .05) = 350 destroyed; the seller nets 6,650.
    expect(creditsOf(S)).toBe(sBefore + 6_650);
  });

  it('spend-through: the filled cores pay a real reforge on the bench', async () => {
    const itemRow = h.store.seed.items.find((i) => i.id === WPN)!;
    const payload = itemRow.payload as unknown as GearItem;
    const affixId = payload.affixes.find(isReforgeableAffix)!.id;
    const cost = reforgeCostFor({ rarity: Rarity.Legendary, level: 50 });
    expect(cost.cores).toBe(2);
    const scrapBefore = profileOf(B)?.scrap ?? 0;
    const res = await post(h, '/api/ops/reforge-item', h.tokens[B], {
      nonce: nonce(), item_id: WPN, affix_id: affixId,
    });
    expect(res.status).toBe(200);
    expect(res.json.action_type).toBe('cc_reforge_item');
    expect(res.json.cores_charged).toBe(2);
    expect(coresOf(B)).toBe(0);
    expect(profileOf(B)?.scrap).toBe(scrapBefore - cost.scrap);
  });

  it('core ceiling: a price move between quote and fill requotes and moves nothing', async () => {
    const res = await quote(h, h.tokens[B], 'core', 'legendary', 3);
    const q = res.json as unknown as QuickBuyQuote;
    // Remaining supply: 1 @ 3,500 (L_CORE1) + 2 @ 3,700 (L_CORE2).
    expect(q.market.total).toBe(10_900);
    // Drift: the second stack's price jumps after the quote.
    listingOf(L_CORE2)!.price_credits = 9_000;
    const bCredits = creditsOf(B);
    const blocked = await fill(h, h.tokens[B], {
      kind: 'core', id: 'legendary', source: 'market', quantity: 3, quotedTotal: 10_900,
    });
    expect(blocked.json.status).toBe('requote');
    expect(blocked.json.reason).toBe('price_moved');
    // Nothing moved: no cores, no credits, no listing quantities.
    expect(coresOf(B)).toBe(0);
    expect(creditsOf(B)).toBe(bCredits);
    expect(listingOf(L_CORE1)?.quantity).toBe(1);
    expect(listingOf(L_CORE2)?.quantity).toBe(2);
    listingOf(L_CORE2)!.price_credits = 7_400;
  });

  it('guest: quotes both QB-4 goods openly, fills refuse', async () => {
    const cw = await quote(h, h.tokens[G], 'material', 'Chromaweave', 1);
    expect(cw.status).toBe(200);
    expect((cw.json as unknown as QuickBuyQuote).market.supplyQty).toBe(3);
    const core = await quote(h, h.tokens[G], 'core', 'legendary', 1);
    expect(core.status).toBe(200);
    expect((core.json as unknown as QuickBuyQuote).market.supplyQty).toBe(3);

    const blocked = await fill(h, h.tokens[G], {
      kind: 'core', id: 'legendary', source: 'market', quantity: 1, quotedTotal: 3_500,
    });
    expect(blocked.json.status).not.toBe('filled');
    expect(coresOf(G)).toBe(0);
  });
});
