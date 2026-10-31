/**
 * Mechanics & repair services (migration 0025) — shipped-path tests
 * through the real write routes + InMemoryWriteStore (the mirror of
 * the 0025 SQL; the SQL itself is exercised against embedded Postgres
 * in the slice verification harness, incl. the economy-metrics panel).
 *
 * Michael's rulings under test:
 *  - NO NPC mechanic, OPEN MARKET ONLY: a public board; owners escrow
 *    the full price up front; terms fixed at posting.
 *  - PATCH-KIT MODEL: the mechanic supplies the kits on board jobs
 *    (price = kits + labor); self-repair burns your own kits.
 *  - Mechanic XP = 2 per condition point ACTUALLY restored (incl.
 *    partial jobs), into the services.repair mastery at 1 XP/point.
 *  - The edge is TIME + EFFICIENCY: self-repair is a TIMED job on the
 *    craft machinery; mastery raises points/hour and per-kit yield;
 *    kit quality % multiplies underneath.
 *  - Fee: the shared market-fee lever applies to service payments
 *    and is destroyed; completion pays full price, every other
 *    terminal state pays pro-rata floor(price × restored/target).
 *  - Guests cannot post/accept (market account gating); self-repair
 *    stays open (consumption, like refuelling).
 *  - Forged claims fail: no time = no pay, no restoring beyond kit
 *    capacity, no double-claims, no cross-player finishes.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import { ECONOMY_CONFIG_DEFAULTS, ECONOMY_CONFIG_KEYS } from '../server/economy/config';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const T0 = new Date('2026-10-31T12:00:00.000Z').getTime();
let clockMs = T0;

const OWNER = '11111111-1111-4111-8111-111111111111';
const MECH = '22222222-2222-4222-8222-222222222222';
const PRO = '33333333-3333-4333-8333-333333333333';
const BROKE = '55555555-5555-4555-8555-555555555555';
const GUEST = '44444444-4444-4444-8444-444444444444';

const VEH1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VEH2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const VEH3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 25, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function vehicleItem(id: string, owner: string, condition: number, classId = 'dune_buggy'): WriteItemData {
  return {
    id, owner_user_id: owner, kind: 'vehicle', static_item_id: null, item_level: 10,
    rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
    condition_current: condition, condition_max: 100,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null,
    payload: { vehicleClassId: classId, name: classId, rarity: 'Rare', level: 10, affixes: [] },
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 2000,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteItemData;
}

function kitBatch(id: string, owner: string, type: string, quality: number, quantity: number) {
  return {
    id, owner_user_id: owner, consumable_type: type, quality_percent: quality,
    quantity, origin: 'vendor', creator_user_id: null, source_recipe_id: null, metadata: {},
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteSeed['consumableBatches'][number];
}

function seed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({ id: OWNER, credits: 10_000, consumables: { PatchKit: 3 } }),
    profile({ id: MECH, credits: 500, consumables: { PatchKit: 6 } }),
    profile({ id: PRO, credits: 0, consumables: { PatchKit: 2 } }),
    profile({ id: BROKE, credits: 10_000, consumables: {} }),
    profile({ id: GUEST, account_type: 'guest', email_verified_at: null, credits: 10_000, consumables: { PatchKit: 2 } }),
  ];
  s.items = [
    vehicleItem(VEH1, OWNER, 40),
    vehicleItem(VEH2, OWNER, 90, 'scrap_bike'),
    vehicleItem(VEH3, PRO, 10, 'utility_rover'),
  ];
  s.consumableBatches = [
    kitBatch('batch-o1', OWNER, 'PatchKit', 100, 3),
    kitBatch('batch-m1', MECH, 'PatchKit', 100, 6),
    // PRO: FIFO burns worst-first — the 100% kit goes before the 150%.
    kitBatch('batch-p1', PRO, 'PatchKit', 150, 1),
    kitBatch('batch-p2', PRO, 'PatchKit', 100, 1),
    kitBatch('batch-g1', GUEST, 'PatchKit', 100, 2),
  ];
  s.masteries = [
    // Level 26 on the shipped curve (sum of k²×100 for k=1..25).
    { user_id: PRO, mastery_id: 'services.repair', mastery_xp: 552_500, mastery_level: 26 },
  ];
  return s;
}

interface Harness { store: InMemoryWriteStore; base: string; close: () => Promise<void>; tokens: Record<string, string> }
let h: Harness;
let nonceN = 0;
const nonce = () => `repair-nonce-${++nonceN}-abcdefgh`;

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
  for (const id of [OWNER, MECH, PRO, BROKE, GUEST]) tokens[id] = issueAccessToken(SECRET, id, id === GUEST);
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
async function board(token: string) {
  const res = await fetch(`${h.base}/api/repair/board`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const prof = (id: string) => h.store.seed.profiles.find((p) => p.id === id)!;
const item = (id: string) => h.store.seed.items.find((i) => i.id === id)!;
const advance = (ms: number) => { clockMs += ms; };
const setAction = (token: string, kind: string, targetId?: string) =>
  post('/api/activity/set', token, {
    nonce: nonce(), activity_kind: kind,
    ...(targetId ? { target_type: 'workshop_job', target_id: targetId } : {}),
    activity_payload: {}, public_payload: {},
  });
const HOUR = 3600_000;

async function postJob(price = 600, target?: number): Promise<string> {
  const res = await post('/api/ops/repair-post', h.tokens[OWNER], {
    nonce: nonce(), item_id: VEH1, price_credits: price,
    ...(target != null ? { target_points: target } : {}),
  });
  expect(res.status).toBe(200);
  return (res.json.job as Record<string, unknown>).id as string;
}

describe('repair board — escrow lifecycle through the shipped routes', () => {
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('post escrows the full price up front and locks the vehicle into service', async () => {
    const jobId = await postJob(600);
    expect(prof(OWNER).credits).toBe(9400);
    expect(item(VEH1).runtime_state).toBe('in_service');
    expect(item(VEH1).is_locked).toBe(true);

    const view = await board(h.tokens[MECH]);
    expect(view.status).toBe(200);
    const listing = (view.json.open as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(listing).toBeTruthy();
    // Target defaults to the full deficit: 100 − 40 = 60 points.
    expect(listing.targetPoints).toBe(60);
    expect(listing.priceCredits).toBe(600);
    expect(listing.creditsPerPoint).toBe(10);
  });

  it('work accrues ONLY while the mechanic\u2019s action targets the job; kits burn at quality-scaled capacity', async () => {
    const view0 = await board(h.tokens[OWNER]);
    const jobId = (view0.json.mine as Array<Record<string, unknown>>)[0].id as string;

    const accepted = await post('/api/ops/repair-accept', h.tokens[MECH], {
      nonce: nonce(), job_id: jobId, item_key: 'PatchKit',
    });
    expect(accepted.status).toBe(200);
    const snap = (accepted.json.job as Record<string, unknown>).repair_snapshot as Record<string, unknown>;
    // Untrained snapshot: 20 pts/h, efficiency 1.0.
    expect(snap.workRatePointsPerHour).toBe(20);
    expect(snap.efficiency).toBe(1);

    // Two hours ROAMING: no accrual, no kits burned.
    await setAction(h.tokens[MECH], 'roaming_loot');
    advance(2 * HOUR);
    let view = await board(h.tokens[MECH]);
    let job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.pointsRestored).toBe(0);
    expect((job.kitsConsumed as unknown[]).length).toBe(0);

    // Two hours ON the job: 40 points — kit 1 applies 30, kit 2 opens
    // and applies 10. The mechanic's own kits are the consumable.
    await setAction(h.tokens[MECH], 'workshop_service', jobId);
    advance(2 * HOUR);
    view = await board(h.tokens[MECH]);
    job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.pointsRestored).toBe(40);
    const consumed = job.kitsConsumed as Array<Record<string, unknown>>;
    expect(consumed.length).toBe(2);
    expect(consumed[0].pointsApplied).toBe(30);
    expect(consumed[1].pointsApplied).toBe(10);
    expect(item(VEH1).condition_current).toBe(80);
    expect(prof(MECH).consumables.PatchKit).toBe(4);
  });

  it('completion pays the full price minus the destroyed fee, grants 2 XP/point and mastery XP', async () => {
    const view0 = await board(h.tokens[MECH]);
    const jobId = (view0.json.work as Array<Record<string, unknown>>)[0].id as string;
    advance(1 * HOUR); // the remaining 20 points
    const view = await board(h.tokens[MECH]);
    const job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.status).toBe('completed');
    expect(job.outcome).toBe('completed');
    expect(job.pointsRestored).toBe(60);
    expect(job.paidCredits).toBe(600);
    expect(job.feeCredits).toBe(30);
    expect(job.xpAwarded).toBe(120);
    // Conservation: 10_500 total before posting; the 30cr fee is the
    // only credit destroyed by the whole flow.
    expect(prof(OWNER).credits).toBe(9400);
    expect(prof(MECH).credits).toBe(500 + 570);
    expect(prof(MECH).player_xp).toBe(120);
    const mastery = h.store.seed.masteries.find((m) => m.user_id === MECH && m.mastery_id === 'services.repair');
    expect(mastery?.mastery_xp).toBe(60);
    // Vehicle released whole.
    expect(item(VEH1).condition_current).toBe(100);
    expect(item(VEH1).runtime_state).toBe('available');
    expect(item(VEH1).is_locked).toBe(false);
    // No third kit was needed: the second kit's remaining capacity
    // covered the final 20 points exactly.
    expect(prof(MECH).consumables.PatchKit).toBe(4);
  });
});

describe('repair board — cancel, expiry, reclaim', () => {
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('cancelling a LISTED job refunds the escrow in full and releases the vehicle', async () => {
    const jobId = await postJob(600);
    expect(prof(OWNER).credits).toBe(9400);
    const res = await post('/api/ops/repair-cancel', h.tokens[OWNER], { nonce: nonce(), job_id: jobId });
    expect(res.status).toBe(200);
    expect(prof(OWNER).credits).toBe(10_000);
    expect(item(VEH1).runtime_state).toBe('available');
    expect(item(VEH1).is_locked).toBe(false);
  });

  it('owner cancel mid-job settles pro-rata: floor(price × restored/target), fee on the paid part only', async () => {
    const jobId = await postJob(600);
    await post('/api/ops/repair-accept', h.tokens[MECH], { nonce: nonce(), job_id: jobId, item_key: 'PatchKit' });
    await setAction(h.tokens[MECH], 'workshop_service', jobId);
    advance(2 * HOUR); // 40 of 60 points
    await board(h.tokens[MECH]); // settle the work in
    const res = await post('/api/ops/repair-cancel', h.tokens[OWNER], { nonce: nonce(), job_id: jobId });
    expect(res.status).toBe(200);
    // paid = floor(600 × 40/60) = 400; fee = 5% × 400 = 20 destroyed;
    // mechanic nets 380; owner refunded the unpaid 200.
    expect(prof(MECH).credits).toBe(500 + 380);
    expect(prof(OWNER).credits).toBe(9400 + 200);
    expect(prof(MECH).player_xp).toBe(80); // 2 XP × 40 points, partial job included
    expect(item(VEH1).condition_current).toBe(80);
    expect(item(VEH1).runtime_state).toBe('available');
  });

  it('provider quit pays the same pro-rata for work actually done', async () => {
    // VEH1 sits at 80 after the previous test, so this posting's
    // target is the 20-point deficit. Balances entering: OWNER 9600,
    // MECH 880.
    const jobId = await postJob(600);
    await post('/api/ops/repair-accept', h.tokens[MECH], { nonce: nonce(), job_id: jobId, item_key: 'PatchKit' });
    await setAction(h.tokens[MECH], 'workshop_service', jobId);
    advance(HOUR / 2); // 10 of 20 points
    const res = await post('/api/ops/repair-cancel', h.tokens[MECH], { nonce: nonce(), job_id: jobId });
    expect(res.status).toBe(200);
    // paid = floor(600 × 10/20) = 300; fee 15; mechanic nets 285;
    // owner refunded the unpaid 300.
    expect(prof(MECH).credits).toBe(880 + 285);
    expect(prof(OWNER).credits).toBe(9600 - 600 + 300);
    expect(item(VEH1).condition_current).toBe(90);
  });

  it('an expired listing refunds in full when the board is next read', async () => {
    const res = await post('/api/ops/repair-post', h.tokens[OWNER], {
      nonce: nonce(), item_id: VEH2, price_credits: 250,
    });
    expect(res.status).toBe(200);
    const jobId = (res.json.job as Record<string, unknown>).id as string;
    expect(prof(OWNER).credits).toBe(9300 - 250);
    advance(8 * 24 * HOUR); // listing expiry lever: 7 days
    const view = await board(h.tokens[OWNER]);
    const job = (view.json.mine as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.status).toBe('cancelled');
    expect(job.outcome).toBe('expired');
    expect(prof(OWNER).credits).toBe(9300);
    expect(item(VEH2).runtime_state).toBe('available');
  });

  it('the owner can reclaim after the 48h abandon window with zero progress', async () => {
    const jobId = await postJob(600);
    await post('/api/ops/repair-accept', h.tokens[MECH], { nonce: nonce(), job_id: jobId, item_key: 'PatchKit' });
    // The mechanic never works. Inside the window, reclaim refuses.
    advance(24 * HOUR);
    const early = await post('/api/ops/repair-reclaim', h.tokens[OWNER], { nonce: nonce(), job_id: jobId });
    expect(early.status).toBeGreaterThanOrEqual(400);
    advance(25 * HOUR); // 49h total
    const view = await board(h.tokens[OWNER]);
    const mine = (view.json.mine as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(mine.reclaimable).toBe(true);
    const res = await post('/api/ops/repair-reclaim', h.tokens[OWNER], { nonce: nonce(), job_id: jobId });
    expect(res.status).toBe(200);
    expect(prof(OWNER).credits).toBe(9300); // nothing restored → nothing paid, full refund
    expect(item(VEH1).runtime_state).toBe('available');
    const mechView = await board(h.tokens[MECH]);
    expect((mechView.json.stats as Record<string, unknown>).myJobsAbandoned).toBe(1);
  });
});

describe('self-repair — a timed job on the craft machinery', () => {
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('untrained: kits escrow at enqueue, one 30-point unit lands per 1.5h of Workshop Service', async () => {
    const res = await post('/api/ops/repair-enqueue', h.tokens[OWNER], {
      nonce: nonce(), item_id: VEH1, item_key: 'PatchKit', units: 2,
    });
    expect(res.status).toBe(200);
    const job = res.json.job as Record<string, unknown>;
    expect(job.kind).toBe('repair');
    expect(job.unitDurationMs).toBe(5_400_000); // 30 base ÷ 20 pts/h
    expect(prof(OWNER).consumables.PatchKit).toBe(1); // 2 of 3 escrowed
    expect(item(VEH1).condition_current).toBe(40); // nothing restored yet

    await setAction(h.tokens[OWNER], 'workshop_service', job.id as string);
    advance(5_400_000 + 60_000);
    const ws = await fetch(`${h.base}/api/workshop/me`, { headers: { authorization: `Bearer ${h.tokens[OWNER]}` } });
    const wsJson = (await ws.json()) as Record<string, unknown>;
    let jobs = wsJson.jobs as Array<Record<string, unknown>>;
    let mine = jobs.find((j) => j.id === job.id)!;
    expect(mine.unitsCompleted).toBe(1);
    expect(item(VEH1).condition_current).toBe(70);

    advance(5_400_000);
    const ws2 = await fetch(`${h.base}/api/workshop/me`, { headers: { authorization: `Bearer ${h.tokens[OWNER]}` } });
    const ws2Json = (await ws2.json()) as Record<string, unknown>;
    jobs = ws2Json.jobs as Array<Record<string, unknown>>;
    mine = jobs.find((j) => j.id === job.id)!;
    expect(mine.state).toBe('complete');
    expect(item(VEH1).condition_current).toBe(100);
    // Self-repair grants repair mastery XP for points restored (60),
    // and no player XP — the board is the paid lane.
    const mastery = h.store.seed.masteries.find((m) => m.user_id === OWNER && m.mastery_id === 'services.repair');
    expect(mastery?.mastery_xp).toBe(60);
    expect(prof(OWNER).player_xp).toBe(0);
  });

  it('mastery raises BOTH pace and per-kit yield; kit quality % multiplies underneath', async () => {
    // PRO: repair mastery 26 → speed ×1.5 (30 pts/h), efficiency ×1.5.
    const res = await post('/api/ops/repair-enqueue', h.tokens[PRO], {
      nonce: nonce(), item_id: VEH3, item_key: 'PatchKit', units: 1,
    });
    expect(res.status).toBe(200);
    const job = res.json.job as Record<string, unknown>;
    expect(job.unitDurationMs).toBe(3_600_000); // 30 ÷ 30 pts/h = 1h (vs 1.5h untrained)
    await setAction(h.tokens[PRO], 'workshop_service', job.id as string);
    advance(3_600_000 + 60_000);
    const ws = await fetch(`${h.base}/api/workshop/me`, { headers: { authorization: `Bearer ${h.tokens[PRO]}` } });
    const wsJson = (await ws.json()) as Record<string, unknown>;
    const mine = (wsJson.jobs as Array<Record<string, unknown>>).find((j) => j.id === job.id)!;
    expect(mine.state).toBe('complete');
    // FIFO burned the 100% kit: 30 × 1.00 quality × 1.5 efficiency = 45.
    expect(mine.repairPointsRestored).toBe(45);
    expect(item(VEH3).condition_current).toBe(55);

    // Second job burns the 150% kit: 30 × 1.50 × 1.5 = 67.5 points of
    // capacity against 45 points of headroom — restoration clamps at
    // full and the job completes on the one kit.
    const res2 = await post('/api/ops/repair-enqueue', h.tokens[PRO], {
      nonce: nonce(), item_id: VEH3, item_key: 'PatchKit', units: 1,
    });
    const job2 = res2.json.job as Record<string, unknown>;
    await setAction(h.tokens[PRO], 'workshop_service', job2.id as string);
    advance(3_600_000 + 60_000);
    const ws2 = await fetch(`${h.base}/api/workshop/me`, { headers: { authorization: `Bearer ${h.tokens[PRO]}` } });
    const ws2Json = (await ws2.json()) as Record<string, unknown>;
    const mine2 = (ws2Json.jobs as Array<Record<string, unknown>>).find((j) => j.id === job2.id)!;
    expect(mine2.state).toBe('complete');
    expect(mine2.repairPointsRestored).toBe(45);
    expect(item(VEH3).condition_current).toBe(100);
  });

  it('cancelling a self-repair job refunds every uncompleted kit whole', async () => {
    // VEH1 is whole again after the first test; use a fresh damaged
    // vehicle state via VEH2 (90/100, OWNER's scrap bike).
    const res = await post('/api/ops/repair-enqueue', h.tokens[OWNER], {
      nonce: nonce(), item_id: VEH2, item_key: 'PatchKit', units: 1,
    });
    expect(res.status).toBe(200);
    const job = res.json.job as Record<string, unknown>;
    expect(prof(OWNER).consumables.PatchKit).toBe(0); // last kit escrowed
    const cancel = await post('/api/ops/craft-cancel', h.tokens[OWNER], { nonce: nonce(), job_id: job.id });
    expect(cancel.status).toBe(200);
    expect(prof(OWNER).consumables.PatchKit).toBe(1); // refunded whole
    expect(item(VEH2).condition_current).toBe(90);
  });

  it('guests may self-repair (consumption) but cannot post or accept board jobs', async () => {
    const postRes = await post('/api/ops/repair-post', h.tokens[GUEST], {
      nonce: nonce(), item_id: VEH1, price_credits: 100,
    });
    expect(postRes.status).toBeGreaterThanOrEqual(400);
    // VEH1 is whole by now in this describe; VEH2 (90/100) carries the
    // owner's listing the guest tries to accept.
    const listed = await post('/api/ops/repair-post', h.tokens[OWNER], {
      nonce: nonce(), item_id: VEH2, price_credits: 300,
    });
    expect(listed.status).toBe(200);
    const jobId = (listed.json.job as Record<string, unknown>).id as string;
    const acceptRes = await post('/api/ops/repair-accept', h.tokens[GUEST], {
      nonce: nonce(), job_id: jobId, item_key: 'PatchKit',
    });
    expect(acceptRes.status).toBeGreaterThanOrEqual(400);
    await post('/api/ops/repair-cancel', h.tokens[OWNER], { nonce: nonce(), job_id: jobId });
  });
});

describe('repair board — forgery suite', () => {
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('finishing with no work done pays 0 and refunds the owner in full', async () => {
    const jobId = await postJob(600);
    await post('/api/ops/repair-accept', h.tokens[MECH], { nonce: nonce(), job_id: jobId, item_key: 'PatchKit' });
    const fin = await post('/api/ops/repair-finish', h.tokens[MECH], { nonce: nonce(), job_id: jobId });
    expect(fin.status).toBe(200);
    expect(prof(MECH).credits).toBe(500);
    expect(prof(OWNER).credits).toBe(10_000);
    expect(item(VEH1).condition_current).toBe(40);
    expect(item(VEH1).runtime_state).toBe('available');
  });

  it('double-finish and double-accept are rejected; terms cannot be rewritten by the body', async () => {
    const jobId = await postJob(600);
    // Body tries to rewrite the price at accept — the route schema
    // carries no price field for accept, so terms stay as posted.
    const acc = await post('/api/ops/repair-accept', h.tokens[MECH], {
      nonce: nonce(), job_id: jobId, item_key: 'PatchKit',
      price_credits: 1, points_restored: 60, paid_credits: 600,
    });
    expect(acc.status).toBe(200);
    expect((acc.json.job as Record<string, unknown>).quoted_price_credits ?? (acc.json.job as Record<string, unknown>).price_credits).toBe(600);
    const again = await post('/api/ops/repair-accept', h.tokens[PRO], {
      nonce: nonce(), job_id: jobId, item_key: 'PatchKit',
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
    await post('/api/ops/repair-finish', h.tokens[MECH], { nonce: nonce(), job_id: jobId });
    const second = await post('/api/ops/repair-finish', h.tokens[MECH], { nonce: nonce(), job_id: jobId });
    expect(second.status).toBeGreaterThanOrEqual(400);
    // Still exactly one settlement: owner whole, mechanic unpaid.
    expect(prof(OWNER).credits).toBe(10_000);
    expect(prof(MECH).credits).toBe(500);
  });

  it('own-job accepts, kit-less accepts, and cross-player finishes are rejected', async () => {
    const jobId = await postJob(600);
    const own = await post('/api/ops/repair-accept', h.tokens[OWNER], {
      nonce: nonce(), job_id: jobId, item_key: 'PatchKit',
    });
    expect(own.status).toBeGreaterThanOrEqual(400);
    const kitless = await post('/api/ops/repair-accept', h.tokens[BROKE], {
      nonce: nonce(), job_id: jobId, item_key: 'PatchKit',
    });
    expect(kitless.status).toBeGreaterThanOrEqual(400);
    await post('/api/ops/repair-accept', h.tokens[MECH], { nonce: nonce(), job_id: jobId, item_key: 'PatchKit' });
    const cross = await post('/api/ops/repair-finish', h.tokens[OWNER], { nonce: nonce(), job_id: jobId });
    expect(cross.status).toBeGreaterThanOrEqual(400);
    const crossCancel = await post('/api/ops/repair-reclaim', h.tokens[MECH], { nonce: nonce(), job_id: jobId });
    expect(crossCancel.status).toBeGreaterThanOrEqual(400);
    // The job is untouched: still active, nothing restored or paid.
    const view = await board(h.tokens[MECH]);
    const job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.status).toBe('active');
    expect(job.pointsRestored).toBe(0);
  });

  it('over-credit posts and the retired instant patch-kit route fail', async () => {
    const poor = await post('/api/ops/repair-post', h.tokens[BROKE], {
      nonce: nonce(), item_id: VEH1, price_credits: 999_999,
    });
    // BROKE doesn't own VEH1 either — either way it must fail cleanly
    // and hold no escrow.
    expect(poor.status).toBeGreaterThanOrEqual(400);
    expect(prof(BROKE).credits).toBe(10_000);
    // The retired instant route is unregistered (bare-framework 404;
    // raw fetch because the harness's post() parses JSON bodies).
    const retired = await fetch(`${h.base}/api/ops/use-patch-kit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${h.tokens[OWNER]}` },
      body: JSON.stringify({ nonce: nonce(), item_id: VEH1 }),
    });
    expect(retired.status).toBe(404);
  });
});

describe('repair levers — registered in the economy config (0025)', () => {
  it('all six repair constants exist with the ruled defaults', () => {
    expect(ECONOMY_CONFIG_DEFAULTS.repairWorkRateBase).toBe(20);
    expect(ECONOMY_CONFIG_DEFAULTS.repairMasterySpeedPerLevel).toBe(0.02);
    expect(ECONOMY_CONFIG_DEFAULTS.repairMasteryEfficiencyPerLevel).toBe(0.02);
    expect(ECONOMY_CONFIG_DEFAULTS.serviceXpPerPoint).toBe(2);
    expect(ECONOMY_CONFIG_DEFAULTS.repairAbandonWindowHours).toBe(48);
    expect(ECONOMY_CONFIG_DEFAULTS.repairListingExpiryDays).toBe(7);
    for (const key of [
      'repairWorkRateBase', 'repairMasterySpeedPerLevel', 'repairMasteryEfficiencyPerLevel',
      'serviceXpPerPoint', 'repairAbandonWindowHours', 'repairListingExpiryDays',
    ] as const) {
      expect(ECONOMY_CONFIG_KEYS[key]).toBeTruthy();
    }
  });
});
