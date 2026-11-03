/**
 * Workshop Direction A ("Make-now first") — derivation tests.
 *
 * The fixture is the approved mock's own (dir-a NOTES.md): level 14,
 * benches 1–2 owned, mastery 9/6/4/2, Production Systems not taken,
 * a named handful of materials. The mock's section placements are
 * the assertions: its six craftable cards classify craftable, its
 * four one-gate cards classify one-gate, its four locked cards
 * classify locked — from the REAL derivation over the REAL catalog.
 */
import { describe, expect, it } from 'vitest';
import { ALL_CRAFT_RECIPES, getCraftRecipe } from '../content/crafting';
import {
  countCraftableNow,
  deriveRecipeReadiness,
  recipePurpose,
  recipeQualityLine,
  recipeSearchText,
  type WorkshopPlayerContext,
} from '../lib/workshop/readiness';
import { sourcesForInput } from '../lib/workshop/sources';
import { humanizeWorkshopError, WORKSHOP_ERROR_FALLBACK } from '../lib/workshop/errors';
import { salvageYieldFromRecycleResult } from '../lib/gear/salvageAward';

const GENERIC = ALL_CRAFT_RECIPES.filter((r) => !r.tintCraft);

function fixtureCtx(over: Partial<WorkshopPlayerContext> = {}): WorkshopPlayerContext {
  return {
    playerLevel: 14,
    scrap: 1240,
    materials: {
      ScrapAlloy: 42,
      ReactiveComponents: 17,
      BallisticParts: 9,
      TechFragments: 6,
      RefinedAlloy: 3,
    },
    essences: { IgnitionFluid: 2 },
    consumables: {},
    benchesOwned: 2,
    masteries: {
      crafting_consumables: { level: 9, xp: 0 },
      'crafting.refining': { level: 6, xp: 0 },
      'crafting.gear': { level: 4, xp: 0 },
      'crafting.cosmetics': { level: 2, xp: 0 },
    },
    standingRanks: {},
    researchCompletedIds: new Set<string>(),
    activeJobs: [],
    toolsOwned: {},
    ...over,
  };
}

const classify = (id: string, ctx: WorkshopPlayerContext = fixtureCtx()) => {
  const recipe = getCraftRecipe(id);
  if (!recipe) throw new Error(`fixture recipe missing: ${id}`);
  return deriveRecipeReadiness(recipe, ctx);
};

