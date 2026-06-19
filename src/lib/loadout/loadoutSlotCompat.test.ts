import { describe, expect, it } from 'vitest';
import { isItemCompatibleWithSlot } from './loadoutSlotCompat';
import type { Weapon, Shield, ClassMod, Relic, Ordnance, GearItem } from '@/types/items';

const weapon = { weaponType: 'Pistol' } as unknown as Weapon;
const shield = { hp: 100 } as unknown as Shield;
const classMod = { treeBonus: 'assault' } as unknown as ClassMod;
const relic = { affixes: [] } as unknown as Relic;
const ordnance = { damage: 50, effect: 'burst' } as unknown as Ordnance;

describe('isItemCompatibleWithSlot', () => {
  it.each([
    ['primary', weapon, true],
    ['secondary', weapon, true],
    ['heavy', weapon, true],
    ['primary', shield, false],
    ['shield', shield, true],
    ['shield', ordnance, false],
    ['classMod', classMod, true],
    ['relic', relic, true],
    ['relic', ordnance, false],
    ['ordnance', ordnance, true],
    ['primary', ordnance, false],
  ] as [import('@/store/slices/loadoutSlice').LoadoutSlot, GearItem, boolean][])('%s for %p returns %s', (slot, item, expected) => {
    expect(isItemCompatibleWithSlot(item, slot)).toBe(expected);
  });
});
