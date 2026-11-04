/**
 * Econ 10 — bench time (economy redesign brief §8.2/§8.3/§8.7;
 * migration 0075). Shipped-path tests through the real write routes
 * + InMemoryWriteStore (the mirror of the 0075 SQL; the SQL itself
 * is exercised against real Postgres in the slice verification —
 * cybercache-prep/econ10-verification/).
 *
 * Covered: the content envelope rule + lever resolution; the bank
 * op (grant, cap clamp, cap refusal with the §8.2 remedy, nonce
 * replay, guest banking); the widened enqueue envelope (6 → 18,
 * tint gate in step); display state (3 running, extraLane tags);
 * and the drain — ONLY under extra-lane occupancy, exact to the
 * millisecond remainder, stopping at zero mid-job without killing
 * anything, with queued work finishing afterwards on baseline.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import {
  BENCH_TIME_BANK_CAP_SECONDS,
  BENCH_TIME_GRANT_SECONDS,
  benchEnvelope,
} from '../content/crafting';
import { resolveEconomyConfigValues } from '../server/economy/config';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const T0 = new Date('2026-11-04T12:00:00.000Z').getTime();
let clockMs = T0;

const P = '11111111-1111-4111-8111-111111111111'; // verified crafter
const GUEST = '44444444-4444-4444-8444-444444444444';

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'bencher', display_name: null, player_level: 25, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-11-04T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'bencher@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    bench_time_banked_seconds: 0, bench_time_remainder_ms: 0,
    ...over,
  } as ProfileRowData;
}

const RICH = { Scrap: 5000, ReactiveComponents: 5000, Chromaweave: 50 };

interface Harness {
  store: InMemoryWriteStore;
  base: string;
  close: () => Promise<void>;
  tokens: Record<string, string>;
}

async function makeServer(
  profiles: ProfileRowData[],
  opts: { craftLeverProvider?: () => Record<string, unknown> } = {},
): Promise<Harness> {
  clockMs = T0;
  const seed = emptyWriteSeed();
  seed.profiles = profiles;
  const store = new InMemoryWriteStore(seed, {
    now: () => new Date(clockMs),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
    ...(opts.craftLeverProvider
      ? { craftLeverProvider: opts.craftLeverProvider as never }
      : {}),
  });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((r) => server.on('listening', r));
  const { port } = server.address() as AddressInfo;
  const tokens: Record<string, string> = {};
  for (const p of profiles) tokens[p.id] = issueAccessToken(SECRET, p.id, p.account_type === 'guest');
  return { store, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())), tokens };
}

let nonceN = 0;
const nonce = () => `bench-nonce-${++nonceN}-abcdefgh`;

function client(h: Harness) {
  const post = async (path: string, token: string, payload: unknown) => {
    const res = await fetch(`${h.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  };
  const get = async (path: string, token: string) => {
    const res = await fetch(`${h.base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  };
  return { post, get };
}

/** Advance the clock in attended steps: heartbeat at the new time,
 *  then a workshop read to settle — the rhythm a live client keeps. */
async function attendedAdvance(h: Harness, token: string, totalMs: number, stepMs = 120_000) {
  const { post, get } = client(h);
  let left = totalMs;
  while (left > 0) {
    const step = Math.min(stepMs, left);
    clockMs += step;
    await post('/api/activity/heartbeat', token, {});
    await get('/api/workshop/me', token);
    left -= step;
  }
}

// ─── The content rule + levers ───────────────────────────────────────

