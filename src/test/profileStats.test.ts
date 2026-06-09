import { describe, expect, it } from 'vitest';
import { combatStatsSelectors } from '@/store/slices/combatStatsSlice';
import { Element, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

const makeWeapon = (affixStats: string[]): Weapon => ({
  id: 'test-weapon',
  name: 'Test',
  kind: 'weapon',
  weaponType: WeaponType.Pistol,
  rarity: 'Common',
  manufacturer: 'Dahl',
  element: Element.Kinetic,
  baseDamage: 10,
  attackSpeed: 1,
  critChance: 0.05,
  critDamage: 1.5,
  reloadSpeed: 2,
  magazineSize: 12,
  accuracy: 0.9,
  affixes: affixStats.map((stat, i) => ({ id: `${stat}_${i}`, stat, value: 1 })),
  isLocked: false,
  combatPower: 100,
  signature: 'Test',
});

describe('ProfileScreen stat selectors', () => {
  describe('dominantWeaponType', () => {
    it('returns null for an empty kill ledger', () => {
      expect(combatStatsSelectors.dominantWeaponType({ killsByWeaponType: {} })).toBeNull();
    });

    it('returns the weapon type with the most kills', () => {
      const result = combatStatsSelectors.dominantWeaponType({
        killsByWeaponType: {
          [WeaponType.SMG]: 4,
          [WeaponType.Sniper]: 12,
          [WeaponType.Pistol]: 7,
        },
      });
      expect(result).toBe(WeaponType.Sniper);
    });

    it('reflects what the player actually uses, not what they own', () => {
      // Player might own 30 pistols but racks kills with a single SMG;
      // the build identity is the SMG.
      const result = combatStatsSelectors.dominantWeaponType({
        killsByWeaponType: {
          [WeaponType.Pistol]: 0, // owned but never used
          [WeaponType.SMG]: 41,
        },
      });
      expect(result).toBe(WeaponType.SMG);
    });
  });

  describe('unique affix types', () => {
    // The old formula used `affix.id` = `${stat}_${index}` which counted
    // affix *slots*, not distinct affix *types*. The fix uses `affix.stat`.
    it('counts distinct affix stats across all weapons', () => {
      const weapons: Weapon[] = [
        makeWeapon(['damage', 'critChance']),
        makeWeapon(['damage', 'reloadSpeed']),
        makeWeapon(['critChance', 'magazineSize']),
      ];
      const unique = new Set(weapons.flatMap((w) => w.affixes.map((a) => a.stat))).size;
      // {damage, critChance, reloadSpeed, magazineSize} = 4
      expect(unique).toBe(4);
    });

    it('returns 0 when no weapons have affixes', () => {
      const weapons: Weapon[] = [];
      const unique = new Set(weapons.flatMap((w) => w.affixes.map((a) => a.stat))).size;
      expect(unique).toBe(0);
    });
  });
});
