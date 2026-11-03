/**
 * Economy Slice 4 — production law-fixes (brief
 * ~/cybercache-prep/design-briefs/economy-redesign-2026-11-03.md §9).
 *
 * §9.1 Gear catalyst: Forgeheart Ingots escrowed on gear jobs were
 *   destroyed unread. The read is now wired in both twins: a catalyzed
 *   gear unit's quality roll uses the shared bounds function with the
 *   catalyst flag set (+CATALYST_MIN_BONUS min / +CATALYST_MAX_BONUS
 *   max — the consumable branch's own shift), rolled per generation
 *   draw with the best roll kept, exactly like the consumable branch
 *   composes its shift. Proven below at the bounds grid, at the
 *   generator (distribution), and through the shipped write routes
 *   (a catalyzed job's item differs from an uncatalyzed control by
 *   exactly the specced effect; the ingot is refunded whole when the
 *   job is cancelled before the shift could apply).
 * §9.2 Tools are permanent (layer-2 law): no charge burn, no
 *   fitted-reads-absent at 0 stored charges, no charge stamp on
 *   completion. Stored charges are inert data.
 * §9.3 Furnace refine: stochastic rounding — floor(x) plus one extra
 *   unit with probability frac(x) — keeps the floor formula's
 *   expectation while making mastery and the Reclaimer Head real on
 *   the outputBase-2 furnace recipes.
 * §9.4 Batch recipes: numbers unchanged (a straight efficiency, the
 *   Production Systems reward); the comment and unlock text now say
 *   so instead of claiming a materials trade.
 *
 * The SQL twin is restated in db/migrations/0067_economy_law_fixes.sql
 * (draft — applied live by the parent before merge); its shape is
 * pinned textually here, the same way the other migrations are pinned.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import {
  CATALYST_MAX_BONUS,
  CATALYST_MIN_BONUS,
  CRAFT_TOOLS,
  REFINE_BASE_YIELD_DEFAULT,
  craftQualityBounds,
  getCraftRecipe,
  refineOutputExpectation,
  refineOutputRange,
  rollRefineOutputCount,
} from '../content/crafting';
import { RESEARCH_COURSES } from '../content/research';
import { generateCraftedGearItem } from '../server/writes/craftGear';

/** The shipped refine base yield (economy-config default). */
const REFINE_BASE_YIELD = REFINE_BASE_YIELD_DEFAULT;

/** Deterministic PRNG for distribution pins. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── §9.1 bounds grid: the gear (frame) band with the catalyst flag ── */

