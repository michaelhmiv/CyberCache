import { GAME_CONTENT, MATERIAL_QUALITY, OUTPUT_QUALITY_CURVE, type LootEntry, type LootTable, type QualityTier } from './gameContent';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  path: string;
  message: string;
}

export interface ContentValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const QUALITY_TIERS: QualityTier[] = ['Crude', 'Standard', 'Refined', 'Superior', 'Prototype'];

function issue(severity: ValidationSeverity, code: string, path: string, message: string): ValidationIssue {
  return { severity, code, path, message };
}

function findDuplicateIds<T extends { id: string }>(items: T[], path: string): ValidationIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates].map((id) => issue('error', 'duplicate_id', path, `Duplicate id '${id}' found.`));
}

function nearlyEquals(a: number, b: number, epsilon = 0.000001): boolean {
  return Math.abs(a - b) <= epsilon;
}

function validateQualityChanceRecord(chances: Record<QualityTier, number>, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let sum = 0;
  for (const tier of QUALITY_TIERS) {
    const chance = chances[tier];
    if (typeof chance !== 'number' || Number.isNaN(chance)) {
      issues.push(issue('error', 'invalid_quality_chance', path, `${tier} chance must be numeric.`));
      continue;
    }
    if (chance < 0 || chance > 1) {
      issues.push(issue('error', 'invalid_quality_chance', path, `${tier} chance must be between 0 and 1.`));
    }
    sum += chance;
  }
  if (!nearlyEquals(sum, 1)) {
    issues.push(issue('error', 'quality_curve_not_normalized', path, `Quality chances must sum to 1. Got ${sum}.`));
  }
  return issues;
}

function validateLootEntry(entry: LootEntry, path: string, materialIds: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (entry.weight <= 0) {
    issues.push(issue('error', 'invalid_loot_weight', path, `Loot entry '${entry.entryId}' must have positive weight.`));
  }
  if (entry.entryType === 'material' && !materialIds.has(entry.entryId)) {
    issues.push(issue('error', 'missing_material_reference', path, `Loot entry references missing material '${entry.entryId}'.`));
  }
  return issues;
}

function validateLootTable(table: LootTable, path: string, lootPoolIds: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [rollIndex, roll] of table.rolls.entries()) {
    const rollPath = `${path}.rolls[${rollIndex}]`;
    if (roll.chance < 0 || roll.chance > 1) {
      issues.push(issue('error', 'invalid_roll_chance', rollPath, `Roll '${roll.id}' chance must be between 0 and 1.`));
    }
    if (roll.rolls <= 0 || !Number.isInteger(roll.rolls)) {
      issues.push(issue('error', 'invalid_roll_count', rollPath, `Roll '${roll.id}' rolls must be a positive integer.`));
    }
    if (!lootPoolIds.has(roll.poolId)) {
      issues.push(issue('error', 'missing_loot_pool_reference', rollPath, `Roll '${roll.id}' references missing pool '${roll.poolId}'.`));
    }
  }
  return issues;
}

