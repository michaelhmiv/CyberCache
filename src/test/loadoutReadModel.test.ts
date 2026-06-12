import { describe, expect, it } from 'vitest';
import {
  buildLoadoutRows,
  chooseDefaultSlotForItem,
  countEquippedLoadoutSlots,
  getEquippedItemIdSet,
  getLoadoutIntegrityIssues,
  loadoutSlotAccepts,
} from '@/lib/loadout/loadoutReadModel';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { GearItem, Weapon, Shield } from '@/types/items';

const testWeapon = (id: string): Weapon => ({
  id,
  name: `Test item ${id}`,
  level: 1,
  rarity: Rarity.Rare,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.HelixWorks,
  element: Element.Kinetic,
  rollQuality: 75,
  baseDamage: 10,
  attackSpeed: 1,
  critChance: 0.05,
  critDamage: 1.5,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 1,
  waveDamageMod: 1,
  shieldDamageMod: 1,
  armorDamageMod: 1,
  offlineEarningsMod: 1,
  rareDropChanceMod: 0,
  scrapYieldMod: 1,
  parts: [],
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 1,
  combatPower: 10,
  bossPower: 10,
  farmPower: 10,
  economyScore: 10,
});

const testShield = (id: string): Shield => ({
  id,
  name: `Shield ${id}`,
  level: 1,
  rarity: Rarity.Uncommon,
  hp: 25,
  mitigation: 0.1,
  rechargeRate: 2,
  element: Element.Kinetic,
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
});

describe('loadoutReadModel', () => {
  it('resolves equipped rows and counts only valid slot assignments', () => {
    const rows = buildLoadoutRows({ primary: 'w1', shield: 's1', relic: 'missing' }, [testWeapon('w1'), testShield('s1')]);

    expect(countEquippedLoadoutSlots(rows)).toBe(2);
    expect(getEquippedItemIdSet(rows)).toEqual(new Set(['w1', 's1']));
    expect(getLoadoutIntegrityIssues(rows).map((row) => row.slot)).toEqual(['relic']);
  });

  it('flags type mismatches instead of silently rendering empty', () => {
    const rows = buildLoadoutRows({ shield: 'w1' }, [testWeapon('w1')]);

    expect(rows.find((row) => row.slot === 'shield')?.status).toBe('wrong-slot-type');
    expect(countEquippedLoadoutSlots(rows)).toBe(0);
  });

  it('uses the same compatibility and default slot rules across screens', () => {
    const weapon = testWeapon('w1') as GearItem;
    const shield = testShield('s1') as GearItem;
    const rows = buildLoadoutRows({ primary: 'w1' }, [weapon]);

    expect(loadoutSlotAccepts('primary', weapon)).toBe(true);
    expect(loadoutSlotAccepts('shield', weapon)).toBe(false);
    expect(chooseDefaultSlotForItem(weapon, rows)).toBe('primary');
    expect(chooseDefaultSlotForItem(shield, rows)).toBe('shield');
  });
});
