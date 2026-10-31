/**
 * Vendor 2a — rotation + Item of the Day + buyback (migration 0020).
 *
 * Layers covered:
 *   1. The ONE catalog (src/lib/vendor/catalog.ts): staples derive
 *      from the consumable defs, the rotation pool is the priced
 *      non-staple set, materials/essences carry the new values.
 *   2. Rotation determinism: same UTC date → identical stock on
 *      every call; the featured item is always on sale that day;
 *      the discount math is exact integer math.
 *   3. Shipped paths over HTTP against InMemoryWriteStore (the SQL
 *      twin's mirror): rotation buys land on their day and fail on
 *      other days, the Item of the Day discount is charged exactly,
 *      buyback pays floor(value × levered rate) for gear / batches /
 *      stacks, equipped + locked gear is refused, nonce replay does
 *      not double-pay, and guests can buy AND sell.
 *   4. The vendorBuybackRate lever registry (0..0.9, default = the
 *      catalog constant) and the economy-metrics attribution of
 *      cc_vendor_sell payouts as a mint source.
 *   5. Source pins on migration 0020, including a full parse of the
 *      cc_vendor_catalog VALUES list against this TS catalog.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore, type InMemoryWriteOptions } from '../server/writes/memory';
import {
  emptyWriteSeed,
  type ConsumableBatchData,
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import { VENDOR_CONSUMABLES } from '../constants/consumables';
import {
  VENDOR_BUYBACK_RATE_DEFAULT,
  VENDOR_MATERIALS,
  VENDOR_ROTATION_DEFS,
  VENDOR_STAPLE_DEFS,
  discountedUnitPrice,
  vendorBasePrice,
  vendorOfferFor,
  vendorRotationForDate,
  vendorStockForDate,
} from '../lib/vendor/catalog';
import {
  ECONOMY_CONFIG_DEFAULTS,
  resolveEconomyConfigValues,
  validateEconomyConfigValue,
} from '../server/economy/config';
import { InMemoryEconomyStore, emptyEconomySeed } from '../server/economy/memory';

const SECRET = 'test-secret-at-least-32-chars-long!!';

const A = '11111111-1111-4111-8111-111111111111';
const G = '33333333-3333-4333-8333-333333333333'; // guest

const GEAR_OK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GEAR_EQUIPPED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GEAR_LOCKED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GEAR_LISTED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GEAR_SECOND = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const BATCH_MEDKIT = '12121212-1212-4121-8121-121212121212';

const DAY_A = '2027-01-15';
const DAY_B = '2027-01-16';
let nowMs = Date.parse(`${DAY_A}T12:00:00.000Z`);
let buybackRate = VENDOR_BUYBACK_RATE_DEFAULT;
let uuidCounter = 0;

function nextUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
}

function profile(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 1, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2027-01-15T10:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2027-01-14T00:00:00.000Z',
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
    account_bound: false, locked_until: null, payload: { weaponType: 'Pistol', combatPower: 50 },
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function batch(overrides: Partial<ConsumableBatchData> & { id: string; owner_user_id: string }): ConsumableBatchData {
  return {
    consumable_type: 'MedKit', quality_percent: 100, quantity: 1, origin: 'crafted',
    creator_user_id: null, source_recipe_id: null, metadata: {},
    created_at: '2027-01-10T00:00:00.000Z', updated_at: '2027-01-10T00:00:00.000Z',
    ...overrides,
  };
}

function baseSeed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({
      id: A, username: 'alpha', credits: 100_000,
      materials: { ScrapAlloy: 20 }, essences: { VoidEssence: 2 },
      consumables: { MedKit: 3 },
    }),
    profile({
      id: G, username: 'guest_g', account_type: 'guest', email_verified_at: null,
      credits: 10_000, materials: { ScrapAlloy: 5 },
    }),
  ];
  s.items = [
    item({ id: GEAR_OK, owner_user_id: A }),
    item({ id: GEAR_EQUIPPED, owner_user_id: A, runtime_state: 'equipped', equipped_slot: 'primary' }),
    item({ id: GEAR_LOCKED, owner_user_id: A, is_locked: true }),
    item({ id: GEAR_LISTED, owner_user_id: A, runtime_state: 'listed' }),
    item({ id: GEAR_SECOND, owner_user_id: A }),
  ];
  s.consumableBatches = [
    batch({ id: BATCH_MEDKIT, owner_user_id: A, quality_percent: 125, quantity: 3 }),
  ];
  return s;
}

interface Harness {
  store: InMemoryWriteStore;
  base: string;
  close: () => Promise<void>;
  tokenA: string;
  tokenG: string;
}

async function makeServer(): Promise<Harness> {
  const opts: InMemoryWriteOptions = {
    now: () => new Date(nowMs),
    uuid: nextUuid,
    buybackRateProvider: () => buybackRate,
  };
  const store = new InMemoryWriteStore(baseSeed(), opts);
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolveListen) => server.on('listening', resolveListen));
  const { port } = server.address() as AddressInfo;
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    tokenA: issueAccessToken(SECRET, A, false),
    tokenG: issueAccessToken(SECRET, G, true),
  };
}

interface Reply {
  status: number;
  json: Record<string, unknown>;
}

async function post(h: Harness, path: string, token: string | null, payload?: unknown): Promise<Reply> {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

let nonceCounter = 0;
function nonce(): string {
  nonceCounter += 1;
  return `vendor-nonce-${nonceCounter}-abcdef`;
}

function profileOf(h: Harness, id: string): ProfileRowData {
  const p = h.store.seed.profiles.find((row) => row.id === id);
  if (!p) throw new Error(`profile ${id} missing`);
  return p;
}

// ---------------------------------------------------------------------------
// 1 + 2. The catalog and rotation math
// ---------------------------------------------------------------------------

describe('vendor catalog — the one source', () => {
  it('staples are exactly the vendor-stocked consumable defs, at def prices', () => {
    expect(VENDOR_STAPLE_DEFS.map((c) => c.id).sort()).toEqual(
      VENDOR_CONSUMABLES.map((c) => c.id).sort(),
    );
    expect(VENDOR_STAPLE_DEFS).toHaveLength(9); // 7 originals + GenericFuelCell/PatchKit (0021)
    for (const def of VENDOR_STAPLE_DEFS) {
      expect(vendorBasePrice(def.id)).toBe(def.market.vendorPrice);
    }
  });

  it('rotation pool: priced non-staples incl. the rotating-only def, excl. legacy', () => {
    const ids = VENDOR_ROTATION_DEFS.map((c) => c.id);
    expect(ids).toContain('WorkshopRushTicket'); // rotatingVendorOnly
    expect(ids).not.toContain('ElementalCoating'); // not craftable / not player-marketable
    for (const staple of VENDOR_STAPLE_DEFS) expect(ids).not.toContain(staple.id);
    expect(VENDOR_ROTATION_DEFS).toHaveLength(23);
  });

  it('materials + essences carry vendor values for all ten profile counters', () => {
    expect(VENDOR_MATERIALS).toHaveLength(10);
    expect(vendorBasePrice('ScrapAlloy')).toBe(10);
    expect(vendorBasePrice('VoidDust')).toBe(75);
    expect(vendorBasePrice('VoidEssence')).toBe(90);
    expect(vendorBasePrice('Nope')).toBeNull();
  });

  it('discount math is exact per-unit integer math', () => {
    expect(discountedUnitPrice(250)).toBe(187);
    expect(discountedUnitPrice(150)).toBe(112);
    expect(discountedUnitPrice(350)).toBe(262);
    expect(discountedUnitPrice(400)).toBe(300);
    expect(discountedUnitPrice(1000)).toBe(750);
  });

  it('rotation is deterministic per date and well-formed over a month', () => {
    const first = vendorRotationForDate(DAY_A);
    expect(vendorRotationForDate(DAY_A)).toEqual(first);
    expect(first.consumables).toHaveLength(2);
    expect(first.materials).toHaveLength(1);
    expect(new Set(first.consumables).size).toBe(2);

    const seen = new Set<string>();
    for (let day = 1; day <= 30; day += 1) {
      const key = `2027-02-${String(day).padStart(2, '0')}`;
      const rotation = vendorRotationForDate(key);
      seen.add(rotation.consumables.join(','));
      // Every pick is in its pool, and the featured item is on sale.
      for (const id of rotation.consumables) {
        expect(VENDOR_ROTATION_DEFS.map((c) => c.id)).toContain(id);
      }
      expect(VENDOR_MATERIALS.map((m) => m.id)).toContain(rotation.materials[0]);
      const featured = vendorOfferFor(rotation.itemOfTheDay, key);
      expect(featured).not.toBeNull();
      expect(featured?.itemOfTheDay).toBe(true);
      expect(featured?.unitPrice).toBe(discountedUnitPrice(featured?.basePrice ?? 0));
      // Stock for the day = 9 staples + 2 rotation + 1 material, no dupes.
      const stock = vendorStockForDate(key);
      expect(stock).toHaveLength(12);
      expect(new Set(stock.map((o) => o.itemKey)).size).toBe(12);
    }
    expect(seen.size).toBeGreaterThan(10); // the stock actually rotates
  });

  it('off-day rotation items and unknown items are not on sale', () => {
    const rotationA = vendorRotationForDate(DAY_A);
    const offDay = VENDOR_ROTATION_DEFS.map((c) => c.id).find(
      (id) => !rotationA.consumables.includes(id),
    );
    expect(offDay).toBeDefined();
    expect(vendorOfferFor(offDay as string, DAY_A)).toBeNull();
    expect(vendorOfferFor('ElementalCoating', DAY_A)).toBeNull();
    expect(vendorOfferFor('MedKit', DAY_A)?.unitPrice).toBe(250); // staple, not featured on DAY_A
  });
});

// ---------------------------------------------------------------------------
// 3. Shipped paths
// ---------------------------------------------------------------------------

describe('vendor rotation + item of the day — shipped buy path', () => {
  let h: Harness;
  beforeAll(async () => {
    nowMs = Date.parse(`${DAY_A}T12:00:00.000Z`);
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('buys a rotating consumable on its day at full price, as a 100% batch', async () => {
    const rotation = vendorRotationForDate(DAY_A);
    const key = rotation.consumables[0];
    const base = vendorBasePrice(key);
    const res = await post(h, '/api/ops/vendor-buy', h.tokenA, { nonce: nonce(), item_key: key, quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.json.total_price).toBe((base ?? 0) * 2);
    expect(res.json.kind).toBe('consumable');
    const batchRow = h.store.seed.consumableBatches.find(
      (b) => b.owner_user_id === A && b.consumable_type === key,
    );
    expect(batchRow?.quantity).toBe(2);
    expect(batchRow?.quality_percent).toBe(100);
    expect(batchRow?.origin).toBe('vendor');
  });

  it('refuses the same consumable the next day (rollover) and sells the new day’s pick', async () => {
    const rotationA = vendorRotationForDate(DAY_A);
    const rotationB = vendorRotationForDate(DAY_B);
    const stale = rotationA.consumables.find((id) => !rotationB.consumables.includes(id));
    expect(stale).toBeDefined();
    nowMs = Date.parse(`${DAY_B}T12:00:00.000Z`);
    try {
      const res = await post(h, '/api/ops/vendor-buy', h.tokenA, { nonce: nonce(), item_key: stale, quantity: 1 });
      expect(res.status).toBe(400);
      expect(res.json.message).toBe('Unknown vendor item');

      const fresh = await post(h, '/api/ops/vendor-buy', h.tokenA, {
        nonce: nonce(),
        item_key: rotationB.consumables[0],
        quantity: 1,
      });
      expect(fresh.status).toBe(200);
    } finally {
      nowMs = Date.parse(`${DAY_A}T12:00:00.000Z`);
    }
  });

  it('charges the Item of the Day discount exactly, per unit', async () => {
    const rotation = vendorRotationForDate(DAY_A);
    const featured = rotation.itemOfTheDay;
    const base = vendorBasePrice(featured) ?? 0;
    const creditsBefore = profileOf(h, A).credits;
    const res = await post(h, '/api/ops/vendor-buy', h.tokenA, { nonce: nonce(), item_key: featured, quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.json.item_of_the_day).toBe(true);
    expect(res.json.unit_price).toBe(discountedUnitPrice(base));
    expect(res.json.total_price).toBe(discountedUnitPrice(base) * 2);
    expect(profileOf(h, A).credits).toBe(creditsBefore - discountedUnitPrice(base) * 2);
  });

  it('buys the rotating material/essence into the right profile counter, no batch', async () => {
    const rotation = vendorRotationForDate(DAY_A);
    const key = rotation.materials[0];
    const entry = VENDOR_MATERIALS.find((m) => m.id === key);
    if (!entry) throw new Error('rotation material missing from catalog');
    const counters = () => (entry.kind === 'material' ? profileOf(h, A).materials : profileOf(h, A).essences);
    const before = (counters()[key] as number | undefined) ?? 0;
    const batchesBefore = h.store.seed.consumableBatches.length;
    const res = await post(h, '/api/ops/vendor-buy', h.tokenA, { nonce: nonce(), item_key: key, quantity: 3 });
    expect(res.status).toBe(200);
    expect(res.json.kind).toBe(entry.kind);
    expect(res.json.batch_id).toBeNull();
    expect(res.json.total_price).toBe(entry.unitPrice * 3);
    expect((counters()[key] as number | undefined) ?? 0).toBe(before + 3);
    expect(h.store.seed.consumableBatches.length).toBe(batchesBefore);
  });

  it('staples stay buyable at base price on any day', async () => {
    const res = await post(h, '/api/ops/vendor-buy', h.tokenA, { nonce: nonce(), item_key: 'ShieldCell', quantity: 1 });
    expect(res.status).toBe(200);
    expect(res.json.total_price).toBe(300);
    expect(res.json.item_of_the_day).toBe(false);
  });
});

describe('vendor buyback — shipped sell path', () => {
  let h: Harness;
  beforeAll(async () => {
    nowMs = Date.parse(`${DAY_A}T12:00:00.000Z`);
    buybackRate = VENDOR_BUYBACK_RATE_DEFAULT;
    h = await makeServer();
  });
  afterAll(async () => h.close());

  it('sells gear at floor(estimated value × rate) and consumes the instance', async () => {
    const creditsBefore = profileOf(h, A).credits;
    const res = await post(h, '/api/ops/vendor-sell', h.tokenA, { nonce: nonce(), kind: 'gear', item_id: GEAR_OK });
    expect(res.status).toBe(200);
    expect(res.json.total_payout).toBe(200); // floor(500 × 0.4)
    expect(res.json.vendor_value).toBe(500);
    expect(profileOf(h, A).credits).toBe(creditsBefore + 200);
    const row = h.store.seed.items.find((i) => i.id === GEAR_OK);
    expect(row?.runtime_state).toBe('consumed');
  });

  it('nonce replay returns the prior result and does not double-pay', async () => {
    const sharedNonce = nonce();
    const creditsBefore = profileOf(h, A).credits;
    const first = await post(h, '/api/ops/vendor-sell', h.tokenA, {
      nonce: sharedNonce, kind: 'material', material_id: 'ScrapAlloy', quantity: 5,
    });
    expect(first.status).toBe(200);
    expect(first.json.total_payout).toBe(20); // floor(5 × 10 × 0.4)
    const replay = await post(h, '/api/ops/vendor-sell', h.tokenA, {
      nonce: sharedNonce, kind: 'material', material_id: 'ScrapAlloy', quantity: 5,
    });
    expect(replay.status).toBe(200);
    expect(replay.json.total_payout).toBe(20);
    expect(profileOf(h, A).credits).toBe(creditsBefore + 20);
    expect(profileOf(h, A).materials.ScrapAlloy).toBe(15);
  });

  it('refuses equipped, locked, and listed gear', async () => {
    const equipped = await post(h, '/api/ops/vendor-sell', h.tokenA, { nonce: nonce(), kind: 'gear', item_id: GEAR_EQUIPPED });
    expect(equipped.status).toBe(409); // 'Item state invalid' is a conflict, per codeForWriteMessage
    expect(equipped.json.message).toBe('Item state invalid');
    const locked = await post(h, '/api/ops/vendor-sell', h.tokenA, { nonce: nonce(), kind: 'gear', item_id: GEAR_LOCKED });
    expect(locked.status).toBe(400);
    expect(locked.json.message).toBe('Locked item');
    const listed = await post(h, '/api/ops/vendor-sell', h.tokenA, { nonce: nonce(), kind: 'gear', item_id: GEAR_LISTED });
    expect(listed.status).toBe(409);
    expect(listed.json.message).toBe('Item state invalid');
  });

  it('the buyback lever moves the payout', async () => {
    buybackRate = 0.5;
    try {
      const res = await post(h, '/api/ops/vendor-sell', h.tokenA, { nonce: nonce(), kind: 'gear', item_id: GEAR_SECOND });
      expect(res.status).toBe(200);
      expect(res.json.buyback_rate).toBe(0.5);
      expect(res.json.total_payout).toBe(250); // floor(500 × 0.5)
    } finally {
      buybackRate = VENDOR_BUYBACK_RATE_DEFAULT;
    }
  });

  it('sells a consumable batch at quality-scaled value and decrements batch + aggregate', async () => {
    const creditsBefore = profileOf(h, A).credits;
    const res = await post(h, '/api/ops/vendor-sell', h.tokenA, {
      nonce: nonce(), kind: 'consumable', batch_id: BATCH_MEDKIT, quantity: 2,
    });
    expect(res.status).toBe(200);
    // value = 250 × 125% × 2 = 625 → floor(625 × 0.4) = 250
    expect(res.json.vendor_value).toBe(625);
    expect(res.json.total_payout).toBe(250);
    expect(profileOf(h, A).credits).toBe(creditsBefore + 250);
    const batchRow = h.store.seed.consumableBatches.find((b) => b.id === BATCH_MEDKIT);
    expect(batchRow?.quantity).toBe(1);
    expect(profileOf(h, A).consumables.MedKit).toBe(1);
  });

  it('refuses to sell more of a batch than it holds', async () => {
    const res = await post(h, '/api/ops/vendor-sell', h.tokenA, {
      nonce: nonce(), kind: 'consumable', batch_id: BATCH_MEDKIT, quantity: 99,
    });
    expect(res.status).toBe(400);
    expect(res.json.message).toBe('Insufficient quantity');
  });

  it('sells essence stacks through the material kind at catalog value', async () => {
    const res = await post(h, '/api/ops/vendor-sell', h.tokenA, {
      nonce: nonce(), kind: 'material', material_id: 'VoidEssence', quantity: 2,
    });
    expect(res.status).toBe(200);
    expect(res.json.total_payout).toBe(72); // floor(2 × 90 × 0.4)
    expect(profileOf(h, A).essences.VoidEssence).toBe(0);
  });

  it('refuses material sales beyond the stack', async () => {
    const res = await post(h, '/api/ops/vendor-sell', h.tokenA, {
      nonce: nonce(), kind: 'material', material_id: 'ScrapAlloy', quantity: 10_000,
    });
    expect(res.status).toBe(400);
    expect(res.json.message).toBe('Insufficient material ScrapAlloy');
  });

  it('guests can buy from the vendor and sell back to it', async () => {
    const buy = await post(h, '/api/ops/vendor-buy', h.tokenG, { nonce: nonce(), item_key: 'MedKit', quantity: 1 });
    expect(buy.status).toBe(200);
    expect(buy.json.total_price).toBe(250);
    const sell = await post(h, '/api/ops/vendor-sell', h.tokenG, {
      nonce: nonce(), kind: 'material', material_id: 'ScrapAlloy', quantity: 2,
    });
    expect(sell.status).toBe(200);
    expect(sell.json.total_payout).toBe(8); // floor(2 × 10 × 0.4)
    expect(profileOf(h, G).materials.ScrapAlloy).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Lever registry + metrics attribution
// ---------------------------------------------------------------------------

describe('vendorBuybackRate lever + economy attribution', () => {
  it('is registered with the catalog default and the 0..0.9 range', () => {
    expect(ECONOMY_CONFIG_DEFAULTS.vendorBuybackRate).toBe(VENDOR_BUYBACK_RATE_DEFAULT);
    expect(VENDOR_BUYBACK_RATE_DEFAULT).toBe(0.4);
    expect(validateEconomyConfigValue('vendorBuybackRate', 0)).toBe(0);
    expect(validateEconomyConfigValue('vendorBuybackRate', 0.9)).toBe(0.9);
    expect(validateEconomyConfigValue('vendorBuybackRate', 0.91)).toBeNull();
    expect(validateEconomyConfigValue('vendorBuybackRate', -0.1)).toBeNull();
    expect(resolveEconomyConfigValues({ vendorBuybackRate: 0.25 }).vendorBuybackRate).toBe(0.25);
    expect(resolveEconomyConfigValues({ vendorBuybackRate: 7 }).vendorBuybackRate).toBe(0.4);
  });

  it('counts cc_vendor_sell payouts as a mint source in the daily meters', async () => {
    const seed = emptyEconomySeed();
    seed.ledger = [
      {
        action_type: 'cc_vendor_sell',
        created_at: '2027-03-04T12:00:00.000Z',
        result_payload: { total_payout: 250 },
      },
      {
        action_type: 'cc_vendor_sell',
        created_at: '2027-03-04T13:00:00.000Z',
        result_payload: { total_payout: 72 },
      },
      {
        action_type: 'cc_vendor_buy',
        created_at: '2027-03-04T14:00:00.000Z',
        result_payload: { total_price: 500 },
      },
    ];
    const store = new InMemoryEconomyStore(seed);
    const m = await store.computeMetricsForDay('2027-03-04');
    expect(m.creditsMintedVendorBuyback).toBe(322);
    expect(m.creditsMintedTotal).toBe(322);
    expect(m.creditsDestroyedVendor).toBe(500);
    expect(m.netCreditChange).toBe(-178);
  });
});

// ---------------------------------------------------------------------------
// 5. Migration 0020 source pins
// ---------------------------------------------------------------------------

describe('migration 0020 — SQL twin pins', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'db/migrations/0020_vendor_rotation_buyback.sql'),
    'utf8',
  );

  it('carries the sell function, the levered rate read, and the metrics term', () => {
    expect(sql).toContain('create or replace function public.cc_vendor_sell');
    expect(sql).toContain("public.cc_economy_config_number('vendorBuybackRate', 0.4)");
    expect(sql).toContain('credits_minted_vendor_buyback');
    expect(sql).toContain("filter (where action_type = 'cc_vendor_sell')");
    expect(sql).toContain('drop function if exists public.cc_vendor_price(text)');
    // Rotation seeds match the TS catalog's seed strings exactly.
    expect(sql).toContain("'vendor-rotation:' || _day::text || ':' || c.item_key");
    expect(sql).toContain("'vendor-iotd:' || _day::text || ':' || c.item_key");
    // Equipped gear cannot be sold: only 'available' passes.
    expect(sql).toContain("if item.runtime_state <> 'available' then raise exception 'Item state invalid'");
  });

  it('cc_vendor_catalog VALUES list matches the TS catalog exactly', () => {
    // The catalog's live SQL twin is the LATEST restatement:
    // migration 0021 (vehicles) restates cc_vendor_catalog with the
    // two vehicle staples added, superseding 0020's list.
    const catalogSql = readFileSync(
      resolve(process.cwd(), 'db/migrations/0021_vehicles.sql'),
      'utf8',
    );
    const rows = [...catalogSql.matchAll(/\('([A-Za-z]+)',\s*(\d+),\s*'(staple|rotation|material|essence)'\)/g)].map(
      (match) => ({ itemKey: match[1], basePrice: Number(match[2]), pool: match[3] }),
    );
    const expected = [
      ...VENDOR_STAPLE_DEFS.map((c) => ({ itemKey: c.id, basePrice: c.market.vendorPrice, pool: 'staple' })),
      ...VENDOR_ROTATION_DEFS.map((c) => ({ itemKey: c.id, basePrice: c.market.vendorPrice, pool: 'rotation' })),
      ...VENDOR_MATERIALS.map((m) => ({ itemKey: m.id, basePrice: m.unitPrice, pool: m.kind })),
    ];
    const byKey = (a: { itemKey: string }, b: { itemKey: string }) => a.itemKey.localeCompare(b.itemKey);
    expect([...rows].sort(byKey)).toEqual([...expected].sort(byKey));
  });
});
