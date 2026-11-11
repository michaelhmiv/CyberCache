/**
 * Elemental Coating crafting disposition (fleet coverage audit,
 * 2026-11-04; owner ruling: give it a crafting recipe — the
 * crafter-only pattern for specialty consumables, not vendor stock).
 *
 * Before this slice the type was defined but unobtainable: no
 * recipe output, no vendor stock, no rotation entry — and its
 * shield/armor break multipliers were display-only, because the
 * boss sim never read them (a prepared coating burned on the
 * attempt and moved nothing). Covered here:
 *  - the def is a live craftable again (quality rolls and scales
 *    the effect like its peers; Prism Coating stays the premium);
 *  - recipe_elemental_coating sits in both catalogs (TS content and
 *    migration 0077's restated SQL twin) at elemental-ammo-band
 *    cost, and its Scrap leg is lever-addressable (Econ 7);
 *  - the shipped craft engine enqueues it (escrow = the content
 *    inputs, or the lever's Scrap figure when one is set), settles
 *    it, and the completed unit lands as a crafted batch;
 *  - consuming it in a boss attempt actually moves the sim's break
 *    score by the def's multipliers at the batch's quality, and the
 *    attempt charges it (onAttempt).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '../constants/bosses';
import { CONSUMABLES, getConsumableRuntimeEffects } from '../constants/consumables';
import { CRAFTING_RECIPES } from '../constants/craftingRecipes';
import { ALL_CRAFT_RECIPES, getCraftRecipe } from '../content/crafting';
import { getBossConsumableUsage, simulateBoss } from '../lib/simulation/bossSimulator';
import { RECIPE_SCRAP_DEFAULTS, resolveRecipeScrapCosts } from '../server/economy/config';
import {
  enqueueCraftJob as enqueueCraftJobCore,
  settleCraftJobs as settleCraftJobsCore,
  type CraftAdapter,
  type CraftJobRecord,
  type CraftLeverValues,
  type CraftProfileView,
} from '../server/writes/craftEngine';
import { computeSkillBonuses } from '../lib/skills/skillBonuses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

const P = '11111111-1111-4111-8111-111111111111';
const MIGRATION_0077 = readFileSync(
  join(process.cwd(), 'db/migrations/0077_elemental_coating_recipe.sql'),
  'utf8',
);

// ─── The def ────────────────────────────────────────────────────────

describe('Elemental Coating — the def is a live craftable', () => {
  const def = CONSUMABLES['ElementalCoating'];

  it('is implemented, craftable, and vendor-excluded — never stocked', () => {
    expect(def.implementationStatus).toBe('implemented');
    expect(def.market.craftable).toBe(true);
    expect(def.market.vendorStocked).toBe(false);
    expect(def.market.vendorExcluded).toBe(true);
    // The 0019 player-market exclusion for this type stands:
    // crafted batches are consumable, not listable.
    expect(def.market.playerMarketAllowed).toBe(false);
    expect(def.isBossPrepVisible).toBe(true);
    expect(def.runtime.activityScopes).toEqual(['boss']);
  });

  it('keeps its shipped effect: 1.15 shield + armor break at quality 100', () => {
    const at100 = getConsumableRuntimeEffects('ElementalCoating', 100);
    expect(at100.shieldBreakMultiplier).toBeCloseTo(1.15, 10);
    expect(at100.armorBreakMultiplier).toBeCloseTo(1.15, 10);
  });

  it('crafted quality actually scales the effect, like its peers', () => {
    expect(def.quality.craftMin).toBe(75);
    expect(def.quality.craftMax).toBe(150);
    const at150 = getConsumableRuntimeEffects('ElementalCoating', 150);
    // multiplierDelta: 1 + 0.15 × 1.5 = 1.225 — since T2 raised the
    // whole break family, a perfect baseline coating overshoots
    // Prism Coating's 1.18 base.
    expect(at150.shieldBreakMultiplier).toBeCloseTo(1.225, 10);
    expect(at150.armorBreakMultiplier).toBeCloseTo(1.225, 10);
    const prism = getConsumableRuntimeEffects('PrismCoating', 100);
    expect(prism.shieldBreakMultiplier).toBeCloseTo(1.18, 10); // the premium still starts higher
  });
});

// ─── The recipe + both catalogs ─────────────────────────────────────

describe('recipe_elemental_coating — catalog presence and costing', () => {
  const recipe = getCraftRecipe('recipe_elemental_coating');

  it('exists in the unified catalog at the elemental-ammo band', () => {
    expect(recipe).toBeDefined();
    expect(recipe?.kind).toBe('consumable');
    expect(recipe?.consumableType).toBe('ElementalCoating');
    expect(recipe?.category).toBe('offense');
    expect(recipe?.inputs).toEqual({ Scrap: 75, BallisticParts: 8, VoidEssence: 3 });
    expect(recipe?.unitDurationMs).toBe(20 * 60 * 1000);
    expect(recipe?.requiresLevel).toBe(1);
    expect(recipe?.requiresBench).toBe(1);
    // The legacy recipe list carries the same row (one source).
    const legacy = CRAFTING_RECIPES.find((r) => r.id === 'recipe_elemental_coating');
    expect(legacy?.materials).toEqual(recipe?.inputs);
    expect(legacy?.craftTimeMs).toBe(recipe?.unitDurationMs);
  });

  it('peer band: ammos price Scrap 75, Prism prices the same essences plus signature stock', () => {
    const shock = getCraftRecipe('recipe_shock_ammo');
    expect(shock?.inputs['Scrap']).toBe(75);
    expect(shock?.inputs['BallisticParts']).toBe(8);
    const prism = getCraftRecipe('recipe_prismatek_standing');
    expect(prism?.inputs['VoidEssence']).toBe(3); // same essence leg
    expect(prism?.inputs['PrismShards']).toBe(2); // + the gated signature premium
    expect(prism?.unitDurationMs).toBe(25 * 60 * 1000); // the baseline runs faster
  });

  it('its Scrap leg is a generated Econ-7 lever, defaulting to the literal', () => {
    expect(RECIPE_SCRAP_DEFAULTS['recipe_elemental_coating']).toBe(75);
    const resolved = resolveRecipeScrapCosts({ 'recipeScrap.recipe_elemental_coating': 5 });
    expect(resolved['recipe_elemental_coating']).toBe(5);
    expect(resolveRecipeScrapCosts({})['recipe_elemental_coating']).toBe(75);
  });

  it('migration 0077 restates the catalog (89 recipes, deep-equal) and the bounds row', () => {
    const catalog = JSON.parse(MIGRATION_0077.split('$catalog$')[1]) as Array<Record<string, unknown>>;
    expect(catalog).toHaveLength(89);
    expect(catalog).toEqual(JSON.parse(JSON.stringify(ALL_CRAFT_RECIPES)));
    expect(MIGRATION_0077).toContain("('ElementalCoating', 75::numeric, 150::numeric)");
    // Provenance + the owner's apply order ride in the header.
    expect(MIGRATION_0077).toContain('chain head = 0073');
    expect(MIGRATION_0077).toContain('staging clone first');
  });
});

// ─── Enqueue → settle → batch, through the shipped craft engine ────

describe('craft engine — enqueue, settle, crafted batch lands', () => {
  const LEVERS: CraftLeverValues = {
    craftXpRate: 0.775, craftTimeScalar: 1, craftQualityShift: 0,
    gearTemperBaseChance: 0.05, refineBaseYield: 0.8,
    repairWorkRateBase: 20, repairMasterySpeedPerLevel: 0.02,
    repairMasteryEfficiencyPerLevel: 0.02,
    shieldTechWorkRateBase: 500, shieldTechMasterySpeedPerLevel: 0.02,
    shieldTechMasteryEfficiencyPerLevel: 0.02,
  };

  function harness(recipeScrapCosts?: Record<string, number>) {
    const profileView = {
      player_level: 10, player_xp: 0, credits: 0,
      materials: { Scrap: 1000, BallisticParts: 1000 },
      essences: { VoidEssence: 100 },
      consumables: {},
      workshop_benches: 1, legendary_cores: 0,
      workshop_tools: { owned: {}, fitted: {}, charges: {} },
      offline_cap_hours: null,
    } as unknown as CraftProfileView;
    const jobs: CraftJobRecord[] = [];
    const batches: Array<{ type: string; qty: number; quality: number; origin: string; recipeId: string | null }> = [];
    let now = 1_000_000;
    const adapter = {
      nowMs: () => now,
      rng: () => 0.5,
      uuid: (() => { let n = 0; return () => `coating-job-${++n}`; })(),
      profile: () => profileView,
      activeAction: () => ({ kind: 'crafting', lastHeartbeatMs: now }),
      jobs: () => jobs,
      addJob: (j: CraftJobRecord) => { jobs.push(j); },
      masteryLevel: () => 1,
      skillBonus: (_id: string, key: string) => computeSkillBonuses({})[key as never] ?? 0,
      addMasteryXp: () => {},
      addStat: () => {},
      addBatch: (_pid: string, type: string, qty: number, quality: number, origin: string, _c: string | null, recipeId: string | null) => {
        batches.push({ type, qty, quality, origin, recipeId });
      },
      burnOneBatchUnit: () => null,
      insertGearItem: () => 'coating-item-1',
      vehicleInfo: () => null,
      restoreVehicle: () => null,
      levers: () => (recipeScrapCosts ? { ...LEVERS, recipeScrapCosts } : LEVERS),
    } as unknown as CraftAdapter;
    return {
      jobs, batches, profileView,
      enqueue: (units = 1) => enqueueCraftJobCore(adapter, P, {
        bench: 1, recipeId: 'recipe_elemental_coating', units,
        consumableEfficiencyBonus: 0,
        fixerBonuses: { craftSpeedBonus: 0, workshopQueueBonus: 0, rushReductionCapBonus: 0, coreCatalystDrawBonus: 0 },
      } as never),
      settle: (job: CraftJobRecord) => {
        now += job.unit_duration_ms + 1000;
        settleCraftJobsCore(adapter, P, { maxAdvanceMs: job.unit_duration_ms + 1000 });
      },
    };
  }

  it('escrows the content inputs and charges them from materials + essences', () => {
    const h = harness();
    const { job } = h.enqueue();
    expect(job.escrow_inputs).toEqual({ Scrap: 75, BallisticParts: 8, VoidEssence: 3 });
    expect(job.unit_duration_ms).toBe(20 * 60 * 1000);
    expect((h.profileView as unknown as { materials: Record<string, number> }).materials['Scrap']).toBe(925);
    expect((h.profileView as unknown as { essences: Record<string, number> }).essences['VoidEssence']).toBe(97);
  });

  it('the Scrap lever reprices the escrow at enqueue (5 instead of 75)', () => {
    const h = harness({ recipe_elemental_coating: 5 });
    const { job } = h.enqueue();
    expect(job.escrow_inputs['Scrap']).toBe(5);
    expect(job.escrow_inputs['BallisticParts']).toBe(8);
    expect(job.escrow_inputs['VoidEssence']).toBe(3);
  });

  it('settling the job lands one crafted ElementalCoating batch at rolled quality', () => {
    const h = harness();
    const { job } = h.enqueue();
    h.settle(job);
    expect(h.batches).toHaveLength(1);
    expect(h.batches[0]).toMatchObject({ type: 'ElementalCoating', qty: 1, origin: 'crafted', recipeId: 'recipe_elemental_coating' });
    // Bounds 75–150 at mastery 1, rng 0.5 → the midpoint roll.
    expect(h.batches[0].quality).toBeCloseTo(112.5, 5);
    expect(job.xp_awarded).toBeGreaterThan(0);
  });
});

// ─── Consumption: the sim reads the effect now ──────────────────────

describe('boss sim — a prepared coating moves the break score', () => {
  const boss = REGION_1_BOSSES[3]; // Ashgut
  const weapon: Weapon = {
    id: 'coating-test-gun', name: 'Coating Test Gun', level: 22,
    rarity: Rarity.Legendary, weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline, element: Element.Fire,
    rollQuality: 100, baseDamage: 60, attackSpeed: 2, critChance: 0.2,
    critDamage: 2, statusChance: 0, statusDamage: 0, bossDamageMod: 0.2,
    waveDamageMod: 0, shieldDamageMod: 1, armorDamageMod: 1,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 1, combatPower: 0, bossPower: 0, farmPower: 0, economyScore: 0,
  };
  const base = {
    primary: weapon, secondary: null, heavy: null, ordnance: null,
    shield: null, classMod: null, relic: null, consumables: {},
    risk: RiskSetting.Balanced, boss, playerLevel: 22,
    skillBonuses: {}, pityCount: 0, playerCredits: 0,
  } as const;

  it('quality 100 multiplies the break score by the def’s 1.15', () => {
    const bare = simulateBoss({ ...base });
    const coated = simulateBoss({
      ...base,
      consumables: { ElementalCoating: 1 },
      consumableQuality: { ElementalCoating: 100 },
    });
    expect(bare.breakScore).toBeGreaterThan(0);
    expect(bare.breakScore).toBeLessThan(1); // the multiplier is not capped away
    expect(coated.breakScore).toBeCloseTo(bare.breakScore * 1.15, 10);
  });

  it('a 150-quality batch multiplies by 1.225 — crafted quality is priced', () => {
    const bare = simulateBoss({ ...base });
    const coated = simulateBoss({
      ...base,
      consumables: { ElementalCoating: 1 },
      consumableQuality: { ElementalCoating: 150 },
    });
    expect(coated.breakScore).toBeCloseTo(bare.breakScore * 1.225, 10);
  });

  it('the attempt charges the coating (onAttempt, win or lose)', () => {
    expect(getBossConsumableUsage({ ElementalCoating: 2 }, true, 1.4)).toEqual({ ElementalCoating: 2 });
    expect(getBossConsumableUsage({ ElementalCoating: 2 }, false, 0.4)).toEqual({ ElementalCoating: 2 });
  });
});
