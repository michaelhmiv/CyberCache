import { describe, expect, it } from 'vitest';
import { serverItemRowToDisplayGear } from './serverItemAdapter';
import type { ServerItemRow } from './serverItemAdapter';

describe('cache weapon payload round-trip', () => {
  it('recognizes a generated cache weapon as a real weapon', () => {
    const row: ServerItemRow = {
      id: 'cache-weapon-1',
      item_level: 10,
      rarity: 'Rare',
      payload: {
        id: 'cache-weapon-1',
        weaponType: 'Pistol',
        manufacturer: 'HelixWorks',
        element: 'Kinetic',
        name: 'Rare Cache Pistol',
        level: 10,
        rarity: 'Rare',
        baseDamage: 100,
        attackSpeed: 1.2,
        critChance: 0.1,
        critDamage: 1.5,
        statusChance: 0.08,
        statusDamage: 1.2,
        bossDamageMod: 1,
        waveDamageMod: 1,
        shieldDamageMod: 1,
        armorDamageMod: 1,
        offlineEarningsMod: 0,
        rareDropChanceMod: 0,
        scrapYieldMod: 0,
        rollQuality: 50,
        parts: [],
        affixes: [],
        sourceTag: 'Cache-Forged',
        isLocked: false,
        pixelSeed: 123,
        combatPower: 150,
        bossPower: 150,
        farmPower: 150,
        economyScore: 0,
      },
    };
    const item = serverItemRowToDisplayGear(row);
    expect(item).not.toBeNull();
    expect(item && 'weaponType' in item ? item.weaponType : null).toBe('Pistol');
  });
});
