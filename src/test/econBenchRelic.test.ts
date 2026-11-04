/**
 * Economy slice 9 — BENCH COLLAPSE + RELIC MERGER (brief §8 as
 * amended by ruling 9), through the real wire contracts:
 *
 *  - content pins: one bench, every requiresBench 1, no 'tool'
 *    kind anywhere, the four craft relics with their exact effects;
 *  - the ceiling law: relic effects compose under ×1.10 / +5 —
 *    two sources past the ceiling still clamp (composer AND the
 *    enqueue snapshot, the double-equip case);
 *  - behavior through the shipped routes + InMemoryWriteStore (the
 *    TS twin; the SQL twin + the conversion are proven against
 *    real Postgres in cybercache-prep/econ9-verification/):
 *    bench-3 requests land on bench 1, catalysts run on the one
 *    bench, named relics refuse catalysts and mint fixed at Epic,
 *    the queue holds the 1-running + 5-queued envelope, and the
 *    unlock/fit routes are gone (404);
 *  - grep pins: no shipped (non-test) source references the
 *    retired benches/tools machinery;
 *  - migration pins: 0073 carries the audit table, the §8.6
 *    refund rule, the conversion map, and the two drops.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteItemData, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import {
  ALL_CRAFT_RECIPES,
  CRAFT_BENCHES,
  CRAFT_RELICS,
  MAX_BENCH,
  QUEUED_JOBS_PER_BENCH,
  RUNNING_JOBS_ON_BENCH,
  catalystForRecipe,
  composeCraftRelicEffects,
  craftAffixesForRelic,
  getCraftRecipe,
} from '../content/crafting';

// ─── Pure content pins ────────────────────────────────────────────

describe('slice 9 — content collapse pins', () => {
  it('one bench, always owned, ×1.00', () => {
    expect(CRAFT_BENCHES).toHaveLength(1);
    expect(MAX_BENCH).toBe(1);
    expect(CRAFT_BENCHES[0].costCredits).toBe(0);
    expect(CRAFT_BENCHES[0].qualityFactor).toBe(1);
    expect(CRAFT_BENCHES[0].minQualityBonus).toBe(0);
    expect(RUNNING_JOBS_ON_BENCH).toBe(1);
    expect(QUEUED_JOBS_PER_BENCH).toBe(5);
  });

  it('every recipe in the catalog sits on bench 1; no tool kind remains', () => {
    for (const r of ALL_CRAFT_RECIPES) {
      expect(r.requiresBench, r.id).toBe(1);
      expect(r.kind, r.id).not.toBe('tool');
    }
  });

  it('the three converted tools are named-relic gear recipes with effects intact', () => {
    const cal = getCraftRecipe('tool_precision_calipers')!;
    expect(cal.kind).toBe('gear');
    expect(cal.gearSlot).toBe('relic');
    expect(cal.namedRelic).toBe('Precision Calipers');
    expect(cal.fixedRarity).toBe('Epic');
    expect(craftAffixesForRelic('Precision Calipers')).toEqual([
      expect.objectContaining({ stat: 'craftQualityMultiplier', value: 1.08, category: 'crafting' }),
    ]);
    expect(craftAffixesForRelic('Servo Bench Rig')).toEqual([
      expect.objectContaining({ stat: 'craftDurationMultiplier', value: 0.85 }),
    ]);
    expect(craftAffixesForRelic('Reclaimer Head')).toEqual([
      expect.objectContaining({ stat: 'craftRefineYieldBonus', value: 0.05 }),
      expect.objectContaining({ stat: 'craftBonusUnitChance', value: 0.1 }),
    ]);
    // Relic recipes take no catalyst — the refusal's content side.
    expect(catalystForRecipe(cal)).toBeNull();
  });

  it('the Prime Laboratory carries the Lab ceiling as a relic effect', () => {
    const lab = getCraftRecipe('relic_prime_laboratory')!;
    expect(lab.namedRelic).toBe('Prime Laboratory');
    expect(lab.fixedRarity).toBe('Epic');
    expect(craftAffixesForRelic('Prime Laboratory')).toEqual([
      expect.objectContaining({ stat: 'craftQualityMultiplier', value: 1.1 }),
      expect.objectContaining({ stat: 'craftMinQualityBonus', value: 5 }),
    ]);
    expect(CRAFT_RELICS.map((r) => r.name)).toEqual([
      'Precision Calipers', 'Servo Bench Rig', 'Reclaimer Head', 'Prime Laboratory',
    ]);
  });
});

describe('slice 9 — the ×1.10/+5 ceiling (double-source law)', () => {
  it('two Prime Laboratories compose to exactly ×1.10/+5, never past', () => {
    const twoLabs = [...craftAffixesForRelic('Prime Laboratory'), ...craftAffixesForRelic('Prime Laboratory')];
    const fx = composeCraftRelicEffects(twoLabs);
    expect(fx.qualityMultiplier).toBe(1.1);
    expect(fx.minQualityBonus).toBe(5);
  });

  it('Lab + Calipers (×1.10 × ×1.08 = ×1.188) clamps to ×1.10', () => {
    const fx = composeCraftRelicEffects([
      ...craftAffixesForRelic('Prime Laboratory'),
      ...craftAffixesForRelic('Precision Calipers'),
    ]);
    expect(fx.qualityMultiplier).toBe(1.1);
    expect(fx.minQualityBonus).toBe(5);
  });

  it('below-ceiling effects compose untouched', () => {
    const fx = composeCraftRelicEffects([
      ...craftAffixesForRelic('Precision Calipers'),
      ...craftAffixesForRelic('Servo Bench Rig'),
      ...craftAffixesForRelic('Reclaimer Head'),
    ]);
    expect(fx.qualityMultiplier).toBe(1.08);
    expect(fx.durationMultiplier).toBe(0.85);
    expect(fx.refineYieldBonus).toBe(0.05);
    expect(fx.bonusUnitChance).toBe(0.1);
    expect(fx.minQualityBonus).toBe(0);
  });
});

// ─── Migration pins ───────────────────────────────────────────────

describe('slice 9 — migration 0073 pins', () => {
  const sql = readFileSync(join(__dirname, '../../db/migrations/0073_bench_collapse_relic_merger.sql'), 'utf8');

  it('carries the conversion audit + the §8.6 refund rule + the drops', () => {
    expect(sql).toContain('bench_relic_conversion_audit');
    expect(sql).toContain("'bench_collapse_refund'");
    expect(sql).toContain('then 30000 else 5000');
    expect(sql).toContain("public.cc_jsonb_add_int(essences, 'VoidDust', v_dust)");
    expect(sql).toContain('drop function if exists public.cc_unlock_bench(uuid, text)');
    expect(sql).toContain('drop function if exists public.cc_fit_workshop_tool(uuid, text, integer, text)');
    for (const tool of ['tool_precision_calipers', 'tool_servo_bench_rig', 'tool_reclaimer_head']) {
      expect(sql).toContain(tool);
    }
    // The tombstone: benches to 1, tools cleared.
    expect(sql).toContain("workshop_tools = '{}'::jsonb");
  });
});

// ─── Grep pins over shipped sources ───────────────────────────────

describe('slice 9 — no shipped path references retired benches/tools', () => {
  const RETIRED = [
    'unlockCraftBench', 'fitWorkshopTool', 'cc_unlock_bench', 'cc_fit_workshop_tool',
    'gearRarityRequiresBench', 'CRAFT_TOOLS', 'Benches & Tools', 'CATALYST_REQUIRES_BENCH',
  ];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (!p.endsWith('/test')) walk(p);
      } else if (/\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(join(__dirname, '..'));

  it('the retired identifiers appear nowhere in src (outside tests)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const needle of RETIRED) {
        if (text.includes(needle)) offenders.push(`${f}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─── Route-level behavior (the TS twin) ───────────────────────────

const SECRET = 'test-secret-at-least-32-chars-long!!';
const T0 = new Date('2026-11-03T12:00:00.000Z').getTime();
let clockMs = T0;

const LAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // L40, wears the Prime Laboratory
const STACK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // L25, wears Lab+Calipers stacked
const PLAIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // L25, no relic

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'crafter', display_name: null, player_level: 25, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-11-03T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'crafter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function relicItem(id: string, owner: string, name: string, level: number): WriteItemData {
  return {
    id, owner_user_id: owner, kind: 'relic', static_item_id: null, item_level: level,
    rarity: 'Epic', quality: null, material_tier: null, condition_state: null,
    condition_current: null, condition_max: null, supply_mode: 'verified_action',
    source_id: null, creator_user_id: owner, tradeable: true, account_bound: false,
    locked_until: null,
    payload: {
      id, name, level, rarity: 'Epic',
      affixes: craftAffixesForRelic(name),
      sourceTag: 'Crafted', isLocked: false,
    },
    runtime_state: 'equipped', is_locked: false, equipped_slot: 'relic',
    estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  };
}

const RICH = {
  Scrap: 1000, ReactiveComponents: 1000, BallisticParts: 500, TechFragments: 500,
  HeartwoodResin: 50, CompositePlating: 50, MagnetiteCores: 50,
  Voidweave: 10, CircuitLattice: 10, PrismShards: 50,
};

function seed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({ id: LAB, player_level: 40, materials: { ...RICH } }),
    profile({ id: STACK, materials: { ...RICH } }),
    profile({ id: PLAIN, materials: { ...RICH } }),
  ];
  const labItem = relicItem('11111111-1111-4111-8111-111111111111', LAB, 'Prime Laboratory', 40);
  const stackItem = relicItem('22222222-2222-4222-8222-222222222222', STACK, 'Prime Laboratory', 25);
  (stackItem.payload as { affixes: unknown[] }).affixes = [
    ...craftAffixesForRelic('Prime Laboratory'),
    ...craftAffixesForRelic('Precision Calipers'),
  ];
  s.items = [labItem, stackItem];
  return s;
}

interface Harness { store: InMemoryWriteStore; base: string; close: () => Promise<void>; tokens: Record<string, string> }
let h: Harness;
let nonceN = 0;
const nonce = () => `econ9-nonce-${++nonceN}-abcdefgh`;

async function makeServer(): Promise<Harness> {
  clockMs = T0;
  const store = new InMemoryWriteStore(seed(), {
    now: () => new Date(clockMs),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `99999999-9999-4999-8999-${String(++n).padStart(12, '0')}`; })(),
  });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((r) => server.on('listening', r));
  const { port } = server.address() as AddressInfo;
  const tokens: Record<string, string> = {};
  for (const id of [LAB, STACK, PLAIN]) tokens[id] = issueAccessToken(SECRET, id, false);
  return { store, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())), tokens };
}

async function post(path: string, token: string, payload: unknown) {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  return { status: res.status, json };
}
async function get(path: string, token: string) {
  const res = await fetch(`${h.base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const advance = (ms: number) => { clockMs += ms; };
const jobOf = (player: string, recipeId: string) =>
  h.store.seed.craftJobs.filter((j) => j.owner_user_id === player && j.recipe_id === recipeId).at(-1)!;
const enqueue = (player: string, body: Record<string, unknown>) =>
  post('/api/ops/craft-enqueue', h.tokens[player], { nonce: nonce(), bench: 1, units: 1, ...body });

describe('slice 9 — workshop behavior through the shipped routes', () => {
  beforeAll(async () => { h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('a bench-3 request lands on the one bench; the equipped relic snapshots at the ceiling', async () => {
    const res = await post('/api/ops/craft-enqueue', h.tokens[LAB], {
      nonce: nonce(), bench: 3, recipe_id: 'recipe_medkit', units: 1,
    });
    expect(res.status).toBe(200);
    const job = jobOf(LAB, 'recipe_medkit');
    expect(job.bench).toBe(1);
    expect(job.snapshot.toolQualityMultiplier).toBe(1.1);
    expect(job.snapshot.relicMinQualityBonus).toBe(5);
    expect(job.snapshot.toolId).toBe('11111111-1111-4111-8111-111111111111');
    expect(job.snapshot.namedRelic).toBeNull();
  });

  it('double-source equip (Lab + Calipers) still snapshots ×1.10/+5 — never ×1.188', async () => {
    const res = await enqueue(STACK, { recipe_id: 'recipe_medkit' });
    expect(res.status).toBe(200);
    const job = jobOf(STACK, 'recipe_medkit');
    expect(job.snapshot.toolQualityMultiplier).toBe(1.1);
    expect(job.snapshot.relicMinQualityBonus).toBe(5);
  });

  it('a craft completes AT the ceiling: bounds floor +5, roll ×1.10', async () => {
    await post('/api/activity/set', h.tokens[LAB], {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    advance(12 * 60 * 1000 + 1000);
    const view = await get('/api/workshop/me', h.tokens[LAB]);
    const job = view.json.jobs.find((j: { recipeId: string }) => j.recipeId === 'recipe_medkit');
    expect(job.state).toBe('complete');
    // MedKit bounds at mastery 1: 75–125; relic floor +5 → 80–125;
    // rng 0.5 rolls 102.5; ×1.10 relic multiplier → 112.75.
    const batch = h.store.seed.consumableBatches.find(
      (b) => b.owner_user_id === LAB && b.consumable_type === 'MedKit',
    );
    expect(batch?.quality_percent).toBe(112.75);
  });

  it('catalysts run on the one bench (the Forge gate is gone)', async () => {
    const res = await enqueue(PLAIN, { recipe_id: 'recipe_shieldcell', use_catalyst: true });
    expect(res.status).toBe(200);
    expect(jobOf(PLAIN, 'recipe_shieldcell').snapshot.catalystMaterialId).toBe('HeartwoodResin');
  });

  it('a converted tool recipe enqueues as a named-relic craft at fixed Epic', async () => {
    const res = await enqueue(PLAIN, { recipe_id: 'tool_servo_bench_rig' });
    expect(res.status).toBe(200);
    const job = jobOf(PLAIN, 'tool_servo_bench_rig');
    expect(job.kind).toBe('gear');
    expect(job.snapshot.namedRelic).toBe('Servo Bench Rig');
    expect(job.snapshot.gearRarity).toBe('Epic');
  });

  it('named relics refuse catalysts at enqueue', async () => {
    const res = await enqueue(LAB, { recipe_id: 'relic_prime_laboratory', use_catalyst: true });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toContain('take no catalyst');
  });

  it('the Prime Laboratory mints fixed: Epic, its own affixes, no pool roll', async () => {
    const res = await enqueue(LAB, { recipe_id: 'relic_prime_laboratory' });
    expect(res.status).toBe(200);
    const job = jobOf(LAB, 'relic_prime_laboratory');
    expect(job.unit_duration_ms).toBe(240 * 60 * 1000);
    // The internal away cap settles at most 2h per read — advance
    // in chunks with a settling read between, the shipped pattern.
    for (let i = 0; i < 3; i += 1) {
      advance(100 * 60 * 1000);
      await get('/api/workshop/me', h.tokens[LAB]);
    }
    const view = await get('/api/workshop/me', h.tokens[LAB]);
    const done = view.json.jobs.find((j: { recipeId: string }) => j.recipeId === 'relic_prime_laboratory');
    expect(done.state).toBe('complete');
    const minted = h.store.seed.items.find(
      (i) => i.owner_user_id === LAB && i.kind === 'relic'
        && (i.payload as { name?: string }).name === 'Prime Laboratory'
        && i.runtime_state === 'available',
    );
    expect(minted).toBeTruthy();
    expect(minted!.rarity).toBe('Epic');
    expect((minted!.payload as { affixes: unknown[] }).affixes).toEqual(craftAffixesForRelic('Prime Laboratory'));
  });

  it('the queue envelope holds: 1 running + 5 queued, the 7th job refused', async () => {
    // PLAIN already holds 2 active jobs from earlier probes
    // (shieldcell + servo rig) — 4 more fit, the next refuses.
    for (let i = 0; i < 4; i += 1) {
      const res = await enqueue(PLAIN, { recipe_id: 'recipe_medkit' });
      expect(res.status).toBe(200);
    }
    const res = await enqueue(PLAIN, { recipe_id: 'recipe_medkit' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toContain('Bench queue is full');
  });

  it('the unlock + fit routes are gone', async () => {
    const unlock = await post('/api/ops/craft-unlock-bench', h.tokens[PLAIN], { nonce: nonce() });
    expect(unlock.status).toBe(404);
    const fit = await post('/api/ops/craft-fit-tool', h.tokens[PLAIN], { nonce: nonce(), bench: 1, tool_id: null });
    expect(fit.status).toBe(404);
  });

  it('the workshop view reports the collapsed truth: 1 bench, no tools', async () => {
    const view = await get('/api/workshop/me', h.tokens[PLAIN]);
    expect(view.json.benches).toBe(1);
    expect(view.json.tools).toEqual({ owned: {}, fitted: {}, charges: {} });
  });
});
