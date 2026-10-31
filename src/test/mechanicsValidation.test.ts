import { describe, expect, it } from 'vitest';
import {
  CONSUMABLES,
  getConsumableRuntimeEffects,
  getConsumablesForActivity,
  getConsumablesForLayoutChannel,
  VENDOR_CONSUMABLES,
} from '../constants/consumables';
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

  it('keeps consumables metadata complete enough for runtime, market, and visuals', () => {
    const all = Object.values(CONSUMABLES);
    expect(all.length).toBeGreaterThan(24);

    for (const consumable of all) {
      expect(consumable.id).toBeTruthy();
      expect(consumable.name.length).toBeGreaterThan(0);
      expect(consumable.family).toBeTruthy();
      expect(consumable.shortDescription.length).toBeGreaterThan(0);
      expect(consumable.tacticalRole.length).toBeGreaterThan(0);
      expect(consumable.trigger).toBeTruthy();
      expect(consumable.consumePolicy).toBeTruthy();
      expect(consumable.implementationStatus).toBeTruthy();

      expect(consumable.visual.glyph.length).toBeGreaterThan(0);
      expect(consumable.visual.accent).toBeTruthy();
      expect(consumable.visual.silhouette).toBeTruthy();
      expect(consumable.runtime.activityScopes.length).toBeGreaterThan(0);
      expect(consumable.runtime.layoutChannel).toBeTruthy();
      expect(consumable.runtime.trigger).toBeTruthy();
      expect(consumable.runtime.consumePolicy).toBeTruthy();
      expect(consumable.runtime.zeroBehavior).toBeTruthy();
      expect(consumable.runtime.ledgerText.length).toBeGreaterThan(0);
      expect(Object.keys(consumable.runtime.baseEffects).length).toBeGreaterThan(0);
      expect(consumable.quality.vendorQuality).toBe(100);
      expect(consumable.quality.craftMin).toBeGreaterThan(0);
      expect(consumable.quality.craftMax).toBeGreaterThanOrEqual(consumable.quality.craftMin);
      expect(consumable.market.vendorPrice).toBeGreaterThan(0);
    }
  });

  it('backs quality perks with actual runtime effect keys', () => {
    for (const consumable of Object.values(CONSUMABLES)) {
      const vendorEffects = getConsumableRuntimeEffects(consumable.id, 100);
      expect(Object.keys(vendorEffects).length).toBeGreaterThan(0);

      for (const perk of consumable.runtime.highQualityPerks ?? []) {
        expect(perk.minQuality).toBeGreaterThan(100);
        expect(perk.label.length).toBeGreaterThan(0);
        expect(Object.keys(perk.effects).length).toBeGreaterThan(0);
        const perkQualityEffects = getConsumableRuntimeEffects(consumable.id, perk.minQuality);
        for (const key of Object.keys(perk.effects)) {
          expect(perkQualityEffects).toHaveProperty(key);
        }
      }
    }
  });

  it('derives activity and layout views from the consumable source of truth', () => {
    expect(getConsumablesForActivity('boss').map((c) => c.id)).toContain('AmmoPack');
    expect(getConsumablesForActivity('roaming').map((c) => c.id)).toContain('LootBeacon');
    expect(getConsumablesForActivity('scrapping').map((c) => c.id)).toContain('SalvageContract');
    expect(getConsumablesForActivity('crafting').map((c) => c.id)).toContain('WorkshopRushTicket');
    expect(getConsumablesForLayoutChannel('ammo').map((c) => c.id)).toContain('HighCapacityAmmoPack');
    expect(getConsumablesForLayoutChannel('emergency').map((c) => c.id)).toContain('MedKit');
    expect(VENDOR_CONSUMABLES.map((c) => c.id)).toContain('AmmoPack');
    expect(VENDOR_CONSUMABLES.map((c) => c.id)).not.toContain('ElementalCoating');
  });

  it('keeps boss-prep-visible consumables tagged and explainable', () => {
    const prepVisible = Object.values(CONSUMABLES).filter((item) => item.isBossPrepVisible);
    expect(prepVisible.length).toBeGreaterThan(18);

    for (const consumable of prepVisible) {
      expect(consumable.counterTags.length).toBeGreaterThan(0);
      expect(consumable.uiHints.length).toBeGreaterThan(0);
      expect(consumable.runtime.activityScopes).toContain('boss');
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
    expect(REGION_1_BOSSES).toHaveLength(13);
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