describe('readiness classification — the mock fixture, live derivation', () => {
  it('the mock’s six craftable cards classify craftable', () => {
    for (const id of [
      'recipe_medkit',
      'recipe_patch_kit',
      'recipe_ammo_pack',
      'recipe_shieldcell',
      'refine_refined_alloy',
      'recipe_skin_dread_torso',
    ]) {
      expect(classify(id).classification, id).toBe('craftable');
      expect(classify(id).canEnqueue, id).toBe(true);
    }
  });

  it('the mock’s four one-gate cards classify one-gate', () => {
    for (const id of ['recipe_fuel_cell', 'recipe_fire_ammo', 'frame_weapon', 'recipe_patch_kit_batch']) {
      expect(classify(id).classification, id).toBe('one-gate');
      expect(classify(id).blockerFamilies, id).toHaveLength(1);
    }
  });

  it('the mock’s locked cards classify locked with every family named', () => {
    for (const id of ['recipe_master_patch_kit', 'tool_precision_calipers', 'recipe_skin_bulwark_head']) {
      expect(classify(id).classification, id).toBe('locked');
      expect(classify(id).blockerFamilies.length, id).toBeGreaterThanOrEqual(2);
    }
    // Gate-removal step 2 (merged to master while this PR was in
    // flight) dropped the Calibration Core's level requirement, so
    // at this fixture it is one gate away now — materials only. The
    // derivation follows the live defs; the mock predates step 2.
    expect(classify('recipe_calibration_core').classification).toBe('one-gate');
    expect(classify('recipe_calibration_core').blockerFamilies).toEqual(['materials']);
  });

  it('disabled summaries match the mock’s CTA words', () => {
    expect(classify('recipe_fuel_cell').disabledSummary).toBe('Missing materials');
    expect(classify('recipe_patch_kit_batch').disabledSummary).toBe('Locked — research');
    expect(classify('recipe_master_patch_kit').disabledSummary).toBe('Locked — mastery + 1 material');
    expect(classify('recipe_calibration_core').disabledSummary).toBe('Missing materials');
    expect(classify('recipe_skin_bulwark_head').disabledSummary).toBe('Locked — the Lab + materials');
    expect(classify('tool_precision_calipers').disabledSummary).toBe('Locked — the Lab + materials');
  });

  it('all gates print — met ones included — never just the first failure', () => {
    const master = classify('recipe_master_patch_kit');
    const labels = master.gates.map((g) => g.label).join(' | ');
    expect(labels).toContain('Level 1 — met');
    expect(labels).toContain('Any bench — met');
    expect(labels).toContain('Mastery — Consumables 15. Yours is 9.');
    expect(labels).toContain('Missing Void Dust ×1');
    const cal = classify('recipe_calibration_core');
    const calLabels = cal.gates.map((g) => g.label).join(' | ');
    expect(calLabels).toContain('Level 1 — met');
    expect(calLabels).toContain('Forge bench — owned');
  });

  it('the research gate renders in human words with its door', () => {
    const batch = classify('recipe_patch_kit_batch');
    const gate = batch.gates.find((g) => g.family === 'research');
    expect(gate?.met).toBe(false);
    expect(gate?.label).toContain('Production Systems not taken');
    expect(gate?.door).toBe('research');
    expect(JSON.stringify(batch)).not.toContain('research_required');
  });

  it('research completion opens the batch recipes (materials permitting)', () => {
    const ctx = fixtureCtx({ researchCompletedIds: new Set(['production_systems']) });
    expect(classify('recipe_patch_kit_batch', ctx).classification).toBe('craftable');
  });

  it('an unreachable Chef (null research state) keeps research recipes locked', () => {
    const ctx = fixtureCtx({ researchCompletedIds: null });
    expect(classify('recipe_patch_kit_batch', ctx).classification).toBe('one-gate');
    expect(classify('recipe_patch_kit_batch', ctx).blockerFamilies).toEqual(['research']);
  });

  it('the craftable count is live: it moves when state moves', () => {
    const before = countCraftableNow(GENERIC, fixtureCtx());
    expect(before).toBeGreaterThanOrEqual(6);
    const broke = countCraftableNow(GENERIC, fixtureCtx({ materials: {}, essences: {}, scrap: 0 }));
    expect(broke).toBe(0);
    const researched = countCraftableNow(
      GENERIC,
      fixtureCtx({ researchCompletedIds: new Set(['production_systems']) }),
    );
    expect(researched).toBeGreaterThan(before);
  });

  it('queue-full is a real gate, and a free second bench rescues it', () => {
    const fullBench1 = Array.from({ length: 6 }, () => ({ bench: 1, recipeId: 'recipe_medkit' }));
    const oneBench = fixtureCtx({ benchesOwned: 1, activeJobs: fullBench1 });
    const blocked = classify('recipe_medkit', oneBench);
    expect(blocked.blockerFamilies).toContain('queue');
    const twoBenches = fixtureCtx({ benchesOwned: 2, activeJobs: fullBench1 });
    expect(classify('recipe_medkit', twoBenches).classification).toBe('craftable');
    expect(classify('recipe_medkit', twoBenches).bench).toBe(2);
  });

  it('an owned tool cannot be crafted again; a queued one says so', () => {
    const ownedCtx = fixtureCtx({ toolsOwned: { tool_precision_calipers: true } });
    // Give the player the materials so ONLY the tool gate can bind.
    const rich = fixtureCtx({
      toolsOwned: { tool_precision_calipers: true },
      materials: { CircuitLattice: 5, PrismShards: 5 },
      benchesOwned: 3,
    });
    expect(classify('tool_precision_calipers', rich).blockerFamilies).toEqual(['tool']);
    expect(classify('tool_precision_calipers', ownedCtx).blockerFamilies).toContain('materials');
    const queuedCtx = fixtureCtx({
      materials: { CircuitLattice: 5, PrismShards: 5 },
      benchesOwned: 3,
      activeJobs: [{ bench: 1, recipeId: 'tool_precision_calipers' }],
    });
    expect(classify('tool_precision_calipers', queuedCtx).blockerFamilies).toEqual(['tool']);
  });

  it('selected units reprice the material gate (totals honesty)', () => {
    const recipe = getCraftRecipe('recipe_medkit')!;
    const two = deriveRecipeReadiness(recipe, fixtureCtx(), { units: 2 });
    expect(two.classification).toBe('craftable'); // 42/30 + 17/16 still holds
    const ten = deriveRecipeReadiness(recipe, fixtureCtx(), { units: 10 });
    expect(ten.blockerFamilies).toEqual(['materials']);
    expect(ten.shortages.map((s) => s.key)).toContain('ScrapAlloy');
  });
});

