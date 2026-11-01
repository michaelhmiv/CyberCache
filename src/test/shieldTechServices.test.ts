/**
 * Shield-tech services (migration 0044) — shipped-path tests through
 * the real write routes + InMemoryWriteStore (the mirror of the 0044
 * SQL; the SQL itself is exercised against embedded Postgres in the
 * slice verification harness, incl. the economy-metrics panel).
 *
 * Michael's rulings under test:
 *  - R8 (DECISIONS.md): recalibrating a Legendary shield DOWN to
 *    Standard is BANNED — a hard refusal at the route AND content
 *    layers; the legality rule IS the generation rule (a target is
 *    legal iff its SHIELD_BEHAVIOR_WEIGHTS entry for the rarity > 0).
 *  - NO NPC shield tech, OPEN MARKET ONLY: a public board; owners
 *    escrow the full price up front; terms fixed at posting.
 *  - CORE MODEL: the tech supplies the Calibration Cores on board
 *    jobs (price = cores + labor); the self-lane burns your own.
 *  - The FLIP follows the work: payload.behavior changes only at
 *    100% completion, rebased through the generation transform
 *    (Turtle un-bakes / re-bakes); partial, abandoned, cancelled and
 *    expired jobs leave the shield bit-identical to posting, and a
 *    payload that drifted under the job refuses the flip while the
 *    money still settles.
 *  - Money follows the repair rule: every terminal state pays
 *    floor(price × points_done / target) minus the shared market fee
 *    (destroyed); XP = shieldTechXpPerPoint (0.25) per point actually
 *    calibrated, partials included; mastery trains at ceil(points/10)
 *    into services.shield_tech.
 *  - Guests cannot post/accept (market account gating); the
 *    self-lane stays open (consumption, like self-repair).
 *  - Recalibration writes NO collection discoveries.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_CRAFT_RECIPES } from '../content/crafting';
import { getConsumableRuntimeEffects } from '../constants/consumables';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import {
  isLegalShieldTechTarget,
  legalShieldTechTargets,
  rebasedShieldPayload,
} from '../content/shieldTech';
import { SHIELD_BEHAVIOR_WEIGHTS } from '../lib/combat/shieldBehaviors';
import type { Rarity } from '../types/game';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const T0 = new Date('2026-11-01T12:00:00.000Z').getTime();
let clockMs = T0;

const OWNER = '11111111-1111-4111-8111-111111111111';
const TECH = '22222222-2222-4222-8222-222222222222';
const BROKE = '55555555-5555-4555-8555-555555555555';
const GUEST = '44444444-4444-4444-8444-444444444444';

const SH_NOVA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const SH_LEGENDARY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const SH_TURTLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const SH_LEGACY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const SH_SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const SH_PARTIAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const SH_GUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
const SH_CANCEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8';

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

function shieldItem(
  id: string,
  owner: string,
  rarity: string,
  payload: Record<string, unknown>,
): WriteItemData {
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

function coreBatch(id: string, owner: string, quality: number, quantity: number) {
  return {
    id, owner_user_id: owner, consumable_type: 'CalibrationCore', quality_percent: quality,
    quantity, origin: 'crafted', creator_user_id: owner, source_recipe_id: null, metadata: {},
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteSeed['consumableBatches'][number];
}

function seed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({ id: OWNER, credits: 50_000, consumables: { CalibrationCore: 3 } }),
    profile({ id: TECH, credits: 500, consumables: { CalibrationCore: 8 } }),
    profile({ id: BROKE, credits: 50_000, consumables: {} }),
    profile({ id: GUEST, account_type: 'guest', email_verified_at: null, credits: 50_000, consumables: { CalibrationCore: 2 } }),
  ];
  s.items = [
    shieldItem(SH_NOVA, OWNER, 'Rare', { behavior: 'nova', hp: 3000, rechargeRate: 12.0, name: 'Nova Aegis' }),
    shieldItem(SH_LEGENDARY, OWNER, 'Legendary', { behavior: 'nova', hp: 5200, rechargeRate: 10.0 }),
    shieldItem(SH_TURTLE, OWNER, 'Epic', { behavior: 'turtle', hp: 4500, rechargeRate: 6.0 }),
    shieldItem(SH_LEGACY, OWNER, 'Common', { hp: 2000, rechargeRate: 10.0 }),
    shieldItem(SH_SELF, OWNER, 'Rare', { behavior: 'absorb', hp: 3000, rechargeRate: 11.0 }),
    shieldItem(SH_PARTIAL, OWNER, 'Rare', { behavior: 'amp', hp: 3000, rechargeRate: 9.0 }),
    shieldItem(SH_GUEST, GUEST, 'Rare', { behavior: 'amp', hp: 1500, rechargeRate: 9.0 }),
    shieldItem(SH_CANCEL, OWNER, 'Rare', { behavior: 'amp', hp: 2000, rechargeRate: 8.0 }),
  ];
  s.consumableBatches = [
    coreBatch('batch-o1', OWNER, 100, 3),
    coreBatch('batch-t1', TECH, 100, 8),
    coreBatch('batch-g1', GUEST, 100, 2),
  ];
  return s;
}

interface Harness { store: InMemoryWriteStore; base: string; close: () => Promise<void>; tokens: Record<string, string> }
let h: Harness;
let nonceN = 0;
const nonce = () => `shieldtech-nonce-${++nonceN}-abcdefgh`;

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
  for (const id of [OWNER, TECH, BROKE, GUEST]) tokens[id] = issueAccessToken(SECRET, id, id === GUEST);
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
  const res = await fetch(`${h.base}/api/shieldtech/board`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const prof = (id: string) => h.store.seed.profiles.find((p) => p.id === id)!;
const item = (id: string) => h.store.seed.items.find((i) => i.id === id)!;
const payloadOf = (id: string) => item(id).payload as unknown as Record<string, unknown>;
const advance = (ms: number) => { clockMs += ms; };
const setAction = (token: string, kind: string, targetId?: string) =>
  post('/api/activity/set', token, {
    nonce: nonce(), activity_kind: kind,
    ...(targetId ? { target_type: 'workshop_job', target_id: targetId } : {}),
    activity_payload: {}, public_payload: {},
  });
const HOUR = 3600_000;

describe('migration 0044 — catalog + consumable parity pins', () => {
  it('the restated SQL catalog deep-equals the TS catalog (59 recipes)', () => {
    const sql = readFileSync(
      join(process.cwd(), 'db', 'migrations', '0044_shield_tech_services.sql'),
      'utf8',
    );
    const parts = sql.split('$catalog$');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const catalog = JSON.parse(parts[1]) as Array<Record<string, unknown>>;
    expect(catalog).toHaveLength(59);
    expect(catalog.map((r) => r.id).sort()).toEqual(ALL_CRAFT_RECIPES.map((r) => r.id).sort());
    // The slice's own recipe matches the TS catalog field for field.
    const ts = ALL_CRAFT_RECIPES.find((r) => r.id === 'recipe_calibration_core')!;
    const entry = catalog.find((r) => r.id === 'recipe_calibration_core')!;
    expect(entry).toEqual(JSON.parse(JSON.stringify(ts)));
    // Nothing from 0038/0043 was dropped by the restatement.
    expect(catalog.find((r) => r.id === 'recipe_patch_kit_batch')?.requiresResearch)
      .toBe('production_systems');
    expect(catalog.filter((r) => r.requiresStanding)).toHaveLength(6);
  });

  it('CalibrationCore runtime effects carry the 2,500-point capacity, quality-scaled', () => {
    expect(getConsumableRuntimeEffects('CalibrationCore', 100).calibrationPoints).toBe(2500);
    expect(getConsumableRuntimeEffects('CalibrationCore', 150).calibrationPoints).toBe(3750);
    expect(getConsumableRuntimeEffects('CalibrationCore', 75).calibrationPoints).toBe(1875);
  });
});

describe('legality — the generation rule IS the service rule (R8)', () => {
  it('matches SHIELD_BEHAVIOR_WEIGHTS over the full rarity × behavior matrix', () => {
    const rarities = Object.keys(SHIELD_BEHAVIOR_WEIGHTS) as Rarity[];
    for (const rarity of rarities) {
      for (const target of ['standard', 'nova', 'absorb', 'amp', 'turtle'] as const) {
        expect(isLegalShieldTechTarget(rarity, target)).toBe(SHIELD_BEHAVIOR_WEIGHTS[rarity][target] > 0);
      }
    }
    // The one banned cell in the matrix, named outright:
    expect(isLegalShieldTechTarget('Legendary', 'standard')).toBe(false);
    expect(legalShieldTechTargets('Legendary', 'nova')).not.toContain('standard');
    expect(legalShieldTechTargets('Common', 'nova')).toContain('standard');
  });

  it('rebased payloads un-bake and re-bake the Turtle transform exactly', () => {
    const turtle = { behavior: 'turtle', hp: 4500, rechargeRate: 6.0, affixes: [1] };
    expect(rebasedShieldPayload(turtle, 'nova')).toEqual({ behavior: 'nova', hp: 3000, rechargeRate: 12.0, affixes: [1] });
    const nova = { behavior: 'nova', hp: 3000, rechargeRate: 12.0 };
    expect(rebasedShieldPayload(nova, 'turtle')).toEqual({ behavior: 'turtle', hp: 4500, rechargeRate: 6.0 });
    // Non-Turtle swaps change nothing but the behavior field.
    expect(rebasedShieldPayload(nova, 'amp')).toEqual({ behavior: 'amp', hp: 3000, rechargeRate: 12.0 });
    // A legacy shield with no baked stats gains just the behavior field.
    expect(rebasedShieldPayload({ hp: 2000, rechargeRate: 10.0 }, 'turtle'))
      .toEqual({ behavior: 'turtle', hp: 3000, rechargeRate: 5.0 });
  });
});

describe('shield-tech board — escrow lifecycle through the shipped routes', () => {
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('R8: posting a Legendary shield for Standard recalibration is refused', async () => {
    const res = await post('/api/ops/shieldtech-post', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_LEGENDARY, to_behavior: 'standard', price_credits: 5000,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toContain('Legendary shields cannot be recalibrated to Standard');
    expect(item(SH_LEGENDARY).runtime_state).toBe('available');
    expect(prof(OWNER).credits).toBe(50_000);
  });

  it('guests cannot post or accept; the self-lane stays open to them', async () => {
    // The route layer refuses guests on player-economy ops (403),
    // before the store's own verified-account gate is reached.
    const postRes = await post('/api/ops/shieldtech-post', h.tokens[GUEST], {
      nonce: nonce(), item_id: SH_GUEST, to_behavior: 'nova', price_credits: 100,
    });
    expect(postRes.status).toBe(403);
    expect(item(SH_GUEST).runtime_state).toBe('available');
    // Consumption stays open: a guest recalibrates their OWN shield
    // with their OWN cores on the self-lane.
    const enq = await post('/api/ops/shieldtech-enqueue', h.tokens[GUEST], {
      nonce: nonce(), item_id: SH_GUEST, to_behavior: 'nova',
    });
    expect(enq.status).toBe(200);
    expect(prof(GUEST).consumables.CalibrationCore).toBe(1); // 1,500 pts ≤ one core
  });

  it('post escrows the full price and locks the shield in service; the board shows the swap', async () => {
    const res = await post('/api/ops/shieldtech-post', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_NOVA, to_behavior: 'amp', price_credits: 9000,
    });
    expect(res.status).toBe(200);
    const jobId = (res.json.job as Record<string, unknown>).id as string;
    expect(prof(OWNER).credits).toBe(41_000);
    expect(item(SH_NOVA).runtime_state).toBe('in_service');
    expect(item(SH_NOVA).is_locked).toBe(true);

    const view = await board(h.tokens[TECH]);
    expect(view.status).toBe(200);
    const listing = (view.json.open as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(listing).toBeTruthy();
    expect(listing.targetPoints).toBe(3000); // the stored capacity IS the work size
    expect(listing.priceCredits).toBe(9000);
    expect(listing.fromBehavior).toBe('nova');
    expect(listing.fromBehaviorName).toBe('Nova');
    expect(listing.toBehavior).toBe('amp');
    expect(listing.toBehaviorName).toBe('Amp');
    expect(String(listing.fromBehaviorDescription)).toContain('erupts');
    expect(String(listing.toBehaviorDescription)).toContain('damage is increased');
    // 3,000 points at the reader's untrained efficiency: 2 cores.
    expect(listing.estimatedCoresForReader).toBe(2);
    expect(view.json.medianPerThousandByRarity).toEqual({});

    // State discipline: an in-service shield cannot be listed or salvaged.
    const listRes = await post('/api/ops/market-create', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_NOVA, price_credits: 100,
    });
    expect(listRes.status).toBe(400);
    const repost = await post('/api/ops/shieldtech-post', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_NOVA, to_behavior: 'turtle', price_credits: 100,
    });
    expect(repost.status).toBe(409); // state conflict at the wire
  });

  it('nonce replay returns the stored post and escrows once', async () => {
    const n = nonce();
    const body = { nonce: n, item_id: SH_CANCEL, to_behavior: 'nova', price_credits: 700 };
    const first = await post('/api/ops/shieldtech-post', h.tokens[OWNER], body);
    const creditsAfterFirst = prof(OWNER).credits;
    const second = await post('/api/ops/shieldtech-post', h.tokens[OWNER], body);
    expect(second.status).toBe(200);
    expect((second.json.job as Record<string, unknown>).id).toBe((first.json.job as Record<string, unknown>).id);
    expect(prof(OWNER).credits).toBe(creditsAfterFirst);
    // Clean up the listing for later tests.
    const cancel = await post('/api/ops/shieldtech-cancel', h.tokens[OWNER], {
      nonce: nonce(), job_id: (first.json.job as Record<string, unknown>).id as string,
    });
    expect(cancel.status).toBe(200);
    expect(prof(OWNER).credits).toBe(creditsAfterFirst + 700);
    expect(item(SH_CANCEL).runtime_state).toBe('available');
  });

  it('self-accept and coreless accept are refused', async () => {
    const view = await board(h.tokens[OWNER]);
    const jobId = (view.json.mine as Array<Record<string, unknown>>).find((j) => j.status === 'listed')!.id as string;
    const selfAccept = await post('/api/ops/shieldtech-accept', h.tokens[OWNER], { nonce: nonce(), job_id: jobId });
    expect(selfAccept.status).toBe(403); // ownership refusal at the wire
    expect(JSON.stringify(selfAccept.json)).toContain('Cannot accept own job');
    const brokeAccept = await post('/api/ops/shieldtech-accept', h.tokens[BROKE], { nonce: nonce(), job_id: jobId });
    expect(brokeAccept.status).toBe(400);
    expect(JSON.stringify(brokeAccept.json)).toContain('No CalibrationCore available');
    const guestAccept = await post('/api/ops/shieldtech-accept', h.tokens[GUEST], { nonce: nonce(), job_id: jobId });
    expect(guestAccept.status).toBe(403);
  });

  it('work accrues only while the tech targets the job; cores burn worst-first at quality × efficiency', async () => {
    const view0 = await board(h.tokens[OWNER]);
    const jobId = (view0.json.mine as Array<Record<string, unknown>>).find((j) => j.status === 'listed')!.id as string;
    const accepted = await post('/api/ops/shieldtech-accept', h.tokens[TECH], { nonce: nonce(), job_id: jobId });
    expect(accepted.status).toBe(200);
    const snap = (accepted.json.job as Record<string, unknown>).shieldtech_snapshot as Record<string, unknown>;
    // Untrained snapshot: 500 pts/h, efficiency 1.0.
    expect(snap.workRatePointsPerHour).toBe(500);
    expect(snap.efficiency).toBe(1);

    // Two hours roaming: nothing accrues, no cores burn.
    await setAction(h.tokens[TECH], 'roaming_loot');
    advance(2 * HOUR);
    let view = await board(h.tokens[TECH]);
    let job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.pointsCalibrated).toBe(0);
    expect((job.kitsConsumed as unknown[]).length).toBe(0);

    // Two hours on the job: 1,000 points from the first core.
    await setAction(h.tokens[TECH], 'workshop_service', jobId);
    advance(2 * HOUR);
    view = await board(h.tokens[TECH]);
    job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.pointsCalibrated).toBe(1000);
    const consumed = job.kitsConsumed as Array<Record<string, unknown>>;
    expect(consumed.length).toBe(1);
    expect(consumed[0].kitType).toBe('CalibrationCore');
    expect(consumed[0].pointsApplied).toBe(1000);
    expect(prof(TECH).consumables.CalibrationCore).toBe(7);
  });

  it('completion flips the shield, pays in full minus the destroyed fee, grants 0.25 XP/pt and mastery', async () => {
    const view0 = await board(h.tokens[TECH]);
    const jobId = (view0.json.work as Array<Record<string, unknown>>)[0].id as string;
    const techCreditsBefore = prof(TECH).credits;
    const discoveriesBefore = h.store.seed.discoveries?.length ?? 0;
    advance(4 * HOUR); // the remaining 2,000 points
    const view = await board(h.tokens[TECH]);
    const job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.status).toBe('completed');
    expect(job.outcome).toBe('completed');
    expect(job.pointsCalibrated).toBe(3000);
    expect(job.paidCredits).toBe(9000);
    expect(job.feeCredits).toBe(450); // floor(9000 × 5%), destroyed
    expect(job.xpAwarded).toBe(750); // round(3000 × 0.25)
    expect(job.flipApplied).toBe(true);
    expect(prof(TECH).credits).toBe(techCreditsBefore + 9000 - 450);
    expect(payloadOf(SH_NOVA).behavior).toBe('amp');
    expect(payloadOf(SH_NOVA).hp).toBe(3000);
    expect(payloadOf(SH_NOVA).rechargeRate).toBe(12.0);
    expect(item(SH_NOVA).runtime_state).toBe('available');
    expect(item(SH_NOVA).is_locked).toBe(false);
    const mastery = h.store.seed.masteries.find((m) => m.user_id === TECH && m.mastery_id === 'services.shield_tech');
    expect(mastery?.mastery_xp).toBe(300); // ceil(3000 / 10)
    expect(h.store.seed.discoveries?.length ?? 0).toBe(discoveriesBefore);
    // Board stats: the completed job prices the Rare band median.
    const stats = view.json.stats as Record<string, unknown>;
    expect(stats.myJobsCompleted).toBe(1);
    expect((view.json.medianPerThousandByRarity as Record<string, unknown>).Rare).toBe(3000);
  });

  it('Turtle → Nova un-bakes the stored stats at the flip', async () => {
    const res = await post('/api/ops/shieldtech-post', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_TURTLE, to_behavior: 'nova', price_credits: 4500,
    });
    const jobId = (res.json.job as Record<string, unknown>).id as string;
    await post('/api/ops/shieldtech-accept', h.tokens[TECH], { nonce: nonce(), job_id: jobId });
    await setAction(h.tokens[TECH], 'workshop_service', jobId);
    // 4,500 points at ~510 pts/h ≈ 9h of work; the away cap settles
    // at most ~4h per read, so advance in chunks with reads between.
    advance(4 * HOUR);
    await board(h.tokens[TECH]);
    advance(4 * HOUR);
    await board(h.tokens[TECH]);
    advance(4 * HOUR);
    const view = await board(h.tokens[TECH]);
    const job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.status).toBe('completed');
    expect(payloadOf(SH_TURTLE).behavior).toBe('nova');
    expect(payloadOf(SH_TURTLE).hp).toBe(3000);
    expect(payloadOf(SH_TURTLE).rechargeRate).toBe(12.0);
  });

  it('a legacy shield with no behavior field recalibrates and gains the field', async () => {
    const res = await post('/api/ops/shieldtech-post', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_LEGACY, to_behavior: 'turtle', price_credits: 2000,
    });
    expect(res.status).toBe(200);
    const jobId = (res.json.job as Record<string, unknown>).id as string;
    await post('/api/ops/shieldtech-accept', h.tokens[TECH], { nonce: nonce(), job_id: jobId });
    await setAction(h.tokens[TECH], 'workshop_service', jobId);
    advance(8 * HOUR);
    const view = await board(h.tokens[TECH]);
    const job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.status).toBe('completed');
    expect(payloadOf(SH_LEGACY).behavior).toBe('turtle');
    expect(payloadOf(SH_LEGACY).hp).toBe(3000); // 2000 × 1.5 re-baked
    expect(payloadOf(SH_LEGACY).rechargeRate).toBe(5.0);
  });

  it('partial delivery pays pro-rata, refunds the rest, and never flips', async () => {
    const res = await post('/api/ops/shieldtech-post', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_PARTIAL, to_behavior: 'nova', price_credits: 6000,
    });
    const jobId = (res.json.job as Record<string, unknown>).id as string;
    await post('/api/ops/shieldtech-accept', h.tokens[TECH], { nonce: nonce(), job_id: jobId });
    await setAction(h.tokens[TECH], 'workshop_service', jobId);
    advance(1 * HOUR);
    let view = await board(h.tokens[TECH]);
    let job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    const done = job.pointsCalibrated as number;
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(3000);
    const ownerBefore = prof(OWNER).credits;
    const finish = await post('/api/ops/shieldtech-finish', h.tokens[TECH], { nonce: nonce(), job_id: jobId });
    expect(finish.status).toBe(200);
    view = await board(h.tokens[TECH]);
    job = (view.json.work as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    const expectedPaid = Math.floor((6000 * done) / 3000);
    expect(job.outcome).toBe('delivered_partial');
    expect(job.paidCredits).toBe(expectedPaid);
    expect(job.xpAwarded).toBe(Math.round(done * 0.25));
    expect(job.flipApplied).toBe(false);
    expect(prof(OWNER).credits).toBe(ownerBefore + (6000 - expectedPaid));
    expect(payloadOf(SH_PARTIAL).behavior).toBe('amp'); // untouched
    expect(item(SH_PARTIAL).runtime_state).toBe('available');
  });

  it('an expired listing refunds in full and releases the shield untouched', async () => {
    const res = await post('/api/ops/shieldtech-post', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_PARTIAL, to_behavior: 'turtle', price_credits: 3000,
    });
    const jobId = (res.json.job as Record<string, unknown>).id as string;
    const ownerBefore = prof(OWNER).credits;
    advance(8 * 24 * HOUR); // past the 7-day listing expiry
    const view = await board(h.tokens[OWNER]);
    const job = (view.json.mine as Array<Record<string, unknown>>).find((j) => j.id === jobId)!;
    expect(job.outcome).toBe('expired');
    expect(prof(OWNER).credits).toBe(ownerBefore + 3000);
    expect(item(SH_PARTIAL).runtime_state).toBe('available');
    expect(payloadOf(SH_PARTIAL).behavior).toBe('amp');
  });
});

describe('self-lane recalibration — a timed job on the craft machinery', () => {
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('R8: the self-lane refuses Legendary → Standard too', async () => {
    const res = await post('/api/ops/shieldtech-enqueue', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_LEGENDARY, to_behavior: 'standard',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toContain('Legendary shields cannot be recalibrated to Standard');
  });

  it('enqueue escrows exactly the cores whose capacity covers the target', async () => {
    const res = await post('/api/ops/shieldtech-enqueue', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_SELF, to_behavior: 'nova',
    });
    expect(res.status).toBe(200);
    const job = res.json.job as Record<string, unknown>;
    expect(job.kind).toBe('shieldtech');
    // 3,000 points: core 1 carries 2,500, core 2 covers the rest.
    expect(job.unitsTotal ?? job.units_total).toBe(2);
    expect(job.unitDurationMs).toBe(18_000_000); // 2500 ÷ 500 pts/h
    expect(prof(OWNER).consumables.CalibrationCore).toBe(1);
    expect(payloadOf(SH_SELF).behavior).toBe('absorb'); // nothing applied yet
  });

  it('units apply over Workshop Service time; the flip lands at full coverage with no player XP', async () => {
    const wsRes = await fetch(`${h.base}/api/workshop/me`, { headers: { authorization: `Bearer ${h.tokens[OWNER]}` } });
    const wsJson = (await wsRes.json()) as Record<string, unknown>;
    const job = (wsJson.jobs as Array<Record<string, unknown>>).find((j) => j.kind === 'shieldtech')!;
    await setAction(h.tokens[OWNER], 'workshop_service', job.id as string);
    // One unit = 5h of work; the away cap settles ~4h per read, so
    // advance in chunks (4h + 2h) with reads between.
    advance(4 * HOUR);
    await fetch(`${h.base}/api/workshop/me`, { headers: { authorization: `Bearer ${h.tokens[OWNER]}` } });
    advance(2 * HOUR);
    const ws2 = await fetch(`${h.base}/api/workshop/me`, { headers: { authorization: `Bearer ${h.tokens[OWNER]}` } });
    const ws2Json = (await ws2.json()) as Record<string, unknown>;
    let mine = (ws2Json.jobs as Array<Record<string, unknown>>).find((j) => j.id === job.id)!;
    expect(mine.unitsCompleted).toBe(1);
    expect(payloadOf(SH_SELF).behavior).toBe('absorb'); // 2,500 of 3,000 — no flip yet

    advance(4 * HOUR);
    const ws3 = await fetch(`${h.base}/api/workshop/me`, { headers: { authorization: `Bearer ${h.tokens[OWNER]}` } });
    const ws3Json = (await ws3.json()) as Record<string, unknown>;
    mine = (ws3Json.jobs as Array<Record<string, unknown>>).find((j) => j.id === job.id)!;
    expect(mine.state).toBe('complete');
    expect(payloadOf(SH_SELF).behavior).toBe('nova');
    expect(payloadOf(SH_SELF).hp).toBe(3000);
    expect(prof(OWNER).player_xp).toBe(0); // consumption pays no player XP
    const mastery = h.store.seed.masteries.find((m) => m.user_id === OWNER && m.mastery_id === 'services.shield_tech');
    expect(mastery?.mastery_xp).toBe(500); // per-unit ceil(points/10): two full 2,500-point cores → 250 + 250
  });

  it('cancel refunds every unstarted core whole', async () => {
    const res = await post('/api/ops/shieldtech-enqueue', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_CANCEL, to_behavior: 'nova',
    });
    expect(res.status).toBe(200);
    const job = res.json.job as Record<string, unknown>;
    expect(prof(OWNER).consumables.CalibrationCore).toBe(0); // the last core escrowed (2000 pts ≤ 2500)
    const cancel = await post('/api/ops/craft-cancel', h.tokens[OWNER], {
      nonce: nonce(), job_id: job.id as string,
    });
    expect(cancel.status).toBe(200);
    expect(prof(OWNER).consumables.CalibrationCore).toBe(1);
    expect(payloadOf(SH_CANCEL).behavior).toBe('amp');
  });

  it('enqueue refuses when the owner\u2019s cores cannot cover the target', async () => {
    // OWNER now holds exactly 1 core (2,500 points) — SH_NOVA needs 3,000.
    const res = await post('/api/ops/shieldtech-enqueue', h.tokens[OWNER], {
      nonce: nonce(), item_id: SH_NOVA, to_behavior: 'amp',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toContain('Not enough Calibration Core capacity');
    expect(prof(OWNER).consumables.CalibrationCore).toBe(1); // nothing consumed by the refusal
  });
});
