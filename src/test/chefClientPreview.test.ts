/**
 * Client Preview Event Tests
 *
 * Phase 3: preview events in the tick feed are COSMETIC ONLY.
 * They do NOT mutate inventory, player resources, survival,
 * or kill cycle state. The Chef is the sole mutator.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useInventoryStore } from '@/store/slices/inventorySlice';

describe('Client preview events are cosmetic', () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [] });
  });

  it('receiveServerItems merges items without generating', () => {
    // Simulate Chef response items
    const serverItems = [
      {
        id: 'item-1',
        name: 'Test Weapon',
        level: 5,
        rarity: 'Rare' as const,
        weaponType: 'SMG' as const,
        manufacturer: 'Redline' as const,
        element: 'Fire' as const,
        rollQuality: 75,
        baseDamage: 100,
        attackSpeed: 1.2,
        critChance: 0.1,
        critDamage: 1.5,
        statusChance: 0,
        statusDamage: 0,
        bossDamageMod: 1,
        waveDamageMod: 1,
        shieldDamageMod: 1,
        armorDamageMod: 1,
        offlineEarningsMod: 0,
        rareDropChanceMod: 0,
        scrapYieldMod: 0,
        parts: [],
        affixes: [],
        sourceTag: 'World Drop' as const,
        isLocked: false,
        pixelSeed: 12345,
        combatPower: 100,
        bossPower: 100,
        farmPower: 100,
        economyScore: 0,
      },
    ];

    const inv = useInventoryStore.getState();
    inv.receiveServerItems(serverItems);

    const items = useInventoryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('item-1');
    expect(items[0].name).toBe('Test Weapon');
  });

  it('receiveServerItems deduplicates by id', () => {
    const existing = {
      id: 'existing-item',
      name: 'Old Weapon',
      level: 1,
      rarity: 'Common' as const,
      weaponType: 'Pistol' as const,
      manufacturer: 'Ironwood' as const,
      element: 'Kinetic' as const,
      rollQuality: 50,
      baseDamage: 10,
      attackSpeed: 1.0,
      critChance: 0.05,
      critDamage: 1.2,
      statusChance: 0,
      statusDamage: 0,
      bossDamageMod: 1,
      waveDamageMod: 1,
      shieldDamageMod: 1,
      armorDamageMod: 1,
      offlineEarningsMod: 0,
      rareDropChanceMod: 0,
      scrapYieldMod: 0,
      parts: [],
      affixes: [],
      sourceTag: 'World Drop' as const,
      isLocked: false,
      pixelSeed: 999,
      combatPower: 10,
      bossPower: 10,
      farmPower: 10,
      economyScore: 0,
    };

    useInventoryStore.setState({ items: [existing] });

    const serverItems = [
      {
        ...existing,
        name: 'Updated Weapon (from server)',
      },
    ];

    useInventoryStore.getState().receiveServerItems(serverItems);
    const items = useInventoryStore.getState().items;

    expect(items).toHaveLength(1);
    // Server version takes precedence
    expect(items[0].name).toBe('Updated Weapon (from server)');
  });
});
