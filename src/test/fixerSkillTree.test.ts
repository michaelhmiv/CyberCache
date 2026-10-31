/**
 * Fixer skill tree (migration 0029) — the fourth tree, for
 * support/economy builds.
 *
 * Laws under test (design brief: cybercache-prep/design-briefs/
 * expansion-pack/fixer-skill-tree.md; defaults approved 2026-10-31):
 *  - Shape mirrors the shipped trees: 12 small / 4 major / 1 keystone,
 *    77 points to max; the point budget DOES NOT change (level − 1,
 *    99 lifetime against 303 points of trees).
 *  - Zero dead keys: every Fixer effect key is consumed through a
 *    shipped path (the registry structural law lives in
 *    keystoneSkillLayer.test.ts; here each consumer is exercised).
 *  - No double-dip with Scavenger: craft-time terms compose
 *    multiplicatively under a 0.60× floor; fee terms are disjoint by
 *    drop source (found vs crafted) under one ≤ 1 clamp; House Brand
 *    never touches repair service fees.
 *  - Class mods: SKILL_NODE_IDS is DERIVED from SKILL_NODES; the
 *    legacy 35 ids keep their exact positions; Fixer mods generate,
 *    name, and resolve visually.
 *  - Every bonus derives server-side from the actor's own records;
 *    request-body assertions of Fixer bonuses change nothing.
 *  - Respec (cc_retrain) prices and zeroes Fixer spends; in-flight
 *    job snapshots are respec-immune.
 *
 * The SQL twin is pinned textually here and exercised against
 * embedded Postgres in the slice verification harness.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as skillTreesModule from '../constants/skillTrees';
import { SKILL_NODES, getSkillTreeNodes } from '../constants/skillTrees';
import { SKILL_TREE_VISUALS } from '../constants/skillTreeVisuals';
import { SkillTreeType, Rarity, DropSource } from '../types/game';
import { computeSkillBonuses } from '../lib/skills/skillBonuses';
import { generateClassMod, SKILL_NODE_IDS } from '../server/lib/generators/classModGenerator';
import { buildClassModVisualSpec } from '../lib/gearArt/buildClassModVisualSpec';
import { createRNG } from '../lib/utils/rng';
import {
  effectiveVehicleYield,
  vehicleBurnPerTick,
  vehicleDecayPerTick,
} from '../lib/vehicles/vehicles';
import { marketFeeReduction, marketFeeForSeller } from '../lib/market/marketFee';
import { repairServiceFee } from '../content/repair';
import {
  composedCraftQualityShift,
  fixerCraftSpeedDurationMultiplier,
  gearTemperChance,
  getCraftRecipe,
  rushTicketTimeReduction,
} from '../content/crafting';
import {
  repairEfficiencyMultiplier,
  repairEfficiencyWithSkill,
  repairKitUnitDurationMs,
  repairSpeedRateMultiplier,
} from '../content/repair';
import { processRoamingClaim, type ClaimRequest } from '../server/chef';
import { InMemoryWriteStore } from '../server/writes/memory';
import {
  emptyWriteSeed,
  type SkillNodeData,
  type WriteItemData,
  type WriteSeed,
} from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import type { Vehicle } from '../types/items';

const P = '11111111-1111-4111-8111-111111111111'; // Fixer crafter
const Q = '22222222-2222-4222-8222-222222222222'; // plain / buyer / owner
const MECH = '33333333-3333-4333-8333-333333333333'; // mechanic

let nonceN = 0;
const nonce = () => `fixer-nonce-${++nonceN}-abcdefgh`;

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'fixer', display_name: null, player_level: 30, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'fixer@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 2, workshop_tools: {}, legendary_cores: 10,
    ...over,
  } as ProfileRowData;
}

function skillNodeData(): SkillNodeData[] {
  return SKILL_NODES.map((n) => ({
    id: n.id, tree: n.tree, tier: n.tier, slot_index: n.index, name: n.name,
    description: n.description, node_type: n.type, max_points: n.maxPoints,
    per_point_cost: n.cost, effects: n.effects as SkillNodeData['effects'],
    requires: n.requires ?? [],
  }));
}

function makeStore(seedFn: (s: WriteSeed) => void, opts: Record<string, unknown> = {}) {
  const s = emptyWriteSeed();
  s.skillNodes = skillNodeData();
  seedFn(s);
  return new InMemoryWriteStore(s, {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
    ...opts,
  });
}

const FIXER_MAXED: Record<string, number> = {
  fix_craft_time_1: 5, fix_craft_time_2: 5,
  fix_quality_1: 5, fix_quality_2: 5,
  fix_repair_speed_1: 5, fix_repair_speed_2: 5,
  fix_repair_eff_1: 5, fix_repair_eff_2: 5,
  fix_vehicle_yield_1: 5, fix_vehicle_yield_2: 5,
  fix_vehicle_fuel_1: 5, fix_vendor_1: 5,
  fix_major_1: 1, fix_major_2: 1, fix_major_3: 1, fix_major_4: 1,
  fix_keystone: 1,
};

// ---------------------------------------------------------------------------
// 1. Tree shape, maps, and the budget law
// ---------------------------------------------------------------------------

describe('Fixer tree — shape and identity', () => {
  const fixer = getSkillTreeNodes(SkillTreeType.Fixer);

  it('has the shipped shape: 12 small / 4 major / 1 keystone, tiers 1–9 in pairs', () => {
    expect(fixer).toHaveLength(17);
    expect(fixer.filter((n) => n.type === 'small')).toHaveLength(12);
    expect(fixer.filter((n) => n.type === 'major')).toHaveLength(4);
    expect(fixer.filter((n) => n.type === 'keystone')).toHaveLength(1);
    for (const n of fixer) {
      expect(n.id.startsWith('fix_')).toBe(true);
      if (n.type === 'small') { expect(n.cost).toBe(1); expect(n.maxPoints).toBe(5); }
      if (n.type === 'major') { expect(n.cost).toBe(3); expect(n.maxPoints).toBe(1); }
      if (n.type === 'keystone') { expect(n.cost).toBe(5); expect(n.maxPoints).toBe(1); }
    }
    const costToMax = fixer.reduce((sum, n) => sum + n.cost * n.maxPoints, 0);
    expect(costToMax).toBe(77);
    const allCost = SKILL_NODES.reduce((sum, n) => sum + n.cost * n.maxPoints, 0);
    expect(allCost).toBe(303);
  });

  it('carries the brief\'s exact effect values', () => {
    const byId = new Map(fixer.map((n) => [n.id, n]));
    expect(byId.get('fix_craft_time_1')?.effects).toEqual({ craftSpeedBonus: 0.025 });
    expect(byId.get('fix_quality_1')?.effects).toEqual({ craftQualityBonus: 1.0 });
    expect(byId.get('fix_repair_speed_1')?.effects).toEqual({ repairSpeedBonus: 0.03 });
    expect(byId.get('fix_repair_eff_1')?.effects).toEqual({ repairEfficiencyBonus: 0.025 });
    expect(byId.get('fix_vehicle_yield_1')?.effects).toEqual({ vehicleYieldBonus: 0.02 });
    expect(byId.get('fix_vehicle_fuel_1')?.effects).toEqual({ vehicleFuelBonus: 0.03 });
    expect(byId.get('fix_vendor_1')?.effects).toEqual({ vendorBuybackBonus: 0.01 });
    expect(byId.get('fix_major_1')?.effects).toEqual({ craftTemperBonus: 0.05 });
    expect(byId.get('fix_major_2')?.effects).toEqual({ vehicleDecayReduction: 0.25 });
    expect(byId.get('fix_major_3')?.effects).toEqual({ craftedItemFeeReduction: 0.15 });
    expect(byId.get('fix_major_4')?.effects).toEqual({ bonusRepairJobs: 1 });
    expect(byId.get('fix_keystone')?.effects).toEqual({
      coreCatalystDrawBonus: 1, workshopQueueBonus: 1, rushReductionCapBonus: 0.10,
    });
    expect(byId.get('fix_major_1')?.requires).toEqual(['fix_quality_1', 'fix_quality_2']);
    expect(byId.get('fix_major_2')?.requires).toEqual(['fix_vehicle_yield_1', 'fix_vehicle_yield_2']);
    expect(byId.get('fix_major_3')?.requires).toEqual(['fix_vendor_1']);
    expect(byId.get('fix_major_4')?.requires).toEqual(['fix_repair_speed_1', 'fix_repair_speed_2']);
    expect(byId.get('fix_keystone')?.requires).toEqual(['fix_major_1', 'fix_major_2', 'fix_major_4']);
  });

  it('every SkillTreeType resolves in the visuals registry and both tree-name maps', () => {
    for (const tree of Object.values(SkillTreeType)) {
      expect(SKILL_TREE_VISUALS[tree], `visuals for ${tree}`).toBeDefined();
    }
    expect(SKILL_TREE_VISUALS[SkillTreeType.Fixer]).toMatchObject({
      sigil: '⚒', color: '#2EC4B6', accentColor: '#FFD166', label: 'Fixer',
      description: 'Crafting, repair, vehicles, and trade.',
    });
    // skillBonuses TREE_NAME_MAP: a Fixer treeBonus mod with no spends
    // grants +1 effective point to every Fixer node (capped per node).
    const bonuses = computeSkillBonuses({}, { treeBonus: 'Fixer', nodeBoosts: {} });
    expect(bonuses.craftSpeedBonus).toBeCloseTo(0.05, 10); // two nodes × 1pt × 0.025
    expect(bonuses.craftQualityBonus).toBeCloseTo(2, 10);
    expect(bonuses.bonusRepairJobs).toBe(1);
    expect(bonuses.rushReductionCapBonus).toBeCloseTo(0.1, 10);
  });

  it('the dead MAX_SKILL_POINTS = 50 constant is gone', () => {
    expect((skillTreesModule as Record<string, unknown>).MAX_SKILL_POINTS).toBeUndefined();
  });

  it('computeSkillBonuses aggregates a maxed Fixer tree to the brief totals', () => {
    const b = computeSkillBonuses(FIXER_MAXED, { nodeBoosts: {} });
    expect(b.craftSpeedBonus).toBeCloseTo(0.25, 10);
    expect(b.craftQualityBonus).toBeCloseTo(10, 10);
    expect(b.repairSpeedBonus).toBeCloseTo(0.3, 10);
    expect(b.repairEfficiencyBonus).toBeCloseTo(0.25, 10);
    expect(b.vehicleYieldBonus).toBeCloseTo(0.2, 10);
    expect(b.vehicleFuelBonus).toBeCloseTo(0.15, 10);
    expect(b.vendorBuybackBonus).toBeCloseTo(0.05, 10);
    expect(b.craftTemperBonus).toBeCloseTo(0.05, 10);
    expect(b.vehicleDecayReduction).toBeCloseTo(0.25, 10);
    expect(b.craftedItemFeeReduction).toBeCloseTo(0.15, 10);
    expect(b.bonusRepairJobs).toBe(1);
    expect(b.coreCatalystDrawBonus).toBe(1);
    expect(b.workshopQueueBonus).toBe(1);
    expect(b.rushReductionCapBonus).toBeCloseTo(0.1, 10);
  });
});

// ---------------------------------------------------------------------------
// 2. Class mods — derived pool, parity, Fixer reachability
// ---------------------------------------------------------------------------

const LEGACY_SMALL_IDS = [
  'gs_dmg_1', 'gs_dmg_2', 'gs_crit_1', 'gs_crit_2', 'gs_critdmg_1', 'gs_critdmg_2',
  'gs_speed_1', 'gs_speed_2', 'gs_boss_1', 'gs_boss_2', 'gs_status_1', 'gs_shield_1',
  'demo_ord_1', 'demo_ord_2', 'demo_exp_1', 'demo_exp_2', 'demo_armor_1', 'demo_armor_2',
  'demo_stag_1', 'demo_stag_2', 'demo_heavy_1', 'demo_heavy_2', 'demo_shield_1',
  'scav_idle_1', 'scav_idle_2', 'scav_drop_1', 'scav_drop_2', 'scav_qty_1', 'scav_qty_2',
  'scav_scrap_1', 'scav_scrap_2', 'scav_cons_1', 'scav_cons_2', 'scav_cache_1', 'scav_fee_1',
];
const FIXER_SMALL_IDS = [
  'fix_craft_time_1', 'fix_craft_time_2', 'fix_quality_1', 'fix_quality_2',
  'fix_repair_speed_1', 'fix_repair_speed_2', 'fix_repair_eff_1', 'fix_repair_eff_2',
  'fix_vehicle_yield_1', 'fix_vehicle_yield_2', 'fix_vehicle_fuel_1', 'fix_vendor_1',
];

describe('class mods — derived SKILL_NODE_IDS', () => {
  it('the derived pool is the frozen legacy 35 in order, then the 12 Fixer smalls', () => {
    expect(SKILL_NODE_IDS).toEqual([...LEGACY_SMALL_IDS, ...FIXER_SMALL_IDS]);
    // And it really is derived from the one registry:
    expect(SKILL_NODE_IDS).toEqual(
      SKILL_NODES.filter((n) => n.type === 'small').map((n) => n.id),
    );
  });

  it('zero-draw generation is bit-identical to the pre-derivation output', () => {
    // With rng ≡ 0 every draw takes index 0 / the range minimum, which
    // is invariant to the pool growing 35 → 47: this is exactly the
    // output the hand-copied literal produced before 0029.
    const mod = generateClassMod(10, () => 0);
    expect(mod.treeBonus).toBe(SkillTreeType.Gunslinger);
    expect(mod.name).toBe('Prototype Gunslinger Class Mod');
    expect(mod.nodeBoosts).toEqual({ gs_dmg_1: 1 });
  });

  it('seeded generation is deterministic and can roll Fixer bonuses', () => {
    const a = generateClassMod(20, createRNG(4242));
    const b = generateClassMod(20, createRNG(4242));
    expect({ ...a, id: 'x' }).toEqual({ ...b, id: 'x' });

    let sawFixerTree = false;
    let sawFixerBoost = false;
    for (let seed = 1; seed <= 400 && !(sawFixerTree && sawFixerBoost); seed++) {
      const mod = generateClassMod(20, createRNG(seed));
      if (mod.treeBonus === SkillTreeType.Fixer) {
        sawFixerTree = true;
        expect(mod.name).toContain('Fixer Class Mod');
        const spec = buildClassModVisualSpec(mod);
        expect(spec.treeBonus).toBe('Fixer');
        expect(spec.silhouette).toBeDefined();
      }
      if (Object.keys(mod.nodeBoosts).some((id) => id.startsWith('fix_'))) sawFixerBoost = true;
      for (const id of Object.keys(mod.nodeBoosts)) {
        expect(SKILL_NODE_IDS).toContain(id);
      }
    }
    expect(sawFixerTree).toBe(true);
    expect(sawFixerBoost).toBe(true);
  });

  it('a Fixer class mod\'s boosts flow through computeSkillBonuses', () => {
    const bonuses = computeSkillBonuses(
      {},
      { treeBonus: 'Fixer', nodeBoosts: { fix_craft_time_1: 2 } },
    );
    // nodeBoosts +2 on fix_craft_time_1, treeBonus +1 everywhere:
    // craft time nodes read 3 and 1 points → 4 × 0.025.
    expect(bonuses.craftSpeedBonus).toBeCloseTo(0.1, 10);
  });
});

// ---------------------------------------------------------------------------
// 3. Training, the shared budget, and respec
// ---------------------------------------------------------------------------

describe('training and respec — the budget does not change', () => {
  it('cc_train_skill accepts Fixer nodes, enforces prereqs and the shared level−1 budget', async () => {
    const store = makeStore((s) => {
      s.profiles = [profile({ id: P, player_level: 10 })]; // budget 9
    });
    const train = (nodeId: string) => store.trainSkill(P, nonce(), nodeId);

    await expect(train('fix_major_1')).rejects.toThrow(/Missing prerequisites/);
    for (let i = 0; i < 5; i++) await train('fix_craft_time_1'); // 5 pts
    await train('fix_quality_1'); // 6
    await train('fix_quality_2'); // 7
    const major = await train('fix_major_1'); // 8 (one budget point per train, both twins)
    expect(major.node_id).toBe('fix_major_1');
    // Budget is shared across ALL trees: 1 legacy point fits, the 10th fails.
    await train('gs_dmg_1'); // 9
    await expect(train('gs_dmg_2')).rejects.toThrow(/Insufficient skill points/);
    const spends = store.seed.profiles[0].skill_spends as Record<string, number>;
    expect(spends.fix_craft_time_1).toBe(5);
    expect(spends.fix_major_1).toBe(1);
  });

  it('respec charges total × 100cr INCLUDING Fixer points and zeroes them', async () => {
    const store = makeStore((s) => {
      s.profiles = [profile({
        id: P, credits: 10_000,
        skill_spends: { gs_dmg_1: 5, fix_craft_time_1: 5, fix_major_1: 1, fix_keystone: 1 },
      })];
    });
    const result = await store.retrain(P, nonce());
    // 12 points × 100cr.
    expect(result.total_price).toBe(1200);
    expect(store.seed.profiles[0].credits).toBe(10_000 - 1200);
    expect(store.seed.profiles[0].skill_spends).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 4. Pure formula pins (the composition rules themselves)
// ---------------------------------------------------------------------------

describe('Fixer formulas — composition rules', () => {
  it('craft speed: multiplicative after Scavenger, combined floor exactly 0.60', () => {
    expect(fixerCraftSpeedDurationMultiplier(0)).toBe(1);
    expect(fixerCraftSpeedDurationMultiplier(0.25)).toBeCloseTo(0.75, 10);
    expect(fixerCraftSpeedDurationMultiplier(0.5)).toBeCloseTo(0.75, 10); // capped at 0.25
    // The floor case is exercised through the enqueue snapshot below;
    // here the composed shift clamp:
    expect(composedCraftQualityShift(0, 0)).toBe(0);
    expect(composedCraftQualityShift(-10, 10)).toBe(0);
    expect(composedCraftQualityShift(10, 10)).toBe(20); // ceiling +20
    expect(composedCraftQualityShift(0, 25)).toBe(20);
    expect(composedCraftQualityShift(-10, 0)).toBe(-10); // floor −10
    expect(composedCraftQualityShift(5, 3)).toBe(8);
  });

  it('temper: base + 0.01 × mastery + Master Artificer, cap 0.30', () => {
    expect(gearTemperChance(1, 0.05)).toBeCloseTo(0.06, 10);
    expect(gearTemperChance(1, 0.05, 0.05)).toBeCloseTo(0.11, 10);
    expect(gearTemperChance(50, 0.05, 0.05)).toBe(0.3); // cap binds
  });

  it('rush ticket: min(0.45 + capBonus, 0.2 × quality/100)', () => {
    expect(rushTicketTimeReduction(100)).toBeCloseTo(0.2, 10);
    expect(rushTicketTimeReduction(250)).toBeCloseTo(0.45, 10);
    expect(rushTicketTimeReduction(250, 0.1)).toBeCloseTo(0.5, 10);
    expect(rushTicketTimeReduction(300, 0.1)).toBeCloseTo(0.55, 10); // keystone cap
  });

  it('repair efficiency: mastery cap 1.5 alone, composed ceiling 1.80', () => {
    expect(repairEfficiencyMultiplier(26, 0.02)).toBe(1.5); // mastery cap
    expect(repairEfficiencyWithSkill(1, 0.02, 0)).toBe(1);
    expect(repairEfficiencyWithSkill(1, 0.02, 0.25)).toBeCloseTo(1.25, 10);
    expect(repairEfficiencyWithSkill(26, 0.02, 0.25)).toBeCloseTo(1.8, 10); // 1.5 × 1.25 = 1.875 → 1.80
    expect(repairEfficiencyWithSkill(26, 0.02, 0)).toBe(1.5);
  });

  it('repair duration: the speed term multiplies the snapshotted duration', () => {
    // 30-point kit at the untrained 20 pts/hour = 1.5h; −30% at max.
    expect(repairKitUnitDurationMs(30, 20)).toBe(5_400_000);
    expect(repairKitUnitDurationMs(30, 20, 0.3)).toBe(3_780_000);
    expect(repairKitUnitDurationMs(30, 20, 0.9)).toBe(3_780_000); // term capped at 0.30
    expect(repairSpeedRateMultiplier(0.3)).toBeCloseTo(1 / 0.7, 10);
    expect(repairSpeedRateMultiplier(0)).toBe(1);
  });

  it('vehicles: yield adds into the affix bracket; fuel and decay terms apply after affixes', () => {
    const bike: Vehicle = {
      id: 'veh-1', name: 'Scrap Bike', vehicleClassId: 'scrap_bike', level: 1,
      rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
      isLocked: false, pixelSeed: 1,
    };
    const buggy: Vehicle = { ...bike, vehicleClassId: 'dune_buggy' };
    expect(effectiveVehicleYield(bike, 1, 1)).toBeCloseTo(1.15, 10);
    expect(effectiveVehicleYield(bike, 1, 1, 0.2)).toBeCloseTo(1 + 0.15 * 1.2, 10);
    expect(effectiveVehicleYield(buggy, 1, 1, 0.2)).toBeCloseTo(1 + 0.35 * 1.2, 10);
    const skimmer: Vehicle = { ...bike, vehicleClassId: 'relay_skimmer' };
    expect(vehicleBurnPerTick(skimmer)).toBeCloseTo(2.0, 10);
    expect(vehicleBurnPerTick(skimmer, 0.15)).toBeCloseTo(1.7, 10);
    expect(vehicleBurnPerTick(skimmer, 0.9)).toBeCloseTo(2.0 * 0.7, 10); // term capped at 0.30
    const decay = vehicleDecayPerTick(bike, 'Low');
    expect(vehicleDecayPerTick(bike, 'Low', 0.25)).toBeCloseTo(decay * 0.75, 10);
    expect(vehicleDecayPerTick(bike, 'Low', 0)).toBe(decay);
  });

  it('market fee: House Brand is disjoint from Market Manipulator and never a service fee', () => {
    const bonuses = { marketFeeReduction: 0.25, foundItemFeeReduction: 0.15, craftedItemFeeReduction: 0.15 };
    expect(marketFeeReduction(bonuses, false, false)).toBeCloseTo(0.25, 10);
    expect(marketFeeReduction(bonuses, true, false)).toBeCloseTo(0.4, 10);
    expect(marketFeeReduction(bonuses, false, true)).toBeCloseTo(0.4, 10);
    expect(marketFeeReduction({ marketFeeReduction: 0.9, craftedItemFeeReduction: 0.15 }, false, true)).toBe(1);
    // Service fee: repairServiceFee reads marketFeeReduction(bonuses, false)
    // — neither gated term can fire on labor.
    const svc = repairServiceFee(10_000, 0.05, bonuses);
    expect(svc.feeReduction).toBeCloseTo(0.25, 10);
    expect(svc.feeCredits).toBe(375);
    expect(svc.mechanicProceeds).toBe(10_000 - 375);
    // marketFeeForSeller threads the crafted gate through.
    const sale = marketFeeForSeller({
      price: 10_000, skillSpends: { scav_fee_1: 5, fix_major_3: 1 },
      foundBySeller: false, craftedBySeller: true,
    });
    expect(sale.feeReduction).toBeCloseTo(0.4, 10);
    expect(sale.fee).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// 5. Craft consumers through the in-memory WriteStore (shipped path)
// ---------------------------------------------------------------------------

describe('craft enqueue — Fixer snapshots through the WriteStore', () => {
  const MATS = { ScrapAlloy: 100_000, ReactiveComponents: 100_000 };
  const baseDuration = () => getCraftRecipe('recipe_medkit')!.unitDurationMs;

  function craftStore(spends: Record<string, number>, extra: Partial<ProfileRowData> = {}) {
    return makeStore((s) => {
      s.profiles = [profile({ id: P, materials: { ...MATS }, skill_spends: spends, ...extra })];
    });
  }

  it('duration snapshot: Fixer term alone, then the 0.60 floor with Scavenger maxed', async () => {
    const plain = craftStore({});
    await plain.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 });
    expect(plain.seed.craftJobs[0].snapshot.skillDurationMultiplier).toBe(1);
    expect(plain.seed.craftJobs[0].unit_duration_ms).toBe(baseDuration());

    const fixerOnly = craftStore({ fix_craft_time_1: 5, fix_craft_time_2: 5 });
    await fixerOnly.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 });
    expect(fixerOnly.seed.craftJobs[0].snapshot.skillDurationMultiplier).toBeCloseTo(0.75, 10);
    expect(fixerOnly.seed.craftJobs[0].unit_duration_ms).toBe(Math.round(baseDuration() * 0.75));
    // The keystone draw bonus snapshots on every job (0 without it).
    expect(fixerOnly.seed.craftJobs[0].snapshot.coreCatalystDrawBonus).toBe(0);

    const both = craftStore({
      fix_craft_time_1: 5, fix_craft_time_2: 5, scav_cons_1: 5, scav_cons_2: 5,
    });
    await both.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 });
    // 0.80 (Scavenger cap) × 0.75 (Fixer cap) = 0.60 — the floor binds exactly.
    expect(both.seed.craftJobs[0].snapshot.skillDurationMultiplier).toBeCloseTo(0.6, 10);
    expect(both.seed.craftJobs[0].unit_duration_ms).toBe(Math.round(baseDuration() * 0.6));

    const partial = craftStore({ fix_craft_time_1: 5 });
    await partial.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 });
    expect(partial.seed.craftJobs[0].snapshot.skillDurationMultiplier).toBeCloseTo(0.875, 10);
  });

  it('bench queue: 1 + 5 by default; the keystone holds one more', async () => {
    const plain = craftStore({});
    for (let i = 0; i < 6; i++) {
      await plain.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 });
    }
    await expect(
      plain.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 }),
    ).rejects.toThrow(/Bench queue is full/);

    const keystoned = craftStore({ fix_keystone: 1 });
    for (let i = 0; i < 7; i++) {
      await keystoned.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 });
    }
    await expect(
      keystoned.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 }),
    ).rejects.toThrow(/Bench queue is full/);
  });

  it('rush ticket: the 0.45 cap binds without the keystone; 0.55 with it', async () => {
    const seedTicket = (s: WriteSeed) => {
      s.consumableBatches = [{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', owner_user_id: P,
        consumable_type: 'WorkshopRushTicket', quantity: 1, quality_percent: 250,
        origin: 'crafted', creator_user_id: P, source_recipe_id: null,
        created_at: '2026-10-30T00:00:00.000Z', updated_at: '2026-10-30T00:00:00.000Z',
      } as WriteSeed['consumableBatches'][number]];
    };
    const plain = makeStore((s) => {
      s.profiles = [profile({ id: P, materials: { ...MATS }, consumables: { WorkshopRushTicket: 1 } })];
      seedTicket(s);
    });
    await plain.enqueueCraftJob(P, nonce(), {
      bench: 1, recipeId: 'recipe_medkit', units: 1, useRushTicket: true,
    });
    expect(plain.seed.craftJobs[0].snapshot.rushReduction).toBeCloseTo(0.45, 10);
    expect(plain.seed.craftJobs[0].unit_duration_ms).toBe(Math.round(baseDuration() * 0.55));

    const keystoned = makeStore((s) => {
      s.profiles = [profile({
        id: P, materials: { ...MATS }, consumables: { WorkshopRushTicket: 1 },
        skill_spends: { fix_keystone: 1 },
      })];
      seedTicket(s);
    });
    await keystoned.enqueueCraftJob(P, nonce(), {
      bench: 1, recipeId: 'recipe_medkit', units: 1, useRushTicket: true,
    });
    // Raw reduction at quality 250 is 0.50 — under the raised 0.55 cap.
    expect(keystoned.seed.craftJobs[0].snapshot.rushReduction).toBeCloseTo(0.5, 10);
    expect(keystoned.seed.craftJobs[0].unit_duration_ms).toBe(Math.round(baseDuration() * 0.5));
  });

  it('snapshots are respec-immune: retraining after enqueue changes nothing in flight', async () => {
    const store = craftStore({ fix_craft_time_1: 5, fix_craft_time_2: 5, fix_keystone: 1 });
    await store.enqueueCraftJob(P, nonce(), { bench: 1, recipeId: 'recipe_medkit', units: 1 });
    const before = { ...store.seed.craftJobs[0] };
    await store.retrain(P, nonce());
    expect(store.seed.profiles[0].skill_spends).toEqual({});
    const after = store.seed.craftJobs[0];
    expect(after.unit_duration_ms).toBe(before.unit_duration_ms);
    expect(after.snapshot.skillDurationMultiplier).toBeCloseTo(0.75, 10);
    expect(after.snapshot.coreCatalystDrawBonus).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Craft completions through the shared engine (quality / temper / draws)
// ---------------------------------------------------------------------------

import {
  enqueueCraftJob as enqueueCraftJobCore,
  settleCraftJobs as settleCraftJobsCore,
  type CraftAdapter,
  type CraftJobRecord,
  type CraftLeverValues,
  type CraftProfileView,
} from '../server/writes/craftEngine';
import type { CraftedGearCandidate } from '../server/writes/craftGear';

const ENGINE_LEVERS: CraftLeverValues = {
  craftXpRate: 0.775, craftTimeScalar: 1, craftQualityShift: 0,
  gearTemperBaseChance: 0.05, refineBaseYield: 0.8,
  repairWorkRateBase: 20, repairMasterySpeedPerLevel: 0.02,
  repairMasteryEfficiencyPerLevel: 0.02,
};

function engineHarness(opts: {
  spends: Record<string, number>;
  rng: () => number;
  levers?: Partial<CraftLeverValues>;
  cores?: number;
}) {
  const bonuses = computeSkillBonuses(opts.spends, { nodeBoosts: {} });
  const profileView: CraftProfileView = {
    player_level: 25, player_xp: 0, credits: 0,
    materials: {
      ScrapAlloy: 100_000, ReactiveComponents: 100_000,
      RefinedAlloy: 100, TemperedParts: 100, ForgeheartIngots: 100,
    },
    essences: {}, consumables: {},
    workshop_benches: 2, legendary_cores: opts.cores ?? 0,
    workshop_tools: { owned: {}, fitted: {}, charges: {} },
    offline_cap_hours: null,
  };
  const jobs: CraftJobRecord[] = [];
  const batches: Array<{ type: string; qty: number; quality: number }> = [];
  const candidates: CraftedGearCandidate[] = [];
  let now = 1_000_000;
  const state = { bonuses };
  const adapter: CraftAdapter = {
    nowMs: () => now,
    rng: opts.rng,
    uuid: (() => { let n = 0; return () => `engine-job-${++n}`; })(),
    profile: () => profileView,
    activeAction: () => ({ kind: 'crafting', lastHeartbeatMs: now }),
    jobs: () => jobs,
    addJob: (j) => { jobs.push(j); },
    masteryLevel: () => 1,
    skillBonus: (_id, key) => state.bonuses[key] ?? 0,
    addMasteryXp: () => {},
    addStat: () => {},
    addBatch: (_id, type, qty, quality) => { batches.push({ type, qty, quality }); },
    burnOneBatchUnit: () => null,
    insertGearItem: (_id, candidate) => {
      candidates.push(candidate);
      return `engine-item-${candidates.length}`;
    },
    vehicleInfo: () => null,
    restoreVehicle: () => null,
    levers: () => ({ ...ENGINE_LEVERS, ...(opts.levers ?? {}) }),
  };
  const enqueueInput = (over: Record<string, unknown> = {}) => ({
    bench: 1, recipeId: 'recipe_medkit', units: 1,
    consumableEfficiencyBonus: bonuses.consumableEfficiency ?? 0,
    fixerBonuses: {
      craftSpeedBonus: bonuses.craftSpeedBonus ?? 0,
      workshopQueueBonus: bonuses.workshopQueueBonus ?? 0,
      rushReductionCapBonus: bonuses.rushReductionCapBonus ?? 0,
      coreCatalystDrawBonus: bonuses.coreCatalystDrawBonus ?? 0,
    },
    ...over,
  });
  return {
    adapter, jobs, batches, candidates, state,
    enqueue: (over: Record<string, unknown> = {}) =>
      enqueueCraftJobCore(adapter, P, enqueueInput(over) as never),
    settle: (advanceMs: number) => {
      now += advanceMs;
      return settleCraftJobsCore(adapter, P, { maxAdvanceMs: advanceMs });
    },
  };
}

describe('craft completions — quality shift, temper, core draws', () => {
  it('quality: the Fixer shift composes with the lever under the [−10, +20] clamp', () => {
    // MedKit bounds at mastery 1 / bench 1: 75–125; rng 0.5 rolls the
    // midpoint → quality = 100 + composed shift, exactly.
    const run = (spends: Record<string, number>, leverShift = 0) => {
      const h = engineHarness({ spends, rng: () => 0.5, levers: { craftQualityShift: leverShift } });
      const { job } = h.enqueue();
      h.settle(job.unit_duration_ms + 1000);
      expect(h.batches).toHaveLength(1);
      return h.batches[0].quality;
    };
    expect(run({})).toBe(100);
    expect(run({ fix_quality_1: 5, fix_quality_2: 5 })).toBe(110); // +10 skill
    expect(run({ fix_quality_1: 5, fix_quality_2: 5 }, 10)).toBe(120); // clamp +20 binds the sum
    expect(run({ fix_quality_1: 5, fix_quality_2: 5 }, -10)).toBe(100); // lever −10 cancels skill +10
    expect(run({}, -10)).toBe(90);
  });

  it('temper: Master Artificer flips the roll at the boundary', () => {
    // Chance at mastery 1 = 0.05 base + 0.01 = 0.06; +0.05 with the
    // major = 0.11. A constant 0.10 roll separates the two.
    const run = (spends: Record<string, number>) => {
      const h = engineHarness({ spends, rng: () => 0.1 });
      const { job } = h.enqueue({ recipeId: 'frame_weapon', rarity: 'Common' });
      const settled = h.settle(job.unit_duration_ms + 1000);
      expect(settled.completions).toHaveLength(1);
      return settled.completions[0].tempered;
    };
    expect(run({})).toBe(false);
    expect(run({ fix_major_1: 1 })).toBe(true);
  });

  it('core draws: the keystone snapshot adds a draw, and the snapshot survives a respec', () => {
    const runToCandidate = (spends: Record<string, number>, seed: number, respec = false) => {
      const h = engineHarness({ spends, rng: createRNG(seed), cores: 5 });
      const { job } = h.enqueue({
        bench: 2, recipeId: 'frame_weapon', rarity: 'Common', useCoreCatalyst: true,
      });
      if (respec) h.state.bonuses = {}; // retrain lands mid-flight
      const settled = h.settle(job.unit_duration_ms + 1000);
      expect(settled.completions).toHaveLength(1);
      expect(h.candidates).toHaveLength(1);
      return { job, rollQuality: h.candidates[0].rollQuality };
    };
    // Snapshot assertions (the enqueue-time contract).
    expect(runToCandidate({}, 7).job.snapshot.coreCatalystDrawBonus).toBe(0);
    expect(runToCandidate({ fix_keystone: 1 }, 7).job.snapshot.coreCatalystDrawBonus).toBe(1);
    // Best-of-N: draws 4 (keystone) never loses to draws 3, and wins
    // strictly somewhere across seeds — even after a mid-flight respec,
    // because the bonus rides the snapshot, not live records.
    let strictWins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const base = runToCandidate({}, seed).rollQuality;
      const keyed = runToCandidate({ fix_keystone: 1 }, seed, true).rollQuality;
      expect(keyed).toBeGreaterThanOrEqual(base);
      if (keyed > base) strictWins++;
    }
    expect(strictWins).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Repair consumers — self-repair snapshots + cap, board accept snapshot
// ---------------------------------------------------------------------------

function vehicleData(id: string, owner: string, condition: number): WriteItemData {
  return {
    id, owner_user_id: owner, kind: 'vehicle', static_item_id: null, item_level: 10,
    rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
    condition_current: condition, condition_max: 100,
    supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
    account_bound: false, locked_until: null,
    payload: { vehicleClassId: 'dune_buggy', name: 'Dune Buggy', rarity: 'Rare', level: 10, affixes: [] },
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 2000,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteItemData;
}

function kitBatchData(id: string, owner: string, quality: number, quantity: number) {
  return {
    id, owner_user_id: owner, consumable_type: 'PatchKit', quality_percent: quality,
    quantity, origin: 'vendor', creator_user_id: null, source_recipe_id: null, metadata: {},
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as WriteSeed['consumableBatches'][number];
}

const VEH_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VEH_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const VEH_C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const VEH_D = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const VEH_E = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';

describe('repair — Fixer snapshots at enqueue and accept', () => {
  it('self-repair: duration and efficiency snapshot the owner\'s Fixer terms', async () => {
    const store = makeStore((s) => {
      s.profiles = [profile({
        id: Q, consumables: { PatchKit: 5 },
        skill_spends: {
          fix_repair_speed_1: 5, fix_repair_speed_2: 5,
          fix_repair_eff_1: 5, fix_repair_eff_2: 5,
        },
      })];
      s.items = [vehicleData(VEH_A, Q, 40)];
      s.consumableBatches = [kitBatchData('kit-q1', Q, 100, 5)];
    });
    await store.enqueueRepairJob(Q, nonce(), { itemId: VEH_A, kitType: 'PatchKit', units: 1 });
    const job = store.seed.craftJobs[0];
    // 30-point kit, untrained rate 20/hr, speed term −30%: 3,780,000ms.
    expect(job.unit_duration_ms).toBe(3_780_000);
    expect(job.snapshot.repair?.efficiency).toBeCloseTo(1.25, 10);
    expect(job.snapshot.repair?.workRatePointsPerHour).toBe(20);

    const plain = makeStore((s) => {
      s.profiles = [profile({ id: Q, consumables: { PatchKit: 5 } })];
      s.items = [vehicleData(VEH_A, Q, 40)];
      s.consumableBatches = [kitBatchData('kit-q1', Q, 100, 5)];
    });
    await plain.enqueueRepairJob(Q, nonce(), { itemId: VEH_A, kitType: 'PatchKit', units: 1 });
    expect(plain.seed.craftJobs[0].unit_duration_ms).toBe(5_400_000);
    expect(plain.seed.craftJobs[0].snapshot.repair?.efficiency).toBe(1);
  });

  it('Second Shift: the self-repair cap is 3, or 4 with fix_major_4', async () => {
    const seedFour = (spends: Record<string, number>) => (s: WriteSeed) => {
      s.profiles = [profile({ id: Q, consumables: { PatchKit: 20 }, skill_spends: spends })];
      s.items = [VEH_A, VEH_B, VEH_C, VEH_D].map((id) => vehicleData(id, Q, 40));
      s.consumableBatches = [kitBatchData('kit-q1', Q, 100, 20)];
    };
    const plain = makeStore(seedFour({}));
    for (const id of [VEH_A, VEH_B, VEH_C]) {
      await plain.enqueueRepairJob(Q, nonce(), { itemId: id, kitType: 'PatchKit', units: 1 });
    }
    await expect(
      plain.enqueueRepairJob(Q, nonce(), { itemId: VEH_D, kitType: 'PatchKit', units: 1 }),
    ).rejects.toThrow(/Too many repair jobs/);

    const shifted = makeStore(seedFour({ fix_major_4: 1 }));
    for (const id of [VEH_A, VEH_B, VEH_C, VEH_D]) {
      await shifted.enqueueRepairJob(Q, nonce(), { itemId: id, kitType: 'PatchKit', units: 1 });
    }
    expect(shifted.seed.craftJobs).toHaveLength(4);
  });

  it('board accept: the snapshot prices the MECHANIC\'s Fixer terms, and settlement pays them', async () => {
    let clockMs = new Date('2026-10-31T12:00:00.000Z').getTime();
    const build = (mechSpends: Record<string, number>) => makeStore((s) => {
      s.profiles = [
        profile({ id: Q, credits: 10_000 }),
        profile({ id: MECH, credits: 0, consumables: { PatchKit: 4 }, skill_spends: mechSpends }),
      ];
      s.items = [vehicleData(VEH_E, Q, 40)];
      s.consumableBatches = [kitBatchData('kit-m1', MECH, 100, 4)];
    }, { now: () => new Date(clockMs) });

    const runBoard = async (mechSpends: Record<string, number>) => {
      clockMs = new Date('2026-10-31T12:00:00.000Z').getTime();
      const store = build(mechSpends);
      const posted = await store.postRepairJob(Q, nonce(), VEH_E, 60, 6000);
      const jobId = (posted.job as { id: string }).id;
      const accepted = await store.acceptRepairJob(MECH, nonce(), jobId, 'PatchKit');
      const snapshot = (accepted.job as { repair_snapshot: { workRatePointsPerHour: number; efficiency: number } })
        .repair_snapshot;
      // Board work accrues only while the provider's one activity slot
      // is on the job (workshop_service targeting it).
      await store.setActiveAction(MECH, nonce(), {
        activity_kind: 'workshop_service', target_type: 'repair_job', target_id: jobId,
      });
      clockMs += Math.round(2.7 * 3_600_000);
      const board = await store.getRepairBoard(MECH);
      const work = (board as { work: Array<{ id: string; status: string; pointsRestored: number }> }).work;
      const view = work.find((j) => j.id === jobId)!;
      const vehicle = store.seed.items.find((i) => i.id === VEH_E)!;
      return { snapshot, view, condition: vehicle.condition_current ?? 0 };
    };

    const fixer = await runBoard({
      fix_repair_speed_1: 5, fix_repair_speed_2: 5, fix_repair_eff_1: 5, fix_repair_eff_2: 5,
    });
    // Rate = 20 / (1 − 0.30); efficiency = 1 × 1.25.
    expect(fixer.snapshot.workRatePointsPerHour).toBeCloseTo(20 / 0.7, 8);
    expect(fixer.snapshot.efficiency).toBeCloseTo(1.25, 10);

    const plain = await runBoard({});
    expect(plain.snapshot.workRatePointsPerHour).toBe(20);
    expect(plain.snapshot.efficiency).toBe(1);

    // After the same 2.7 hours of board work, the Fixer mechanic has
    // restored strictly more — the snapshot terms are the settlement.
    expect(fixer.view.pointsRestored).toBeGreaterThan(plain.view.pointsRestored);
    expect(fixer.condition).toBeGreaterThan(plain.condition);
  });
});

// ---------------------------------------------------------------------------
// 8. Vendor buyback and market fee through the WriteStore
// ---------------------------------------------------------------------------

describe('vendor and market — Appraiser\'s Eye and House Brand', () => {
  it('vendor sell: rate = min(0.90, lever + vendorBuybackBonus)', async () => {
    const sell = async (spends: Record<string, number>, opts: Record<string, unknown> = {}) => {
      const store = makeStore((s) => {
        s.profiles = [profile({ id: P, materials: { ScrapAlloy: 10 }, skill_spends: spends })];
      }, opts);
      return store.vendorSell(P, nonce(), { kind: 'material', materialId: 'ScrapAlloy', quantity: 10 });
    };
    // ScrapAlloy vendor value 10 × 10 units = 100.
    const plain = await sell({});
    expect(plain.buyback_rate).toBeCloseTo(0.4, 10);
    expect(plain.total_payout).toBe(40);
    const appraised = await sell({ fix_vendor_1: 5 });
    expect(appraised.buyback_rate).toBeCloseTo(0.45, 10);
    expect(appraised.total_payout).toBe(45);
    const capped = await sell({ fix_vendor_1: 5 }, { buybackRateProvider: () => 0.88 });
    expect(capped.buyback_rate).toBeCloseTo(0.9, 10);
    expect(capped.total_payout).toBe(90);
  });

  function gearData(id: string, owner: string, payload: Record<string, unknown>): WriteItemData {
    return {
      id, owner_user_id: owner, kind: 'weapon', static_item_id: null, item_level: 10,
      rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
      condition_current: null, condition_max: null,
      supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
      account_bound: false, locked_until: null, payload,
      runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 5000,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    } as WriteItemData;
  }
  const ITEM_1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

  it('market: House Brand fires on crafted sales only; Manipulator on found sales only', async () => {
    const runSale = async (
      spends: Record<string, number>,
      payload: Record<string, unknown>,
    ) => {
      const store = makeStore((s) => {
        s.profiles = [
          profile({ id: P, credits: 0, skill_spends: spends }),
          profile({ id: Q, credits: 100_000 }),
        ];
        s.items = [gearData(ITEM_1, P, payload)];
      });
      const created = await store.marketCreate(P, nonce(), ITEM_1, 10_000);
      const listingId = (created.listing as { id: string }).id;
      const accepted = await store.acceptListing(Q, nonce(), listingId);
      return accepted.market_fee as {
        fee_credits: number; seller_proceeds: number; fee_reduction: number;
        found_item: boolean; crafted_item: boolean;
      };
    };

    // Crafted item, seller holds Darknet (maxed) + House Brand:
    // 0.25 + 0.15 = 0.40, found_item false — the terms are disjoint.
    const crafted = await runSale(
      { scav_fee_1: 5, fix_major_3: 1 },
      { origin: 'crafted', sourceTag: 'Crafted', name: 'Crafted Gun' },
    );
    expect(crafted.crafted_item).toBe(true);
    expect(crafted.found_item).toBe(false);
    expect(crafted.fee_reduction).toBeCloseTo(0.4, 10);
    expect(crafted.fee_credits).toBe(300);
    expect(crafted.seller_proceeds).toBe(9700);

    // Found item, seller holds Darknet + Manipulator + House Brand:
    // House Brand stays silent; 0.25 + 0.15 (Manipulator) = 0.40.
    const found = await runSale(
      { scav_fee_1: 5, scav_major_3: 1, fix_major_3: 1 },
      { sourceTag: 'World Drop', name: 'Found Gun' },
    );
    expect(found.found_item).toBe(true);
    expect(found.crafted_item).toBe(false);
    expect(found.fee_reduction).toBeCloseTo(0.4, 10);

    // Crafted item, seller WITHOUT House Brand: Darknet only.
    const noBrand = await runSale(
      { scav_fee_1: 5 },
      { origin: 'crafted', sourceTag: 'Crafted', name: 'Crafted Gun' },
    );
    expect(noBrand.crafted_item).toBe(true);
    expect(noBrand.fee_reduction).toBeCloseTo(0.25, 10);
  });

  it('market: House Brand applies to crafted consumable batches (batch_origin rule)', async () => {
    const store = makeStore((s) => {
      s.profiles = [
        profile({ id: P, credits: 0, consumables: { MedKit: 2 }, skill_spends: { fix_major_3: 1 } }),
        profile({ id: Q, credits: 100_000 }),
      ];
      s.consumableBatches = [{
        id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', owner_user_id: P,
        consumable_type: 'MedKit', quantity: 2, quality_percent: 120,
        origin: 'crafted', creator_user_id: P, source_recipe_id: 'recipe_medkit',
        created_at: '2026-10-30T00:00:00.000Z', updated_at: '2026-10-30T00:00:00.000Z',
      } as WriteSeed['consumableBatches'][number]];
    });
    const created = await store.marketCreateConsumable(
      P, nonce(), 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 2, 5000,
    );
    const listingId = (created.listing as { id: string }).id;
    const accepted = await store.acceptListing(Q, nonce(), listingId);
    const fee = accepted.market_fee as { fee_reduction: number; crafted_item: boolean };
    expect(fee.crafted_item).toBe(true);
    expect(fee.fee_reduction).toBeCloseTo(0.15, 10);
  });
});

// ---------------------------------------------------------------------------
// 9. Chef vehicle wiring — online claim path (offline shares the engine)
// ---------------------------------------------------------------------------

describe('Chef claim — Fixer vehicle terms ride skillBonuses', () => {
  const PLAYER = '99999999-9999-4999-8999-999999999999';
  const buggy: Vehicle = {
    id: 'veh-1', name: 'Dune Buggy', vehicleClassId: 'dune_buggy', level: 1,
    rarity: Rarity.Common, affixes: [], sourceTag: DropSource.WorldDrop,
    isLocked: false, pixelSeed: 1,
  };
  const claim = (skillBonuses: Record<string, number>) =>
    processRoamingClaim({
      playerId: PLAYER,
      areaId: 'dustwaste_frontier',
      ticks: 20,
      tickCount: 2000,
      playerLevel: 10,
      survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0, mitigation: 0 },
      vehicle: { vehicle: buggy, conditionCurrent: 100, conditionMax: 100, fuelUnits: 100000 },
      skillBonuses,
    } as ClaimRequest);

  it('fuel burn, decay, and yield all move with the derived bonuses', () => {
    const plain = claim({});
    const fixer = claim({ vehicleYieldBonus: 0.2, vehicleFuelBonus: 0.15, vehicleDecayReduction: 0.25 });
    expect(plain.vehicle.activeTicks).toBe(20);
    expect(fixer.vehicle.activeTicks).toBe(20);
    // Burn: × (1 − 0.15); decay: × (1 − 0.25); both exact ratios.
    expect(fixer.vehicle.fuelConsumed / plain.vehicle.fuelConsumed).toBeCloseTo(0.85, 6);
    const plainLoss = 100 - plain.vehicle.conditionCurrent;
    const fixerLoss = 100 - fixer.vehicle.conditionCurrent;
    expect(fixerLoss / plainLoss).toBeCloseTo(0.75, 6);
    // Yield: the Fixer claim pays strictly more than the plain claim.
    const paid = (r: ReturnType<typeof claim>) =>
      r.rewards.creditsAwarded + r.rewards.creditsRemainder;
    expect(paid(fixer)).toBeGreaterThan(paid(plain));
  });
});

// ---------------------------------------------------------------------------
// 10. Adversarial — request-body Fixer assertions change nothing (#207 pattern)
// ---------------------------------------------------------------------------

import express from 'express';
import type { AddressInfo, Server } from 'node:net';
import { afterAll, beforeAll } from 'vitest';
import { mountWriteRoutes } from '../server/writes/routes';
import { issueAccessToken } from '../server/auth/tokens';

const ADV_ITEM = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

describe('adversarial — forged Fixer fields in request bodies are ignored', () => {
  const SECRET = 'test-secret-at-least-32-chars-long!!';
  let store: InMemoryWriteStore;
  let base = '';
  let server: Server;
  let tokenP = '';
  let tokenQ = '';

  beforeAll(async () => {
    store = makeStore((s) => {
      s.profiles = [
        profile({ id: P, materials: { ScrapAlloy: 100_000, ReactiveComponents: 100_000 } }),
        profile({ id: Q, credits: 100_000 }),
      ];
      s.items = [{
        id: ADV_ITEM, owner_user_id: P, kind: 'weapon', static_item_id: null, item_level: 10,
        rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
        condition_current: null, condition_max: null,
        supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
        account_bound: false, locked_until: null,
        payload: { sourceTag: 'World Drop', name: 'Found Gun' },
        runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 5000,
        created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      } as WriteItemData];
    });
    const app = express();
    app.use(express.json());
    mountWriteRoutes(app, store, { jwtSecret: SECRET });
    server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
    tokenP = issueAccessToken(SECRET, P, false);
    tokenQ = issueAccessToken(SECRET, Q, false);
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const post = async (path: string, token: string, payload: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  };

  it('craft-enqueue: body-supplied fixerBonuses / spends do not move the snapshot', async () => {
    const res = await post('/api/ops/craft-enqueue', tokenP, {
      nonce: nonce(), bench: 1, recipe_id: 'recipe_medkit', units: 1,
      // Forged: a maxed Fixer build, asserted by the body.
      fixerBonuses: { craftSpeedBonus: 0.25, workshopQueueBonus: 1, rushReductionCapBonus: 0.1, coreCatalystDrawBonus: 1 },
      craftSpeedBonus: 0.25,
      consumableEfficiencyBonus: 1,
      skill_spends: { fix_craft_time_1: 5, fix_craft_time_2: 5, fix_keystone: 1 },
    });
    expect(res.status).toBe(200);
    const job = store.seed.craftJobs[0];
    expect(job.snapshot.skillDurationMultiplier).toBe(1);
    expect(job.snapshot.coreCatalystDrawBonus).toBe(0);
  });

  it('market-accept: body-supplied craftedBySeller / skill_spends do not move the fee', async () => {
    const created = await store.marketCreate(P, nonce(), ADV_ITEM, 10_000);
    const listingId = (created.listing as { id: string }).id;
    const res = await post('/api/ops/market-accept', tokenQ, {
      nonce: nonce(), listing_id: listingId,
      // Forged: claim the sale is crafted and the seller is a maxed Fixer.
      craftedBySeller: true,
      crafted_by_seller: true,
      skill_spends: { fix_major_3: 1, scav_fee_1: 5 },
      fee_reduction: 1,
    });
    expect(res.status).toBe(200);
    const fee = res.json.market_fee as { fee_reduction: number; crafted_item: boolean; found_item: boolean };
    // The item is a find and the seller has no spends at all: no terms fire.
    expect(fee.crafted_item).toBe(false);
    expect(fee.found_item).toBe(true);
    expect(fee.fee_reduction).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Migration 0029 — SQL pins
// ---------------------------------------------------------------------------

describe('migration 0029 — pins', () => {
  const sql = readFileSync(resolve(process.cwd(), 'db/migrations/0029_fixer_tree.sql'), 'utf8');

  it('seeds all 17 Fixer node definitions, mirroring the TS defs', () => {
    for (const node of getSkillTreeNodes(SkillTreeType.Fixer)) {
      expect(sql).toContain(`('${node.id}', 'Fixer',`);
      const effectsJson = JSON.stringify(node.effects);
      expect(sql, `${node.id} effects`).toContain(`'${effectsJson}'::jsonb`);
    }
  });

  it('derives everything from records through the one helper — no trusted Fixer parameters', () => {
    expect(sql).toContain('create or replace function public.cc_skill_effective_points');
    expect(sql).toContain("'fix_craft_time_1', 'Fixer', 5");
    expect(sql).toContain("'fix_major_3', 'Fixer', 1");
    expect(sql).toContain("'fix_major_4', 'Fixer', 1");
    expect(sql).toContain("'fix_keystone', 'Fixer', 1");
    // Signatures unchanged from the restated bodies.
    expect(sql).toContain('create or replace function public.cc_enqueue_craft_job(');
    expect(sql).toContain('p_efficiency_bonus numeric');
    expect(sql).toContain('create or replace function public.cc_complete_craft_unit(');
    expect(sql).toContain('create or replace function public.cc_enqueue_repair_job(');
    expect(sql).toContain('create or replace function public.cc_accept_repair_job(');
    expect(sql).toContain('create or replace function public.cc_vendor_sell(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.cc_accept_listing(p_player_id uuid, nonce text, listing_id uuid)');
  });

  it('carries each consumer\'s formula at its seam', () => {
    // Craft: combined floor, queue bonus, rush cap, draws snapshot.
    expect(sql).toContain('greatest(0.60, v_skill_mult');
    expect(sql).toContain('>= 6 + v_workshop_queue_bonus');
    expect(sql).toContain('least(0.45 + v_rush_cap_bonus');
    expect(sql).toContain("'coreCatalystDrawBonus', v_core_draw_bonus");
    // Completion: composed shift clamp + temper term + snapshot draws.
    expect(sql).toContain('least(20, greatest(-10, p_quality_shift + v_craft_quality_bonus))');
    expect(sql).toContain('+ v_craft_temper_bonus');
    expect(sql).toContain("job.snapshot ->> 'coreCatalystDrawBonus'");
    // Repair: composed efficiency ceiling, duration term, Second Shift cap.
    expect(sql).toContain('least(1.80, least(1.5, 1 + v_eff');
    expect(sql).toContain('>= 3 + v_bonus_repair_jobs');
    // Vendor: the 0.90 ceiling over lever + bonus.
    expect(sql).toContain('rate := least(0.9::numeric, rate + greatest(0, v_vendor_buyback_bonus))');
    // Market: the metrics crafted-sale rule, both branches.
    expect(sql).toContain("coalesce(item.payload ->> 'origin', '') = 'crafted'");
    expect(sql).toContain("coalesce(listing.batch_origin, '') = 'crafted'");
    expect(sql).toContain("'crafted_item', crafted_item");
  });
});
