/**
 * Crafting-as-occupation (migration 0024) — shipped-path tests for the
 * server job model, through the real write routes + InMemoryWriteStore
 * (the mirror of the 0024 SQL; the SQL itself is exercised against
 * embedded Postgres in the slice verification harness).
 *
 * Covered (brief §2.12): escrow exactness (per-unit), settle only while
 * crafting holds the action slot, pause at exact accrued values on
 * activity transition, per-bench queue order + capacity, the cancel
 * refund table, rush-ticket escrow/burn/refund, bench unlock charges +
 * refusals, gear frames through the shared generators (Epic ceiling,
 * no legendaryEffectId, crafted provenance), refining yields, guest
 * gating, cross-player forgery, body-supplied outcome fields ignored,
 * and nonce replay.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const T0 = new Date('2026-10-31T12:00:00.000Z').getTime();
let clockMs = T0;

const P = '11111111-1111-4111-8111-111111111111'; // verified crafter, L25
const POOR = '22222222-2222-4222-8222-222222222222'; // verified, L1, broke
const GUEST = '44444444-4444-4444-8444-444444444444';

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'crafter', display_name: null, player_level: 25, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'crafter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function seed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({
      id: P,
      materials: { ScrapAlloy: 1000, ReactiveComponents: 1000, BallisticParts: 500, TechFragments: 500, VoidDust: 100, RefinedAlloy: 50, TemperedParts: 50, ForgeheartIngots: 50 },
      consumables: { WorkshopRushTicket: 1 },
    }),
    profile({ id: POOR, player_level: 1, credits: 100, materials: {} }),
    profile({ id: GUEST, account_type: 'guest', email_verified_at: null, materials: { ScrapAlloy: 1000, ReactiveComponents: 1000 } }),
  ];
  s.consumableBatches = [{
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', owner_user_id: P,
    consumable_type: 'WorkshopRushTicket', quantity: 1, quality_percent: 100,
    origin: 'vendor', creator_user_id: null, source_recipe_id: null,
    created_at: '2026-10-30T00:00:00.000Z', updated_at: '2026-10-30T00:00:00.000Z',
  } as WriteSeed['consumableBatches'][number]];
  return s;
}

interface Harness { store: InMemoryWriteStore; base: string; close: () => Promise<void>; tokens: Record<string, string> }
let h: Harness;
let nonceN = 0;
const nonce = () => `craft-nonce-${++nonceN}-abcdefgh`;

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
  for (const id of [P, POOR, GUEST]) tokens[id] = issueAccessToken(SECRET, id, id === GUEST);
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
async function get(path: string, token: string) {
  const res = await fetch(`${h.base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const prof = (id: string) => h.store.seed.profiles.find((p) => p.id === id)!;
const advance = (ms: number) => { clockMs += ms; };
const setAction = (kind: string) =>
  post('/api/activity/set', h.tokens[P], { nonce: nonce(), activity_kind: kind, activity_payload: {}, public_payload: {} });

describe('crafting occupation — job model through the shipped routes', () => {
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('enqueue escrows the full per-unit inputs atomically', async () => {
    const before = { ...prof(P).materials };
    const res = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 2,
    });
    expect(res.status).toBe(200);
    // MedKit = 15 ScrapAlloy + 8 ReactiveComponents PER UNIT (brief §2.1).
    expect(prof(P).materials.ScrapAlloy).toBe(before.ScrapAlloy - 30);
    expect(prof(P).materials.ReactiveComponents).toBe(before.ReactiveComponents - 16);
    const view = await get('/api/workshop/me', h.tokens[P]);
    const job = view.json.jobs.find((j: { recipeId: string }) => j.recipeId === 'recipe_medkit');
    expect(job).toBeTruthy();
    expect(job.unitsTotal).toBe(2);
    expect(job.unitDurationMs).toBe(12 * 60 * 1000);
  });

  it('jobs do not progress while crafting is not the active action', async () => {
    advance(60 * 60 * 1000); // an hour passes on standby
    const view = await get('/api/workshop/me', h.tokens[P]);
    const job = view.json.jobs.find((j: { recipeId: string }) => j.recipeId === 'recipe_medkit');
    expect(job.unitsCompleted).toBe(0);
    expect(prof(P).consumables.MedKit ?? 0).toBe(0);
  });

  it('units complete individually while crafting, paying XP at the pegged rate', async () => {
    const xpBefore = prof(P).player_xp;
    await setAction('crafting');
    advance(12 * 60 * 1000 + 1000);
    const view = await get('/api/workshop/me', h.tokens[P]);
    const job = view.json.jobs.find((j: { recipeId: string }) => j.recipeId === 'recipe_medkit');
    expect(job.unitsCompleted).toBe(1);
    expect(prof(P).consumables.MedKit).toBe(1);
    // L25 MedKit (12 min): round(0.2h × 1200 ticks × 2.4 xp/tick × 0.775) = 446.
    expect(job.xpAwarded).toBe(446);
    expect(prof(P).player_xp - xpBefore).toBe(446);
    // The crafted batch carries the rolled quality (rng 0.5 → mid-bounds 100).
    const batch = h.store.seed.consumableBatches.find(
      (b) => b.owner_user_id === P && b.consumable_type === 'MedKit',
    );
    expect(batch?.origin).toBe('crafted');
    expect(batch?.quality_percent).toBe(100);
  });

  it('switching away pauses at the exact accrued value; returning resumes', async () => {
    advance(6 * 60 * 1000); // half of unit 2 accrues
    await setAction('roaming_loot'); // transition settles outgoing first
    advance(24 * 60 * 60 * 1000); // a day of roaming: zero craft progress
    let view = await get('/api/workshop/me', h.tokens[P]);
    let job = view.json.jobs.find((j: { recipeId: string }) => j.recipeId === 'recipe_medkit');
    expect(job.unitsCompleted).toBe(1);
    expect(job.state).toBe('paused');
    await setAction('crafting');
    advance(6 * 60 * 1000 + 1000); // the remaining half
    view = await get('/api/workshop/me', h.tokens[P]);
    job = view.json.jobs.find((j: { recipeId: string }) => j.recipeId === 'recipe_medkit');
    expect(job.state).toBe('complete');
    expect(job.unitsCompleted).toBe(2);
    expect(prof(P).consumables.MedKit).toBe(2);
    expect(view.json.recentCompletions.filter((c: { recipeId: string }) => c.recipeId === 'recipe_medkit')).toHaveLength(2);
  });

  it('cancel refunds: completed kept, in-progress floor(50%), unstarted 100%', async () => {
    const res = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_shieldcell', units: 3,
    });
    expect(res.status).toBe(200);
    const jobId = (res.json.job.jobId ?? res.json.job.id) as string;
    const matsAfterEnqueue = { ...prof(P).materials };
    await setAction('crafting');
    advance(15 * 60 * 1000 + 60 * 1000); // unit 1 done (15m), 1m into unit 2
    const cancel = await post('/api/ops/craft-cancel', h.tokens[P], { nonce: nonce(), job_id: jobId });
    expect(cancel.status).toBe(200);
    // ShieldCell inputs 20 ScrapAlloy + 12 Reactive per unit.
    // Refund: in-progress floor(50%) = 10 + 6; unstarted 100% = 20 + 12.
    expect(prof(P).materials.ScrapAlloy - matsAfterEnqueue.ScrapAlloy).toBe(30);
    expect(prof(P).materials.ReactiveComponents - matsAfterEnqueue.ReactiveComponents).toBe(18);
    expect(prof(P).consumables.ShieldCell).toBe(1); // completed unit kept
  });

  it('rush ticket: escrowed + burned at start, shortens the snapshotted duration; refunded if cancelled before start', async () => {
    const res = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_ammo_pack', units: 1, use_rush_ticket: true,
    });
    expect(res.status).toBe(200);
    // Quality-100 ticket: timeReduction 0.20 → 10 min × 0.8 = 8 min.
    expect(res.json.job.unit_duration_ms ?? res.json.job.unitDurationMs).toBe(8 * 60 * 1000);
    expect(prof(P).consumables.WorkshopRushTicket ?? 0).toBe(0); // burned
    const jobId = (res.json.job.jobId ?? res.json.job.id) as string;
    const cancel = await post('/api/ops/craft-cancel', h.tokens[P], { nonce: nonce(), job_id: jobId });
    expect(cancel.status).toBe(200);
    expect(prof(P).consumables.WorkshopRushTicket).toBe(1); // refunded as a batch
  });

  it('bench unlock charges atomically and refuses the broke / under-level', async () => {
    const creditsBefore = prof(P).credits;
    const res = await post('/api/ops/craft-unlock-bench', h.tokens[P], { nonce: nonce(), bench: 2 });
    expect(res.status).toBe(200);
    expect(prof(P).credits).toBe(creditsBefore - 5000);
    expect(prof(P).workshop_benches).toBe(2);
    const poor = await post('/api/ops/craft-unlock-bench', h.tokens[POOR], { nonce: nonce(), bench: 2 });
    expect(poor.status).toBe(400);
    expect(prof(POOR).workshop_benches ?? 1).toBe(1);
  });

  it('gear frames generate through the shared generators with provenance; Legendary is refused', async () => {
    const bad = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: nonce(), bench: 1, recipe_id: 'frame_weapon', units: 1, rarity: 'Legendary',
    });
    expect(bad.status).toBe(400);
    const res = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: nonce(), bench: 1, recipe_id: 'frame_weapon', units: 1, rarity: 'Common',
    });
    expect(res.status).toBe(200);
    await setAction('crafting');
    advance(90 * 60 * 1000 + 1000);
    await get('/api/workshop/me', h.tokens[P]); // settle read drives completion
    const item = h.store.seed.items.find(
      (i) => i.owner_user_id === P && (i.payload as Record<string, unknown>).origin === 'crafted',
    );
    expect(item).toBeTruthy();
    expect(item!.rarity).toBe('Common');
    expect((item!.payload as Record<string, unknown>).craftedBy).toBe(P);
    expect('legendaryEffectId' in (item!.payload as Record<string, unknown>)).toBe(false);
  });

  it('refining converts at the mastery yield (10 in → 8 out at mastery 1)', async () => {
    const alloyBefore = prof(P).materials.ScrapAlloy;
    const refinedBefore = prof(P).materials.RefinedAlloy ?? 0;
    const res = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: nonce(), bench: 1, recipe_id: 'refine_refined_alloy', units: 1,
    });
    expect(res.status).toBe(200);
    await setAction('crafting');
    advance(20 * 60 * 1000 + 1000);
    await get('/api/workshop/me', h.tokens[P]);
    expect(prof(P).materials.ScrapAlloy).toBe(alloyBefore - 10);
    expect(prof(P).materials.RefinedAlloy).toBe(refinedBefore + 8);
  });

  it('forgery: body-supplied outcomes are ignored; other players cannot touch a job', async () => {
    const res = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1,
      // Forged fields — the route's input contract has no place for them:
      unit_duration_ms: 1, quality: 175, xp_awarded: 999999,
    });
    expect(res.status).toBe(200);
    expect(res.json.job.unit_duration_ms ?? res.json.job.unitDurationMs).toBe(12 * 60 * 1000);
    const jobId = (res.json.job.jobId ?? res.json.job.id) as string;
    const foreign = await post('/api/ops/craft-cancel', h.tokens[POOR], { nonce: nonce(), job_id: jobId });
    expect(foreign.status).toBe(404); // another player's job is simply not found
    const cancel = await post('/api/ops/craft-cancel', h.tokens[P], { nonce: nonce(), job_id: jobId });
    expect(cancel.status).toBe(200);
  });

  it('insufficient materials fails with NO partial deduction', async () => {
    const res = await post('/api/ops/craft-enqueue', h.tokens[POOR], {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1,
    });
    expect(res.status).toBe(400);
    expect(prof(POOR).materials).toEqual({});
  });

  it('guests craft fully (0046): enqueue escrows + the job completes for a guest', async () => {
    // Michael's ruling (2026-11-01): "Verified account shouldn't be
    // needed for crafting." Pre-0046 this enqueue was a 403
    // 'Verified account required'; the market gate is unchanged.
    const alloyBefore = prof(GUEST).materials.ScrapAlloy;
    const res = await post('/api/ops/craft-enqueue', h.tokens[GUEST], {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1,
    });
    expect(res.status).toBe(200);
    expect(prof(GUEST).materials.ScrapAlloy).toBe(alloyBefore - 15); // MedKit escrow, same as verified
    const setRes = await post('/api/activity/set', h.tokens[GUEST], {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    expect(setRes.status).toBe(200);
    advance(12 * 60 * 1000 + 1000);
    const view = await get('/api/workshop/me', h.tokens[GUEST]);
    const job = view.json.jobs.find((j: { recipeId: string }) => j.recipeId === 'recipe_medkit');
    expect(job.unitsCompleted).toBe(1);
    expect(prof(GUEST).consumables.MedKit).toBe(1);
  });

  it('nonce replay returns the prior result and never double-escrows', async () => {
    const n = nonce();
    const matsBefore = prof(P).materials.ScrapAlloy;
    const first = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: n, bench: 1, recipe_id: 'recipe_ammo_pack', units: 1,
    });
    const second = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: n, bench: 1, recipe_id: 'recipe_ammo_pack', units: 1,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json.job.jobId ?? second.json.job.id).toBe(first.json.job.jobId ?? first.json.job.id);
    expect(matsBefore - prof(P).materials.ScrapAlloy).toBe(10); // AmmoPack = 10 ScrapAlloy, once
    await post('/api/ops/craft-cancel', h.tokens[P], { nonce: nonce(), job_id: (first.json.job.jobId ?? first.json.job.id) as string });
  });

  it('per-bench capacity: 1 running + 5 queued, the 7th job is refused', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await post('/api/ops/craft-enqueue', h.tokens[P], {
        nonce: nonce(), bench: 2, recipe_id: 'recipe_ammo_pack', units: 1,
      });
      expect(res.status).toBe(200);
      ids.push((res.json.job.jobId ?? res.json.job.id) as string);
    }
    const seventh = await post('/api/ops/craft-enqueue', h.tokens[P], {
      nonce: nonce(), bench: 2, recipe_id: 'recipe_ammo_pack', units: 1,
    });
    expect(seventh.status).toBe(400);
    for (const id of ids) {
      await post('/api/ops/craft-cancel', h.tokens[P], { nonce: nonce(), job_id: id });
    }
  });
});