describe('card copy — purpose, quality, search', () => {
  it('purpose lines come from the real consumable defs', () => {
    const medkit = getCraftRecipe('recipe_medkit')!;
    const purpose = recipePurpose(medkit, fixtureCtx());
    expect(purpose.text).toContain('emergency heal');
    expect(purpose.hint).toContain('50% HP');
  });

  it('refining purpose states the live conversion at the player’s mastery', () => {
    const refine = getCraftRecipe('refine_refined_alloy')!;
    const purpose = recipePurpose(refine, fixtureCtx());
    expect(purpose.text).toContain('10 Scrap Alloy');
    expect(purpose.text).toContain('Refined Alloy');
  });

  it('quality lines carry the player’s actual bounds and the Vendor baseline', () => {
    const medkit = getCraftRecipe('recipe_medkit')!;
    // Mastery 9 on the Basic Bench (the card’s default bench): the
    // bounds function’s own numbers, not fixture constants.
    const line = recipeQualityLine(medkit, fixtureCtx(), 1, false) ?? '';
    expect(line).toContain('Quality rolls');
    expect(line).toContain('100% = Vendor strength');
    const bounds = line.match(/(\d+)–(\d+)%/);
    expect(bounds).not.toBeNull();
    expect(Number(bounds![1])).toBeGreaterThan(75); // mastery 9 lifts the floor
    expect(recipeQualityLine(getCraftRecipe('refine_refined_alloy')!, fixtureCtx(), 1, false)).toBeNull();
  });

  it('search covers name, job, and material', () => {
    const ctx = fixtureCtx();
    const medkit = getCraftRecipe('recipe_medkit')!;
    const text = recipeSearchText(medkit, ctx).toLowerCase();
    expect(text).toContain('med kit');
    expect(text).toContain('heal'); // the job/purpose
    expect(text).toContain('scrap alloy'); // a material
    const fuel = getCraftRecipe('recipe_fuel_cell')!;
    expect(recipeSearchText(fuel, ctx).toLowerCase()).toContain('nitrocell gel');
  });
});

describe('material sources — live owners only', () => {
  it('a signature material names its home area and the market', () => {
    const sources = sourcesForInput('NitrocellGel');
    const roam = sources.find((s) => s.kind === 'roam');
    expect(roam).toMatchObject({ areaId: 'redline_circuit', areaName: 'Redline Circuit', home: true });
    expect(sources.some((s) => s.kind === 'market')).toBe(true);
    expect(sources.some((s) => s.kind === 'vendor')).toBe(false);
  });

  it('an essence names its home area and the vendor rotation', () => {
    const sources = sourcesForInput('IgnitionFluid');
    expect(sources.find((s) => s.kind === 'roam')).toMatchObject({ areaId: 'blastforge_yards', home: true });
    expect(sources.some((s) => s.kind === 'vendor')).toBe(true);
  });

  it('a refined material’s first source is Refine here', () => {
    const sources = sourcesForInput('RefinedAlloy');
    expect(sources[0]).toMatchObject({ kind: 'refine', recipeId: 'refine_refined_alloy', station: 'crusher' });
    const lattice = sourcesForInput('CircuitLattice');
    expect(lattice[0]).toMatchObject({ kind: 'refine', recipeId: 'refine_circuit_lattice', station: 'furnace' });
  });

  it('a base material roams in a biased area, rotates at the vendor, and lists on the market', () => {
    const sources = sourcesForInput('ScrapAlloy');
    expect(sources.some((s) => s.kind === 'roam')).toBe(true);
    expect(sources.some((s) => s.kind === 'vendor')).toBe(true);
    expect(sources.some((s) => s.kind === 'market')).toBe(true);
  });

  it('Scrap is a currency line, never a market door', () => {
    expect(sourcesForInput('Scrap')).toEqual([{ kind: 'scrap' }]);
  });
});

