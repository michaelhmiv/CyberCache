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
    it('matches the legacy raw formula for a baseline weapon with any element (PR D: vs standard = raw, no element multiplier)', () => {
      // Under PR D, "vs standard" means no element multiplier for any
      // element. The legacy getElementMatchup(element, 'flesh') fallback
      // is gone. This test covers the Shock element (which previously
      // returned 1.0× anyway) — the Fire/Cryo cases get their own
      // dedicated assertions below to prove the no-fallback invariant.
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      expect(computeStandardDps(weapon)).toBeCloseTo(rawDps, 5);
    });

    it('returns rawDps (1.0x) for Fire under "vs standard" (no flesh fallback)', () => {
      // Pre-PR-D: Fire weapon = 1.3× via the getElementMatchup('Fire',
      // 'flesh') fallback. Post-PR-D: "vs standard" = 1.0× for every
      // element. The Fire-specific assertion is the one that proves
      // the flesh fallback is actually gone.
      const weapon = makeWeapon({ element: Element.Fire });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      expect(computeStandardDps(weapon)).toBeCloseTo(rawDps, 5);
    });

    it('returns rawDps (1.0x) for Cryo under "vs standard" (no flesh fallback)', () => {
      // Same invariant, different element. Together with the Fire
      // test above, proves no element gets a hidden 1.3× in the
      // standard-target path.
      const weapon = makeWeapon({ element: Element.Cryo });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      expect(computeStandardDps(weapon)).toBeCloseTo(rawDps, 5);
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

    it('applies the counter-element 0.7x penalty when player element matches boss resistance (PR D new)', () => {
      // The 0.7× penalty is the new half of the 3-state counter
      // table. A Fire weapon vs a Fire-resistant boss deals 0.7×.
      // This was previously a silent 1.0× (the legacy chain had no
      // resistance concept at all).
      const weapon = makeWeapon({ element: Element.Fire });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({ weapon, bossResistances: [Element.Fire] });
      expect(result).toBeCloseTo(rawDps * 0.7, 4);
    });

    it('returns 1.0x when player element matches neither weakness nor resistance', () => {
      // Use a neutral element (Shock). Boss weak to Fire, resistant
      // to Cryo → 1.0× (no match on either side).
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        bossWeaknesses: [Element.Fire],
        bossResistances: [Element.Cryo],
      });
      expect(result).toBeCloseTo(rawDps * 1.0, 4);
    });

    it('weakness takes priority over resistance when arrays overlap on the player element (data invariant)', () => {
      // Boss weak to Fire AND resistant to Fire — this is a data
      // authoring mistake, but the chain should still produce a
      // sensible value. The 3-state table checks weakness first, so
      // the answer is 1.3×. (The reverse order — resistance wins —
      // would silently punish the player for an authoring typo.)
      const weapon = makeWeapon({ element: Element.Fire });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        bossWeaknesses: [Element.Fire],
        bossResistances: [Element.Fire],
      });
      expect(result).toBeCloseTo(rawDps * 1.3, 4);
    });

    it('applies bossResistances array (PR D: replaces legacy single-number bossResistance)', () => {
      // The legacy `bossResistance: 0.5` parameter is gone. The new
      // contract is `bossResistances: Element[]` (default empty).
      // This test asserts the empty default = 1.0× and a non-empty
      // array with a matching element = 0.7×.
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      // Empty array → no resistance → 1.0×
      const noResist = computeWeaponDps({ weapon, bossResistances: [] });
      expect(noResist).toBeCloseTo(rawDps * 1.0, 4);
      // Non-matching resistance → still 1.0×
      const otherResist = computeWeaponDps({ weapon, bossResistances: [Element.Fire] });
      expect(otherResist).toBeCloseTo(rawDps * 1.0, 4);
      // Matching resistance → 0.7×
      const matchingResist = computeWeaponDps({ weapon, bossResistances: [Element.Shock] });
      expect(matchingResist).toBeCloseTo(rawDps * 0.7, 4);
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
        bossResistances: [Element.Cryo], // non-matching → 1.0× for Shock
        legendaryDamageMult: 1.2,
        consumables: { TargetPainter: 1 },
      });
      // raw * 1.3 (counter element) * 1.0 (resistance, non-matching) * 1.2 (legendary) * 1.15 (TargetPainter)
      const expected = rawDps * 1.3 * 1.0 * 1.2 * 1.15;
      expect(result).toBeCloseTo(expected, 4);
    });

    it('full stack with resistance penalty (replaces the legacy "bossResistance: 0.9" path)', () => {
      // Demonstrates the new contract: a player element that matches
      // a boss resistance pays 0.7×, not a flat 0.9× (which was the
      // legacy single-number path). The math is: raw * 1.0 (neutral)
      // * 0.7 (matching resistance) * 1.2 (legendary) * 1.15 (TargetPainter).
      const weapon = makeWeapon({ element: Element.Shock });
      const rawDps = 100 * 5 * (1 + 0.2 * 1.5);
      const result = computeWeaponDps({
        weapon,
        bossResistances: [Element.Shock],
        legendaryDamageMult: 1.2,
        consumables: { TargetPainter: 1 },
      });
      const expected = rawDps * 1.0 * 0.7 * 1.2 * 1.15;
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
