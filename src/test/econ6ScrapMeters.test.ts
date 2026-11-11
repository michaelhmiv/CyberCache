/**
 * Econ 6 (economy redesign brief §4.4 + §6; migration 0071) —
 * vendor drops Scrap + scrap meters.
 *
 * Layers covered:
 *   1. Migration 0071 source pins: the vendor catalog restatement
 *      carries no Scrap row (the nine staples and the other four
 *      materials untouched), the nine scrap meter columns land, and
 *      the metrics restatement folds the named ledger payloads.
 *   2. The real write routes mint/burn through the ledger into the
 *      meters: a recycle through POST /api/ops/recycle-item moves
 *      scrapMintedSalvage, and a Fuel Cell enqueue through
 *      POST /api/ops/craft-enqueue moves scrapDestroyedCrafting —
 *      the two flows the slice names, proven end to end (route →
 *      writes twin → verified ledger → economy twin compute).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore, type InMemoryWriteOptions } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import { issueAccessToken } from '../server/auth/tokens';
import { InMemoryEconomyStore, emptyEconomySeed, type EconomySeed } from '../server/economy/memory';
import type { ProfileRowData } from '../server/reads/store';

const SECRET = 'econ6-test-secret';
const P = '11111111-1111-4111-8111-111111111111';
const GUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DAY = '2027-03-04';
const nowMs = Date.parse(`${DAY}T12:00:00.000Z`);
let uuidCounter = 0;
let nonceCounter = 0;

function nextUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
}
const nonce = () => `econ6-nonce-${++nonceCounter}`;

function makeSeed(): WriteSeed {
  const seed = emptyWriteSeed();
  seed.profiles = [{
    id: P, username: null, display_name: null, player_level: 5, player_xp: 0, credits: 100_000,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: { Scrap: 100, NitrocellGel: 5 }, essences: {}, consumables: {},
    skill_spends: {}, boss_state: {}, last_idle_claim_at: `${DAY}T10:00:00.000Z`,
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: `${DAY}T00:00:00.000Z`,
    account_type: 'verified', email: null, email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0,
  } satisfies ProfileRowData];
  seed.items = [{
    id: GUN, owner_user_id: P, kind: 'weapon', payload: { weaponType: 'Pistol', combatPower: 50 },
    static_item_id: null, quality: null, material_tier: null,
    condition_state: null, condition_current: null, condition_max: null,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null,
    tradeable: true, account_bound: false, locked_until: null,
    rarity: 'Common', item_level: 5, runtime_state: 'available', equipped_slot: null,
    is_locked: false,
    estimated_value: 250,
    created_at: `${DAY}T09:00:00.000Z`, updated_at: `${DAY}T09:00:00.000Z`,
  } satisfies WriteItemData];
  return seed;
}

// ---------------------------------------------------------------------------
// 1. Migration 0071 pins
// ---------------------------------------------------------------------------

describe('migration 0071 — vendor drops Scrap + scrap meters (source pins)', () => {
  const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0071_vendor_scrap_meters.sql'), 'utf8');

  it('the catalog restatement carries no Scrap row and keeps the other rows', () => {
    const catalogFn = sql.slice(sql.indexOf('create or replace function public.cc_vendor_catalog'));
    const catalogBody = catalogFn.slice(0, catalogFn.indexOf('$$;'));
    expect(catalogBody).not.toContain("'Scrap'");
    for (const row of [
      "('BallisticParts', 15, 'material')",
      "('ReactiveComponents', 20, 'material')",
      "('TechFragments', 35, 'material')",
      "('VoidDust', 75, 'material')",
      "('IgnitionFluid', 30, 'essence')",
      "('VoidEssence', 90, 'essence')",
    ]) {
      expect(catalogBody).toContain(row);
    }
    expect(sql).toContain('VERBATIM from 0069');
  });

  it('adds the nine scrap meter columns, idempotently', () => {
    for (const column of [
      'scrap_minted_salvage', 'scrap_minted_roaming', 'scrap_minted_dispatch',
      'scrap_minted_endless', 'scrap_minted_bundle', 'scrap_minted_total',
      'scrap_destroyed_crafting', 'scrap_destroyed_total', 'net_scrap_change',
    ]) {
      expect(sql).toContain(`add column if not exists ${column} bigint not null default 0`);
    }
  });

  it('folds scrap from the named ledger payloads', () => {
    expect(sql).toContain("result_payload ->> 'scrap_award'");
    expect(sql).toContain("action_type in ('cc_recycle_item', 'cc_recycle_batch')");
    expect(sql).toContain("result_payload ->> 'scrap_awarded'");
    expect(sql).toContain("action_type = 'cc_apply_boss_attempt'");
    expect(sql).toContain("result_payload -> 'rewards' ->> 'scrap_awarded'");
    expect(sql).toContain("'cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards'");
    expect(sql).toContain("result_payload -> 'payout' ->> 'scrap'");
    expect(sql).toContain("result_payload -> 'abandoned_settlement' -> 'payout' ->> 'scrap'");
    expect(sql).toContain("500 * count(*) filter (where action_type = 'cc_initial_bundle')");
    // The crafting breakout includes the tint leg (brief §4.4 names
    // tint a crafting burn) on top of the materials fold's Scrap leg.
    expect(sql).toContain("action_type = 'cc_enqueue_tint_job' and e.key = 'Scrap'");
    expect(sql).toContain('verbatim from 0068');
  });
});

// ---------------------------------------------------------------------------
// 2. Real write routes → ledger → meters
// ---------------------------------------------------------------------------

describe('scrap meters — the real write routes move the counters', () => {
  let store: InMemoryWriteStore;
  let base = '';
  let close: () => Promise<void> = async () => {};
  let token = '';

  beforeAll(async () => {
    const seed = makeSeed();
    const options: InMemoryWriteOptions = {
      now: () => new Date(nowMs),
      uuid: nextUuid,
    };
    store = new InMemoryWriteStore(seed, options);
    const app = express();
    app.use(express.json());
    mountWriteRoutes(app, store, { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((r) => server.close(() => r()));
    token = issueAccessToken(SECRET, P, false);
  });

  afterAll(async () => {
    await close();
  });

  async function post(path: string, payload: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  }

  function metricsForToday() {
    // The writes twin's ledger rows carry no timestamp (the SQL
    // ledger stamps created_at at insert); every op in this
    // scenario runs at the harness clock, so stamp them with it.
    const econSeed: EconomySeed = emptyEconomySeed();
    econSeed.ledger = store.seed.ledger.map((row) => ({
      action_type: row.action_type,
      created_at: new Date(nowMs).toISOString(),
      result_payload: row.result_payload,
    }));
    return new InMemoryEconomyStore(econSeed).computeMetricsForDay(DAY);
  }

  it('recycle mints into scrapMintedSalvage; a Scrap-priced enqueue burns into scrapDestroyedCrafting', async () => {
    const before = await metricsForToday();
    expect(before.scrapMintedSalvage).toBe(0);
    expect(before.scrapDestroyedCrafting).toBe(0);

    // Salvage mint: recycle the seeded Common L5 pistol.
    const recycle = await post('/api/ops/recycle-item', { nonce: nonce(), item_id: GUN });
    expect(recycle.status).toBe(200);
    const award = Number(recycle.json.scrap_award);
    expect(award).toBeGreaterThan(0);

    // Crafting burn: Fuel Cell prices in Scrap (15 per unit,
    // repriced by tuning T3) — two units escrow 30 Scrap at enqueue.
    const setAction = await post('/api/activity/set', {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    expect(setAction.status).toBe(200);
    const enqueue = await post('/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_fuel_cell', units: 2,
    });
    expect(enqueue.status).toBe(200);

    const after = await metricsForToday();
    expect(after.scrapMintedSalvage).toBe(award);
    expect(after.scrapMintedTotal).toBe(award);
    expect(after.scrapDestroyedCrafting).toBe(30);
    expect(after.scrapDestroyedTotal).toBe(30);
    expect(after.netScrapChange).toBe(award - 30);
    // The materials fold's Scrap leg agrees on this day (no tint).
    expect(after.materialsDestroyedCrafting['Scrap']).toBe(30);
  });
});