describe('error humanizer — no Chef refusal renders raw', () => {
  const RAW_CODES = ['research_required', 'standing_required'];

  it('translates the two machine codes into human words with doors', () => {
    expect(humanizeWorkshopError(new Error('research_required'))).toContain('Production Systems');
    expect(humanizeWorkshopError(new Error('research_required'))).toContain('Research (Hunter tab)');
    expect(humanizeWorkshopError(new Error('standing_required'))).toContain('Rep Desk');
  });

  it('translates mastery track ids and material ids', () => {
    expect(humanizeWorkshopError(new Error('Requires crafting.gear mastery 10'))).toContain('Gear mastery 10');
    expect(humanizeWorkshopError(new Error('Requires crafting_consumables mastery 15'))).toContain('Consumables mastery 15');
    expect(humanizeWorkshopError(new Error('Insufficient material NitrocellGel'))).toContain('Nitrocell Gel');
    expect(humanizeWorkshopError(new Error('Insufficient essence IgnitionFluid'))).toContain('Ignition Fluid');
    expect(humanizeWorkshopError(new Error('Insufficient material Chromaweave'))).toContain('Chromaweave');
    expect(humanizeWorkshopError(new Error('Epic frames require crafting.gear mastery 10'))).not.toContain('crafting.gear');
  });

  it('audited refusal strings never come back raw or machine-shaped', () => {
    const audited = [
      'research_required',
      'standing_required',
      'Requires crafting.gear mastery 10',
      'Requires crafting_consumables mastery 15',
      'Requires crafting.refining mastery 5',
      'Requires crafting.cosmetics mastery 5',
      'Insufficient material ScrapAlloy',
      'Insufficient material NitrocellGel',
      'Insufficient essence VoidEssence',
      'Insufficient material Chromaweave',
      'Insufficient scrap',
      'Insufficient credits',
      'Insufficient legendary cores',
      'Insufficient material quantity',
      'Epic frames require crafting.gear mastery 10',
      'Bench 3 requires level 30',
      'Profile not found',
      'some_other_machine_code',
    ];
    for (const raw of audited) {
      const out = humanizeWorkshopError(new Error(raw));
      for (const code of RAW_CODES) expect(out, raw).not.toContain(code);
      expect(out, raw).not.toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/);
      expect(out, raw).not.toContain('crafting.');
      expect(out, raw).not.toContain('crafting_');
      expect(out.length, raw).toBeGreaterThan(10);
    }
  });

  it('already-human refusals pass through untouched', () => {
    for (const human of [
      'Bench queue is full',
      'Legendary gear cannot be crafted',
      'Catalysts require the Forge (bench 2)',
      'No Workshop Rush Ticket available',
      'Job is not active',
      'Tool not owned',
      'All benches already unlocked',
    ]) {
      expect(humanizeWorkshopError(new Error(human))).toBe(human);
    }
    expect(humanizeWorkshopError(new Error(''))).toBe(WORKSHOP_ERROR_FALLBACK);
    expect(humanizeWorkshopError(undefined)).toBe(WORKSHOP_ERROR_FALLBACK);
  });
});

describe('salvage feedback — the live recycle result, named in full', () => {
  it('maps scrap + the King-of-Scrap bonus material + cores', () => {
    const y = salvageYieldFromRecycleResult({ scrap_award: 120, bonus_material: 'BallisticParts', cores_award: 0 });
    expect(y.scrapValue).toBe(120);
    expect(y.ballisticParts).toBe(1);
    expect(y.scrapAlloy).toBe(0);
    const legendary = salvageYieldFromRecycleResult({ scrap_award: 900, cores_award: 3 });
    expect(legendary.legendaryCores).toBe(3);
  });

  it('pays nothing the server did not pay', () => {
    const y = salvageYieldFromRecycleResult({ scrap_award: 50 });
    expect(y).toMatchObject({
      scrapValue: 50,
      scrapAlloy: 0,
      ballisticParts: 0,
      reactiveComponents: 0,
      techFragments: 0,
      voidDust: 0,
      legendaryCores: 0,
    });
    expect(y.essences).toEqual({});
  });
});
