import { describe, expect, it } from 'vitest';
import type { Weapon } from '@/types/items';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import { selectEquippedWeapons, selectPrimaryEquippedWeapon } from './equippedWeaponTruth';

const makeWeapon = (id: string): Weapon => ({
  id,
  name: id,
  level: 1,
  rarity: Rarity.Common,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  baseDamage: 10,
  attackSpeed: 1,
  critChance: 0,
  critDamage: 1,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 1,
  waveDamageMod: 1,
  shieldDamageMod: 1,
  armorDamageMod: 1,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  rollQuality: 50,
  combatPower: 10,
  bossPower: 10,
  farmPower: 10,
  economyScore: 0,
  parts: [],
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 1,
});

describe('equipped weapon truth helpers', () => {
  it('returns no weapons when every loadout getter is undefined', () => {
    const weapons = selectEquippedWeapons({
      getWeapon: () => undefined,
    });
    expect(weapons).toEqual([]);
    expect(selectPrimaryEquippedWeapon({ getWeapon: () => undefined })).toBeUndefined();
  });

  it('returns only loadout getter weapons and preserves slot priority', () => {
    const primary = makeWeapon('primary');
    const heavy = makeWeapon('heavy');
    const weapons = selectEquippedWeapons({
      getWeapon: (slot) => slot === 'primary' ? primary : slot === 'heavy' ? heavy : undefined,
    });
    expect(weapons.map((w) => w.id)).toEqual(['primary', 'heavy']);
    expect(selectPrimaryEquippedWeapon({ getWeapon: (slot) => slot === 'heavy' ? heavy : undefined })?.id).toBe('heavy');
  });
});