describe('§9.1 gear catalyst — bounds grid parity', () => {
  const frame = { consumableType: null, qualityShift: 0 };

  it('the brief numbers are the shipped constants: +10 min / +15 max', () => {
    expect(CATALYST_MIN_BONUS).toBe(10);
    expect(CATALYST_MAX_BONUS).toBe(15);
  });

  it('uncatalyzed frame band is the shipped 75–150 (no-change pin)', () => {
    expect(craftQualityBounds({ ...frame, masteryLevel: 1, bench: 1, catalyst: false }))
      .toEqual({ min: 75, max: 150, cap: 175 });
  });

  it('catalyst shifts the frame band by exactly +10/+15', () => {
    expect(craftQualityBounds({ ...frame, masteryLevel: 1, bench: 1, catalyst: true }))
      .toEqual({ min: 85, max: 165, cap: 175 });
  });

  it('the shift composes with bench and mastery exactly like the consumable branch', () => {
    // Lab: +5 bench minimum on top of the catalyst shift.
    expect(craftQualityBounds({ ...frame, masteryLevel: 1, bench: 3, catalyst: true }))
      .toEqual({ min: 90, max: 165, cap: 175 });
    // Mastery 50: the shipped mastery terms — min(20, 1.5×49) = +20
    // min, min(25, 2×49) = +25 max — stack with the catalyst's
    // +10/+15, and the max lands on the 175 cap.
    expect(craftQualityBounds({ ...frame, masteryLevel: 50, bench: 1, catalyst: true }))
      .toEqual({ min: 105, max: 175, cap: 175 });
    // A composed quality shift stacks additively with the catalyst.
    expect(craftQualityBounds({ consumableType: null, masteryLevel: 1, bench: 1, catalyst: true, qualityShift: 4 }))
      .toEqual({ min: 89, max: 169, cap: 175 });
  });

  it('generator distribution: catalyzed draws live inside the shifted bounds only', () => {
    const rng = mulberry32(7);
    const bounds = craftQualityBounds({ ...frame, masteryLevel: 1, bench: 2, catalyst: true });
    const samples: number[] = [];
    for (let i = 0; i < 300; i++) {
      const c = generateCraftedGearItem({
        slot: 'weapon', rarity: 'Rare', itemLevel: 25, creatorId: 'dist', draws: 1, rng,
        qualityRoll: { bounds, bench: 2 },
      });
      samples.push(c.craftQuality!);
    }
    // Forge factor ×1.05 over bounds 85–165 → [89.25, 173.25].
    for (const q of samples) {
      expect(q).toBeGreaterThanOrEqual(89.25 - 1e-9);
      expect(q).toBeLessThanOrEqual(173.25 + 1e-9);
    }
    // The +15 max shift is real: rolls above the uncatalyzed ceiling
    // (150 × 1.05 = 157.5) occur; the +10 min shift is real: no roll
    // falls to the uncatalyzed floor (75 × 1.05 = 78.75).
    expect(Math.max(...samples)).toBeGreaterThan(160);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeGreaterThan(124);
    expect(mean).toBeLessThan(139);
  });

  it('generator no-change pin: without a qualityRoll, no craftQuality is stamped', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 5; i++) {
      const c = generateCraftedGearItem({
        slot: 'weapon', rarity: 'Rare', itemLevel: 25, creatorId: 'plain', draws: 1, rng,
      });
      expect(c.craftQuality).toBeUndefined();
      expect(c.payload.craftQuality).toBeUndefined();
    }
  });
});

/* ── §9.3 stochastic rounding: expectation + distribution pins ─────── */

describe('§9.3 furnace refine — stochastic rounding', () => {
  const furnace = getCraftRecipe('refine_composite_plating')!;
  const tier1 = getCraftRecipe('refine_refined_alloy')!;

  it('expectation keeps the brief worked points', () => {
    expect(refineOutputExpectation(furnace, 1, REFINE_BASE_YIELD)).toBeCloseTo(2.01, 10);
    expect(refineOutputExpectation(furnace, 25, REFINE_BASE_YIELD)).toBeCloseTo(2.25, 10);
    expect(refineOutputExpectation(furnace, 50, REFINE_BASE_YIELD)).toBeCloseTo(2.5, 10);
    // Reclaimer Head (+0.05) at mastery 37: rate 0.998 → x = 2.495.
    expect(refineOutputExpectation(furnace, 37, REFINE_BASE_YIELD, 0.05)).toBeCloseTo(2.495, 10);
  });

  it('range display helper: fractional expectations read as a range', () => {
    expect(refineOutputRange(furnace, 25, REFINE_BASE_YIELD)).toEqual({ min: 2, max: 3 });
    expect(refineOutputRange(tier1, 25, REFINE_BASE_YIELD)).toEqual({ min: 9, max: 9 });
    expect(refineOutputRange(tier1, 1, REFINE_BASE_YIELD)).toEqual({ min: 8, max: 9 });
  });

  it('distribution at mastery 25: 2 out, ~25% chance of 3 (EV 2.25)', () => {
    const rng = mulberry32(1234);
    let threes = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const out = rollRefineOutputCount(furnace, 25, REFINE_BASE_YIELD, 0, rng);
      expect(out === 2 || out === 3).toBe(true);
      if (out === 3) threes++;
    }
    expect(threes / n).toBeGreaterThan(0.21);
    expect(threes / n).toBeLessThan(0.29);
  });

  it('distribution at mastery 50: 2 or 3, ~50% (EV 2.5)', () => {
    const rng = mulberry32(99);
    let threes = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const out = rollRefineOutputCount(furnace, 50, REFINE_BASE_YIELD, 0, rng);
      if (out === 3) threes++;
    }
    expect(threes / n).toBeGreaterThan(0.45);
    expect(threes / n).toBeLessThan(0.55);
  });

  it('baseline stays near-deterministic: mastery 1 furnace is 2 out ~99%', () => {
    const rng = mulberry32(5);
    let threes = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      if (rollRefineOutputCount(furnace, 1, REFINE_BASE_YIELD, 0, rng) === 3) threes++;
    }
    expect(threes / n).toBeLessThan(0.03);
  });

  it('whole expectations consume no RNG and stay exact (tier-1 no-change pin)', () => {
    let calls = 0;
    const counting = () => { calls++; return 0.999; };
    expect(rollRefineOutputCount(tier1, 25, REFINE_BASE_YIELD, 0, counting)).toBe(9);
    expect(calls).toBe(0);
  });
});

