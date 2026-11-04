/**
 * Saved Builds SB-1 — truthful build apply (cc_apply_build, 0066).
 *
 * Wire-contract tests over real HTTP against the InMemory twin, plus
 * textual pins on the SQL function so the twins cannot drift. The
 * three defects this slice fixes (Saved Builds brief §1.2) are each
 * pinned as fixed:
 *   1. The vehicle never swapped under the old client fan-out (it
 *      resolved slots through the gear inventory store, which
 *      vehicles never enter). Here the vehicle equips — and swaps —
 *      from server records.
 *   2. Missing items failed silently (console.warn) while the slot's
 *      occupant stayed and the build claimed success. Here a gone
 *      item reports outcome 'gone', the occupant stays TRUTHFULLY
 *      (the loadout snapshot still shows it), and `applied` is false.
 *   3. Partial fan-outs still moved the active marker. The marker is
 *      client state, but its contract is server data: `applied` is
 *      true only on a clean full apply (pinned here; the client half
 *      is pinned in loadoutPresetsSlice.test.ts).
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import {
  emptyWriteSeed,
  type ServiceJobData,
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const W1 = 'a0000000-0000-4000-8000-000000000001'; // weapon, available
const OCC = 'a0000000-0000-4000-8000-000000000002'; // weapon, equipped in primary at seed
const OCC2 = 'a0000000-0000-4000-8000-000000000003'; // weapon, equipped in secondary at seed
const S1 = 'a0000000-0000-4000-8000-000000000004'; // shield, available
const V1 = 'a0000000-0000-4000-8000-000000000005'; // vehicle scrap_bike, available
const V2 = 'a0000000-0000-4000-8000-000000000006'; // vehicle dune_buggy, available
const GONE_SALVAGED = 'a0000000-0000-4000-8000-000000000007';
const LISTED = 'a0000000-0000-4000-8000-000000000008';
const LISTING_ID = 'a0000000-0000-4000-8000-000000000108';
const DISPATCHED = 'a0000000-0000-4000-8000-000000000009';
const MISSION_ID = 'a0000000-0000-4000-8000-000000000109';
const MISSION_ENDS = '2026-10-30T08:00:00.000Z';
const BOARD_REPAIR = 'a0000000-0000-4000-8000-000000000010';
const REPAIR_JOB_ID = 'a0000000-0000-4000-8000-000000000110';
const BOARD_ST = 'a0000000-0000-4000-8000-000000000011';
const ST_JOB_ID = 'a0000000-0000-4000-8000-000000000111';
const DONE_JOB_ITEM = 'a0000000-0000-4000-8000-000000000012'; // available; only a COMPLETED job names it
const W_B = 'b0000000-0000-4000-8000-000000000001'; // B's weapon
const MISSING = 'f0000000-0000-4000-8000-000000000099'; // exists nowhere

const NOW = '2026-10-29T12:00:00.000Z';

function profile(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 5, player_xp: 100, credits: 1000,
    scrap: 100, cache_tokens: 2, cache_token_parts: 0, materials: {}, essences: {},
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

function job(overrides: Partial<ServiceJobData> & { id: string }): ServiceJobData {
  return {
    owner_user_id: A, provider_user_id: null, profession_id: 'repair', status: 'active',
    target_item_instance_id: BOARD_REPAIR, requested_service_id: 'repair',
    quoted_price_credits: 300, quoted_duration_minutes: null,
    owner_supplied_material_ids: [], provider_supplied_material_ids: [], escrow_id: null,
    created_at: '2026-10-28T00:00:00.000Z', accepted_at: null, completed_at: null,
    ...overrides,
  };
}

function seed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [profile({ id: A, username: 'alpha' }), profile({ id: B, username: 'bravo' })];
  s.items = [
    item({ id: W1, owner_user_id: A }),
    item({ id: OCC, owner_user_id: A, runtime_state: 'equipped', equipped_slot: 'primary' }),
    item({ id: OCC2, owner_user_id: A, runtime_state: 'equipped', equipped_slot: 'secondary' }),
    item({ id: S1, owner_user_id: A, kind: 'shield', payload: { hp: 100, mitigation: 0.2 } }),
    item({ id: V1, owner_user_id: A, kind: 'vehicle', payload: { vehicleClassId: 'scrap_bike' } }),
    item({ id: V2, owner_user_id: A, kind: 'vehicle', payload: { vehicleClassId: 'dune_buggy' } }),
    item({ id: GONE_SALVAGED, owner_user_id: A, runtime_state: 'salvaged' }),
    item({ id: LISTED, owner_user_id: A, runtime_state: 'listed' }),
    item({ id: DISPATCHED, owner_user_id: A, runtime_state: 'in_service' }),
    item({ id: BOARD_REPAIR, owner_user_id: A, kind: 'shield', payload: { hp: 80, mitigation: 0.1 }, runtime_state: 'in_service', is_locked: true }),
    item({ id: BOARD_ST, owner_user_id: A, runtime_state: 'in_service', is_locked: true }),
    item({ id: DONE_JOB_ITEM, owner_user_id: A }),
    item({ id: W_B, owner_user_id: B }),
  ];
  s.listings = [
    {
      id: LISTING_ID, seller_user_id: A, item_instance_id: LISTED, price_credits: 750,
      status: 'active', listed_at: '2026-10-28T09:00:00.000Z', sold_at: null,
    },
  ];
  s.serviceJobs = [
    job({ id: REPAIR_JOB_ID, target_item_instance_id: BOARD_REPAIR, profession_id: 'repair', status: 'active' }),
    job({ id: ST_JOB_ID, target_item_instance_id: BOARD_ST, profession_id: 'shield_tech', status: 'listed', requested_service_id: 'shieldtech' }),
    job({ id: 'a0000000-0000-4000-8000-000000000112', target_item_instance_id: DONE_JOB_ITEM, status: 'completed' }),
  ];
  s.dispatchMissions = [
    {
      id: MISSION_ID, user_id: A, status: 'active', ends_at: MISSION_ENDS,
      loadout_item_ids: [DISPATCHED], vehicle_item_id: null,
    },
  ];
  return s;
}

interface Harness {
  store: InMemoryWriteStore;
  base: string;
  tokenA: string;
  tokenB: string;
  close: () => Promise<void>;
}

const openHarnesses: Harness[] = [];
afterEach(async () => {
  while (openHarnesses.length) await openHarnesses.pop()?.close();
});

async function makeServer(): Promise<Harness> {
  const store = new InMemoryWriteStore(seed(), { now: () => new Date(NOW) });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const h: Harness = {
    store,
    base: `http://127.0.0.1:${port}`,
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, false),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  openHarnesses.push(h);
  return h;
}

let nonceCounter = 0;
function nonce(): string {
  nonceCounter += 1;
  return `apply-build-nonce-${nonceCounter}-abcdef`;
}

const EMPTY_BUILD: Record<string, string | null> = {
  primary: null, secondary: null, heavy: null, ordnance: null,
  shield: null, classMod: null, relic: null, vehicle: null,
};

type Wire = Record<string, unknown>;

async function applyBuild(h: Harness, token: string | null, slots: unknown, n: string = nonce()) {
  const res = await fetch(`${h.base}/api/ops/apply-build`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ nonce: n, slots }),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Wire };
}

function outcomeOf(res: { json: Wire }, slot: string): Wire {
  const found = (res.json.outcomes as Wire[]).find((o) => o.slot === slot);
  if (!found) throw new Error(`no outcome for slot ${slot}`);
  return found;
}

function loadoutOf(res: { json: Wire }): Wire {
  return res.json.loadout as Wire;
}

function seedItem(h: Harness, id: string): WriteItemData {
  const found = h.store.seed.items.find((i) => i.id === id);
  if (!found) throw new Error(`seed item ${id} missing`);
  return found;
}

describe('cc_apply_build — clean apply', () => {
  it('equips gear AND the vehicle from server records (defect 1: the vehicle swaps)', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: W1, shield: S1, vehicle: V1 });
    expect(res.status).toBe(200);
    expect(res.json.action_type).toBe('cc_apply_build');
    expect(res.json.applied).toBe(true);
    expect(res.json.attention_count).toBe(0);
    expect(res.json.equipped_count).toBe(3);
    expect(outcomeOf(res, 'primary')).toMatchObject({ item_id: W1, outcome: 'equipped' });
    expect(outcomeOf(res, 'shield')).toMatchObject({ item_id: S1, outcome: 'equipped' });
    expect(outcomeOf(res, 'vehicle')).toMatchObject({ item_id: V1, outcome: 'equipped' });
    expect(outcomeOf(res, 'relic')).toMatchObject({ item_id: null, outcome: 'empty' });
    // The canonical loadout snapshot carries the vehicle.
    expect(res.json.loadout).toMatchObject({ primary: W1, shield: S1, vehicle: V1 });
    // The previous primary occupant was cleared by the equip.
    expect(seedItem(h, OCC)).toMatchObject({ equipped_slot: null, runtime_state: 'available' });

    // A second build swaps the vehicle — the ride actually changes.
    const swap = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, vehicle: V2 });
    expect(swap.json.applied).toBe(true);
    expect(loadoutOf(swap).vehicle).toBe(V2);
    expect(seedItem(h, V1)).toMatchObject({ equipped_slot: null, runtime_state: 'available' });
    expect(seedItem(h, V2)).toMatchObject({ equipped_slot: 'vehicle', runtime_state: 'equipped' });
  });

  it('an all-null build clears every slot and still counts as applied', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, EMPTY_BUILD);
    expect(res.json.applied).toBe(true);
    expect(res.json.loadout).toEqual({
      primary: null, secondary: null, heavy: null, ordnance: null,
      shield: null, classMod: null, relic: null, vehicle: null,
    });
    expect(seedItem(h, OCC)).toMatchObject({ equipped_slot: null, runtime_state: 'available' });
    expect(seedItem(h, OCC2)).toMatchObject({ equipped_slot: null, runtime_state: 'available' });
  });

  it('swaps two items between slots (cross-equipped build)', async () => {
    const h = await makeServer();
    // OCC sits in primary, OCC2 in secondary; the build wants them traded.
    const res = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: OCC2, secondary: OCC });
    expect(res.json.applied).toBe(true);
    expect(res.json.loadout).toMatchObject({ primary: OCC2, secondary: OCC });
  });
});

describe('cc_apply_build — truthful failures', () => {
  it('gone items report gone; the slot occupant stays, and applied stays false (defects 2+3)', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, {
      ...EMPTY_BUILD,
      primary: MISSING, // exists nowhere
      secondary: GONE_SALVAGED, // salvaged since the build was saved
      heavy: W_B, // another player's item
    });
    expect(res.status).toBe(200);
    expect(res.json.applied).toBe(false);
    expect(res.json.attention_count).toBe(3);
    expect(outcomeOf(res, 'primary').outcome).toBe('gone');
    expect(outcomeOf(res, 'secondary').outcome).toBe('gone');
    expect(outcomeOf(res, 'heavy').outcome).toBe('gone');
    // A failed slot never strips its current occupant — primary's
    // and secondary's occupants both stay equipped, and the loadout
    // snapshot says so (the old code kept them silently under an
    // "applied" claim; here the report and the snapshot agree).
    expect(seedItem(h, OCC2)).toMatchObject({ equipped_slot: 'secondary', runtime_state: 'equipped' });
    expect(loadoutOf(res).secondary).toBe(OCC2);
    expect(seedItem(h, OCC)).toMatchObject({ equipped_slot: 'primary', runtime_state: 'equipped' });
    expect(loadoutOf(res).primary).toBe(OCC);
  });

  it('a listed item reports listed with its listing id; the listing is untouched', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: LISTED });
    expect(res.json.applied).toBe(false);
    expect(outcomeOf(res, 'primary')).toMatchObject({ outcome: 'listed', listing_id: LISTING_ID });
    expect(seedItem(h, LISTED).runtime_state).toBe('listed');
  });

  it('an item out on dispatch reports in_service with mission + return time', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: DISPATCHED });
    expect(res.json.applied).toBe(false);
    expect(outcomeOf(res, 'primary')).toMatchObject({
      outcome: 'in_service',
      mission_id: MISSION_ID,
      returns_at: MISSION_ENDS,
    });
  });

  it('an item committed to a board job reports locked, naming the job', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, shield: BOARD_REPAIR, primary: BOARD_ST });
    expect(res.json.applied).toBe(false);
    expect(outcomeOf(res, 'shield')).toMatchObject({
      outcome: 'locked', job_id: REPAIR_JOB_ID, job_kind: 'repair',
    });
    expect(outcomeOf(res, 'primary')).toMatchObject({
      outcome: 'locked', job_id: ST_JOB_ID, job_kind: 'shield_tech',
    });
  });

  it('a completed board job does not lock its item', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: DONE_JOB_ITEM });
    expect(outcomeOf(res, 'primary').outcome).toBe('equipped');
    expect(res.json.applied).toBe(true);
  });

  it('an item that no longer fits its slot reports incompatible instead of throwing', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: S1 });
    expect(res.status).toBe(200);
    expect(outcomeOf(res, 'primary').outcome).toBe('incompatible');
    expect(res.json.applied).toBe(false);
    expect(seedItem(h, S1)).toMatchObject({ equipped_slot: null, runtime_state: 'available' });
  });

  it('partial apply lands what it can and reports the rest', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, {
      ...EMPTY_BUILD,
      primary: W1,
      shield: GONE_SALVAGED,
      vehicle: V1,
    });
    expect(res.json.applied).toBe(false);
    expect(res.json.equipped_count).toBe(2);
    expect(res.json.attention_count).toBe(1);
    expect(res.json.loadout).toMatchObject({ primary: W1, vehicle: V1, shield: null });
  });

  it('the same item named in two slots: the first slot wins, the duplicate reports gone', async () => {
    const h = await makeServer();
    const res = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: W1, secondary: W1 });
    expect(outcomeOf(res, 'primary').outcome).toBe('equipped');
    expect(outcomeOf(res, 'secondary').outcome).toBe('gone');
    expect(loadoutOf(res).primary).toBe(W1);
    // OCC2 (secondary's old occupant) stays — the duplicate slot failed.
    expect(loadoutOf(res).secondary).toBe(OCC2);
  });
});

describe('cc_apply_build — wire discipline', () => {
  it('replays a nonce without re-applying', async () => {
    const h = await makeServer();
    const n = nonce();
    const first = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: W1, vehicle: V1 }, n);
    const replay = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: W1, vehicle: V1 }, n);
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual(first.json);
    const ledgerRows = h.store.seed.ledger.filter((e) => e.action_type === 'cc_apply_build');
    expect(ledgerRows).toHaveLength(1);
  });

  it('rejects malformed builds at the route', async () => {
    const h = await makeServer();
    const badValue = await applyBuild(h, h.tokenA, { ...EMPTY_BUILD, primary: 'not-a-uuid' });
    expect(badValue.status).toBe(400);
    expect(badValue.json).toMatchObject({ error: 'validation', message: 'A valid build is required' });
    const noSlots = await applyBuild(h, h.tokenA, undefined);
    expect(noSlots.status).toBe(400);
    expect(noSlots.json).toMatchObject({ error: 'validation', message: 'A valid build is required' });
  });

  it('rejects a short nonce and a missing token', async () => {
    const h = await makeServer();
    const short = await applyBuild(h, h.tokenA, EMPTY_BUILD, 'short');
    expect(short.status).toBe(400);
    expect(short.json).toMatchObject({ error: 'validation', message: 'nonce is required' });
    const anon = await applyBuild(h, null, EMPTY_BUILD);
    expect(anon.status).toBe(401);
  });

  it("never applies another player's build against the caller's items", async () => {
    const h = await makeServer();
    // B applies a build naming A's weapon: for B it is simply gone.
    const res = await applyBuild(h, h.tokenB, { ...EMPTY_BUILD, primary: W1 });
    expect(outcomeOf(res, 'primary').outcome).toBe('gone');
    expect(seedItem(h, W1).owner_user_id).toBe(A);
  });
});

describe('cc_apply_build — SQL twin pins (0066)', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0066_apply_build.sql'), 'utf8');

  it('defines the function with the ledger + advisory-lock discipline', () => {
    expect(sql).toContain('FUNCTION public.cc_apply_build(p_player_id uuid, nonce text, slots jsonb)');
    expect(sql).toContain('pg_advisory_xact_lock(hashtext(actor::text))');
    expect(sql).toContain("'cc_apply_build', nonce, result");
    expect(sql).toContain('public.cc_loadout_snapshot(actor)');
    expect(sql).toContain('public.cc_profile_snapshot(p)');
  });

  it('carries the full outcome vocabulary and the remedy lookups', () => {
    for (const outcome of ['equipped', 'empty', 'gone', 'listed', 'in_service', 'locked', 'incompatible']) {
      expect(sql).toContain(`'${outcome}'`);
    }
    // listed → the active listing; locked → the open service job;
    // in_service → the active dispatch mission's return time.
    expect(sql).toContain('from public.market_listings');
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('from public.service_jobs');
    expect(sql).toContain("status not in ('completed','cancelled')");
    expect(sql).toContain('from public.dispatch_missions');
    expect(sql).toContain('vehicle_item_id = item.id');
    expect(sql).toContain('returns_at');
  });

  it('reuses cc_equip_item semantics helpers rather than re-deriving them', () => {
    expect(sql).toContain('public.cc_item_accepts_slot');
    expect(sql).toContain('public.cc_vehicle_unlock_level');
    expect(sql).toContain("runtime_state in ('consumed','salvaged')");
  });
});
