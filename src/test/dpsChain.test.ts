import { describe, expect, it } from 'vitest';
import { computeLoadoutDps, computeStandardDps, computeWeaponDps, describeDpsContext } from '../lib/stats/dpsChain';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Fire,
    rollQuality: 75,
    baseDamage: 100,
    attackSpeed: 5,
    critChance: 0.2,
    critDamage: 1.5,
    statusChance: 0.1,
    statusDamage: 1.0,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: 'cacheKey' as DropSource,
    isLocked: false,
    pixelSeed: 12345,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

describe('DPS modifier chain', () => {
  describe('computeStandardDps', () => {
    it('matches the legacy raw formula for a baseline weapon with neutral element', () => {
      // Use an element that is NOT strong against flesh (e.g. Shock) so the
      // legacy getElementMatchup fallback returns 1.0.
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      expect(computeStandardDps(weapon)).toBeCloseTo(rawDps, 5);
    });

    it('matches the legacy raw formula for a Fire weapon (Fire is 1.3x vs flesh)', () => {
      const weapon = makeWeapon({ element: Element.Fire });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      // Standard target = flesh for legacy fallback. Fire → 1.3x.
      expect(computeStandardDps(weapon)).toBeCloseTo(rawDps * 1.3, 5);
    });

    it('returns 0 for a weapon with zero damage', () => {
      const weapon = makeWeapon({ baseDamage: 0, element: Element.Shock });
      expect(computeStandardDps(weapon)).toBe(0);
    });
  });

  describe('computeWeaponDps (full chain)', () => {
    it('applies the counter-element 1.3x bonus when player element matches boss weakness', () => {
      // Use a neutral element (Shock) so the boss-weakness path is the only
      // element multiplier in play.
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      // bossWeakness: [Element.Shock] → counterElementMultiplier = 1.3
      const result = computeWeaponDps({ weapon, bossWeaknesses: [Element.Shock] });
      expect(result).toBeCloseTo(rawDps * 1.3, 4);
    });

    it('falls back to 1.0x when player element does not match boss weakness', () => {
      // Use a neutral element (Shock). Boss weak to Fire → 1.0x from counter table.
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, bossWeaknesses: [Element.Fire] });
      // No counter match → counterElementMultiplier returns 1.0 (no legacy
      // flesh fallback here because a boss weakness IS supplied).
      expect(result).toBeCloseTo(rawDps * 1.0, 4);
    });

    it('applies bossResistance multiplicatively', () => {
      // Neutral element so the result is purely rawDps * 0.5.
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, bossResistance: 0.5 });
      expect(result).toBeCloseTo(rawDps * 0.5, 4);
    });

    it('applies legendary damage multiplier', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, legendaryDamageMult: 1.4 });
      expect(result).toBeCloseTo(rawDps * 1.4, 4);
    });

    it('stacks consumable multipliers (TargetPainter + OptimalAmmo)', () => {
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        consumables: { TargetPainter: 1, OptimalAmmo: 1 },
      });
      // (1 + 1*0.15) * (1 + 1*0.08) = 1.15 * 1.08 = 1.242
      expect(result).toBeCloseTo(rawDps * 1.242, 4);
    });

    it('multiplies all chain steps together (full stack)', () => {
      // Neutral element so we can isolate the boss-weakness 1.3x.
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        bossWeaknesses: [Element.Shock],
        bossResistance: 0.9,
        legendaryDamageMult: 1.2,
        consumables: { TargetPainter: 1 },
      });
      // raw * 1.3 (counter element) * 0.9 (resistance) * 1.2 (legendary) * 1.15 (TargetPainter)
      const expected = rawDps * 1.3 * 0.9 * 1.2 * 1.15;
      expect(result).toBeCloseTo(expected, 4);
    });
  });

  describe('computeLoadoutDps', () => {
    it('sums DPS across multiple weapons', () => {
      const w1 = makeWeapon({ id: 'w1' });
      const w2 = makeWeapon({ id: 'w2', baseDamage: 200 });
      const total = computeLoadoutDps([w1, w2]);
      // Each weapon computed independently with the same defaults; result
      // is the sum of their standard DPS values.
      const expected = computeStandardDps(w1) + computeStandardDps(w2);
      expect(total).toBeCloseTo(expected, 4);
    });

    it('returns 0 for an empty loadout', () => {
      expect(computeLoadoutDps([])).toBe(0);
    });
  });

  describe('describeDpsContext', () => {
    it('labels a standard target context', () => {
      const weapon = makeWeapon({ manufacturer: Manufacturer.Redline });
      expect(describeDpsContext(weapon, {})).toBe('vs standard target · Redline');
    });

    it('labels a boss context with consumables', () => {
      const weapon = makeWeapon({ manufacturer: Manufacturer.Ironwood });
      const label = describeDpsContext(weapon, {
        bossWeaknesses: [Element.Fire],
        consumables: { TargetPainter: 1 },
      });
      expect(label).toContain('vs Fire-weak');
      expect(label).toContain('+TargetPainter');
      expect(label).toContain('Ironwood');
    });
  });
});