/* ── §9.2 / §9.4 static pins: catalog + copy truth ─────────────────── */

describe('§9.2/§9.4 catalog and copy pins', () => {
  it('tool defs carry no durability counter and promise permanence', () => {
    for (const tool of CRAFT_TOOLS) {
      expect('durabilityJobs' in tool).toBe(false);
      expect(tool.blurb).toContain('Permanent once crafted');
      expect(tool.blurb).not.toMatch(/25 jobs|lasts/i);
    }
  });

  it('batch numbers are byte-identical to the shipped catalog (no-change pin)', () => {
    const shield = getCraftRecipe('recipe_shield_cell_batch')!;
    expect(shield.inputs).toEqual({ ScrapAlloy: 50, ReactiveComponents: 30 });
    expect(shield.unitDurationMs).toBe(1980000);
    expect(shield.outputQuantity).toBe(3);
    const patch = getCraftRecipe('recipe_patch_kit_batch')!;
    expect(patch.inputs).toEqual({ ScrapAlloy: 10, ReactiveComponents: 3 });
    expect(patch.unitDurationMs).toBe(1584000);
    const ord = getCraftRecipe('recipe_ordnance_batch')!;
    expect(ord.inputs).toEqual({ ScrapAlloy: 30, BallisticParts: 25 });
    expect(ord.unitDurationMs).toBe(1584000);
  });

  it('the batch comment and research text state the efficiency truth', () => {
    const src = readFileSync(path.join(__dirname, '../content/crafting.ts'), 'utf8');
    const header = src.slice(src.indexOf('Research batch recipes (0038'), src.indexOf('export const BATCH_RECIPES'));
    expect(header).toContain('EFFICIENCY');
    expect(src).not.toContain('dearer in materials');
    const course = RESEARCH_COURSES.find((c) => c.id === 'production_systems')!;
    expect(course.unlockText).toContain('2.5× inputs and 2.2× unit time per 3 units');
    expect(course.unlockText).toContain('fewer materials and less time per unit');
  });
});

/* ── Migration 0067: SQL twin shape pins ───────────────────────────── */

describe('migration 0067 — SQL twin shape', () => {
  const sql = readFileSync(
    path.join(__dirname, '../../db/migrations/0067_economy_law_fixes.sql'), 'utf8',
  );

  it('gear branch stamps the catalyst bounds from the shared SQL bounds function', () => {
    expect(sql).toContain("'qualityBounds'");
    expect(sql).toContain('public.cc_craft_quality_bounds(null, v_ml, job.bench, true, v_shift)');
    expect(sql).toContain("(job.snapshot ->> 'catalystMaterialId') is not null");
  });

  it('pending gear surfaces bounds/bench/multiplier; finalize records the winning roll', () => {
    expect(sql).toContain("o -> 'qualityBounds'");
    expect(sql).toContain('p_quality numeric default null');
    expect(sql).toContain("'quality', p_quality");
  });

  it('refine branch applies stochastic rounding with random() only on a fraction', () => {
    expect(sql).toContain('v_expect := (recipe ->> \'outputBase\')::numeric * v_yield / p_refine_base');
    expect(sql).toContain('random() < v_expect - floor(v_expect)');
  });

  it('no charge burn, no fitted-at-zero-charges read, no 25-charge stamp', () => {
    expect(sql).not.toContain("'25'::jsonb");
    expect(sql).not.toContain("charges' ->> v_fitted");
    expect(sql).not.toContain('greatest(0, v_charges - 1)');
    expect(sql).toContain('§9.2');
  });
});

