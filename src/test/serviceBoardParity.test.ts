/**
 * Market-lane parity for the service boards — the repair board and
 * the shield-tech board browse with the Buy lane's toolkit
 * (server-side search / filters / sorts / pagination over
 * src/lib/market/boardQuery.ts) and every open job carries the
 * reader's requirements on its face (src/server/writes/
 * boardRequirements.ts).
 *
 * Shipped-path tests through the real write routes +
 * InMemoryWriteStore, seeded and posted exactly like the lane
 * suites (repairServices / shieldTechServices):
 *  - Query params behave per filter/sort against REAL postings.
 *  - Requirements are computed from the READER's real batches in
 *    burn order (worst quality first): a 100% kit walks before a
 *    150% kit, so the estimate can exceed the best-first count.
 *  - canTake is the accept gate restated: verified + not own job +
 *    ≥1 unit of the supply the lane burns. Mastery never gates.
 *  - Guests browse and filter freely (guest-visibility law); their
 *    requirements say why they cannot take a job.
 *  - An unqueried read keeps the historic shape: every open job,
 *    oldest first, openTotal === open.length.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const T0 = new Date('2026-11-01T12:00:00.000Z').getTime();
let clockMs = T0;

const OWNER = '11111111-1111-4111-8111-111111111111';
const OWNER2 = '66666666-6666-4666-8666-666666666666';
const MECH = '22222222-2222-4222-8222-222222222222';
const RINGER = '77777777-7777-4777-8777-777777777777';
const BROKE = '55555555-5555-4555-8555-555555555555';
const GUEST = '44444444-4444-4444-8444-444444444444';

const VEH1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VEH2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const VEH3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const VEH4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const SH1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const SH2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const SH3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 25, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-11-01T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function vehicleItem(id: string, owner: string, condition: number, classId: string, rarity: string): WriteItemData {
  return {
    id, owner_user_id: owner, kind: 'vehicle', static_item_id: null, item_level: 10,
    rarity, quality: null, material_tier: null, condition_state: null,
    condition_current: condition, condition_max: 100,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null,
    payload: { vehicleClassId: classId, name: classId, rarity, level: 10, affixes: [] },
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 2000,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteItemData;
}

function shieldItem(id: string, owner: string, rarity: string, payload: Record<string, unknown>): WriteItemData {
  return {
    id, owner_user_id: owner, kind: 'shield', static_item_id: null, item_level: 25,
    rarity, quality: null, material_tier: null, condition_state: null,
    condition_current: null, condition_max: null,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null,
    payload,
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 4000,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteItemData;
}

function batch(id: string, owner: string, type: string, quality: number, quantity: number, createdAt: string) {
  return {
    id, owner_user_id: owner, consumable_type: type, quality_percent: quality,
    quantity, origin: 'vendor', creator_user_id: null, source_recipe_id: null, metadata: {},
    created_at: createdAt, updated_at: createdAt,
  } as WriteSeed['consumableBatches'][number];
}

function seed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({ id: OWNER, username: 'cacheboss', credits: 100_000, consumables: { CalibrationCore: 3 } }),
    profile({ id: OWNER2, username: 'secondowner', credits: 100_000 }),
    profile({ id: MECH, username: 'wrenchwendy', credits: 500 }),
    profile({ id: RINGER, username: 'mixedbatches', credits: 500 }),
    profile({ id: BROKE, username: 'emptyeric', credits: 100_000 }),
    profile({ id: GUEST, username: 'guestgail', account_type: 'guest', email_verified_at: null, credits: 100_000 }),
  ];
  s.items = [
    vehicleItem(VEH1, OWNER, 40, 'dune_buggy', 'Rare'),
    vehicleItem(VEH2, OWNER, 90, 'scrap_bike', 'Common'),
    vehicleItem(VEH3, OWNER2, 10, 'utility_rover', 'Epic'),
    vehicleItem(VEH4, OWNER2, 60, 'cargo_hauler', 'Rare'),
    shieldItem(SH1, OWNER, 'Rare', { behavior: 'nova', hp: 3000, rechargeRate: 12.0, name: 'Nova Aegis' }),
    shieldItem(SH2, OWNER2, 'Epic', { behavior: 'turtle', hp: 4500, rechargeRate: 6.0, name: 'Turtle Shell' }),
    shieldItem(SH3, OWNER, 'Common', { hp: 2000, rechargeRate: 10.0, name: 'Old Plate' }),
  ];
  s.consumableBatches = [
    batch('batch-o1', OWNER, 'PatchKit', 100, 3, '2026-10-01T00:00:00.000Z'),
    batch('batch-m1', MECH, 'PatchKit', 100, 6, '2026-10-01T00:00:00.000Z'),
    batch('batch-m2', MECH, 'CalibrationCore', 100, 8, '2026-10-01T00:00:00.000Z'),
    // RINGER: worst-first burn order — the 100% kit walks BEFORE
    // the 150% kit even though the 150% batch is listed second.
    batch('batch-r1', RINGER, 'PatchKit', 150, 1, '2026-10-02T00:00:00.000Z'),
    batch('batch-r2', RINGER, 'PatchKit', 100, 1, '2026-10-01T00:00:00.000Z'),
    batch('batch-g1', GUEST, 'PatchKit', 100, 2, '2026-10-01T00:00:00.000Z'),
    batch('batch-g2', GUEST, 'CalibrationCore', 100, 2, '2026-10-01T00:00:00.000Z'),
  ];
  return s;
}

interface Harness { store: InMemoryWriteStore; base: string; close: () => Promise<void>; tokens: Record<string, string> }
let h: Harness;
let nonceN = 0;
const nonce = () => `parity-nonce-${++nonceN}-abcdefgh`;
const MIN = 60_000;

async function makeServer(): Promise<Harness> {
  clockMs = T0;
  const store = new InMemoryWriteStore(seed(), {
    now: () => new Date(clockMs),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((r) => server.on('listening', r));
  const { port } = server.address() as AddressInfo;
  const tokens: Record<string, string> = {};
  for (const id of [OWNER, OWNER2, MECH, RINGER, BROKE, GUEST]) tokens[id] = issueAccessToken(SECRET, id, id === GUEST);
  return { store, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())), tokens };
}

async function post(path: string, token: string, payload: unknown) {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

async function getBoard(lane: 'repair' | 'shieldtech', token: string, qs = '') {
  const res = await fetch(`${h.base}/api/${lane}/board${qs}`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

interface KitOptionT {
  kitType: string;
  onHand: number;
  estimatedKits: number | null;
  coversTarget: boolean;
}

interface RequirementsT {
  escrowCredits: number;
  canTake: boolean;
  blockers: string[];
  kitOptions: KitOptionT[];
  estimatedHours: number | null;
  coresOnHand: number;
  estimatedCores: number | null;
  coversTarget: boolean;
}

type Job = Record<string, unknown> & { id: string; requirements: RequirementsT };
const openIds = (view: { json: Record<string, unknown> }): string[] =>
  (view.json.open as Job[]).map((j) => j.id);
const jobById = (view: { json: Record<string, unknown> }, id: string): Job =>
  (view.json.open as Job[]).find((j) => j.id === id)!;

// Posted in beforeAll, one minute apart so created_at orders are
// distinct: J1 < J2 < J3 < J4 and S1 < S2 < S3.
let J1 = ''; let J2 = ''; let J3 = ''; let J4 = '';
let S1 = ''; let S2 = ''; let S3 = '';

async function postRepair(token: string, itemId: string, price: number, target?: number): Promise<string> {
  const res = await post('/api/ops/repair-post', token, {
    nonce: nonce(), item_id: itemId, price_credits: price,
    ...(target != null ? { target_points: target } : {}),
  });
  expect(res.status).toBe(200);
  clockMs += MIN;
  return (res.json.job as Job).id as string;
}

async function postShield(token: string, itemId: string, toBehavior: string, price: number): Promise<string> {
  const res = await post('/api/ops/shieldtech-post', token, {
    nonce: nonce(), item_id: itemId, to_behavior: toBehavior, price_credits: price,
  });
  expect(res.status).toBe(200);
  clockMs += MIN;
  return (res.json.job as Job).id as string;
}

describe('service-board parity — repair board browse + requirements', () => {
  beforeAll(async () => {
    h = await makeServer();
    J1 = await postRepair(h.tokens[OWNER], VEH1, 600); // dune_buggy 40% → 60 pts
    J2 = await postRepair(h.tokens[OWNER], VEH2, 100, 10); // scrap_bike 90% → 10 pts
    J3 = await postRepair(h.tokens[OWNER2], VEH3, 2000); // utility_rover 10% → 90 pts
    J4 = await postRepair(h.tokens[OWNER2], VEH4, 400, 40); // cargo_hauler 60% → 40 pts
  });

  it('the unqueried board keeps the historic shape: all open jobs, oldest first', async () => {
    const view = await getBoard('repair', h.tokens[MECH]);
    expect(view.status).toBe(200);
    expect(openIds(view)).toEqual([J1, J2, J3, J4]);
    expect(view.json.openTotal).toBe(4);
  });

  it('requirements ride on every open job: escrow, kit estimate at the reader pace, hours', async () => {
    const view = await getBoard('repair', h.tokens[MECH]);
    const req = jobById(view, J1).requirements;
    expect(req).toBeTruthy();
    expect(req.escrowCredits).toBe(600);
    expect(req.canTake).toBe(true);
    expect(req.blockers).toEqual([]);
    // MECH: mastery Lv 1 → efficiency 1.0, rate 20 pts/h.
    // 60 points ÷ 30 per 100% Patch Kit = 2 kits; 60 ÷ 20 = 3h.
    const patch = (req.kitOptions as Job[]).find((o) => o.kitType === 'PatchKit')!;
    expect(patch.onHand).toBe(6);
    expect(patch.estimatedKits).toBe(2);
    expect(patch.coversTarget).toBe(true);
    expect(req.estimatedHours).toBe(3);
  });

  it('kit estimates walk the reader batches worst-first, not best-first', async () => {
    const view = await getBoard('repair', h.tokens[RINGER]);
    const req = jobById(view, J4).requirements;
    const patch = (req.kitOptions as Job[]).find((o) => o.kitType === 'PatchKit')!;
    expect(patch.onHand).toBe(2);
    // Worst-first: 100% kit yields 30 (< 40), then the 150% kit
    // yields 45 → 2 kits. Best-first would claim 1 (45 ≥ 40).
    expect(patch.estimatedKits).toBe(2);
    expect(patch.coversTarget).toBe(true);
  });

  it('a reader with no kits gets the no_supply blocker and a null estimate', async () => {
    const view = await getBoard('repair', h.tokens[BROKE]);
    const req = jobById(view, J1).requirements;
    expect(req.canTake).toBe(false);
    expect(req.blockers).toContain('no_supply');
    const patch = (req.kitOptions as Job[]).find((o) => o.kitType === 'PatchKit')!;
    expect(patch.onHand).toBe(0);
    expect(patch.estimatedKits).toBeNull();
    expect(patch.coversTarget).toBe(false);
  });

  it('the owner sees own_job on their postings and can take other owners jobs', async () => {
    const view = await getBoard('repair', h.tokens[OWNER]);
    expect(jobById(view, J1).requirements.blockers).toContain('own_job');
    expect(jobById(view, J1).requirements.canTake).toBe(false);
    expect(jobById(view, J3).requirements.canTake).toBe(true);
  });

  it('guests browse and filter freely; requirements name the verified gate', async () => {
    const view = await getBoard('repair', h.tokens[GUEST], '?search=dune');
    expect(view.status).toBe(200);
    expect(openIds(view)).toEqual([J1]);
    const req = jobById(view, J1).requirements;
    expect(req.canTake).toBe(false);
    expect(req.blockers).toContain('unverified');
    expect(req.blockers).not.toContain('no_supply');
  });

  it('search matches vehicle class names and owner display names', async () => {
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?search=utility'))).toEqual([J3]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?search=secondowner'))).toEqual([J4, J3]);
    const byOwner = await getBoard('repair', h.tokens[MECH], '?search=cacheboss&sort=newest');
    expect(openIds(byOwner).sort()).toEqual([J1, J2].sort());
  });

  it('rarity, vehicle class, condition band, price band, and work-size band filters compose', async () => {
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?rarity=Epic'))).toEqual([J3]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?vehicleClass=scrap_bike'))).toEqual([J2]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?conditionMax=50&sort=pay_asc'))).toEqual([J1, J3]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?conditionMin=50&sort=pay_asc'))).toEqual([J2, J4]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?priceMin=500&sort=pay_asc'))).toEqual([J1, J3]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?priceMax=500&sort=pay_asc'))).toEqual([J2, J4]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?pointsMin=50&sort=pay_asc'))).toEqual([J1, J3]);
  });

  it('sorts: pay both ways, condition (most worn first), newest, expiring', async () => {
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?sort=pay_desc'))).toEqual([J3, J1, J4, J2]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?sort=pay_asc'))).toEqual([J2, J4, J1, J3]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?sort=condition'))).toEqual([J3, J1, J4, J2]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?sort=newest'))).toEqual([J4, J3, J2, J1]);
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?sort=expiring'))).toEqual([J1, J2, J3, J4]);
  });

  it('canTake=1 keeps only jobs the reader can accept right now', async () => {
    expect(openIds(await getBoard('repair', h.tokens[MECH], '?canTake=1&sort=pay_asc'))).toEqual([J2, J4, J1, J3]);
    const broke = await getBoard('repair', h.tokens[BROKE], '?canTake=1');
    expect(broke.json.open).toEqual([]);
    expect(broke.json.openTotal).toBe(0);
    const ownerCanTake = openIds(await getBoard('repair', h.tokens[OWNER], '?canTake=1'));
    expect(ownerCanTake.sort()).toEqual([J3, J4].sort());
  });

  it('pagination pages over the filtered set and reports the full total', async () => {
    const page1 = await getBoard('repair', h.tokens[MECH], '?sort=pay_desc&limit=2');
    expect(openIds(page1)).toEqual([J3, J1]);
    expect(page1.json.openTotal).toBe(4);
    const page2 = await getBoard('repair', h.tokens[MECH], '?sort=pay_desc&limit=2&offset=2');
    expect(openIds(page2)).toEqual([J4, J2]);
    expect(page2.json.openTotal).toBe(4);
  });

  it('the status filter narrows the caller own lists, never the open board', async () => {
    const listed = await getBoard('repair', h.tokens[OWNER], '?status=listed');
    expect((listed.json.mine as Job[]).map((j) => j.id).sort()).toEqual([J1, J2].sort());
    expect(listed.json.openTotal).toBe(4);
    const completed = await getBoard('repair', h.tokens[OWNER], '?status=completed');
    expect(completed.json.mine).toEqual([]);
    expect(completed.json.openTotal).toBe(4);
  });
});

describe('service-board parity — shield-tech board browse + requirements', () => {
  beforeAll(async () => {
    S1 = await postShield(h.tokens[OWNER], SH1, 'turtle', 5000); // Rare nova → turtle, 3000 pts
    S2 = await postShield(h.tokens[OWNER2], SH2, 'nova', 9000); // Epic turtle → nova, 4500 pts
    S3 = await postShield(h.tokens[OWNER], SH3, 'amp', 1200); // Common legacy → amp, 2000 pts
  });
  afterAll(async () => { await h.close(); });

  it('the unqueried board keeps the historic shape', async () => {
    const view = await getBoard('shieldtech', h.tokens[MECH]);
    expect(view.status).toBe(200);
    expect(openIds(view)).toEqual([S1, S2, S3]);
    expect(view.json.openTotal).toBe(3);
  });

  it('requirements ride on every open job: escrow, holdings-based core estimate, hours', async () => {
    const view = await getBoard('shieldtech', h.tokens[MECH]);
    const req = jobById(view, S1).requirements;
    expect(req).toBeTruthy();
    expect(req.escrowCredits).toBe(5000);
    expect(req.canTake).toBe(true);
    expect(req.blockers).toEqual([]);
    // MECH: 8 cores at 100%, efficiency 1.0 → 2500 pts/core.
    // 3000 points → 2 cores; 3000 ÷ 500 pts/h = 6h.
    expect(req.coresOnHand).toBe(8);
    expect(req.estimatedCores).toBe(2);
    expect(req.coversTarget).toBe(true);
    expect(req.estimatedHours).toBe(6);
  });

  it('a reader whose cores cannot cover the target sees the shortfall, not a blocker', async () => {
    // OWNER holds 3 legacy-count cores (no batch rows): the legacy
    // fallback prices them as one 100% batch — 3 × 2500 = 7500 pts,
    // which covers S2's 4500 with 2 cores.
    const view = await getBoard('shieldtech', h.tokens[OWNER]);
    const req2 = jobById(view, S2).requirements;
    expect(req2.coresOnHand).toBe(3);
    expect(req2.estimatedCores).toBe(2);
    expect(req2.canTake).toBe(true);
    // S1 is OWNER's own job.
    expect(jobById(view, S1).requirements.blockers).toContain('own_job');
  });

  it('broke and guest readers get named blockers', async () => {
    const broke = await getBoard('shieldtech', h.tokens[BROKE]);
    const reqB = jobById(broke, S1).requirements;
    expect(reqB.canTake).toBe(false);
    expect(reqB.blockers).toContain('no_supply');
    expect(reqB.estimatedCores).toBeNull();
    const guest = await getBoard('shieldtech', h.tokens[GUEST], '?canTake=1');
    expect(guest.status).toBe(200);
    expect(guest.json.open).toEqual([]);
    const guestAll = await getBoard('shieldtech', h.tokens[GUEST]);
    expect(jobById(guestAll, S1).requirements.blockers).toContain('unverified');
  });

  it('behavior, rarity, search, and band filters compose', async () => {
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?fromBehavior=turtle'))).toEqual([S2]);
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?toBehavior=turtle'))).toEqual([S1]);
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?rarity=Epic'))).toEqual([S2]);
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?search=nova&sort=pay_asc'))).toEqual([S1, S2]);
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?search=secondowner'))).toEqual([S2]);
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?pointsMax=3000&sort=pay_asc'))).toEqual([S3, S1]);
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?priceMin=4000&sort=pay_asc'))).toEqual([S1, S2]);
  });

  it('sorts: pay both ways, smallest job first, newest', async () => {
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?sort=pay_desc'))).toEqual([S2, S1, S3]);
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?sort=pay_asc'))).toEqual([S3, S1, S2]);
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?sort=condition'))).toEqual([S3, S1, S2]);
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?sort=newest'))).toEqual([S3, S2, S1]);
  });

  it('canTake and pagination agree with the repair lane contract', async () => {
    expect(openIds(await getBoard('shieldtech', h.tokens[MECH], '?canTake=1&sort=pay_asc'))).toEqual([S3, S1, S2]);
    const page = await getBoard('shieldtech', h.tokens[MECH], '?sort=pay_desc&limit=1&offset=1');
    expect(openIds(page)).toEqual([S1]);
    expect(page.json.openTotal).toBe(3);
  });
});