describe('bench time — content rule and economy levers (§8.2/§8.3)', () => {
  it('pins the shipped figures: +1 h per ad, 24 h cap', () => {
    expect(BENCH_TIME_GRANT_SECONDS).toBe(3600);
    expect(BENCH_TIME_BANK_CAP_SECONDS).toBe(86_400);
  });

  it('benchEnvelope: baseline 1 + 5 + bonus; banked 3 + 15 + 3×bonus', () => {
    expect(benchEnvelope(0, 0)).toEqual({ running: 1, queued: 5, capacity: 6, wide: false });
    expect(benchEnvelope(0, 1)).toEqual({ running: 1, queued: 6, capacity: 7, wide: false });
    expect(benchEnvelope(3600, 0)).toEqual({ running: 3, queued: 15, capacity: 18, wide: true });
    expect(benchEnvelope(3600, 1)).toEqual({ running: 3, queued: 18, capacity: 21, wide: true });
    expect(benchEnvelope(1, 0).wide).toBe(true); // one second is a bank
  });

  it('the levers resolve with the content defaults; out-of-spec values reject to default', () => {
    const d = resolveEconomyConfigValues({});
    expect(d.benchTimeGrantSeconds).toBe(3600);
    expect(d.benchTimeBankCapSeconds).toBe(86_400);
    // In-spec stored values resolve; out-of-spec ones fall back to
    // the default — the registry's semantics for every lever (the
    // SQL ops clamp instead; both twins agree inside the spec).
    expect(resolveEconomyConfigValues({ benchTimeGrantSeconds: 7200 }).benchTimeGrantSeconds).toBe(7200);
    expect(resolveEconomyConfigValues({ benchTimeGrantSeconds: 999_999 }).benchTimeGrantSeconds).toBe(3600);
    expect(resolveEconomyConfigValues({ benchTimeBankCapSeconds: -5 }).benchTimeBankCapSeconds).toBe(86_400);
  });
});

// ─── The bank op ─────────────────────────────────────────────────────

describe('bench time — the bank op (cc_bank_bench_time)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer([
      profile({ id: P, materials: { ...RICH } }),
      profile({ id: GUEST, account_type: 'guest', email_verified_at: null, materials: { ...RICH } }),
    ]);
  });
  afterAll(async () => { await h.close(); });
  const prof = (id: string) => h.store.seed.profiles.find((p) => p.id === id)!;

  it('one attested ad banks exactly one hour; the result reports the bank', async () => {
    const { post } = client(h);
    const res = await post('/api/ops/bank-bench-time', h.tokens[P], {
      nonce: nonce(), ad_unit_id: 'ca-app-pub-test/bench',
    });
    expect(res.status).toBe(200);
    expect(res.json.action_type).toBe('cc_bank_bench_time');
    expect(res.json.granted_seconds).toBe(3600);
    expect(res.json.banked_seconds).toBe(3600);
    expect(res.json.bank_cap_seconds).toBe(86_400);
    expect(prof(P).bench_time_banked_seconds).toBe(3600);
  });

  it('nonce replay returns the recorded result and never double-grants', async () => {
    const { post } = client(h);
    const n = nonce();
    const first = await post('/api/ops/bank-bench-time', h.tokens[P], { nonce: n, ad_unit_id: 'u' });
    expect(first.json.banked_seconds).toBe(7200);
    const replay = await post('/api/ops/bank-bench-time', h.tokens[P], { nonce: n, ad_unit_id: 'u' });
    expect(replay.status).toBe(200);
    expect(replay.json.banked_seconds).toBe(7200);
    expect(prof(P).bench_time_banked_seconds).toBe(7200);
  });

  it('guests may bank bench time (§8.7 — banking is not transacting)', async () => {
    const { post } = client(h);
    const res = await post('/api/ops/bank-bench-time', h.tokens[GUEST], { nonce: nonce(), ad_unit_id: 'u' });
    expect(res.status).toBe(200);
    expect(res.json.banked_seconds).toBe(3600);
    expect(prof(GUEST).bench_time_banked_seconds).toBe(3600);
  });

  it('the workshop view carries the bank and the wide envelope', async () => {
    const { get } = client(h);
    const view = await get('/api/workshop/me', h.tokens[P]);
    expect(view.json.benchTime).toEqual({
      bankedSeconds: 7200, capSeconds: 86_400, grantSeconds: 3600,
      wideActive: true, runningLimit: 3, queueLimit: 15, capacity: 18,
    });
  });
});