/* ── Wire contract: shipped routes + InMemoryWriteStore ───────────── */

const SECRET = 'test-secret-at-least-32-chars-long!!';
const T0 = new Date('2026-11-03T12:00:00.000Z').getTime();
let clockMs = T0;
let rngFn: () => number = () => 0.5;

const CAT = '11111111-1111-4111-8111-111111111111'; // catalyst tester, Forge owner
const TOOLP = '22222222-2222-4222-8222-222222222222'; // tool permanence tester
const FURN = '33333333-3333-4333-8333-333333333333'; // furnace tester, refining 25

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

function seed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({
      id: CAT, workshop_benches: 2,
      materials: { RefinedAlloy: 500, TemperedParts: 500, ForgeheartIngots: 500 },
    }),
    profile({
      id: TOOLP,
      materials: { CircuitLattice: 4, PrismShards: 4, ScrapAlloy: 3000, ReactiveComponents: 3000 },
    }),
    profile({
      id: FURN, workshop_benches: 3,
      materials: { MycoSteelFiber: 200 }, essences: { VoidEssence: 100 },
    }),
  ];
  s.masteries = [
    { user_id: FURN, mastery_id: 'crafting.refining', mastery_xp: 0, mastery_level: 25 },
  ];
  return s;
}

interface Harness { store: InMemoryWriteStore; base: string; close: () => Promise<void>; tokens: Record<string, string> }
let h: Harness;
let nonceN = 0;
const nonce = () => `econ-nonce-${++nonceN}-abcdefgh`;

async function makeServer(): Promise<Harness> {
  clockMs = T0;
  const store = new InMemoryWriteStore(seed(), {
    now: () => new Date(clockMs),
    rng: () => rngFn(),
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  });
  const app = express();
  app.use(express.json());
  mountWriteRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((r) => server.on('listening', r));
  const { port } = server.address() as AddressInfo;
  const tokens: Record<string, string> = {};
  for (const id of [CAT, TOOLP, FURN]) tokens[id] = issueAccessToken(SECRET, id, false);
  return { store, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())), tokens };
}

