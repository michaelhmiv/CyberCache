import { describe, expect, it } from 'vitest';
import { GAME_CONTENT, OUTPUT_QUALITY_CURVE } from '../content/gameContent';
import { CACHE_RARITY_ODDS, resolveRarityWeights, rollCacheRarity, validateCacheRarityOdds } from '../content/lootResolver';
import { ACTION_SLOT_RULES, DURABILITY_POLICIES, GEAR_SLOT_RULES, GUNSMITHING_BOUNDARIES, MARKET_CONTROL_RULES, SERVICE_MARKET_RULES, STARTER_STORE_ITEMS, VEHICLE_CLASSES_FIRST_ERA } from '../content/mechanicFramework';
import { buildLevelCurve, calculateDailyXp, calculateEffectiveSkill, rollOutputQuality, simulateLootTable } from '../content/simulation';
import { buildXpProgressionSummary, getXpForAction, grantXp, levelStateFromTotalXp, totalXpRequiredToReachLevel } from '../content/xpResolver';
import { validateGameContent } from '../content/validation';
import { CONTENT_BOUNDARIES, IMPLEMENTATION_BACKLOG } from '../content/runtimeModel';
import { DropSource, Rarity } from '../types/game';

describe('CyberCache content layer', () => {
  it('validates the seeded content without errors', () => {
    const report = validateGameContent(GAME_CONTENT);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('keeps every quality curve normalized to 100%', () => {
    for (const band of OUTPUT_QUALITY_CURVE) {
      const total = Object.values(band.chances).reduce((sum, chance) => sum + chance, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it('keeps cache rarity odds in the content source of truth', () => {
    expect(validateCacheRarityOdds()).toBe(true);
    expect(CACHE_RARITY_ODDS).toEqual([
      { rarity: Rarity.Rare, chance: 0.6 },
      { rarity: Rarity.Epic, chance: 0.32 },
      { rarity: Rarity.Legendary, chance: 0.08 },
    ]);
  });

  it('rolls cache rarity from content-backed odds', () => {
    expect(rollCacheRarity(() => 0.01)).toBe(Rarity.Rare);
    expect(rollCacheRarity(() => 0.61)).toBe(Rarity.Epic);
    expect(rollCacheRarity(() => 0.99)).toBe(Rarity.Legendary);
  });

  it('resolves cache-forged rarity weighting through the content resolver', () => {
    const worldWeights = resolveRarityWeights({ source: DropSource.WorldDrop });
    const cacheWeights = resolveRarityWeights({ source: DropSource.CacheForged });
    expect(cacheWeights[Rarity.Legendary]).toBeGreaterThan(worldWeights[Rarity.Legendary] ?? 0);
  });

  it('runs deterministic loot simulations for a fixed seed', () => {
    const first = simulateLootTable('boss_dune_tyrant_rewards', 12345);
    const second = simulateLootTable('boss_dune_tyrant_rewards', 12345);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(1);
  });

  it('applies effective-skill math for recipe quality', () => {
    expect(calculateEffectiveSkill({ professionLevel: 40, stationBonus: 5, blueprintMastery: 3, materialQualityBonus: 8, recipeDifficulty: 22 })).toBe(34);
  });

  it('rolls output quality deterministically with a fixed seed', () => {
    const input = { professionLevel: 80, stationBonus: 5, blueprintMastery: 5, materialQualityBonus: 16, recipeDifficulty: 35 };
    const first = rollOutputQuality(input, 99);
    const second = rollOutputQuality(input, 99);
    expect(second).toEqual(first);
    expect(['Crude', 'Standard', 'Refined', 'Superior', 'Prototype']).toContain(first.quality);
  });

  it('calculates daily XP from the 24/7 stress assumptions', () => {
    const dailyXp = calculateDailyXp();
    expect(dailyXp.totalXp).toBeGreaterThan(0);
    expect(dailyXp.bossAttemptXp).toBeGreaterThan(0);
    expect(dailyXp.enemyDefeatXp).toBeGreaterThan(0);
  });

  it('uses the XP resolver as the source for action rewards', () => {
    expect(getXpForAction('boss_victory')).toBe(1000);
    expect(getXpForAction('enemy_defeated')).toBe(16);
  });

  it('converts total XP into level state through the resolver', () => {
    const levelTwoTotal = totalXpRequiredToReachLevel(2);
    const state = levelStateFromTotalXp(levelTwoTotal);
    expect(state.level).toBe(2);
    expect(state.xpIntoLevel).toBe(0);
  });

  it('grants XP and reports level gains deterministically', () => {
    const previous = levelStateFromTotalXp(0);
    const result = grantXp(previous, totalXpRequiredToReachLevel(3));
    expect(result.next.level).toBe(3);
    expect(result.levelsGained).toBe(2);
  });

  it('summarizes XP progression with stress-test timing', () => {
    const summary = buildXpProgressionSummary(10);
    expect(summary.levelCap).toBe(10);
    expect(summary.dailyStressXp.totalXp).toBeGreaterThan(0);
    expect(summary.totalYearsToCap).toBeGreaterThanOrEqual(0);
  });

  it('builds a level curve with cumulative day estimates', () => {
    const curve = buildLevelCurve(10);
    expect(curve).toHaveLength(10);
    expect(curve[0].level).toBe(1);
    expect(curve[9].level).toBe(10);
    expect(curve[8].cumulativeDaysAtStressAssumption).toBeGreaterThan(curve[0].cumulativeDaysAtStressAssumption);
  });

  it('documents the boundary between static content and runtime state', () => {
    expect(CONTENT_BOUNDARIES.some((boundary) => boundary.persistence ===('static_content' as const))).toBe(true);
    expect(CONTENT_BOUNDARIES.some((boundary) => boundary.persistence ===('supabase_runtime' as const))).toBe(true);
  });

  it('keeps the next implementation backlog explicit', () => {
    expect(IMPLEMENTATION_BACKLOG.map((item) => item.id)).toContain('content_pipeline_json_ts');
    expect(IMPLEMENTATION_BACKLOG.map((item) => item.id)).toContain('runtime_supabase_mapping');
    expect(IMPLEMENTATION_BACKLOG.map((item) => item.id)).toContain('loot_xp_simulation');
  });

  it('keeps first-era vehicle scope intentionally small', () => {
    expect(VEHICLE_CLASSES_FIRST_ERA).toHaveLength(6);
    expect(VEHICLE_CLASSES_FIRST_ERA.every((vehicle) => vehicle.travelSpeedMultiplier > 1)).toBe(true);
  });

  it('keeps starter-store goods account-bound and non-resellable', () => {
    expect(STARTER_STORE_ITEMS.length).toBeGreaterThan(0);
    expect(STARTER_STORE_ITEMS.every((item) => item.accountBound && !item.resellable)).toBe(true);
  });

  it('rejects normal-use weapon durability but accepts vehicle condition', () => {
    expect(DURABILITY_POLICIES.find((policy) => policy.id === 'weapon_use_durability')?.firstEraStatus).toBe('rejected');
    expect(DURABILITY_POLICIES.find((policy) => policy.id === 'vehicle_condition')?.firstEraStatus).toBe('accepted');
  });

  it('keeps gunsmithing from creating top-tier weapons from scratch', () => {
    expect(GUNSMITHING_BOUNDARIES.find((rule) => rule.id === 'create_top_tier_weapon')?.allowed).toBe(false);
    expect(GUNSMITHING_BOUNDARIES.find((rule) => rule.id === 'process_legendary_core')?.allowed).toBe(true);
  });

  it('models one active productive action as a core economy constraint', () => {
    const productiveRules = ACTION_SLOT_RULES.filter((rule) => rule.id !== 'none');
    expect(productiveRules.every((rule) => rule.consumesActiveSlot)).toBe(true);
  });

  it('requires service-market escrow and explicit shop rules', () => {
    expect(SERVICE_MARKET_RULES.map((rule) => rule.id)).toContain('escrow_required');
    expect(MARKET_CONTROL_RULES.map((rule) => rule.id)).toContain('service_item_handoff');
  });

  it('covers the major gear slots discussed in the design workbook', () => {
    expect(GEAR_SLOT_RULES.map((slot) => slot.id)).toEqual(expect.arrayContaining(['primary_weapon', 'shield', 'armor', 'ordnance', 'repkit', 'vehicle']));
  });
});
