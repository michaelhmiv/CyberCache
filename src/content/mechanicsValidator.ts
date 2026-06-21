import { REGION_1_BOSSES } from '../constants/bosses';
import { CONSUMABLES } from '../constants/consumables';
import { CRAFTING_RECIPES } from '../constants/craftingRecipes';
import { LEGENDARY_EFFECTS } from '../constants/legendaryEffects';
import { ROAMING_AREAS, DEFAULT_ROAMING_AREA_ID } from '../constants/roamingAreas';
import { RARITIES } from '../constants/rarities';
import { Element, Manufacturer, Rarity, WeaponType } from '../types/game';

export type MechanicsValidationSeverity = 'error' | 'warning';

export interface MechanicsValidationIssue {
  severity: MechanicsValidationSeverity;
  code: string;
  path: string;
  message: string;
}

export interface MechanicsValidationReport {
  ok: boolean;
  checkCount: number;
  errors: MechanicsValidationIssue[];
  warnings: MechanicsValidationIssue[];
}

function createIssue(
  severity: MechanicsValidationSeverity,
  code: string,
  path: string,
  message: string
): MechanicsValidationIssue {
  return { severity, code, path, message };
}

function uniqueIds<T extends { id: string }>(items: T[], path: string): MechanicsValidationIssue[] {
  const issues: MechanicsValidationIssue[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) {
      issues.push(createIssue('error', 'duplicate_id', path, `Duplicate id '${item.id}'.`));
    }
    seen.add(item.id);
  }

  return issues;
}

function positiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonNegativeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function check(condition: boolean, issues: MechanicsValidationIssue[], code: string, path: string, message: string): number {
  if (!condition) issues.push(createIssue('error', code, path, message));
  return 1;
}

function warn(condition: boolean, issues: MechanicsValidationIssue[], code: string, path: string, message: string): number {
  if (!condition) issues.push(createIssue('warning', code, path, message));
  return 1;
}