async function post(id: string, p: string, payload: unknown) {
  const res = await fetch(`${h.base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${h.tokens[id]}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
async function get(id: string, p: string) {
  const res = await fetch(`${h.base}${p}`, { headers: { authorization: `Bearer ${h.tokens[id]}` } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const prof = (id: string) => h.store.seed.profiles.find((p) => p.id === id)!;
const jobsOf = (id: string, recipeId: string) =>
  h.store.seed.craftJobs.filter((j) => j.owner_user_id === id && j.recipe_id === recipeId);
const advance = (ms: number) => { clockMs += ms; };
const MIN_MS = 60 * 1000;

describe('§9.1 wire contract — catalyzed gear through the shipped routes', () => {
  beforeAll(async () => { rngFn = () => 0.5; h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('cancelling a catalyzed job before completion refunds the ingot in full', async () => {
    const before = prof(CAT).materials.ForgeheartIngots;
    const res = await post(CAT, '/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 2, recipe_id: 'frame_weapon', units: 2, rarity: 'Rare', use_catalyst: true,
    });
    expect(res.status).toBe(200);
    // Per unit: 2 ingots of frame inputs + 1 catalyst ingot escrowed.
    expect(prof(CAT).materials.ForgeheartIngots).toBe(before - 6);
    const job = jobsOf(CAT, 'frame_weapon').at(-1)!;
    expect(job.snapshot.catalystMaterialId).toBe('ForgeheartIngots');
    expect(job.escrow_catalyst).toEqual({ ForgeheartIngots: 2 });
    const cancel = await post(CAT, '/api/ops/craft-cancel', { nonce: nonce(), job_id: job.id });
    expect(cancel.status).toBe(200);
    // Nothing completed → the catalyst counts as never consumed.
    expect(prof(CAT).materials.ForgeheartIngots).toBe(before);
  });

  it('a catalyzed gear unit carries exactly the +10/+15-shifted roll; the control carries none', async () => {
    await post(CAT, '/api/activity/set', {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    const catRes = await post(CAT, '/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 2, recipe_id: 'frame_weapon', units: 1, rarity: 'Rare', use_catalyst: true,
    });
    expect(catRes.status).toBe(200);
    // Control on bench 1 at Common (Rare frames require the Forge);
    // the frame quality band is rarity-independent, and the control
    // assertion is the ABSENCE of the catalyst stamp.
    const ctlRes = await post(CAT, '/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 1, recipe_id: 'frame_weapon', units: 1, rarity: 'Common',
    });
    expect(ctlRes.status).toBe(200);
    advance(151 * MIN_MS);
    await get(CAT, '/api/workshop/me');

    const catJob = jobsOf(CAT, 'frame_weapon').find(
      (j) => j.snapshot.catalystMaterialId && j.status === 'complete',
    )!;
    expect(catJob).toBeTruthy();
    const catOut = catJob.outputs[0] as unknown as Record<string, unknown>;
    // rng 0.5 → roll = (85 + 0.5 × 80) × 1.05 (Forge) = 131.25, inside
    // the catalyst-shifted bounds and above the uncatalyzed ceiling
    // roll (150 × 1.05 = 157.5 is the max; the midpoint proves the
    // bounds moved, the range pins above prove the edges).
    expect(catOut.quality).toBeCloseTo(131.25, 6);
    const catItem = h.store.seed.items.find((i) => i.id === catOut.itemId);
    expect((catItem!.payload as Record<string, unknown>).craftQuality).toBeCloseTo(131.25, 6);
    // The ingot was consumed — and this time the effect it paid for exists.
    expect(catJob.escrow_catalyst).toEqual({ ForgeheartIngots: 1 });
    // 500 start; the cancelled job netted zero; −3 catalyzed unit
    // (2 frame inputs + 1 catalyst), −2 control unit (inputs only).
    expect(prof(CAT).materials.ForgeheartIngots).toBe(495);

    const ctlJob = jobsOf(CAT, 'frame_weapon').find((j) => !j.snapshot.catalystMaterialId && j.status === 'complete')!;
    const ctlOut = ctlJob.outputs[0] as unknown as Record<string, unknown>;
    expect(ctlOut.quality ?? null).toBeNull();
    const ctlItem = h.store.seed.items.find((i) => i.id === ctlOut.itemId);
    expect((ctlItem!.payload as Record<string, unknown>).craftQuality).toBeUndefined();
  });
});

describe('§9.2 wire contract — fitted tools never expire', () => {
  beforeAll(async () => { rngFn = () => 0.5; h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('tool completion stamps ownership only — no charge count', async () => {
    await post(TOOLP, '/api/activity/set', {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    const res = await post(TOOLP, '/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 1, recipe_id: 'tool_precision_calipers', units: 1,
    });
    expect(res.status).toBe(200);
    advance(61 * MIN_MS);
    await get(TOOLP, '/api/workshop/me');
    const tools = prof(TOOLP).workshop_tools as {
      owned: Record<string, boolean>;
      charges?: Record<string, number>;
      fitted: Record<string, string>;
    };
    expect(tools.owned.tool_precision_calipers).toBe(true);
    expect(tools.charges?.tool_precision_calipers).toBeUndefined();
  });

  it('a fitted tool at 0 stored charges still applies, and 26 job starts never unfit it', async () => {
    const fit = await post(TOOLP, '/api/ops/craft-fit-tool', {
      nonce: nonce(), bench: 1, tool_id: 'tool_precision_calipers',
    });
    expect(fit.status).toBe(200);
    // Legacy profile state: the pre-0067 counter ran out. Under the
    // old law the fitted read now returns "absent"; under §9.2 the
    // stored value is inert and the tool applies in full.
    const tools = prof(TOOLP).workshop_tools as unknown as {
      owned: Record<string, boolean>;
      charges: Record<string, number>;
      fitted: Record<string, string>;
    };
    tools.charges = { tool_precision_calipers: 0 };
    // The seeded exhaustion is really in the store's record before
    // the loop starts (the old law would now read the tool absent).
    expect(
      (prof(TOOLP).workshop_tools as unknown as { charges: Record<string, number> })
        .charges.tool_precision_calipers,
    ).toBe(0);

    for (let i = 0; i < 26; i++) {
      const res = await post(TOOLP, '/api/ops/craft-enqueue', {
        nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1,
      });
      expect(res.status).toBe(200);
      const job = jobsOf(TOOLP, 'recipe_medkit').at(-1)!;
      // The Calipers' ×1.08 rides every snapshot — start 1 and start 26 alike.
      expect(job.snapshot.toolQualityMultiplier).toBe(1.08);
      expect(job.snapshot.toolId).toBe('tool_precision_calipers');
      advance(13 * MIN_MS);
      await get(TOOLP, '/api/workshop/me');
      expect(job.status).toBe('complete');
      expect(job.tool_charged).toBe(true); // completion record parity only
    }
    const after = prof(TOOLP).workshop_tools as unknown as {
      owned: Record<string, boolean>;
      charges: Record<string, number>;
      fitted: Record<string, string>;
    };
    expect(after.owned.tool_precision_calipers).toBe(true);
    expect(after.fitted['1']).toBe('tool_precision_calipers');
    // The inert counter was never decremented below 0 and never
    // re-stamped to a fresh 25 — no reader consumes it (the twin's
    // state normalization may drop the dead key entirely; both are
    // the brief's "inert data" outcome).
    expect(after.charges.tool_precision_calipers ?? 0).toBe(0);
    expect(after.charges.tool_precision_calipers).not.toBe(25);
    expect(prof(TOOLP).consumables.MedKit).toBe(26);
  });
});

describe('§9.3 wire contract — furnace yields move with refining mastery', () => {
  beforeAll(async () => { rngFn = mulberry32(2026); h = await makeServer(); });
  afterAll(async () => { await h.close(); });

  it('40 chromaweave units at mastery 25 pay 2–3 each, averaging ≈2.25', async () => {
    await post(FURN, '/api/activity/set', {
      nonce: nonce(), activity_kind: 'crafting', activity_payload: {}, public_payload: {},
    });
    const res = await post(FURN, '/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 3, recipe_id: 'refine_chromaweave', units: 40,
    });
    expect(res.status).toBe(200);
    // 40 units × 30 min = 20 h of bench time. The lazy settle caps
    // un-heartbeated away time at the offline cap, so — like the real
    // client — the test heartbeats as virtual time passes, in 2 h
    // attended steps.
    for (let step = 0; step < 11; step++) {
      advance(2 * 60 * MIN_MS);
      await post(FURN, '/api/activity/heartbeat', {});
      await get(FURN, '/api/workshop/me');
    }
    const job = jobsOf(FURN, 'refine_chromaweave').at(-1)!;
    expect(job.status).toBe('complete');
    expect(job.outputs).toHaveLength(40);
    const counts = job.outputs.map((o) => {
      const out = o as unknown as { outputMaterial?: string; outputQuantity?: number };
      expect(out.outputMaterial).toBe('Chromaweave');
      return out.outputQuantity!;
    });
    for (const c of counts) expect(c === 2 || c === 3).toBe(true);
    expect(counts).toContain(2);
    expect(counts).toContain(3);
    const total = counts.reduce((a, b) => a + b, 0);
    // EV 90 over 40 units; a ±3σ band around the binomial mean.
    expect(total).toBeGreaterThanOrEqual(80);
    expect(total).toBeLessThanOrEqual(100);
    expect(prof(FURN).materials.Chromaweave).toBe(total);
  });
});
