import { CONSUMABLES } from '@/constants/consumables';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';

/**
 * Build a flat Record<string, number> from the player's loaded consumable
 * slots, extracting runtime baseEffects fields and mapping them to
 * snapshot-friendly key names consumed by buildCharacterMechanicsSnapshot.
 *
 * Slot order: PreFight → MidFight → Emergency.
 * Effect values are summed across all loaded slots.
 *
 * Mapping (runtime baseEffects → snapshot key):
 *   - bonusLootChance     → bonusLootChance
 *   - extraLootRollChance → lootQuantity
 *   - rareMaterialChance  → rareDropChanceMod
 *   - yieldMultiplier     → scrapYieldMod
 */
export function buildConsumableMods(
  consumables: LoadoutConsumables,
): Record<string, number> {
  const slots = ['PreFight', 'MidFight', 'Emergency'] as const;
  const result: Record<string, number> = {};

  for (const slot of slots) {
    const id = consumables[slot];
    if (!id) continue;

    const def = CONSUMABLES[id];
    if (!def) continue;

    const effects = def.runtime.baseEffects;

    if (effects.bonusLootChance) {
      result.bonusLootChance = (result.bonusLootChance ?? 0) + effects.bonusLootChance;
    }
    if (effects.extraLootRollChance) {
      result.lootQuantity = (result.lootQuantity ?? 0) + effects.extraLootRollChance;
    }
    if (effects.rareMaterialChance) {
      result.rareDropChanceMod = (result.rareDropChanceMod ?? 0) + effects.rareMaterialChance;
    }
    if (effects.yieldMultiplier) {
      result.scrapYieldMod = (result.scrapYieldMod ?? 0) + effects.yieldMultiplier;
    }
    // xpBoostMod – reserved for future consumables
  }

  return result;
}
