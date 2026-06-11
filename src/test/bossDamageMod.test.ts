import { describe, expect, it } from 'vitest';
import { computeWeaponDps, computeStandardDps, computeLoadoutDps } from '../lib/stats/dpsChain';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Weapon',
    level: 10,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 50,
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
    legendaryEffectId: undefined,
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 0,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

describe('dpsChain — bossDamageMod', () => {
  it('weapon with bossDamageMod 0 has same DPS as without', () => {
    const weapon = makeWeapon({ bossDamageMod: 0 });
    const withField = computeWeaponDps({ weapon, bossDamageMod: 0 });
    const withoutField = computeWeaponDps({ weapon });
    expect(withField).toBe(withoutField);
  });

  it('weapon with bossDamageMod 0.2 gets 20% more DPS vs boss', () => {
    const weapon = makeWeapon({ bossDamageMod: 0.2 });
    const standard = computeStandardDps(weapon); // no bossDamageMod
    const bossDps = computeWeaponDps({ weapon, bossDamageMod: 0.2 });
    expect(bossDps).toBeCloseTo(standard * 1.2, 0);
  });

  it('bossDamageMod stacks multiplicatively with element matchup', () => {
    const weapon = makeWeapon({ bossDamageMod: 0.15, element: Element.Fire });
    // Fire vs Fire-weak boss: 1.3× element × 1.15× bossDamageMod
    const standard = computeStandardDps(weapon);
    const bossDps = computeWeaponDps({
      weapon,
      bossWeaknesses: [Element.Fire],
      bossDamageMod: 0.15,
    });
    expect(bossDps).toBeCloseTo(standard * 1.3 * 1.15, -1);
  });

  it('computeLoadoutDps applies bossDamageMod only when boss context is present', () => {
    const weapon = makeWeapon({ bossDamageMod: 0.5 });
    const standard = computeStandardDps(weapon);
    expect(computeLoadoutDps([weapon])).toBe(standard);
    expect(computeLoadoutDps([weapon], [Element.Kinetic], [])).toBeCloseTo(standard * 1.3 * 1.5, 0);
  });

  it('two weapons with different bossDamageMod each get their own bonus', () => {
    const w1 = makeWeapon({ id: 'w1', bossDamageMod: 0.1 });
    const w2 = makeWeapon({ id: 'w2', bossDamageMod: 0.3, baseDamage: 50 });
    const d1 = computeWeaponDps({ weapon: w1, bossDamageMod: 0.1 });
    const d2 = computeWeaponDps({ weapon: w2, bossDamageMod: 0.3 });
    const s1 = computeStandardDps(w1);
    const s2 = computeStandardDps(w2);
    expect(d1).toBeCloseTo(s1 * 1.1, 0);
    expect(d2).toBeCloseTo(s2 * 1.3, 0);
  });
});