describe('bench time — the 24 h cap', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer([profile({ id: P, materials: { ...RICH }, bench_time_banked_seconds: 86_400 - 1800 })]);
  });
  afterAll(async () => { await h.close(); });
  const prof = () => h.store.seed.profiles.find((p) => p.id === P)!;

  it('a grant that would pass the cap clamps at it and reports the real amount', async () => {
    const { post } = client(h);
    const res = await post('/api/ops/bank-bench-time', h.tokens[P], { nonce: nonce(), ad_unit_id: 'u' });
    expect(res.status).toBe(200);
    expect(res.json.granted_seconds).toBe(1800);
    expect(res.json.banked_seconds).toBe(86_400);
    expect(prof().bench_time_banked_seconds).toBe(86_400);
  });

  it('a full bank refuses with the §8.2 remedy and banks nothing', async () => {
    const { post } = client(h);
    const res = await post('/api/ops/bank-bench-time', h.tokens[P], { nonce: nonce(), ad_unit_id: 'u' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toContain('Bench time bank full — 24 h');
    expect(prof().bench_time_banked_seconds).toBe(86_400);
  });
});

describe('bench time — grant/cap levers move the op', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer([profile({ id: P, materials: { ...RICH } })], {
      craftLeverProvider: () => ({ benchTimeGrantSeconds: 1800, benchTimeBankCapSeconds: 3600 }),
    });
  });
  afterAll(async () => { await h.close(); });

  it('grant 1800 / cap 3600: two ads fill the bank, the third refuses', async () => {
    const { post } = client(h);
    const a = await post('/api/ops/bank-bench-time', h.tokens[P], { nonce: nonce(), ad_unit_id: 'u' });
    expect(a.json.banked_seconds).toBe(1800);
    const b = await post('/api/ops/bank-bench-time', h.tokens[P], { nonce: nonce(), ad_unit_id: 'u' });
    expect(b.json.banked_seconds).toBe(3600);
    const c = await post('/api/ops/bank-bench-time', h.tokens[P], { nonce: nonce(), ad_unit_id: 'u' });
    expect(c.status).toBe(400);
  });
});

// ─── The envelope at the gates ───────────────────────────────────────

describe('bench time — the enqueue envelope (baseline 6, banked 18)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer([profile({ id: P, materials: { ...RICH } })]);
  });
  afterAll(async () => { await h.close(); });

  const enqueue = async (token: string) => {
    const { post } = client(h);
    return post('/api/ops/craft-enqueue', token, {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1,
    });
  };

  it('baseline: six jobs fit, the seventh is refused', async () => {
    for (let i = 0; i < 6; i += 1) {
      expect((await enqueue(h.tokens[P])).status).toBe(200);
    }
    const seventh = await enqueue(h.tokens[P]);
    expect(seventh.status).toBe(400);
    expect(JSON.stringify(seventh.json)).toContain('Bench queue is full');
  });

  it('banked: the envelope widens to 18 total, the 19th is refused', async () => {
    const { post } = client(h);
    await post('/api/ops/bank-bench-time', h.tokens[P], { nonce: nonce(), ad_unit_id: 'u' });
    for (let i = 0; i < 12; i += 1) {
      expect((await enqueue(h.tokens[P])).status).toBe(200);
    }
    const nineteenth = await enqueue(h.tokens[P]);
    expect(nineteenth.status).toBe(400);
    expect(JSON.stringify(nineteenth.json)).toContain('Bench queue is full');
    const view = await client(h).get('/api/workshop/me', h.tokens[P]);
    expect(view.json.benchTime.capacity).toBe(18);
    expect(view.json.jobs.filter((j: { state: string }) => j.state !== 'complete')).toHaveLength(18);
  });

  it('display state: three running lanes, extra lanes tagged, the rest queued', async () => {
    const { post, get } = client(h);
    await post('/api/activity/set', h.tokens[P], {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    const view = await get('/api/workshop/me', h.tokens[P]);
    const active = view.json.jobs.filter((j: { state: string }) => j.state === 'running' || j.state === 'queued');
    expect(active.slice(0, 3).map((j: { state: string }) => j.state)).toEqual(['running', 'running', 'running']);
    expect(active[0].extraLane).toBe(false);
    expect(active[1].extraLane).toBe(true);
    expect(active[2].extraLane).toBe(true);
    expect(active[3].state).toBe('queued');
    expect(active[3].extraLane).toBe(false);
  });
});

