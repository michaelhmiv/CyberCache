/**
 * QuickBuy QB-2 — the board shortfall fields and the QB-2 goods'
 * wire-contract fills.
 *
 * Section 1 (server builders, pure): the new shortfall fields on
 * the shared board-requirement builders (src/server/writes/
 * boardRequirements.ts) — the number the + mounts on. The
 * shortfall is the remaining points priced in whole units at
 * STANDARD quality (100%) at the reader's efficiency: the planning
 * basis a fresh unit is quoted at everywhere else (vendor stock is
 * flat 100%), so the sheet's stepper opens at a quantity the
 * market or the vendor can actually deliver.
 *
 * Section 2 (wire, checkpoint 3): fills through the real write
 * routes + InMemoryWriteStore for the QB-2 goods — PatchKit
 * (vendor staple leg + market leg), FieldPatchKit (market-only),
 * CalibrationCore (market-only) — proving delivery lands in the
 * buyer's consumable batches.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  coveredPoints,
  repairJobRequirements,
  shieldTechJobRequirements,
  shortfallUnits,
  type ServiceReaderFacts,
} from '../server/writes/boardRequirements';
import {
  calibrationCoreCapacityPoints,
  coresNeededForTarget,
} from '../content/shieldTech';
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

function reader(
  batchesByType: Record<string, Array<{ quality: number; quantity: number }>>,
  efficiency = 1,
): ServiceReaderFacts {
  return {
    verified: true,
    batchesByType: new Map(Object.entries(batchesByType)),
    workRatePointsPerHour: 100,
    efficiency,
  };
}

describe('boardRequirements — shortfall helpers', () => {
  it('coveredPoints sums every batch at its own yield, order-free', () => {
    const perUnit = (q: number) => (q / 100) * 10;
    const forward = coveredPoints(
      [{ quality: 100, quantity: 2 }, { quality: 50, quantity: 4 }],
      perUnit,
    );
    const reversed = coveredPoints(
      [{ quality: 50, quantity: 4 }, { quality: 100, quantity: 2 }],
      perUnit,
    );
    expect(forward).toBe(40);
    expect(reversed).toBe(40);
  });

  it('shortfallUnits ceils the remainder at standard quality, 0 when covered or degenerate', () => {
    expect(shortfallUnits(100, 60, 25)).toBe(2);
    expect(shortfallUnits(100, 100, 25)).toBe(0);
    expect(shortfallUnits(100, 140, 25)).toBe(0);
    expect(shortfallUnits(0, 0, 25)).toBe(0);
    expect(shortfallUnits(100, 0, 0)).toBe(0);
    expect(shortfallUnits(100, 0, -5)).toBe(0);
  });
});

describe('boardRequirements — repair kit shortfall', () => {
  const base = (kitType: string) => (kitType === 'PatchKit' ? 100 : 200);
  const restore = (kitBase: number, qualityPct: number, efficiency: number) =>
    kitBase * (qualityPct / 100) * efficiency;

  const build = (batchesByType: Record<string, Array<{ quality: number; quantity: number }>>, target = 250) =>
    repairJobRequirements({
      ownerUserId: 'owner-1',
      callerId: 'reader-1',
      targetPoints: target,
      priceCredits: 1000,
      kitTypes: ['PatchKit'],
      kitBase: base,
      kitRestorePoints: restore,
      reader: reader(batchesByType),
    });

  it('no stock: the whole target, in standard units', () => {
    const req = build({});
    const opt = req.kitOptions[0];
    expect(opt.onHand).toBe(0);
    expect(opt.estimatedKits).toBeNull();
    expect(opt.coversTarget).toBe(false);
    expect(opt.shortfallKits).toBe(3); // ceil(250 / 100)
  });

  it('partial stock: the remainder only, at standard quality — not the burn-order count', () => {
    // 1 × 100% covers 100 of 250; the burn walk runs dry (null),
    // but the shortfall is just ceil(150 / 100) = 2 fresh kits.
    const req = build({ PatchKit: [{ quality: 100, quantity: 1 }] });
    const opt = req.kitOptions[0];
    expect(opt.onHand).toBe(1);
    expect(opt.estimatedKits).toBeNull();
    expect(opt.shortfallKits).toBe(2);
  });

  it('mixed-quality stock prices the remainder off its real coverage', () => {
    // 2 × 50% cover 100 of 250 — same remainder as 1 × 100%.
    const req = build({ PatchKit: [{ quality: 50, quantity: 2 }] });
    expect(req.kitOptions[0].shortfallKits).toBe(2);
  });

  it('covered stock: shortfall 0 and the burn walk agrees', () => {
    const req = build({ PatchKit: [{ quality: 100, quantity: 3 }] });
    const opt = req.kitOptions[0];
    expect(opt.onHand).toBe(3);
    expect(opt.estimatedKits).toBe(3);
    expect(opt.coversTarget).toBe(true);
    expect(opt.shortfallKits).toBe(0);
  });
});

describe('boardRequirements — shield-tech core shortfall', () => {
  const build = (batchesByType: Record<string, Array<{ quality: number; quantity: number }>>, target = 9000) =>
    shieldTechJobRequirements({
      ownerUserId: 'owner-1',
      callerId: 'reader-1',
      targetPoints: target,
      priceCredits: 1000,
      coreType: 'CalibrationCore',
      coresNeeded: coresNeededForTarget,
      coreCapacityPoints: calibrationCoreCapacityPoints,
      reader: reader(batchesByType),
    });

  it('partial stock: remainder in whole standard cores', () => {
    // 2 × 100% cores cover 5,000 of 9,000; a standard core yields
    // 2,500 → ceil(4,000 / 2,500) = 2.
    const req = build({ CalibrationCore: [{ quality: 100, quantity: 2 }] });
    expect(req.coresOnHand).toBe(2);
    expect(req.estimatedCores).toBeNull();
    expect(req.coversTarget).toBe(false);
    expect(req.shortfallCores).toBe(2);
  });

  it('covered stock: shortfall 0', () => {
    const req = build({ CalibrationCore: [{ quality: 100, quantity: 4 }] });
    expect(req.estimatedCores).toBe(4);
    expect(req.coversTarget).toBe(true);
    expect(req.shortfallCores).toBe(0);
  });

  it('no stock: the whole target in standard cores', () => {
    const req = build({});
    expect(req.coresOnHand).toBe(0);
    expect(req.shortfallCores).toBe(4); // ceil(9,000 / 2,500)
  });
});

// ---------------------------------------------------------------------------
// 2. Wire fills for the QB-2 goods through the real routes + twin
// ---------------------------------------------------------------------------

const SECRET = 'test-secret-at-least-32-chars-long!!';
// Pinned clock: a Wednesday (matches the QB-1 harness date so the
// vendor rotation derives identically on both sides).
const nowMs = new Date('2026-11-04T12:00:00.000Z').getTime();
const nowFn = () => new Date(nowMs);
const dateKey = '2026-11-04';

const S = '11111111-1111-4111-8111-111111111111'; // seller
const B = '33333333-3333-4333-8333-333333333333'; // buyer
const G = '44444444-4444-4444-8444-444444444444'; // guest

const L_PK = '99999999-9999-4999-8999-000000000101';
const L_FPK = '99999999-9999-4999-8999-000000000102';
const L_CC = '99999999-9999-4999-8999-000000000103';

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
    // Patch Kits: 10 for 1,000cr (100/unit), one crafted 120% batch.
    listing({
      id: L_PK, seller_user_id: S, consumable_type: 'PatchKit', quality_percent: 120,
      batch_origin: 'crafted', quantity: 10, price_credits: 1000,
    }),
    // Field Patch Kits: 4 for 800cr (200/unit) — vendor never sells these.
    listing({
      id: L_FPK, seller_user_id: S, consumable_type: 'FieldPatchKit', quality_percent: 100,
      batch_origin: 'crafted', quantity: 4, price_credits: 800,
    }),
    // Calibration Cores: 3 for 1,500cr (500/unit) — vendor never sells these.
    listing({
      id: L_CC, seller_user_id: S, consumable_type: 'CalibrationCore', quality_percent: 90,
      batch_origin: 'crafted', quantity: 3, price_credits: 1500,
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
const nonce = () => `qb2-nonce-${++nonceCounter}-abcdef`;

const quote = (h: Harness, token: string, id: string, quantity: number) =>
  post(h, '/api/ops/quickbuy-quote', token, { good_kind: 'consumable', good_id: id, quantity });
const fill = (
  h: Harness, token: string,
  input: { source: string; id: string; quantity: number; quotedTotal: number },
) =>
  post(h, '/api/ops/quickbuy-fill', token, {
    nonce: nonce(),
    source: input.source,
    good_kind: 'consumable',
    good_id: input.id,
    quantity: input.quantity,
    quoted_total: input.quotedTotal,
  });

describe('quickBuy QB-2 goods — wire fills', () => {
  let h: Harness;
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  const profileOf = (id: string) => h.store.seed.profiles.find((p) => p.id === id);
  const creditsOf = (id: string) => profileOf(id)?.credits ?? 0;
  const listingOf = (id: string) => h.store.seed.listings.find((l) => l.id === id);
  const batchesOf = (type: string) =>
    h.store.seed.consumableBatches.filter(
      (b) => b.owner_user_id === B && b.consumable_type === type,
    );

  it('PatchKit quote: the vendor staple leg and the market sweep both price', async () => {
    const res = await quote(h, h.tokens[B], 'PatchKit', 2);
    expect(res.status).toBe(200);
    const q = res.json as unknown as QuickBuyQuote;
    const offer = vendorOfferFor('PatchKit', dateKey);
    expect(offer).not.toBeNull();
    expect(offer!.staple).toBe(true);
    expect(q.vendor?.unitPrice).toBe(offer!.unitPrice);
    expect(q.vendor?.total).toBe(offer!.unitPrice * 2);
    expect(q.market.total).toBe(200);
    expect(q.market.supplyQty).toBe(10);
  });

  it('PatchKit vendor fill: delivers flat-100% kits at the quoted staple price', async () => {
    const offer = vendorOfferFor('PatchKit', dateKey)!;
    const before = creditsOf(B);
    const res = await fill(h, h.tokens[B], {
      source: 'vendor', id: 'PatchKit', quantity: 2, quotedTotal: offer.unitPrice * 2,
    });
    expect(res.json.status).toBe('filled');
    expect(res.json.source).toBe('vendor');
    expect(creditsOf(B)).toBe(before - offer.unitPrice * 2);
    expect(profileOf(B)?.consumables.PatchKit).toBe(2);
    const batches = batchesOf('PatchKit');
    expect(batches.reduce((sum, b) => sum + b.quantity, 0)).toBe(2);
    expect(batches.every((b) => b.quality_percent === 100)).toBe(true);
  });

  it('PatchKit market fill: splits the stack, pays the seller net of fee, delivers the listed quality', async () => {
    const sBefore = creditsOf(S);
    const res = await fill(h, h.tokens[B], {
      source: 'market', id: 'PatchKit', quantity: 3, quotedTotal: 300,
    });
    expect(res.json.status).toBe('filled');
    expect(res.json.total_charged).toBe(300);
    // Partial take: floor(1000 × 3/10) = 300; remainder 7 @ 700.
    expect(listingOf(L_PK)?.quantity).toBe(7);
    expect(listingOf(L_PK)?.price_credits).toBe(700);
    // Fee: floor(300 × .05) = 15 destroyed; the seller nets 285.
    expect(creditsOf(S)).toBe(sBefore + 285);
    expect(profileOf(B)?.consumables.PatchKit).toBe(5);
    const crafted = batchesOf('PatchKit').filter((b) => b.quality_percent === 120);
    expect(crafted.reduce((sum, b) => sum + b.quantity, 0)).toBe(3);
  });

  it('FieldPatchKit: no vendor leg exists — quote is market-only and the fill delivers', async () => {
    const res = await quote(h, h.tokens[B], 'FieldPatchKit', 2);
    const q = res.json as unknown as QuickBuyQuote;
    expect(q.vendor).toBeNull();
    expect(q.market.total).toBe(400);

    const filled = await fill(h, h.tokens[B], {
      source: 'market', id: 'FieldPatchKit', quantity: 2, quotedTotal: 400,
    });
    expect(filled.json.status).toBe('filled');
    expect(listingOf(L_FPK)?.quantity).toBe(2);
    expect(listingOf(L_FPK)?.price_credits).toBe(400);
    expect(profileOf(B)?.consumables.FieldPatchKit).toBe(2);
    expect(batchesOf('FieldPatchKit').reduce((sum, b) => sum + b.quantity, 0)).toBe(2);
  });

  it('CalibrationCore: market-only fill delivers the listed batch intact', async () => {
    const res = await quote(h, h.tokens[B], 'CalibrationCore', 2);
    const q = res.json as unknown as QuickBuyQuote;
    expect(q.vendor).toBeNull();
    expect(q.market.total).toBe(1000);

    const filled = await fill(h, h.tokens[B], {
      source: 'market', id: 'CalibrationCore', quantity: 2, quotedTotal: 1000,
    });
    expect(filled.json.status).toBe('filled');
    expect(listingOf(L_CC)?.quantity).toBe(1);
    expect(listingOf(L_CC)?.price_credits).toBe(500);
    expect(profileOf(B)?.consumables.CalibrationCore).toBe(2);
    const batches = batchesOf('CalibrationCore');
    expect(batches).toHaveLength(1);
    expect(batches[0].quality_percent).toBe(90);
    expect(batches[0].quantity).toBe(2);
  });

  it('guest: a QB-2 good quotes openly and the fill refuses with the sign-in remedy', async () => {
    const offer = vendorOfferFor('PatchKit', dateKey)!;
    const res = await quote(h, h.tokens[G], 'PatchKit', 1);
    expect(res.status).toBe(200);
    expect((res.json as unknown as QuickBuyQuote).vendor?.unitPrice).toBe(offer.unitPrice);

    const blocked = await fill(h, h.tokens[G], {
      source: 'vendor', id: 'PatchKit', quantity: 1, quotedTotal: offer.unitPrice,
    });
    expect(blocked.status).toBe(403);
    expect(blocked.json.message).toContain('Verified account required');
  });
});
