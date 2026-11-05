/**
 * Auto-Salvage Rules made real (migration 0080) — the profile-owned
 * rule + the Chef claim-settlement salvage pass.
 *
 * The defect these tests close: the Settings card's rule (max rarity,
 * max roll quality, yield toggle) saved into the client store and
 * the runtime snapshot for its whole life, and NOTHING consumed it —
 * the Chef had zero references to it. The contract pinned here:
 *
 *   - the rule lives on the profile; Settings writes through the
 *     JWT route (identity from the token, never the body) and reads
 *     it back; a Legendary ceiling is refused at every layer;
 *   - at roaming-claim and offline settlement ONLY, the drops that
 *     settlement just stored are checked against the rule and the
 *     matches are recycled through cc_recycle_item itself (the twin:
 *     recycleItem) under derived nonces — the yield IS the manual
 *     path's, Scavenger bonuses included;
 *   - boss/cache/market/crafted loot never reaches the pass (the
 *     SQL function itself refuses any source but 'roam'/'offline');
 *   - a replayed settlement pays nothing twice;
 *   - every auto-salvage lands in the Activity Log as its own
 *     record, told apart by the 'autosalvage:' nonce marker.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import { mountReadRoutes } from '../server/reads/routes';
import {
  InMemoryReadStore, emptyReadSeed,
  type ProfileRowData, type ReadSeed,
} from '../server/reads/store';
import {
  buildActivityRecords, emptyActivityInput, type ActivityLedgerRow,
} from '../server/reads/activityLog';
import { issueAccessToken } from '../server/auth/tokens';
import { salvageScrap } from '../lib/skills/salvageBonuses';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const G = '33333333-3333-4333-8333-333333333333'; // guest account

type Json = Record<string, unknown>;

function gameStore(): InMemoryChefGameplayStore {
  return new InMemoryChefGameplayStore(() => new Date('2026-11-04T12:00:00.000Z'));
}

function scrapOf(store: InMemoryChefGameplayStore, playerId: string): number {
  const p = store.profiles.get(playerId);
  return p?.materials['Scrap'] ?? 0;
}

function stateOf(store: InMemoryChefGameplayStore, itemId: string): string {
  return store.items.get(itemId)?.runtime_state ?? 'missing';
}

// ---------------------------------------------------------------------------
// The settlement pass — the in-memory twin of cc_auto_salvage_claim_items.
// ---------------------------------------------------------------------------

describe('auto-salvage settlement pass (0080 twin)', () => {
  it('default rule: a matching Common drop is salvaged at exactly the manual recycle yield', async () => {
    // Auto path.
    const auto = gameStore();
    auto.seedProfile({ id: A });
    auto.seedItem({ id: 'drop-1', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { name: 'Rusty Pistol', rollQuality: 12 } });
    auto.seedItem({ id: 'drop-2', owner_user_id: A, rarity: 'Rare', item_level: 5, payload: { name: 'Keeper', rollQuality: 12 } });
    const summary = (await auto.applyAutoSalvage(A, 'claim:100', 'roam', ['drop-1', 'drop-2'])) as Json;

    expect(summary.action_type).toBe('cc_auto_salvage');
    expect(summary.salvaged_count).toBe(1);
    expect(summary.counts_by_rarity).toEqual({ Common: 1 });
    expect(stateOf(auto, 'drop-1')).toBe('consumed');
    expect(stateOf(auto, 'drop-2')).toBe('available'); // Rare is above the default Common ceiling

    // Manual path on an identical twin store: the yields must agree
    // to the unit — the pass routes through recycleItem, it does not
    // re-price anything.
    const manual = gameStore();
    manual.seedProfile({ id: A });
    manual.seedItem({ id: 'drop-1', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { name: 'Rusty Pistol', rollQuality: 12 } });
    const recycled = (await manual.recycleItem(A, 'manual-nonce-0001', 'drop-1')) as Json;

    expect(summary.scrap_award).toBe(recycled.scrap_award);
    expect(summary.scrap_award).toBe(salvageScrap('Common', 5));
    expect(scrapOf(auto, A)).toBe(scrapOf(manual, A));
    const entry = (summary.items as Json[])[0];
    expect(entry.name).toBe('Rusty Pistol');
    expect(entry.converted_material).toBeNull();
  });

  it('rule off: nothing is salvaged and the summary says so', async () => {
    const store = gameStore();
    store.seedProfile({ id: A, auto_salvage_enabled: false });
    store.seedItem({ id: 'drop-1', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { rollQuality: 1 } });
    const summary = (await store.applyAutoSalvage(A, 'claim:101', 'roam', ['drop-1'])) as Json;
    expect(summary.enabled).toBe(false);
    expect(summary.salvaged_count).toBe(0);
    expect(summary.scrap_award).toBe(0);
    expect(stateOf(store, 'drop-1')).toBe('available');
    expect(scrapOf(store, A)).toBe(0);
  });

  it('rarity boundary: at the ceiling salvages, one rarity above keeps', async () => {
    const store = gameStore();
    store.seedProfile({ id: A, auto_salvage_max_rarity: 'Rare', auto_salvage_max_quality: 100 });
    store.seedItem({ id: 'rare-1', owner_user_id: A, rarity: 'Rare', item_level: 8, payload: { rollQuality: 90 } });
    store.seedItem({ id: 'epic-1', owner_user_id: A, rarity: 'Epic', item_level: 8, payload: { rollQuality: 1 } });
    const summary = (await store.applyAutoSalvage(A, 'claim:102', 'roam', ['rare-1', 'epic-1'])) as Json;
    expect(summary.salvaged_count).toBe(1);
    expect(stateOf(store, 'rare-1')).toBe('consumed');
    expect(stateOf(store, 'epic-1')).toBe('available');
  });

  it('quality boundary: a weapon at the cap salvages, above the cap keeps; a shield with no roll is decided by rarity alone', async () => {
    const store = gameStore();
    store.seedProfile({ id: A }); // default: Common, quality 20
    store.seedItem({ id: 'w-at', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { rollQuality: 20 } });
    store.seedItem({ id: 'w-above', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { rollQuality: 21 } });
    store.seedItem({ id: 's-noroll', owner_user_id: A, kind: 'shield', rarity: 'Common', item_level: 5, payload: { hp: 40 } });
    const summary = (await store.applyAutoSalvage(A, 'claim:103', 'roam', ['w-at', 'w-above', 's-noroll'])) as Json;
    expect(summary.salvaged_count).toBe(2);
    expect(stateOf(store, 'w-at')).toBe('consumed');
    expect(stateOf(store, 'w-above')).toBe('available');
    expect(stateOf(store, 's-noroll')).toBe('consumed');
  });

  it('legendaries are never swept: kept at the Epic ceiling, and a stored Legendary ceiling salvages nothing', async () => {
    const store = gameStore();
    store.seedProfile({ id: A, auto_salvage_max_rarity: 'Epic', auto_salvage_max_quality: 100 });
    store.seedItem({ id: 'leg-1', owner_user_id: A, rarity: 'Legendary', item_level: 30, payload: { rollQuality: 1 } });
    const summary = (await store.applyAutoSalvage(A, 'claim:104', 'roam', ['leg-1'])) as Json;
    expect(summary.salvaged_count).toBe(0);
    expect(stateOf(store, 'leg-1')).toBe('available');

    // Defense in depth: even a profile row that somehow carries a
    // Legendary ceiling (the column check now forbids it) resolves
    // to ceiling 0 in the twin — salvage NOTHING, never rank 5.
    const poisoned = gameStore();
    poisoned.seedProfile({ id: A, auto_salvage_max_rarity: 'Legendary', auto_salvage_max_quality: 100 });
    poisoned.seedItem({ id: 'c-1', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { rollQuality: 1 } });
    const blocked = (await poisoned.applyAutoSalvage(A, 'claim:105', 'roam', ['c-1'])) as Json;
    expect(blocked.salvaged_count).toBe(0);
    expect(stateOf(poisoned, 'c-1')).toBe('available');
  });

  it("Hoarder's Instinct changes the yield — through the same recycle path, not a fork", async () => {
    const withSpends = gameStore();
    withSpends.seedProfile({ id: A, skill_spends: { scav_major_1: 1 } });
    withSpends.seedItem({ id: 'drop-1', owner_user_id: A, rarity: 'Common', item_level: 10, payload: { rollQuality: 5 } });
    const autoSummary = (await withSpends.applyAutoSalvage(A, 'claim:106', 'roam', ['drop-1'])) as Json;

    const manual = gameStore();
    manual.seedProfile({ id: A, skill_spends: { scav_major_1: 1 } });
    manual.seedItem({ id: 'drop-1', owner_user_id: A, rarity: 'Common', item_level: 10, payload: { rollQuality: 5 } });
    const recycled = (await manual.recycleItem(A, 'manual-nonce-0002', 'drop-1')) as Json;

    const base = salvageScrap('Common', 10);
    expect(autoSummary.scrap_award).toBe(recycled.scrap_award); // identical to the manual path
    expect(autoSummary.scrap_award).toBe(Math.round(base * 1.25)); // Hoarder's +25% is inside it
    expect(autoSummary.scrap_award as number).toBeGreaterThan(base);
  });

  it('to-materials: the scrap award converts to +1 kind-mapped material and the trade is reported', async () => {
    const store = gameStore();
    store.seedProfile({ id: A, auto_salvage_to_materials: true });
    store.seedItem({ id: 'w-1', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { name: 'Gun', rollQuality: 3 } });
    store.seedItem({ id: 's-1', owner_user_id: A, kind: 'shield', rarity: 'Common', item_level: 5, payload: { name: 'Plate' } });
    const summary = (await store.applyAutoSalvage(A, 'claim:107', 'roam', ['w-1', 's-1'])) as Json;

    const awardPerItem = salvageScrap('Common', 5);
    expect(summary.salvaged_count).toBe(2);
    expect(summary.scrap_award).toBe(0); // nothing landed as scrap
    expect(summary.converted_scrap).toBe(awardPerItem * 2); // the forgone scrap is named
    expect(summary.materials).toEqual({ BallisticParts: 1, ReactiveComponents: 1 });
    const p = store.profiles.get(A);
    expect(p?.materials['BallisticParts']).toBe(1); // weapon → BallisticParts
    expect(p?.materials['ReactiveComponents']).toBe(1); // shield → ReactiveComponents
    expect(p?.materials['Scrap'] ?? 0).toBe(0);
    const entries = summary.items as Json[];
    expect(entries.find((e) => e.id === 'w-1')?.converted_material).toBe('BallisticParts');
    expect(entries.find((e) => e.id === 's-1')?.converted_material).toBe('ReactiveComponents');
  });

  it("source pin: the pass refuses anything but 'roam'/'offline' — boss loot can never enter it", async () => {
    const store = gameStore();
    store.seedProfile({ id: A });
    store.seedItem({ id: 'boss-loot', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { rollQuality: 1 } });
    await expect(
      store.applyAutoSalvage(A, 'boss-attempt-1', 'boss' as 'roam', ['boss-loot']),
    ).rejects.toThrow('Invalid auto-salvage source');
    await expect(
      store.applyAutoSalvage(A, 'cache-open-01', 'cache' as 'roam', ['boss-loot']),
    ).rejects.toThrow('Invalid auto-salvage source');
    expect(stateOf(store, 'boss-loot')).toBe('available');
  });

  it('replay: re-running the same settlement pays nothing twice', async () => {
    const store = gameStore();
    store.seedProfile({ id: A });
    store.seedItem({ id: 'drop-1', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { rollQuality: 2 } });
    const first = (await store.applyAutoSalvage(A, 'claim:108', 'roam', ['drop-1'])) as Json;
    const scrapAfterFirst = scrapOf(store, A);
    const second = (await store.applyAutoSalvage(A, 'claim:108', 'roam', ['drop-1'])) as Json;
    expect(first.salvaged_count).toBe(1);
    expect(second.salvaged_count).toBe(0);
    expect(second.scrap_award).toBe(0);
    expect(scrapOf(store, A)).toBe(scrapAfterFirst);
  });

  it('candidates are only the ids handed in: unlisted matches, other players’ items, and locked items are untouched', async () => {
    const store = gameStore();
    store.seedProfile({ id: A });
    store.seedProfile({ id: B });
    store.seedItem({ id: 'listed-drop', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { rollQuality: 2 } });
    store.seedItem({ id: 'unlisted-drop', owner_user_id: A, rarity: 'Common', item_level: 5, payload: { rollQuality: 2 } });
    store.seedItem({ id: 'foreign-drop', owner_user_id: B, rarity: 'Common', item_level: 5, payload: { rollQuality: 2 } });
    store.seedItem({ id: 'locked-drop', owner_user_id: A, rarity: 'Common', item_level: 5, is_locked: true, payload: { rollQuality: 2 } });
    const summary = (await store.applyAutoSalvage(
      A, 'claim:109', 'roam', ['listed-drop', 'foreign-drop', 'locked-drop'],
    )) as Json;
    expect(summary.salvaged_count).toBe(1); // only the listed, own, unlocked drop
    expect(stateOf(store, 'listed-drop')).toBe('consumed');
    expect(stateOf(store, 'unlisted-drop')).toBe('available'); // no retroactive sweep, ever
    expect(stateOf(store, 'foreign-drop')).toBe('available');
    expect(stateOf(store, 'locked-drop')).toBe('available');
    expect(scrapOf(store, B)).toBe(0);
  });

  it('non-gear kinds keep their own lanes: vehicles and cosmetics are never candidates', async () => {
    const store = gameStore();
    store.seedProfile({ id: A, auto_salvage_max_rarity: 'Epic', auto_salvage_max_quality: 100 });
    store.seedItem({ id: 'veh-1', owner_user_id: A, kind: 'vehicle', rarity: 'Common', item_level: 5, payload: {} });
    store.seedItem({ id: 'cos-1', owner_user_id: A, kind: 'cosmetic', rarity: 'Common', item_level: 5, payload: {} });
    const summary = (await store.applyAutoSalvage(A, 'claim:110', 'roam', ['veh-1', 'cos-1'])) as Json;
    expect(summary.salvaged_count).toBe(0);
    expect(stateOf(store, 'veh-1')).toBe('available');
    expect(stateOf(store, 'cos-1')).toBe('available');
  });
});

// ---------------------------------------------------------------------------
// The Settings write path — GET/POST /api/profile/auto-salvage.
// ---------------------------------------------------------------------------

function writeProfile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 20, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 2,
    ...over,
  } as ProfileRowData;
}

describe('auto-salvage rule route (0080)', () => {
  let base = '';
  let server: ReturnType<express.Express['listen']> | null = null;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const seed: WriteSeed = emptyWriteSeed();
    seed.profiles = [
      writeProfile({ id: A, username: 'alpha' }),
      writeProfile({ id: B, username: 'bravo' }),
      writeProfile({ id: G, username: 'guestie', account_type: 'guest', email: null, email_verified_at: null }),
    ];
    const app = express();
    app.use(express.json());
    mountWriteRoutes(app, new InMemoryWriteStore(seed), { jwtSecret: SECRET });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.on('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tokens[A] = issueAccessToken(SECRET, A, false);
    tokens[B] = issueAccessToken(SECRET, B, false);
    tokens[G] = issueAccessToken(SECRET, G, true);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  async function call(who: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; json: Json }> {
    const res = await fetch(`${base}/api/profile/auto-salvage`, {
      method,
      headers: {
        authorization: `Bearer ${tokens[who]}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: (await res.json()) as Json };
  }

  it('a fresh profile reads back the shipped defaults', async () => {
    const { status, json } = await call(A, 'GET');
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.autoSalvage).toEqual({ enabled: true, maxRarity: 'Common', maxQuality: 20, toMaterials: false });
  });

  it('write → read round trip: what Settings saves is what the profile holds', async () => {
    const post = await call(A, 'POST', { enabled: true, max_rarity: 'Rare', max_quality: 60, to_materials: true });
    expect(post.json.ok).toBe(true);
    expect(post.json.autoSalvage).toEqual({ enabled: true, maxRarity: 'Rare', maxQuality: 60, toMaterials: true });
    const get = await call(A, 'GET');
    expect(get.json.autoSalvage).toEqual({ enabled: true, maxRarity: 'Rare', maxQuality: 60, toMaterials: true });
  });

  it('a Legendary ceiling is refused as data and the stored rule does not move', async () => {
    const post = await call(A, 'POST', { enabled: true, max_rarity: 'Legendary', max_quality: 20, to_materials: false });
    expect(post.json.ok).toBe(false);
    expect(String(post.json.error)).toContain('legendaries are never auto-salvaged');
    const get = await call(A, 'GET');
    expect(get.json.autoSalvage).toEqual({ enabled: true, maxRarity: 'Rare', maxQuality: 60, toMaterials: true });
  });

  it('an out-of-range quality is refused as data', async () => {
    const post = await call(A, 'POST', { enabled: true, max_rarity: 'Rare', max_quality: 101, to_materials: false });
    expect(post.json.ok).toBe(false);
    expect(String(post.json.error)).toContain('between 0 and 100');
  });

  it('identity comes from the JWT: a body naming another player changes only the caller’s rule', async () => {
    const post = await call(B, 'POST', {
      enabled: false, max_rarity: 'Epic', max_quality: 80, to_materials: false,
      player_id: A, playerId: A, user_id: A,
    });
    expect(post.json.ok).toBe(true);
    const getB = await call(B, 'GET');
    expect(getB.json.autoSalvage).toEqual({ enabled: false, maxRarity: 'Epic', maxQuality: 80, toMaterials: false });
    const getA = await call(A, 'GET');
    expect(getA.json.autoSalvage).toEqual({ enabled: true, maxRarity: 'Rare', maxQuality: 60, toMaterials: true });
  });

  it('guest parity: a guest account reads and writes the same rule surface', async () => {
    const get = await call(G, 'GET');
    expect(get.json.autoSalvage).toEqual({ enabled: true, maxRarity: 'Common', maxQuality: 20, toMaterials: false });
    const post = await call(G, 'POST', { enabled: true, max_rarity: 'Uncommon', max_quality: 40, to_materials: false });
    expect(post.json.ok).toBe(true);
    const after = await call(G, 'GET');
    expect(after.json.autoSalvage).toEqual({ enabled: true, maxRarity: 'Uncommon', maxQuality: 40, toMaterials: false });
  });
});

// ---------------------------------------------------------------------------
// Activity Log projection — the 'autosalvage:' nonce marker.
// ---------------------------------------------------------------------------

function ledgerRow(over: Partial<ActivityLedgerRow> & { id: string }): ActivityLedgerRow {
  return {
    action_type: 'cc_recycle_item',
    created_at: '2026-11-04T10:00:00.000Z',
    result_payload: {
      action_type: 'cc_recycle_item',
      scrap_award: 12,
      cores_award: 0,
      item: {
        id: 'item-x', kind: 'weapon', rarity: 'Common', item_level: 5,
        payload: { id: 'item-x', name: 'Dusty Revolver', kind: 'weapon', rarity: 'Common', level: 5 },
      },
    },
    ...over,
  };
}

describe('auto-salvage in the Activity Log (nonce-marker projection)', () => {
  it('marker rows render as auto-salvages; the offline source is away-era; manual rows are untouched', () => {
    const input = emptyActivityInput();
    input.ledger = [
      ledgerRow({ id: 'led-roam', nonce: 'autosalvage:roam:claim:100:item-x' }),
      ledgerRow({ id: 'led-off', nonce: 'autosalvage:offline:settle-abc:item-x', created_at: '2026-11-04T09:00:00.000Z' }),
      ledgerRow({ id: 'led-manual', nonce: 'recycle-manual-0001', created_at: '2026-11-04T08:00:00.000Z' }),
      ledgerRow({ id: 'led-nononce', created_at: '2026-11-04T07:00:00.000Z' }),
    ];
    const records = buildActivityRecords(input).filter((r) => r.kind === 'salvage');
    expect(records).toHaveLength(4);
    const byId = new Map(records.map((r) => [r.id, r]));

    const roam = byId.get('ledger:led-roam');
    expect(roam?.label).toBe('Auto-salvaged Dusty Revolver');
    expect(roam?.salvage?.auto).toBe(true);
    expect(roam?.salvage?.scrapAward).toBe(12);
    expect(roam?.away).toBe(false);

    const off = byId.get('ledger:led-off');
    expect(off?.label).toBe('Auto-salvaged Dusty Revolver');
    expect(off?.salvage?.auto).toBe(true);
    expect(off?.away).toBe(true); // the offline settlement is a while-away fact

    const manual = byId.get('ledger:led-manual');
    expect(manual?.label).toBe('Salvaged Dusty Revolver');
    expect(manual?.salvage?.auto).toBeUndefined();
    expect(manual?.away).toBe(false);

    // A row whose store carried no nonce projects as a plain salvage —
    // provenance is never invented.
    const bare = byId.get('ledger:led-nononce');
    expect(bare?.label).toBe('Salvaged Dusty Revolver');
    expect(bare?.salvage?.auto).toBeUndefined();
  });

  it('end to end: a seeded ledger row’s idempotency key reaches the record through the read route', async () => {
    const seed: ReadSeed = emptyReadSeed();
    seed.profiles = [writeProfile({ id: A, username: 'alpha' })];
    seed.ledger = [{
      user_id: A,
      action_type: 'cc_recycle_item',
      idempotency_key: 'autosalvage:offline:settle-xyz:item-x',
      created_at: '2026-11-04T09:30:00.000Z',
      result_payload: {
        action_type: 'cc_recycle_item',
        scrap_award: 9,
        cores_award: 0,
        item: {
          id: 'item-x', kind: 'weapon', rarity: 'Common', item_level: 5,
          payload: { id: 'item-x', name: 'Dusty Revolver', kind: 'weapon', rarity: 'Common', level: 5 },
        },
      },
    }];
    const app = express();
    mountReadRoutes(app, new InMemoryReadStore(seed), { jwtSecret: SECRET });
    const srv = app.listen(0);
    await new Promise<void>((resolve) => srv.on('listening', resolve));
    try {
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const token = issueAccessToken(SECRET, A, false);
      const res = await fetch(`${url}/api/activity-log/me?kind=salvage`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const page = (await res.json()) as { records: Array<Record<string, unknown>> };
      expect(page.records).toHaveLength(1);
      expect(page.records[0].label).toBe('Auto-salvaged Dusty Revolver');
      expect((page.records[0].salvage as Json).auto).toBe(true);
      expect(page.records[0].away).toBe(true);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });
});

// ---------------------------------------------------------------------------
// Migration 0080 — the SQL contract, pinned statically (the house idiom:
// the migration is never executed by CI, so its text is the evidence).
// ---------------------------------------------------------------------------

describe('migration 0080 — SQL contract', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0080_auto_salvage_rule.sql'), 'utf8');

  it('the column check admits exactly the four UI ceilings — Legendary is not storable', () => {
    const checkLine = sql.split('\n').find((l) => l.includes('profiles_auto_salvage_max_rarity_check')) ?? '';
    const defLine = sql.slice(sql.indexOf('add constraint profiles_auto_salvage_max_rarity_check'));
    expect(defLine.slice(0, 200)).toContain("('Common', 'Uncommon', 'Rare', 'Epic')");
    expect(defLine.slice(0, 200)).not.toContain('Legendary');
    expect(checkLine.length).toBeGreaterThan(0);
  });

  it('the setter refuses a Legendary ceiling and out-of-range quality', () => {
    expect(sql).toContain("_max_rarity not in ('Common', 'Uncommon', 'Rare', 'Epic')");
    expect(sql).toContain('legendaries are never auto-salvaged');
    expect(sql).toContain('_max_quality < 0 or _max_quality > 100');
  });

  it('the settlement ceiling map stops at Epic (a Legendary ITEM still ranks above it)', () => {
    const ceilingBlock = sql.slice(sql.indexOf('ceiling_rank := case'), sql.indexOf('end;', sql.indexOf('ceiling_rank := case')));
    expect(ceilingBlock).toContain("when 'Epic' then 4");
    expect(ceilingBlock).not.toContain('Legendary');
    // The eligible-set CASE ranks the item's own rarity: Legendary
    // items rank 5, above every legal ceiling — that is the lockout.
    expect(sql).toContain("when 'Legendary' then 5");
  });

  it("the source pin refuses anything but 'roam'/'offline' inside the function itself", () => {
    expect(sql).toContain("p_source not in ('roam', 'offline')");
    expect(sql).toContain("raise exception 'Invalid auto-salvage source'");
  });

  it('cc_recycle_item is CALLED under derived nonces — never restated; the claim appliers are untouched', () => {
    expect(sql).toContain("'autosalvage:' || p_source || ':' || p_nonce || ':'");
    expect(sql).toContain('public.cc_recycle_item(');
    expect(sql).not.toMatch(/create or replace function public\.cc_recycle_item/);
    expect(sql).not.toMatch(/create or replace function public\.cc_apply_chef_rewards/);
    expect(sql).not.toMatch(/create or replace function public\.cc_settle_offline_roaming/);
  });

  it('the backfill validates before adopting: rarity restricted to the four, quality clamped 0..100', () => {
    expect(sql).toContain("s.snapshot -> 'idle' ->> 'autoSalvageRarity' in ('Common', 'Uncommon', 'Rare', 'Epic')");
    expect(sql).toContain("~ '^[0-9]{1,3}$'");
    expect(sql).toContain('least(100, greatest(0,');
    // No snapshot value can smuggle a Legendary ceiling through the backfill.
    const backfill = sql.slice(sql.indexOf('update public.profiles p'), sql.indexOf('-- -------', sql.indexOf('update public.profiles p')));
    expect(backfill).not.toContain("'Legendary'");
  });

  it('settlement hooks exist only in the roaming-claim and offline routes', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    expect(read('src/server/routes/roamingHandler.ts')).toContain('applyAutoSalvage(');
    // 0083 re-pin: the offline lane's pass moved from the settle
    // route to the CLAIM route — the settlement pays nothing now,
    // so the pass runs where the drops land (the claim). The
    // settle route must NOT call it anymore.
    expect(read('src/server/routes/claimOffline.ts')).toContain('applyAutoSalvage(');
    expect(read('src/server/routes/settleOffline.ts')).not.toContain('applyAutoSalvage(');
    // No other route file may call the pass — boss, cache, market and
    // craft settlements stay outside the rule's reach by construction.
    for (const p of [
      'src/server/routes/claim.ts',
      'src/server/writes/routes.ts',
      'src/server/gameplay/routes.ts',
    ]) {
      expect(read(p)).not.toContain('applyAutoSalvage(');
    }
  });
});
