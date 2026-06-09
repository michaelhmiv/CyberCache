import { describe, expect, it } from 'vitest';
import { computeStandardDps, computeLoadoutDps, computeWeaponDps } from '../lib/stats/dpsChain';
import type { Weapon } from '../types/items';
import { Element, Manufacturer, Rarity, WeaponType } from '../types/game';

const makeWeapon = (overrides: Partial<Weapon> = {}): Weapon => ({
  id: 'test-wpn',
  name: 'Test Wpn',
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  rarity: Rarity.Common,
  level: 10,
  baseDamage: 50,
  attackSpeed: 6,
  critChance: 0.1,
  critDamage: 1.5,
  statusChance: 0,
  bossDamageMod: 0,
  bossPower: 100,
  combatPower: 100,
  farmPower: 100,
  shieldDamageMod: 0,
  armorDamageMod: 0,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  affixes: [],
  ammoPerReload: 0,
  ...overrides,
});

describe('dpsChain modifier chain', () => {
  it('computeStandardDps matches the raw formula on a baseline weapon', () => {
    // baseDamage=50, attackSpeed=6, critChance=0.1, critDamage=1.5
    // raw = 50 * 6 * (1 + 0.1 * 1.5) = 300 * 1.15 = 345
    const w = makeWeapon();
    expect(computeStandardDps(w)).toBeCloseTo(345, 4);
  });

  it('computeStandardDps includes the legendary damage multiplier when provided', () => {
    const w = makeWeapon();
    const base = computeStandardDps(w);
    expect(computeStandardDps(w, 1.5)).toBeCloseTo(base * 1.5, 4);
  });

  it('computeWeaponDps applies element matchup vs boss weakness', () => {
    // The DPS chain's counter-element table: matching the boss's first
    // weakness element gives a 1.3x multiplier; non-matching elements
    // return 1.0x (neutral).
    const fire = makeWeapon({ element: Element.Fire });
    const cryo = makeWeapon({ element: Element.Cryo });
    const fireVsFire = computeWeaponDps({ weapon: fire, bossWeaknesses: [Element.Fire] });
    const cryoVsFire = computeWeaponDps({ weapon: cryo, bossWeaknesses: [Element.Fire] });
    expect(fireVsFire).toBeGreaterThan(0);
    expect(cryoVsFire).toBeGreaterThan(0);
    // Fire-vs-Fire (matching weakness) should be 1.3x Cryo-vs-Fire (neutral)
    expect(fireVsFire).toBeCloseTo(cryoVsFire * 1.3, 4);
  });

  it('computeWeaponDps applies boss resistance multiplicatively', () => {
    const w = makeWeapon();
    const base = computeWeaponDps({ weapon: w });
    const resisted = computeWeaponDps({ weapon: w, bossResistance: 0.5 });
    expect(resisted).toBeCloseTo(base * 0.5, 4);
  });

  it('computeWeaponDps applies pre-fight consumables', () => {
    const w = makeWeapon();
    const base = computeWeaponDps({ weapon: w });
    const painted = computeWeaponDps({ weapon: w, consumables: { TargetPainter: 1 } });
    // TargetPainter is +15% DPS
    expect(painted).toBeCloseTo(base * 1.15, 4);
  });

  it('computeLoadoutDps sums per-weapon DPS', () => {
    const w1 = makeWeapon({ id: 'a' });
    const w2 = makeWeapon({ id: 'b' });
    const total = computeLoadoutDps([w1, w2]);
    const one = computeStandardDps(w1);
    const two = computeStandardDps(w2);
    expect(total).toBeCloseTo(one + two, 4);
  });
});
