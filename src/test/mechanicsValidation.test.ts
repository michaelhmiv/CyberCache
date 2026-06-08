import { describe, expect, it } from 'vitest';
import { CONSUMABLES, CONSUMABLE_SLOTS } from '../constants/consumables';
import { CRAFTING_RECIPES } from '../constants/craftingRecipes';
import { LEGENDARY_EFFECTS } from '../constants/legendaryEffects';
import { REGION_1_BOSSES } from '../constants/bosses';
import { ROAMING_AREAS, DEFAULT_ROAMING_AREA_ID } from '../constants/roamingAreas';
import { validateMechanicsFoundation } from '../content/mechanicsValidator';

function uniqueCount(values: string[]): number {
  return new Set(values).size;
}

describe('mechanics foundation validation', () => {
  it('runs the full mechanics validation report without errors', () => {
    const report = validateMechanicsFoundation();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checkCount).toBeGreaterThan(200);
  });

  it('keeps consumables V2 metadata complete enough for boss prep', () => {
    const all = Object.values(CONSUMABLES);
    expect(all.length).toBeGreaterThan(16);

    for (const consumable of all) {
      expect(consumable.id).toBeTruthy();
      expect(consumable.name.length).toBeGreaterThan(0);
      expect(consumable.family).toBeTruthy();
      expect(consumable.allowedSlots.length).toBeGreaterThan(0);
      expect(consumable.allowedSlots.every((slot) => CONSUMABLE_SLOTS.includes(slot))).toBe(true);
      expect(consumable.shortDescription.length).toBeGreaterThan(0);
      expect(consumable.tacticalRole.length).toBeGreaterThan(0);
      expect(consumable.trigger).toBeTruthy();
      expect(consumable.consumePolicy).toBeTruthy();
      expect(consumable.implementationStatus).toBeTruthy();
    }
  });

  it('keeps boss-prep-visible consumables tagged and explainable', () => {
    const prepVisible = Object.values(CONSUMABLES).filter((item) => item.isBossPrepVisible);
    expect(prepVisible.length).toBeGreaterThan(12);

    for (const consumable of prepVisible) {
      expect(consumable.counterTags.length).toBeGreaterThan(0);
      expect(consumable.uiHints.length).toBeGreaterThan(0);
    }
  });

  it('keeps crafting recipes linked to defined consumables', () => {
    const consumableIds = new Set(Object.values(CONSUMABLES).map((item) => item.id));
    expect(uniqueCount(CRAFTING_RECIPES.map((recipe) => recipe.id))).toBe(CRAFTING_RECIPES.length);

    for (const recipe of CRAFTING_RECIPES) {
      expect(consumableIds.has(recipe.consumableType)).toBe(true);
      expect(recipe.craftTimeMs).toBeGreaterThan(0);
      expect(recipe.outputCount).toBeGreaterThan(0);
      expect(recipe.requiresLevel).toBeGreaterThanOrEqual(1);
      expect(Object.keys(recipe.materials).length).toBeGreaterThan(0);
      expect(Object.values(recipe.materials).every((amount) => amount > 0)).toBe(true);
    }
  });

  it('keeps Region 1 bosses sequential and phase-driven', () => {
    expect(REGION_1_BOSSES).toHaveLength(7);
    expect(uniqueCount(REGION_1_BOSSES.map((boss) => boss.id))).toBe(REGION_1_BOSSES.length);

    for (let index = 0; index < REGION_1_BOSSES.length; index += 1) {
      const boss = REGION_1_BOSSES[index];
      expect(boss.tier).toBe(index + 1);
      expect(boss.tags.length).toBeGreaterThan(0);
      expect(boss.phases.length).toBeGreaterThan(0);
      expect(boss.dropTable.length).toBeGreaterThan(0);
      expect(boss.dedicatedDrops.every((dropId) => boss.dropTable.includes(dropId))).toBe(true);
      expect(boss.phases.some((phase) => phase.recommendedCounters.length > 0)).toBe(true);
    }
  });

  it('keeps roaming areas selectable and progression-gated', () => {
    expect(ROAMING_AREAS.find((area) => area.id === DEFAULT_ROAMING_AREA_ID)?.unlockLevel).toBe(1);
    expect(uniqueCount(ROAMING_AREAS.map((area) => area.id))).toBe(ROAMING_AREAS.length);

    for (const area of ROAMING_AREAS) {
      expect(area.name.length).toBeGreaterThan(0);
      expect(area.gameplayIdentity.length).toBeGreaterThan(0);
      expect(area.selectionHint.length).toBeGreaterThan(0);
      expect(area.unlockLevel).toBeGreaterThanOrEqual(1);
      expect(area.idleCreditsPerMinute).toBeGreaterThanOrEqual(0);
      expect(area.idleScrapPerMinute).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps legendary effects uniquely identified and source-gated', () => {
    expect(LEGENDARY_EFFECTS.length).toBeGreaterThanOrEqual(20);
    expect(uniqueCount(LEGENDARY_EFFECTS.map((effect) => effect.id))).toBe(LEGENDARY_EFFECTS.length);

    for (const effect of LEGENDARY_EFFECTS) {
      expect(effect.name.length).toBeGreaterThan(0);
      expect(effect.description.length).toBeGreaterThan(0);
      expect(effect.eligibleSources.length).toBeGreaterThan(0);
    }
  });
});