describe('bench time — the tint gate widens in step (no Fixer bonus, as shipped)', () => {
  const ITEM_ID = '99999999-9999-4999-8999-999999999999';
  function tintSeed(banked: number): WriteSeed {
    const seed = emptyWriteSeed();
    seed.profiles = [profile({ id: P, materials: { ...RICH }, bench_time_banked_seconds: banked })];
    seed.items.push({
      id: ITEM_ID, owner_user_id: P, kind: 'cosmetic', static_item_id: null,
      item_level: 1, rarity: 'Common', quality: null, material_tier: null,
      condition_state: null, condition_current: null, condition_max: null,
      supply_mode: 'verified_action', source_id: null, creator_user_id: null,
      tradeable: true, account_bound: false, locked_until: null,
      payload: {
        name: 'Dreadplate Helm', partId: 'dread-head', slot: 'head', setId: 'dreadplate',
        tier: 'repaint', quality: 70, tintPaletteId: null, origin: 'crafted', craftedBy: P,
      },
      runtime_state: 'available', is_locked: false, equipped_slot: null,
      estimated_value: 100, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    } as never);
    return seed;
  }

  it('baseline: six generic jobs fill the bench and the tint is refused', async () => {
    const store = new InMemoryWriteStore(tintSeed(0), { rng: () => 0.5 });
    for (let i = 0; i < 6; i += 1) {
      await store.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 });
    }
    await expect(
      store.enqueueTintJob(P, nonce(), { itemId: ITEM_ID, paletteId: 'arctic' }),
    ).rejects.toThrow('Bench queue is full');
  });

  it('banked: the tint takes the 18th space; the 19th job is refused', async () => {
    const store = new InMemoryWriteStore(tintSeed(3600), { rng: () => 0.5 });
    for (let i = 0; i < 17; i += 1) {
      await store.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 });
    }
    const tinted = await store.enqueueTintJob(P, nonce(), { itemId: ITEM_ID, paletteId: 'arctic' });
    expect(tinted).toBeTruthy();
    await expect(
      store.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 }),
    ).rejects.toThrow('Bench queue is full');
  });
});

// ─── The drain ───────────────────────────────────────────────────────

describe('bench time — drain only under extra-lane occupancy (§8.3)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer([profile({ id: P, materials: { ...RICH }, bench_time_banked_seconds: 3600 })]);
  });
  afterAll(async () => { await h.close(); });
  const prof = () => h.store.seed.profiles.find((p) => p.id === P)!;
  const jobsOf = async () => {
    const view = await client(h).get('/api/workshop/me', h.tokens[P]);
    return view.json.jobs as Array<{ state: string; accruedMs: number; unitsCompleted: number; recipeId: string }>;
  };

  it('a single running job NEVER drains the bank', async () => {
    const { post } = client(h);
    await post('/api/ops/craft-enqueue', h.tokens[P], { nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1 });
    await post('/api/activity/set', h.tokens[P], {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    await attendedAdvance(h, h.tokens[P], 600_000); // 10 attended minutes
    const jobs = await jobsOf();
    expect(jobs[0].accruedMs).toBe(600_000);
    expect(prof().bench_time_banked_seconds).toBe(3600);
    expect(prof().bench_time_remainder_ms).toBe(0);
  });

  it('when the head completes mid-window, the queue refills the lanes — drain follows occupancy', async () => {
    const { post } = client(h);
    await post('/api/ops/craft-enqueue', h.tokens[P], { nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1 });
    await post('/api/ops/craft-enqueue', h.tokens[P], { nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1 });
    await attendedAdvance(h, h.tokens[P], 600_000); // 10 attended minutes
    const jobs = await jobsOf();
    expect(jobs[0].state).toBe('complete'); // finished 120 s into the window
    expect(jobs[1].accruedMs).toBe(600_000);
    expect(jobs[2].accruedMs).toBe(600_000);
    // Drain = extra-lane busy time, settle by settle: 240 s in the
    // first 120 s step (two extra lanes busy), then 120 s per step
    // once only two jobs remain (one extra lane) — 720 s total.
    // Lanes are positions the queue refills, not job identities.
    expect(prof().bench_time_banked_seconds).toBe(3600 - 720);
    expect(prof().bench_time_remainder_ms).toBe(0);
  });
});

