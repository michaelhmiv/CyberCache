/**
 * Crafting-as-occupation (migration 0024) — the quality wiring, the XP
 * peg, and the TS↔SQL parity pins (brief §2.3, §2.4, §2.12).
 *
 * The heart of the slice: crafted quality % must be READ by the
 * consumption engines. Proven here at the shipped seams:
 *   - roaming: the consumable engine prices its survival buffer from
 *     the per-unit quality profile of the batches it will burn;
 *   - boss: the simulator's survival pools scale with the consumed
 *     quality the verify-boss route derives from batch rows;
 *   - a flat-100 batch is BIT-IDENTICAL to the pre-slice numbers in
 *     both engines (the compatibility law);
 *   - crafting XP/hour is exactly craftXpRate × roaming's benchmark,
 *     and the lever validator hard-clamps the rate into [0.70, 0.85];
 *   - temper keeps the best of its draws through the shared
 *     generators; refine yields follow the mastery formula;
 *   - offline craft settlement honors the caller-supplied cap (F5);
 *   - migration 0024's embedded catalog + market whitelist cannot
 *     drift from src/content/crafting.ts silently.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_CRAFT_RECIPES,
  GEAR_FRAME_DURATION_MS,
  benchmarkXpPerHour,
  craftQualityBounds,
  craftUnitXp,
  refineOutputCount,
  type CraftRecipe,
} from '../content/crafting';
import { resolveEconomyConfigValues, validateEconomyConfigValue } from '../server/economy/config';
import { activateFromInventory, bufferHealPerUnit } from '../lib/consumables/roamingConsumableEngine';
import { buildConsumableQualityProfile, weightedQualityForUnits } from '../lib/consumables/batchProfile';
import { simulateBoss, type BossSimulationInput } from '../lib/simulation/bossSimulator';
import { REGION_1_BOSSES } from '../constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';
import { generateCraftedGearCandidate, generateCraftedGearItem } from '../server/writes/craftGear';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import type { CraftJobRecord } from '../server/writes/craftEngine';

// ---------------------------------------------------------------------------
// §2.3 — the XP peg
// ---------------------------------------------------------------------------

describe('crafting XP peg (brief §2.3)', () => {
  it('matches the brief worked points exactly', () => {
    // L5 MedKit 12 min (best area 1.2 xp/tick): 223 vs roaming 288.
    expect(craftUnitXp(12 * 60 * 1000, 5, 0.775)).toBe(223);
    // L12 EMP Charge 22 min (1.65 xp/tick): 563 vs 726.
    expect(craftUnitXp(22 * 60 * 1000, 12, 0.775)).toBe(563);
    // L25 Adrenaline Shot 60 min (2.4 xp/tick): 2232 vs 2880.
    expect(craftUnitXp(60 * 60 * 1000, 25, 0.775)).toBe(2232);
    // L25 Epic gear frame 240 min: 8928 vs 11520.
    expect(craftUnitXp(240 * 60 * 1000, 25, 0.775)).toBe(8928);
  });

  it('the measured crafting-vs-roaming ratio is exactly the peg, inside the band', () => {
    for (const level of [1, 5, 12, 25, 40, 80]) {
      const perHour = craftUnitXp(60 * 60 * 1000, level, 0.775);
      const ratio = perHour / benchmarkXpPerHour(level);
      expect(ratio).toBeCloseTo(0.775, 3);
      expect(ratio).toBeGreaterThanOrEqual(0.7);
      expect(ratio).toBeLessThanOrEqual(0.85);
    }
  });

  it('craftXpRate can never leave [0.70, 0.85]: the validator rejects out-of-band values and the accessor falls back to the in-band default', () => {
    // The #210 pattern: validation rejects, never clamps — an
    // out-of-band stored value is invalid and ignored, so the
    // effective rate is an in-band stored value or the default.
    expect(validateEconomyConfigValue('craftXpRate', 0.5)).toBeNull();
    expect(validateEconomyConfigValue('craftXpRate', 0.99)).toBeNull();
    expect(validateEconomyConfigValue('craftXpRate', 0.775)).toBe(0.775);
    expect(validateEconomyConfigValue('craftXpRate', 'fast')).toBeNull();
    expect(resolveEconomyConfigValues({ craftXpRate: 0.99 }).craftXpRate).toBe(0.775);
    expect(resolveEconomyConfigValues({ craftXpRate: 0.8 }).craftXpRate).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// §2.4 — quality bounds + the batch quality profile
// ---------------------------------------------------------------------------

describe('quality bounds + batch profile (brief §2.4)', () => {
  it('bounds follow the mastery/bench/catalyst formula', () => {
    // MedKit def bounds 75/125. Mastery 1, Basic bench: unchanged.
    expect(craftQualityBounds({ consumableType: 'MedKit', masteryLevel: 1, bench: 1, catalyst: false })).toEqual({ min: 75, max: 125, cap: 175 });
    // Mastery 11: min +15, max +20.
    expect(craftQualityBounds({ consumableType: 'MedKit', masteryLevel: 11, bench: 1, catalyst: false })).toEqual({ min: 90, max: 145, cap: 175 });
    // Lab adds +5 min; catalyst adds +10/+15.
    expect(craftQualityBounds({ consumableType: 'MedKit', masteryLevel: 1, bench: 3, catalyst: true })).toEqual({ min: 90, max: 140, cap: 175 });
    // Crafted Patch Kit override: 75/130 (not the def display 75/150).
    expect(craftQualityBounds({ consumableType: 'PatchKit', masteryLevel: 1, bench: 1, catalyst: false })).toEqual({ min: 75, max: 130, cap: 175 });
  });

  it('the profile burns quality-ascending FIFO and pads/truncates to the authoritative count', () => {
    const batches = [
      { consumable_type: 'MedKit', quantity: 1, quality_percent: 150, created_at: '2026-10-30T00:00:00.000Z' },
      { consumable_type: 'MedKit', quantity: 2, quality_percent: 75, created_at: '2026-10-29T00:00:00.000Z' },
    ];
    // Batches cover 3 units but the profile count says 2: the two 75s burn first.
    expect(buildConsumableQualityProfile(batches, { MedKit: 2 }).MedKit).toEqual([75, 75]);
    // Count beyond batch coverage pads at flat 100 (legacy inventory).
    expect(buildConsumableQualityProfile(batches, { MedKit: 5 }).MedKit).toEqual([75, 75, 150, 100, 100]);
    expect(weightedQualityForUnits([75, 75, 150], 2)).toBe(75);
    expect(weightedQualityForUnits([75, 150], 2)).toBe(112.5);
  });
});

// ---------------------------------------------------------------------------
// §2.4 wiring — roaming engine
// ---------------------------------------------------------------------------

describe('roaming engine reads crafted quality (brief §2.4)', () => {
  it('a 150% MedKit buffer holds 225/unit; a 100% batch is bit-identical to no profile', () => {
    expect(bufferHealPerUnit('MedKit', 150)).toBe(225);
    expect(bufferHealPerUnit('MedKit', 100)).toBe(150);
    const crafted = activateFromInventory({ MedKit: 2 }, 0, { MedKit: [150, 150] });
    const flat = activateFromInventory({ MedKit: 2 }, 0, { MedKit: [100, 100] });
    const legacy = activateFromInventory({ MedKit: 2 }, 0);
    const bufferOf = (s: typeof crafted) => s.slots.find((x) => x.consumableId === 'MedKit')?.remainingBuffer;
    expect(bufferOf(crafted)).toBe(450);
    expect(bufferOf(flat)).toBe(300);
    expect(bufferOf(legacy)).toBe(300);
    // Bit-identical gameplay state (the flat activation also records
    // the [100, 100] profile it priced from — the numbers are the law):
    const gameplay = (s: typeof crafted) => s.slots.map((x) => ({
      id: x.consumableId, buffer: x.remainingBuffer, expires: x.expiresAtTick,
      regen: x.remainingRegenTicks, armed: x.armed,
    }));
    expect(gameplay(flat)).toEqual(gameplay(legacy));
  });

  it('mixed-quality pools price at the quantity-weighted average', () => {
    const mixed = activateFromInventory({ MedKit: 2 }, 0, { MedKit: [75, 150] });
    const slot = mixed.slots.find((x) => x.consumableId === 'MedKit');
    expect(slot?.remainingBuffer).toBeCloseTo(337.5, 5); // 150 × (0.75 + 1.5)
  });
});

// ---------------------------------------------------------------------------
// §2.4 wiring — boss simulator
// ---------------------------------------------------------------------------

function weapon(): Weapon {
  return {
    id: 'quality-test-gun', name: 'Quality Test Gun', level: 22, rarity: Rarity.Rare,
    weaponType: WeaponType.SMG, manufacturer: Manufacturer.Redline, element: Element.Fire,
    rollQuality: 100, baseDamage: 60, attackSpeed: 2, critChance: 0.2, critDamage: 1.5,
    statusChance: 0, statusDamage: 0, bossDamageMod: 0.2, waveDamageMod: 0,
    shieldDamageMod: 1, armorDamageMod: 1, offlineEarningsMod: 0, rareDropChanceMod: 0,
    scrapYieldMod: 0, parts: [], affixes: [], sourceTag: DropSource.WorldDrop,
    isLocked: false, pixelSeed: 1, combatPower: 0, bossPower: 0,
  } as Weapon;
}

describe('boss sim reads consumed quality (brief §2.4)', () => {
  const base: BossSimulationInput = {
    primary: weapon(), secondary: null, heavy: null, ordnance: null, shield: null,
    classMod: null, relic: null, consumables: { MedKit: 3, ShieldCell: 2 },
    risk: RiskSetting.Balanced, boss: REGION_1_BOSSES[3], playerLevel: 22,
    skillBonuses: {}, pityCount: 0, playerCredits: 0,
  };

  it('150% consumables measurably beat flat-100 survival; flat-100 is bit-identical to absent', () => {
    const noQuality = simulateBoss(base);
    const flat = simulateBoss({ ...base, consumableQuality: { MedKit: 100, ShieldCell: 100 } });
    const crafted = simulateBoss({ ...base, consumableQuality: { MedKit: 150, ShieldCell: 150 } });
    expect(flat.survivalScore).toBe(noQuality.survivalScore);
    expect(flat.winChance).toBe(noQuality.winChance);
    expect(flat.effectiveDPS).toBe(noQuality.effectiveDPS);
    expect(crafted.survivalScore).toBeGreaterThan(flat.survivalScore);
  });
});

// ---------------------------------------------------------------------------
// §2.5 — temper + refine yields
// ---------------------------------------------------------------------------

describe('gear temper + refining (brief §2.5)', () => {
  it('temper keeps the highest rollQuality of its draws; crafted gear carries provenance and no legendary effect', () => {
    // One deterministic value stream; candidates consume it in order.
    const values: number[] = [];
    let seed = 42;
    for (let i = 0; i < 20000; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      values.push(seed / 2147483648);
    }
    const streamFrom = (start: number) => {
      let idx = start;
      return { rng: () => values[idx++ % values.length], used: () => idx - start };
    };
    const s1 = streamFrom(0);
    const c1 = generateCraftedGearCandidate({ slot: 'weapon', rarity: Rarity.Rare, itemLevel: 20, creatorId: 'crafter-1', rng: s1.rng });
    const s2 = streamFrom(s1.used());
    const c2 = generateCraftedGearCandidate({ slot: 'weapon', rarity: Rarity.Rare, itemLevel: 20, creatorId: 'crafter-1', rng: s2.rng });
    const s3 = streamFrom(s1.used() + s2.used());
    const c3 = generateCraftedGearCandidate({ slot: 'weapon', rarity: Rarity.Rare, itemLevel: 20, creatorId: 'crafter-1', rng: s3.rng });

    const sAll = streamFrom(0);
    const tempered = generateCraftedGearItem({ slot: 'weapon', rarity: Rarity.Rare, itemLevel: 20, creatorId: 'crafter-1', draws: 3, rng: sAll.rng });
    expect(tempered.rollQuality).toBe(Math.max(c1.rollQuality, c2.rollQuality, c3.rollQuality));
    expect(tempered.payload.origin).toBe('crafted');
    expect(tempered.payload.craftedBy).toBe('crafter-1');
    expect('legendaryEffectId' in tempered.payload).toBe(false);
    expect(tempered.rarity).toBe('Rare');
  });

  it('refine yields: 8 / 9 / 10 per 10 at mastery 1 / 25 / 50', () => {
    const recipe = ALL_CRAFT_RECIPES.find((r) => r.id === 'refine_refined_alloy')!;
    expect(refineOutputCount(recipe, 1, 0.8)).toBe(8);
    expect(refineOutputCount(recipe, 25, 0.8)).toBe(9);
    expect(refineOutputCount(recipe, 50, 0.8)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// F5 — offline craft settlement honors the cap
// ---------------------------------------------------------------------------

describe('offline craft settlement honors the AFK cap (flag F5)', () => {
  it('a 10h absence with a 2h cap advances exactly 2h of job time', async () => {
    const NOW = new Date('2026-10-31T12:00:00.000Z').getTime();
    const store = new InMemoryChefGameplayStore(() => new Date(NOW));
    const playerId = 'f5-player';
    store.seedProfile({ id: playerId, player_level: 25, materials: {}, consumables: {} });
    store.seedActiveAction({
      user_id: playerId, active_action: 'crafting', target_type: null, target_id: null,
      target_label: null, scene_key: null, notes: null, expected_finish_at: null,
      activity_payload: {}, public_payload: {}, public_visible: false,
      started_at: new Date(NOW - 10 * 3600 * 1000).toISOString(),
      last_heartbeat_at: new Date(NOW - 10 * 3600 * 1000).toISOString(),
      updated_at: new Date(NOW - 10 * 3600 * 1000).toISOString(),
    } as Parameters<InMemoryChefGameplayStore['seedActiveAction']>[0]);
    const job: CraftJobRecord = {
      id: 'f5-job', owner_user_id: playerId, bench: 1, kind: 'consumable',
      recipe_id: 'recipe_medkit', units_total: 3, units_completed: 0,
      unit_duration_ms: 3600 * 1000, accrued_ms: 0, status: 'active',
      escrow_inputs: { ScrapAlloy: 45, ReactiveComponents: 24 }, escrow_catalyst: {},
      rush_ticket_quality: null, rush_ticket_origin: null,
      snapshot: {
        toolId: null, toolQualityMultiplier: null, toolDurationMultiplier: null,
        toolRefineYieldBonus: null, toolBonusUnitChance: null, skillDurationMultiplier: 1,
        rushReduction: 0, craftTimeScalar: 1, catalystMaterialId: null, gearRarity: null,
      },
      xp_awarded: 0, outputs: [], tool_charged: false,
      created_at_ms: NOW - 10 * 3600 * 1000, last_settled_ms: NOW - 10 * 3600 * 1000,
      completed_at_ms: null,
    };
    store.seedCraftJob(job);
    const result = (await store.settleOfflineCraftJobs(playerId, 2 * 3600 * 1000)) as {
      advanced_ms: number; completions: unknown[];
    };
    expect(result.advanced_ms).toBe(2 * 3600 * 1000);
    expect(result.completions).toHaveLength(2);
    expect(job.units_completed).toBe(2);
    expect(job.status).toBe('active'); // third unit still on the bench
  });
});

// ---------------------------------------------------------------------------
// Migration 0024 parity pins
// ---------------------------------------------------------------------------

describe('migration 0024 parity pins', () => {
  const sql = readFileSync(resolve(__dirname, '../../db/migrations/0024_crafting_occupation.sql'), 'utf8');

  function projectRecipe(r: CraftRecipe): Record<string, unknown> {
    const base: Record<string, unknown> = {
      id: r.id, kind: r.kind, name: r.name, category: r.category, inputs: r.inputs,
      unitDurationMs: r.unitDurationMs, requiresLevel: r.requiresLevel,
      requiresBench: r.requiresBench, station: r.station,
    };
    if (r.kind === 'consumable') base.consumableType = r.consumableType;
    if (r.kind === 'refine') { base.outputMaterial = r.outputMaterial; base.outputBase = r.outputBase; }
    if (r.kind === 'gear') { base.gearSlot = r.gearSlot; base.durationByRarityMs = GEAR_FRAME_DURATION_MS; }
    if (r.kind === 'tool') base.toolId = r.toolId;
    if (r.requiresMastery) base.requiresMastery = r.requiresMastery;
    return base;
  }

  it('the embedded SQL catalog deep-equals the TS catalog (49 recipes)', () => {
    const match = sql.match(/\$catalog\$([\s\S]*?)\$catalog\$/);
    expect(match).toBeTruthy();
    const catalog = JSON.parse(match![1]) as Record<string, unknown>[];
    expect(catalog).toHaveLength(49);
    // 0038's batch recipes carry requiresResearch and postdate 0024;
    // their SQL parity is pinned against 0038 in research.test.ts.
    // 0043's exclusive recipes carry requiresStanding and postdate
    // 0024 the same way; their SQL parity is pinned against 0043 in
    // manufacturerStanding.test.ts.
    // 0044's Calibration Core recipe postdates 0024 the same way;
    // its SQL parity is pinned against 0044 in
    // shieldTechServices.test.ts.
    expect(catalog).toEqual(
      ALL_CRAFT_RECIPES.filter(
        (r) => !r.requiresResearch && !r.requiresStanding && r.id !== 'recipe_calibration_core',
      ).map(projectRecipe),
    );
  });

  it('the market material whitelist is exactly the 20 tradeable material ids', () => {
    const expected = [
      'ScrapAlloy', 'BallisticParts', 'ReactiveComponents', 'TechFragments', 'VoidDust',
      'Siltglass', 'NitrocellGel', 'HeartwoodResin', 'ForgeheartIngots', 'PrismShards',
      'MagnetiteCores', 'MycoSteelFiber', 'RefinedAlloy', 'TemperedParts', 'StabilizedCells',
      'WovenCircuits', 'CondensedVoid', 'CompositePlating', 'CircuitLattice', 'Voidweave',
    ];
    const fnStart = sql.toLowerCase().indexOf('create or replace function public.cc_market_create_material');
    const fnBody = sql.slice(fnStart, fnStart + 6000);
    for (const id of expected) expect(fnBody).toContain(`'${id}'`);
    expect(fnBody).not.toContain('CryoEssence');
  });

  it('the SQL quality-bounds table carries the PatchKit crafted override (75/130)', () => {
    const boundsStart = sql.indexOf('create or replace function public.cc_craft_quality_bounds');
    const boundsBody = sql.slice(boundsStart, boundsStart + 5000);
    expect(boundsBody).toContain("('PatchKit', 75::numeric, 130::numeric)");
    expect(boundsBody).toContain("'FieldPatchKit'");
    expect(boundsBody).toContain("'MasterPatchKit'");
    expect(boundsBody).toContain("'FuelCell'");
  });
});
