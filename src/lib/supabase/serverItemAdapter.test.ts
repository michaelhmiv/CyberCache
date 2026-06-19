import { describe, expect, it } from 'vitest';
import { serverItemRowToDisplayGear } from './serverItemAdapter';
import type { ServerItemRow } from './serverItemAdapter';

describe('serverItemRowToDisplayGear', () => {
  it('returns null for an odds-only cache placeholder', () => {
    const row: ServerItemRow = {
      id: 'item-1',
      payload: { odds: { outcome: 'Rare' } },
    };
    expect(serverItemRowToDisplayGear(row)).toBeNull();
  });

  it('returns null for an empty payload', () => {
    const row: ServerItemRow = { id: 'item-empty', payload: {} };
    expect(serverItemRowToDisplayGear(row)).toBeNull();
  });

  it('returns a weapon when the payload has weaponType', () => {
    const row: ServerItemRow = {
      id: 'item-2',
      payload: {
        id: 'item-2',
        name: 'Test SMG',
        level: 5,
        rarity: 'Rare',
        weaponType: 'SMG',
        manufacturer: 'HelixWorks',
        element: 'Kinetic',
        baseDamage: 50,
        attackSpeed: 2,
        critChance: 0.08,
        critDamage: 1.4,
        statusChance: 0.12,
        statusDamage: 1.1,
        bossDamageMod: 0.95,
        waveDamageMod: 1.15,
        shieldDamageMod: 1.05,
        armorDamageMod: 0.9,
        offlineEarningsMod: 0,
        rareDropChanceMod: 0,
        scrapYieldMod: 0,
        rollQuality: 50,
        combatPower: 100,
        bossPower: 100,
        farmPower: 100,
        economyScore: 0,
        sourceTag: 'Cache-Forged',
        parts: [],
        affixes: [],
        pixelSeed: 123,
        isLocked: false,
      },
    };
    const result = serverItemRowToDisplayGear(row);
    expect(result).not.toBeNull();
    expect(result && 'weaponType' in result ? result.weaponType : null).toBe('SMG');
    expect(result?.id).toBe('item-2');
  });

  it('patches incomplete weapon numeric fields with safe defaults', () => {
    const row: ServerItemRow = {
      id: 'item-3',
      payload: {
        id: 'item-3',
        name: 'Patch Test',
        level: 1,
        rarity: 'Common',
        weaponType: 'Pistol',
        manufacturer: 'Redline',
        element: 'Kinetic',
        sourceTag: 'Cache-Forged',
        parts: [],
        affixes: [],
      },
    };
    const result = serverItemRowToDisplayGear(row);
    expect(result).not.toBeNull();
    expect(result && 'weaponType' in result ? result.attackSpeed : null).toBe(1.0);
    expect(result && 'weaponType' in result ? result.baseDamage : null).toBe(10);
  });
});