describe('bench time — three fresh jobs drain two lanes’ worth', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer([profile({ id: P, materials: { ...RICH }, bench_time_banked_seconds: 3600 })]);
  });
  afterAll(async () => { await h.close(); });
  const prof = () => h.store.seed.profiles.find((p) => p.id === P)!;

  it('600 s with 3 concurrent jobs drains exactly 1200 s', async () => {
    const { post, get } = client(h);
    for (let i = 0; i < 3; i += 1) {
      await post('/api/ops/craft-enqueue', h.tokens[P], { nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1 });
    }
    await post('/api/activity/set', h.tokens[P], {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    await attendedAdvance(h, h.tokens[P], 600_000);
    const view = await get('/api/workshop/me', h.tokens[P]);
    const jobs = view.json.jobs as Array<{ accruedMs: number }>;
    expect(jobs.map((j) => j.accruedMs)).toEqual([600_000, 600_000, 600_000]);
    expect(prof().bench_time_banked_seconds).toBe(3600 - 1200);
    expect(prof().bench_time_remainder_ms).toBe(0);
    expect(view.json.benchTime.bankedSeconds).toBe(2400);
  });
});

describe('bench time — drain accounting is exact to the millisecond', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer([profile({ id: P, materials: { ...RICH }, bench_time_banked_seconds: 3600 })]);
  });
  afterAll(async () => { await h.close(); });
  const prof = () => h.store.seed.profiles.find((p) => p.id === P)!;

  it('a 1.5 s two-lane window banks 3,598 s + a 500 ms remainder', async () => {
    const { post, get } = client(h);
    await post('/api/ops/craft-enqueue', h.tokens[P], { nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1 });
    await post('/api/ops/craft-enqueue', h.tokens[P], { nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1 });
    await post('/api/activity/set', h.tokens[P], {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    clockMs += 1500;
    await post('/api/activity/heartbeat', h.tokens[P], {});
    await get('/api/workshop/me', h.tokens[P]);
    expect(prof().bench_time_banked_seconds).toBe(3598);
    expect(prof().bench_time_remainder_ms).toBe(500);
  });
});

describe('bench time — the bank empties mid-job: nothing dies (§8.3 edges)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeServer([profile({ id: P, materials: { ...RICH }, bench_time_banked_seconds: 60 })]);
  });
  afterAll(async () => { await h.close(); });
  const prof = () => h.store.seed.profiles.find((p) => p.id === P)!;
  const jobsOf = async () => {
    const view = await client(h).get('/api/workshop/me', h.tokens[P]);
    return view.json.jobs as Array<{ state: string; accruedMs: number; unitsCompleted: number }>;
  };

  it('the allowance clamps the third lane mid-window; all jobs survive at baseline', async () => {
    const { post, get } = client(h);
    for (let i = 0; i < 3; i += 1) {
      await post('/api/ops/craft-enqueue', h.tokens[P], { nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1 });
    }
    await post('/api/activity/set', h.tokens[P], {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    clockMs += 40_000;
    await post('/api/activity/heartbeat', h.tokens[P], {});
    await get('/api/workshop/me', h.tokens[P]);
    const jobs = await jobsOf();
    // Lane 1 ran 40 s free; lane 2 ran 40 s of the 60 s bank; lane 3
    // got only the 20 s that remained. The bank is empty.
    expect(jobs.map((j) => j.accruedMs)).toEqual([40_000, 40_000, 20_000]);
    expect(prof().bench_time_banked_seconds).toBe(0);
    expect(prof().bench_time_remainder_ms).toBe(0);
    expect(jobs.every((j) => j.state === 'running' || j.state === 'queued')).toBe(true);
  });

  it('with the bank empty, only the head progresses — and the queue still finishes in order', async () => {
    await attendedAdvance(h, h.tokens[P], 720_000); // 12 attended minutes
    const jobs = await jobsOf();
    // Head job: 40 s banked + 680 s baseline = its full 12-min unit.
    expect(jobs[0].state).toBe('complete');
    expect(jobs[0].unitsCompleted).toBe(1);
    // Second job: frozen at its 40 s while the head finished, then
    // took the 40 s of leftover window — never killed, never lost.
    expect(jobs[1].accruedMs).toBe(80_000);
    expect(jobs[2].accruedMs).toBe(20_000);
    expect(prof().bench_time_banked_seconds).toBe(0);
  });
});