export function validateGameContent(content = GAME_CONTENT): ContentValidationReport {
  const issues: ValidationIssue[] = [];
  const professionIds = new Set(content.professions.map((profession) => profession.id));
  const materialIds = new Set(content.materials.map((material) => material.id));
  const materialQualityIds = new Set(MATERIAL_QUALITY.map((quality) => quality.tier));
  const lootPoolIds = new Set(content.lootPools.map((pool) => pool.id));

  issues.push(...findDuplicateIds(content.professions, 'professions'));
  issues.push(...findDuplicateIds(content.materials, 'materials'));
  issues.push(...findDuplicateIds(content.recipes, 'recipes'));
  issues.push(...findDuplicateIds(content.lootPools, 'lootPools'));
  issues.push(...findDuplicateIds(content.lootTables, 'lootTables'));
  issues.push(...findDuplicateIds(content.mechanicDecisions, 'mechanicDecisions'));

  for (const [index, profession] of content.professions.entries()) {
    if (profession.levelCap !== 100) {
      issues.push(issue('warning', 'profession_level_cap_not_100', `professions[${index}]`, `${profession.id} has level cap ${profession.levelCap}; expected 100 for First Era.`));
    }
    if (profession.produces.length === 0) {
      issues.push(issue('warning', 'profession_has_no_outputs', `professions[${index}]`, `${profession.id} does not define produced categories.`));
    }
  }

  for (const [index, material] of content.materials.entries()) {
    for (const professionId of material.usedByProfessions) {
      if (!professionIds.has(professionId)) {
        issues.push(issue('error', 'missing_profession_reference', `materials[${index}].usedByProfessions`, `${material.id} references missing profession '${professionId}'.`));
      }
    }
  }

  for (const tier of QUALITY_TIERS) {
    if (!materialQualityIds.has(tier)) {
      issues.push(issue('error', 'missing_material_quality', 'materialQuality', `Missing material quality tier '${tier}'.`));
    }
  }

  for (const [index, band] of OUTPUT_QUALITY_CURVE.entries()) {
    issues.push(...validateQualityChanceRecord(band.chances, `qualityCurve[${index}]`));
  }

  for (const [index, recipe] of content.recipes.entries()) {
    const recipePath = `recipes[${index}]`;
    const profession = content.professions.find((item) => item.id === recipe.professionId);
    if (!profession) {
      issues.push(issue('error', 'missing_profession_reference', recipePath, `Recipe '${recipe.id}' references missing profession '${recipe.professionId}'.`));
    } else if (recipe.requiredProfessionLevel > profession.levelCap) {
      issues.push(issue('error', 'recipe_level_above_profession_cap', recipePath, `Recipe '${recipe.id}' requires level ${recipe.requiredProfessionLevel}, above ${profession.id} cap ${profession.levelCap}.`));
    }
    if (recipe.requiredProfessionLevel < 1) issues.push(issue('error', 'invalid_required_profession_level', recipePath, `Recipe '${recipe.id}' required level must be at least 1.`));
    if (recipe.recipeDifficulty < 0) issues.push(issue('error', 'invalid_recipe_difficulty', recipePath, `Recipe '${recipe.id}' difficulty must be non-negative.`));
    if (recipe.craftMinutes <= 0) issues.push(issue('error', 'invalid_craft_time', recipePath, `Recipe '${recipe.id}' craft time must be positive.`));
    if (recipe.inputs.length === 0) issues.push(issue('error', 'recipe_has_no_inputs', recipePath, `Recipe '${recipe.id}' has no inputs.`));
    if (recipe.outputs.length === 0) issues.push(issue('error', 'recipe_has_no_outputs', recipePath, `Recipe '${recipe.id}' has no outputs.`));
    for (const [inputIndex, input] of recipe.inputs.entries()) {
      const inputPath = `${recipePath}.inputs[${inputIndex}]`;
      if (!materialIds.has(input.materialId)) issues.push(issue('error', 'missing_material_reference', inputPath, `Recipe '${recipe.id}' references missing material '${input.materialId}'.`));
      if (input.quantity <= 0) issues.push(issue('error', 'invalid_material_quantity', inputPath, `Recipe '${recipe.id}' input '${input.materialId}' quantity must be positive.`));
      if (input.minimumQuality && !QUALITY_TIERS.includes(input.minimumQuality)) issues.push(issue('error', 'invalid_minimum_quality', inputPath, `Recipe '${recipe.id}' input '${input.materialId}' has invalid minimum quality '${input.minimumQuality}'.`));
    }
    for (const [outputIndex, output] of recipe.outputs.entries()) {
      if (output.quantity <= 0) issues.push(issue('error', 'invalid_output_quantity', `${recipePath}.outputs[${outputIndex}]`, `Recipe '${recipe.id}' output '${output.itemId}' quantity must be positive.`));
    }
  }

  for (const [poolIndex, pool] of content.lootPools.entries()) {
    if (pool.entries.length === 0) issues.push(issue('error', 'loot_pool_has_no_entries', `lootPools[${poolIndex}]`, `Loot pool '${pool.id}' has no entries.`));
    for (const [entryIndex, entry] of pool.entries.entries()) issues.push(...validateLootEntry(entry, `lootPools[${poolIndex}].entries[${entryIndex}]`, materialIds));
  }

  for (const [tableIndex, table] of content.lootTables.entries()) issues.push(...validateLootTable(table, `lootTables[${tableIndex}]`, lootPoolIds));

  for (const [index, xpReward] of content.xpActionRewards.entries()) {
    if (xpReward.xp < 0) issues.push(issue('error', 'invalid_xp_reward', `xpActionRewards[${index}]`, `XP reward '${xpReward.actionId}' cannot be negative.`));
  }

  const errors = issues.filter((item) => item.severity === 'error');
  const warnings = issues.filter((item) => item.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings };
}
