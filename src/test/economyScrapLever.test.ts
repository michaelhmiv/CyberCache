/**
 * Economy slice 7 — the per-recipe Scrap-cost lever (brief §4).
 *
 * Covered:
 *  - the generated registry pins 1:1 against the catalog (every
 *    recipe with a Scrap input has exactly one recipeScrap.<id> key
 *    and vice versa; defaults ARE the content literals — adding a
 *    recipe without a lever fails here loudly, by design);
 *  - validation + resolution (stored wins, junk ignored, empty
 *    config = byte-identical literals);
 *  - the admin write/read path accepts the generated keys;
 *  - THE ACCEPTANCE TEST (the owner's example): with
 *    recipeScrap.recipe_fuel_cell lowered 15 -> 3, a Fuel Cell job
 *    enqueues at 3 Scrap/unit through the shipped routes + the
 *    InMemory twin while every other recipe's cost is untouched;
 *    moving the lever after enqueue never reprices the job (cancel
 *    refunds the snapshot); resetting restores the content default;
 *  - the tint craft resolves through recipeScrap.tint_craft;
 *  - migration 0072's SQL pins (resolution present, restated from
 *    the post-merge 0069 chain head — not the brief's stale 0067);
 *  - client-side resolution (readiness shortage math + display
 *    helpers) runs off the same resolved figures.
 *  - (Tuning T3, 2026-11-10: the acceptance figures track the
 *    repriced catalog literals — fuel cell 15/unit, patch kit
 *    10/unit; the lever mechanics are unchanged.)
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_CRAFT_RECIPES, getCraftRecipe } from '../content/crafting';
import {
  ECONOMY_CONFIG_KEYS,
  RECIPE_SCRAP_DEFAULTS,
  RECIPE_SCRAP_SPECS,
  EconomyConfig,
  economyConfigSpecFor,
  isEconomyConfigKey,
  resolveEconomyConfigValues,
  resolveRecipeScrapCosts,
  validateEconomyConfigValue,
} from '../server/economy/config';
import { InMemoryEconomyStore, emptyEconomySeed } from '../server/economy/memory';
import { mountJobRoutes } from '../server/jobs/routes';
import { InMemoryJobStore, emptyJobSeed } from '../server/jobs/memory';
import { mountWriteRoutes } from '../server/writes/routes';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import { deriveRecipeReadiness, recipePurpose, type WorkshopPlayerContext } from '../lib/workshop/readiness';
import { resolvedRecipeInputs, resolvedScrapCost } from '../lib/workshop/recipeCosts';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const JOB_SECRET = 'test-job-secret';
const P = '11111111-1111-4111-8111-111111111111';

// ─── The registry pin ────────────────────────────────────────────────

describe('recipeScrap registry — generated from the catalog', () => {
  const scrapRecipes = ALL_CRAFT_RECIPES.filter((r) => 'Scrap' in r.inputs);

  it('pins exactly one lever key per Scrap-carrying recipe, and vice versa', () => {
    expect(Object.keys(RECIPE_SCRAP_DEFAULTS).sort()).toEqual(scrapRecipes.map((r) => r.id).sort());
    expect(Object.keys(RECIPE_SCRAP_SPECS).sort()).toEqual(
      scrapRecipes.map((r) => `recipeScrap.${r.id}`).sort(),
    );
    // The catalog at this writing (67) — a catalog change updates
    // this pin deliberately, in the same PR as the recipe.
    expect(scrapRecipes.length).toBe(67);
  });

  it('defaults ARE the content literals (untouched config changes nothing)', () => {
    for (const r of scrapRecipes) {
      expect(RECIPE_SCRAP_DEFAULTS[r.id], r.id).toBe(r.inputs['Scrap']);
    }
    expect(RECIPE_SCRAP_DEFAULTS['recipe_fuel_cell']).toBe(15);
    expect(RECIPE_SCRAP_DEFAULTS['tint_craft']).toBe(25);
  });

  it('every generated spec carries the registry bounds and its content owner', () => {
    for (const [key, spec] of Object.entries(RECIPE_SCRAP_SPECS)) {
      expect(spec.min, key).toBe(0);
      expect(spec.max, key).toBe(100_000);
      expect(spec.integer, key).toBe(true);
      expect(spec.defaultOwner, key).toContain('src/content/crafting.ts');
    }
  });

  it('the fixed registry is untouched — no recipeScrap key leaks into it', () => {
    expect(Object.keys(ECONOMY_CONFIG_KEYS).some((k) => k.startsWith('recipeScrap.'))).toBe(false);
    expect(isEconomyConfigKey('recipeScrap.recipe_fuel_cell')).toBe(false);
    expect(economyConfigSpecFor('recipeScrap.recipe_fuel_cell')?.key).toBe('recipeScrap.recipe_fuel_cell');
    expect(economyConfigSpecFor('recipeScrap.not_a_recipe')).toBeUndefined();
    expect(economyConfigSpecFor('marketFeeRate')?.key).toBe('marketFeeRate');
  });
});

// ─── Validation + resolution ─────────────────────────────────────────

describe('recipeScrap validation + resolution', () => {
  it('validates inside the spec and rejects outside it', () => {
    expect(validateEconomyConfigValue('recipeScrap.recipe_fuel_cell', 3)).toBe(3);
    expect(validateEconomyConfigValue('recipeScrap.recipe_fuel_cell', 0)).toBe(0);
    expect(validateEconomyConfigValue('recipeScrap.recipe_fuel_cell', 100_000)).toBe(100_000);
    expect(validateEconomyConfigValue('recipeScrap.recipe_fuel_cell', -1)).toBeNull();
    expect(validateEconomyConfigValue('recipeScrap.recipe_fuel_cell', 100_001)).toBeNull();
    expect(validateEconomyConfigValue('recipeScrap.recipe_fuel_cell', 2.5)).toBeNull();
    expect(validateEconomyConfigValue('recipeScrap.not_a_recipe', 3)).toBeNull();
  });

  it('an empty stored config resolves to the literals, key for key', () => {
    expect(resolveRecipeScrapCosts({})).toEqual(RECIPE_SCRAP_DEFAULTS);
  });

  it('a stored value wins for its recipe only; junk falls back to the literal', () => {
    const resolved = resolveRecipeScrapCosts({
      'recipeScrap.recipe_fuel_cell': 3,
      'recipeScrap.recipe_patch_kit': 'four',
      'recipeScrap.tint_craft': -5,
      'recipeScrap.refine_refined_alloy': 2.5,
      'some.other.key': 1,
    });
    expect(resolved['recipe_fuel_cell']).toBe(3);
    expect(resolved['recipe_patch_kit']).toBe(RECIPE_SCRAP_DEFAULTS['recipe_patch_kit']);
    expect(resolved['tint_craft']).toBe(25);
    expect(resolved['refine_refined_alloy']).toBe(10);
    expect(Object.keys(resolved).length).toBe(67);
  });

  it('the EconomyConfig accessor serves the resolved map (and defaults on failure)', async () => {
    const live = new EconomyConfig({
      loadConfigValues: async () => ({ 'recipeScrap.recipe_fuel_cell': 3 }),
    });
    const map = await live.recipeScrapCosts();
    expect(map['recipe_fuel_cell']).toBe(3);
    expect(map['recipe_patch_kit']).toBe(RECIPE_SCRAP_DEFAULTS['recipe_patch_kit']);
    const failing = new EconomyConfig({
      loadConfigValues: async () => {
        throw new Error('store down');
      },
    });
    expect(await failing.recipeScrapCosts()).toEqual(RECIPE_SCRAP_DEFAULTS);
    // The scalar snapshot is unaffected by the generated keys.
    expect(resolveEconomyConfigValues({ 'recipeScrap.recipe_fuel_cell': 3 }).marketFeeRate).toBe(0.05);
  });
});

// ─── Admin path ──────────────────────────────────────────────────────

describe('recipeScrap levers — the admin path', () => {
  let base = '';
  let close: () => Promise<void> = async () => {};
  let economyStore: InMemoryEconomyStore;

  beforeAll(async () => {
    economyStore = new InMemoryEconomyStore(emptyEconomySeed());
    const economyConfig = new EconomyConfig({ loadConfigValues: () => economyStore.loadConfigValues() });
    const app = express();
    app.use(express.json());
    mountJobRoutes(app, new InMemoryJobStore(emptyJobSeed()), {
      jwtSecret: SECRET,
      jobSecret: JOB_SECRET,
      economyStore,
      economyConfig,
    });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((r) => server.close(() => r()));
  });
  afterAll(async () => {
    await close();
  });

  const call = async (method: 'GET' | 'POST', path: string, payload?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-chef-job-secret': JOB_SECRET },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  };

  it('POST writes a generated key; GET reports it resolved with its default alongside', async () => {
    const posted = await call('POST', '/api/admin/economy/config', {
      key: 'recipeScrap.recipe_fuel_cell',
      value: 3,
    });
    expect(posted.status).toBe(200);
    expect(posted.json.value).toBe(3);
    expect(posted.json.recipeScrapCosts.recipe_fuel_cell).toBe(3);
    expect(posted.json.recipeScrapCosts.recipe_patch_kit).toBe(RECIPE_SCRAP_DEFAULTS['recipe_patch_kit']);
    const report = await call('GET', '/api/admin/economy');
    expect(report.status).toBe(200);
    expect(report.json.recipeScrapCosts.recipe_fuel_cell).toBe(3);
    expect(report.json.recipeScrapDefaults.recipe_fuel_cell).toBe(15);
    expect(Object.keys(report.json.recipeScrapCosts).length).toBe(67);
  });

  it('rejects out-of-spec values and unknown recipe keys', async () => {
    expect((await call('POST', '/api/admin/economy/config', { key: 'recipeScrap.recipe_fuel_cell', value: 2.5 })).status).toBe(400);
    expect((await call('POST', '/api/admin/economy/config', { key: 'recipeScrap.recipe_fuel_cell', value: -1 })).status).toBe(400);
    const unknown = await call('POST', '/api/admin/economy/config', { key: 'recipeScrap.bogus', value: 3 });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toBe('unknown_key');
  });
});

// ─── The acceptance test: fuel cells through the shipped routes ─────

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

describe('acceptance — the fuel-cell example (brief §4.3) in the TS twin', () => {
  let leverMap: Record<string, number> = {};
  let store: InMemoryWriteStore;
  let base = '';
  let close: () => Promise<void> = async () => {};
  let token = '';
  let nonceN = 0;
  const nonce = () => `econ7-nonce-${++nonceN}-abcdefgh`;

  const post = async (path: string, payload: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  };
  const workshop = async () => {
    const res = await fetch(`${base}/api/workshop/me`, { headers: { authorization: `Bearer ${token}` } });
    return res.json();
  };
  const scrap = () => store.seed.profiles.find((p) => p.id === P)!.materials['Scrap'] ?? 0;
  const gel = () => store.seed.profiles.find((p) => p.id === P)!.materials['NitrocellGel'] ?? 0;

  beforeAll(async () => {
    const seed = emptyWriteSeed();
    seed.profiles = [
      profile({ id: P, materials: { Scrap: 100, NitrocellGel: 10, ReactiveComponents: 10, Chromaweave: 5 } }),
    ];
    store = new InMemoryWriteStore(seed, {
      now: () => new Date('2026-11-03T12:00:00.000Z'),
      rng: () => 0.5,
      uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
      // The lever surface, flipped between steps like an admin write.
      craftLeverProvider: () => ({ recipeScrapCosts: leverMap }),
    });
    const app = express();
    app.use(express.json());
    mountWriteRoutes(app, store, { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((r) => server.close(() => r()));
    token = issueAccessToken(SECRET, P, false);
  });
  afterAll(async () => {
    await close();
  });

  it('empty lever config: fuel cell x2 escrows the literal 15/unit (parity with master)', async () => {
    leverMap = {};
    const res = await post('/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_fuel_cell', units: 2,
    });
    expect(res.status).toBe(200);
    expect(scrap()).toBe(70);
    expect(gel()).toBe(8);
    const view = await workshop();
    const job = view.jobs.find((j: { recipeId: string }) => j.recipeId === 'recipe_fuel_cell');
    expect(job.escrowInputs).toEqual({ Scrap: 30, NitrocellGel: 2 });
  });

  it('lever at 3: fuel cell enqueues at 3/unit, gel leg untouched, snapshot ships the map', async () => {
    leverMap = { recipe_fuel_cell: 3 };
    const res = await post('/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_fuel_cell', units: 2,
    });
    expect(res.status).toBe(200);
    expect(scrap()).toBe(64);
    expect(gel()).toBe(6);
    const view = await workshop();
    expect(view.recipeScrapCosts.recipe_fuel_cell).toBe(3);
    expect(view.recipeScrapCosts.recipe_patch_kit).toBe(10);
    const jobs = view.jobs.filter((j: { recipeId: string }) => j.recipeId === 'recipe_fuel_cell');
    expect(jobs).toHaveLength(2);
    expect(jobs[1].escrowInputs).toEqual({ Scrap: 6, NitrocellGel: 2 });
  });

  it('every other recipe is untouched: patch kit still escrows the literal 10/unit', async () => {
    const res = await post('/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_patch_kit', units: 3,
    });
    expect(res.status).toBe(200);
    expect(scrap()).toBe(34);
    const view = await workshop();
    const job = view.jobs.find((j: { recipeId: string }) => j.recipeId === 'recipe_patch_kit');
    expect(job.escrowInputs).toEqual({ Scrap: 30, ReactiveComponents: 3 });
  });

  it('snapshot semantics: lever moved to 9 after enqueue, cancel refunds the 3/unit snapshot', async () => {
    const view = await workshop();
    const levered = view.jobs.filter(
      (j: { recipeId: string; escrowInputs?: Record<string, number> }) =>
        j.recipeId === 'recipe_fuel_cell' && j.escrowInputs?.['Scrap'] === 6,
    );
    expect(levered).toHaveLength(1);
    leverMap = { recipe_fuel_cell: 9 };
    const res = await post('/api/ops/craft-cancel', { nonce: nonce(), job_id: levered[0].id });
    expect(res.status).toBe(200);
    // Refund is the SNAPSHOT (6 Scrap + 2 gel), not 2 units at 9.
    expect(scrap()).toBe(40);
    expect(gel()).toBe(8);
  });

  it('resetting the lever restores the content default', async () => {
    leverMap = {};
    const res = await post('/api/ops/craft-enqueue', {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_fuel_cell', units: 1,
    });
    expect(res.status).toBe(200);
    expect(scrap()).toBe(25);
    const view = await workshop();
    expect(view.recipeScrapCosts.recipe_fuel_cell).toBe(15);
  });

  it('a store with NO lever provider at all charges and displays the literals', async () => {
    const seed = emptyWriteSeed();
    seed.profiles = [profile({ id: P, materials: { Scrap: 50, NitrocellGel: 5 } })];
    const bare = new InMemoryWriteStore(seed, { rng: () => 0.5 });
    await bare.enqueueCraftJob(P, nonce(), {
      bench: 1, recipeId: 'recipe_fuel_cell', units: 1,
    });
    // NB: the store clones its seed — read balances through it.
    expect(bare.seed.profiles[0].materials['Scrap']).toBe(35);
    const view = (await bare.getWorkshopState(P)) as { recipeScrapCosts: Record<string, number> };
    expect(view.recipeScrapCosts['recipe_fuel_cell']).toBe(15);
  });
});

// ─── Tint resolves through its own lever ─────────────────────────────

describe('tint — recipeScrap.tint_craft', () => {
  const ITEM_ID = '99999999-9999-4999-8999-999999999999';
  function tintSeed(): WriteSeed {
    const seed = emptyWriteSeed();
    seed.profiles = [profile({ id: P, materials: { Scrap: 100, Chromaweave: 5 } })];
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
  let tintNonce = 0;
  const tNonce = () => `econ7-tint-${++tintNonce}-abcdefgh`;

  it('charges the literal 25 by default and the lever value when set', async () => {
    const plain = new InMemoryWriteStore(tintSeed(), { rng: () => 0.5 });
    await plain.enqueueTintJob(P, tNonce(), { itemId: ITEM_ID, paletteId: 'arctic' });
    expect(plain.seed.profiles[0].materials['Scrap']).toBe(75);

    const levered = new InMemoryWriteStore(tintSeed(), {
      rng: () => 0.5,
      craftLeverProvider: () => ({ recipeScrapCosts: { tint_craft: 10 } }),
    });
    await levered.enqueueTintJob(P, tNonce(), { itemId: ITEM_ID, paletteId: 'arctic' });
    expect(levered.seed.profiles[0].materials['Scrap']).toBe(90);
  });
});

// ─── Migration 0072 SQL pins ─────────────────────────────────────────

describe('migration 0072 — SQL pins', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0072_recipe_scrap_lever.sql'), 'utf8');
  const generic = sql.slice(0, sql.indexOf('create or replace function public.cc_enqueue_tint_job'));
  const tint = sql.slice(sql.indexOf('create or replace function public.cc_enqueue_tint_job'));

  it('restates both enqueue functions and resolves the Scrap leg at enqueue', () => {
    expect(sql).toContain('create or replace function public.cc_enqueue_craft_job');
    expect(sql).toContain('create or replace function public.cc_enqueue_tint_job');
    expect(generic).toContain("public.cc_economy_config_number('recipeScrap.' || p_recipe_id");
    expect(generic).toContain("jsonb_set(recipe, '{inputs,Scrap}', to_jsonb(v_scrap_cost))");
    expect(generic).toContain('greatest(0, least(100000');
    expect(tint).toContain("public.cc_economy_config_number('recipeScrap.tint_craft'");
  });

  it('is restated from the post-merge chain head (0069), not 0067', () => {
    // 0067's enqueue still carried the 0053 scrap-COLUMN special case;
    // the merge deleted it. Its fingerprints must be absent, and the
    // unified-stack escrow (0069) present.
    expect(generic).not.toContain('coalesce(p.scrap, 0)');
    expect(generic).not.toContain('set scrap = scrap -');
    expect(generic).toContain("recipe -> 'inputs' ? 'Scrap'");
    // The unified-stack escrow deduct (0069) — every key, Scrap
    // included, moves through the materials jsonb.
    expect(generic).toContain('set materials = public.cc_jsonb_add_int(materials, v_key, -v_per_unit::integer)');
    // 0069-only enqueue surface the brief's 0067 citation predates.
    expect(generic).toContain('p_use_core_catalyst boolean default false');
  });
});

// ─── Client-side resolution ──────────────────────────────────────────

describe('client display resolution', () => {
  const fuelCell = getCraftRecipe('recipe_fuel_cell')!;

  it('resolvedScrapCost / resolvedRecipeInputs: server map wins, literal fallback', () => {
    expect(resolvedScrapCost(fuelCell, undefined)).toBe(15);
    expect(resolvedScrapCost(fuelCell, {})).toBe(15);
    expect(resolvedScrapCost(fuelCell, { recipe_fuel_cell: 3 })).toBe(3);
    expect(resolvedRecipeInputs(fuelCell, { recipe_fuel_cell: 3 })).toEqual({ Scrap: 3, NitrocellGel: 1 });
    expect(resolvedRecipeInputs(fuelCell, undefined)).toEqual({ Scrap: 15, NitrocellGel: 1 });
  });

  it('readiness shortage math runs off the resolved bill', () => {
    const ctx: WorkshopPlayerContext = {
      playerLevel: 25,
      scrap: 0,
      materials: { Scrap: 4, NitrocellGel: 5 },
      essences: {},
      consumables: {},
      benchesOwned: 1,
      masteries: {},
      standingRanks: {},
      researchCompletedIds: new Set<string>(),
      activeJobs: [],
    };
    // At the literal 15 the player is short 11 Scrap; at the lever's 3
    // the same wallet crafts — the card must agree with the charge.
    const atLiteral = deriveRecipeReadiness(fuelCell, ctx, { units: 1 });
    expect(atLiteral.shortages).toContainEqual(
      expect.objectContaining({ key: 'Scrap', need: 15, have: 4 }),
    );
    const atLever = deriveRecipeReadiness(
      fuelCell,
      { ...ctx, recipeScrapCosts: { recipe_fuel_cell: 3 } },
      { units: 1 },
    );
    expect(atLever.shortages.find((s) => s.key === 'Scrap')).toBeUndefined();
  });

  it('the refine purpose line quotes the resolved input', () => {
    const ctx: WorkshopPlayerContext = {
      playerLevel: 25,
      scrap: 0,
      materials: { Scrap: 100 },
      essences: {},
      consumables: {},
      benchesOwned: 1,
      masteries: {},
      standingRanks: {},
      researchCompletedIds: new Set<string>(),
      activeJobs: [],
    };
    const alloy = getCraftRecipe('refine_refined_alloy')!;
    expect(recipePurpose(alloy, ctx).text).toContain('Turns 10 Scrap into');
    expect(recipePurpose(alloy, { ...ctx, recipeScrapCosts: { refine_refined_alloy: 3 } }).text).toContain(
      'Turns 3 Scrap into',
    );
  });
});