// ─── Migration 0075 — SQL pins ───────────────────────────────────────

describe('migration 0075 — provenance and shape pins', () => {
  const dir = join(process.cwd(), 'db/migrations');
  const sql = readFileSync(join(dir, '0075_bench_time.sql'), 'utf8');
  const head0073 = readFileSync(join(dir, '0073_bench_collapse_relic_merger.sql'), 'utf8');
  const fn = (text: string, name: string) => {
    const start = text.indexOf(`create or replace function public.${name}(`);
    return text.slice(start, text.indexOf('\n$$;\n', start));
  };

  it('0075 is the chain head for every function it restates', () => {
    for (const name of ['cc_enqueue_craft_job', 'cc_enqueue_tint_job', 'cc_settle_craft_jobs']) {
      const definers = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .filter((f) => readFileSync(join(dir, f), 'utf8').includes(`create or replace function public.${name}(`))
        .sort();
      expect(definers[definers.length - 1]).toBe('0075_bench_time.sql');
    }
  });

  it('the bank op: nonce ledger, cap refusal, lever reads, no economy gate', () => {
    const bank = fn(sql, 'cc_bank_bench_time');
    expect(bank).toContain('verified_action_ledger');
    expect(bank).toContain("raise exception 'Bench time bank full — 24 h'");
    expect(bank).toContain("public.cc_economy_config_number('benchTimeGrantSeconds', 3600)");
    expect(bank).toContain("public.cc_economy_config_number('benchTimeBankCapSeconds', 86400)");
    expect(bank).not.toContain('can_use_player_economy(');
    expect(sql).toContain('add column if not exists bench_time_banked_seconds integer not null default 0');
    expect(sql).toContain('add column if not exists bench_time_remainder_ms integer not null default 0');
  });

  it('the envelope gates read the bank in both enqueues', () => {
    expect(fn(sql, 'cc_enqueue_craft_job')).toContain('then 18 + 3 * v_workshop_queue_bonus');
    expect(fn(sql, 'cc_enqueue_craft_job')).toContain('else 6 + v_workshop_queue_bonus end');
    expect(fn(sql, 'cc_enqueue_tint_job')).toContain('then 18 else 6 end');
  });

  it('the settle carries the drain: lanes, allowance clamp, remainder write-back', () => {
    const settle = fn(sql, 'cc_settle_craft_jobs');
    expect(settle).toContain('v_bank_ms >= 1000 then 3 else 1 end');
    expect(settle).toContain('v_avail := least(v_avail, v_bank_ms - v_extra_ms)');
    expect(settle).toContain('bench_time_remainder_ms = (v_new_bank_ms % 1000)::integer');
  });

  it('0073 bodies ride along verbatim outside the marked blocks', () => {
    // The 0072 recipeScrap resolution (enqueue), the tint Scrap
    // lever, and the settle's unit-completion calls — byte-identical
    // fragments of the 0073 chain head inside the 0075 restatement.
    const frag = "public.cc_economy_config_number('recipeScrap.' || p_recipe_id";
    expect(fn(head0073, 'cc_enqueue_craft_job')).toContain(frag);
    expect(fn(sql, 'cc_enqueue_craft_job')).toContain(frag);
    const tintFrag = "public.cc_economy_config_number('recipeScrap.tint_craft'";
    expect(fn(sql, 'cc_enqueue_tint_job')).toContain(tintFrag);
    const completions = (t: string) => (fn(t, 'cc_settle_craft_jobs').match(/cc_complete_craft_unit\(/g) ?? []).length;
    expect(completions(sql)).toBe(completions(head0073));
    // The dropped bench functions stay dropped.
    expect(sql).not.toContain('function public.cc_unlock_bench');
    expect(sql).not.toContain('function public.cc_fit_workshop_tool');
  });
});
