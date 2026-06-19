import { describe, expect, it } from 'vitest';
import { buildConsumableInventoryMods, buildConsumableMods } from '@/lib/buffs/consumableModsAdapter';

describe('consumableModsAdapter', () => {
  it('derives consumable modifiers from inventory counts without slot gating', () => {
    expect(buildConsumableInventoryMods({ LuckBooster: 12 })).toEqual({
      bonusLootChance: 0.25,
    });
  });

  it('treats inventory count as available coverage, not multiplicative stacking for duration effects', () => {
    expect(buildConsumableInventoryMods({ DataSkimmer: 2 })).toEqual({
      lootQuantity: 0.25,
    });
  });

  it('keeps the legacy loadout-slot adapter for callers that still pass slots', () => {
    expect(buildConsumableMods({ PreFight: 'LuckBooster', MidFight: null, Emergency: null })).toEqual({
      bonusLootChance: 0.25,
    });
  });
});