export function validateMechanicsFoundation(): MechanicsValidationReport {
  const issues: MechanicsValidationIssue[] = [];
  let checkCount = 0;

  const consumables = Object.values(CONSUMABLES);
  const consumableIds = new Set(consumables.map((item) => item.id));
  const recipeIds = new Set(CRAFTING_RECIPES.map((recipe) => recipe.id));
  const bossIds = new Set(REGION_1_BOSSES.map((boss) => boss.id));
  const legendaryIds = new Set(LEGENDARY_EFFECTS.map((effect) => effect.id));
  const roamingIds = new Set(ROAMING_AREAS.map((area) => area.id));

  issues.push(...uniqueIds(consumables, 'CONSUMABLES'));
  issues.push(...uniqueIds(CRAFTING_RECIPES, 'CRAFTING_RECIPES'));
  issues.push(...uniqueIds(REGION_1_BOSSES, 'REGION_1_BOSSES'));
  issues.push(...uniqueIds(LEGENDARY_EFFECTS, 'LEGENDARY_EFFECTS'));
  issues.push(...uniqueIds(ROAMING_AREAS, 'ROAMING_AREAS'));
  checkCount += consumables.length + CRAFTING_RECIPES.length + REGION_1_BOSSES.length + LEGENDARY_EFFECTS.length + ROAMING_AREAS.length;

  checkCount += check(roamingIds.has(DEFAULT_ROAMING_AREA_ID), issues, 'missing_default_roaming_area', 'DEFAULT_ROAMING_AREA_ID', 'Default roaming area must exist.');

  for (const [index, consumable] of consumables.entries()) {
    const path = `CONSUMABLES[${index}:${consumable.id}]`;
    checkCount += check(Boolean(consumable.name), issues, 'missing_consumable_name', path, 'Consumable requires a name.');
    checkCount += check(Boolean(consumable.shortDescription), issues, 'missing_short_description', path, 'Consumable requires shortDescription.');
    checkCount += check(Boolean(consumable.tacticalRole), issues, 'missing_tactical_role', path, 'Consumable requires tacticalRole.');
    checkCount += check(Boolean(consumable.trigger), issues, 'missing_trigger', path, 'Consumable requires trigger.');
    checkCount += check(Boolean(consumable.consumePolicy), issues, 'missing_consume_policy', path, 'Consumable requires consumePolicy.');
    checkCount += check(nonNegativeNumber(consumable.basePrice), issues, 'invalid_base_price', path, 'Consumable basePrice must be non-negative.');
    checkCount += check(Boolean(consumable.craftCategory), issues, 'missing_craft_category', path, 'Consumable requires craftCategory.');
    checkCount += warn(consumable.isBossPrepVisible ? consumable.counterTags.length > 0 : true, issues, 'boss_prep_consumable_without_counter_tags', path, 'Boss-prep-visible consumable should define counter tags.');
    checkCount += warn(consumable.isBossPrepVisible ? consumable.uiHints.length > 0 : true, issues, 'boss_prep_consumable_without_ui_hints', path, 'Boss-prep-visible consumable should define UI hints.');
  }

  for (const [index, recipe] of CRAFTING_RECIPES.entries()) {
    const path = `CRAFTING_RECIPES[${index}:${recipe.id}]`;
    checkCount += check(Boolean(recipe.name), issues, 'missing_recipe_name', path, 'Recipe requires a name.');
    checkCount += check(recipeIds.has(recipe.id), issues, 'invalid_recipe_id', path, 'Recipe id must be registered.');
    checkCount += check(consumableIds.has(recipe.consumableType), issues, 'missing_recipe_consumable_reference', path, `Recipe references missing consumable '${recipe.consumableType}'.`);
    checkCount += check(recipe.craftTimeMs > 0, issues, 'invalid_craft_time', path, 'Recipe craftTimeMs must be positive.');
    checkCount += check(recipe.outputCount > 0, issues, 'invalid_output_count', path, 'Recipe outputCount must be positive.');
    checkCount += check(recipe.requiresLevel >= 1, issues, 'invalid_required_level', path, 'Recipe requiresLevel must be at least 1.');
    checkCount += check(Object.keys(recipe.materials).length > 0, issues, 'recipe_without_materials', path, 'Recipe requires at least one material.');
    for (const [materialId, amount] of Object.entries(recipe.materials)) {
      checkCount += check(amount > 0, issues, 'invalid_recipe_material_amount', `${path}.materials.${materialId}`, 'Recipe material amount must be positive.');
    }
  }

  for (const [index, boss] of REGION_1_BOSSES.entries()) {
    const path = `REGION_1_BOSSES[${index}:${boss.id}]`;
    checkCount += check(Boolean(boss.name), issues, 'missing_boss_name', path, 'Boss requires a name.');
    checkCount += check(bossIds.has(boss.id), issues, 'invalid_boss_id', path, 'Boss id must be registered.');
    checkCount += check(boss.tier === index + 1, issues, 'non_sequential_boss_tier', path, 'Region 1 boss tiers should be sequential.');
    checkCount += check(boss.level >= 1, issues, 'invalid_boss_level', path, 'Boss level must be at least 1.');
    checkCount += check(positiveNumber(boss.health), issues, 'invalid_boss_health', path, 'Boss health must be positive.');
    checkCount += check(nonNegativeNumber(boss.shield), issues, 'invalid_boss_shield', path, 'Boss shield must be non-negative.');
    checkCount += check(nonNegativeNumber(boss.armor), issues, 'invalid_boss_armor', path, 'Boss armor must be non-negative.');
    checkCount += check(positiveNumber(boss.recommendedPower), issues, 'invalid_recommended_power', path, 'Boss recommendedPower must be positive.');
    checkCount += check(boss.tags.length > 0, issues, 'boss_without_tags', path, 'Boss should define tags.');
    checkCount += check(boss.phases.length > 0, issues, 'boss_without_phases', path, 'Boss should define phases.');
    checkCount += check(boss.dropTable.length > 0, issues, 'boss_without_drop_table', path, 'Boss should define a drop table.');
    checkCount += check(boss.dedicatedDrops.every((dropId) => boss.dropTable.includes(dropId)), issues, 'dedicated_drop_outside_drop_table', path, 'Dedicated drops should also appear in the boss drop table.');
    checkCount += warn(index === 0 || boss.health > REGION_1_BOSSES[index - 1].health, issues, 'boss_health_not_increasing', path, 'Boss health should generally increase by tier.');

    for (const [phaseIndex, phase] of boss.phases.entries()) {
      const phasePath = `${path}.phases[${phaseIndex}:${phase.id}]`;
      checkCount += check(Boolean(phase.name), issues, 'missing_phase_name', phasePath, 'Boss phase requires a name.');
      checkCount += check(positiveNumber(phase.targetValue), issues, 'invalid_phase_target', phasePath, 'Boss phase targetValue must be positive.');
      checkCount += warn(phase.recommendedCounters.length > 0, issues, 'phase_without_recommended_counters', phasePath, 'Boss phase should recommend counters.');
    }
  }

  for (const [index, area] of ROAMING_AREAS.entries()) {
    const path = `ROAMING_AREAS[${index}:${area.id}]`;
    checkCount += check(Boolean(area.name), issues, 'missing_area_name', path, 'Roaming area requires a name.');
    checkCount += check(Boolean(area.gameplayIdentity), issues, 'missing_area_identity', path, 'Roaming area requires gameplayIdentity.');
    checkCount += check(Boolean(area.shortDescription), issues, 'missing_area_description', path, 'Roaming area requires shortDescription.');
    checkCount += check(area.unlockLevel >= 1, issues, 'invalid_area_unlock_level', path, 'Roaming area unlockLevel must be at least 1.');
    checkCount += check(nonNegativeNumber(area.idleCreditsPerMinute), issues, 'invalid_area_credits', path, 'Roaming area idleCreditsPerMinute must be non-negative.');
    checkCount += check(nonNegativeNumber(area.idleScrapPerMinute), issues, 'invalid_area_scrap', path, 'Roaming area idleScrapPerMinute must be non-negative.');
    checkCount += check(area.idleXpPerTick > 0, issues, 'invalid_area_idle_xp', path, 'Roaming area idleXpPerTick must be greater than 0.');
    checkCount += check(Object.values(Rarity).every((rarity) => nonNegativeNumber(area.dropPoolRarityWeights[rarity])), issues, 'invalid_area_rarity_weights', path, 'Roaming area must define non-negative weights for every rarity.');
    checkCount += check(Object.values(area.gearDropWeights).every((weight) => weight >= 0), issues, 'invalid_area_gear_weights', path, 'Gear drop weights must be non-negative.');
    checkCount += check(area.manufacturerInfluence === 'Mixed' || Object.values(Manufacturer).includes(area.manufacturerInfluence), issues, 'invalid_manufacturer_influence', path, 'Manufacturer influence must be a manufacturer or Mixed.');
    checkCount += check(area.weaponBias.every((weaponType) => Object.values(WeaponType).includes(weaponType)), issues, 'invalid_weapon_bias', path, 'Weapon bias must use known weapon types.');
    checkCount += check((area.elementBias ?? []).every((element) => Object.values(Element).includes(element)), issues, 'invalid_element_bias', path, 'Element bias must use known elements.');
  }

  for (const [rarity, rarityDef] of Object.entries(RARITIES)) {
    const path = `RARITIES.${rarity}`;
    checkCount += check(rarityDef.dropWeight >= 0, issues, 'invalid_rarity_drop_weight', path, 'Rarity dropWeight must be non-negative.');
    checkCount += check(rarityDef.affixCount.min <= rarityDef.affixCount.max, issues, 'invalid_rarity_affix_range', path, 'Rarity affixCount min must be <= max.');
    checkCount += check(rarityDef.scrapMultiplier > 0, issues, 'invalid_rarity_scrap_multiplier', path, 'Rarity scrapMultiplier must be positive.');
  }

  for (const [index, effect] of LEGENDARY_EFFECTS.entries()) {
    const path = `LEGENDARY_EFFECTS[${index}:${effect.id}]`;
    checkCount += check(Boolean(effect.name), issues, 'missing_legendary_name', path, 'Legendary effect requires a name.');
    checkCount += check(Boolean(effect.description), issues, 'missing_legendary_description', path, 'Legendary effect requires a description.');
    checkCount += check(effect.eligibleSources.length > 0, issues, 'missing_legendary_sources', path, 'Legendary effect requires at least one eligible source.');
    checkCount += check(legendaryIds.has(effect.id), issues, 'invalid_legendary_id', path, 'Legendary effect id must be registered.');
  }

  const errors = issues.filter((item) => item.severity === 'error');
  const warnings = issues.filter((item) => item.severity === 'warning');

  return {
    ok: errors.length === 0,
    checkCount,
    errors,
    warnings,
  };
}
