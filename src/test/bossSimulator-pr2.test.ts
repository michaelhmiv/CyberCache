/**
 * Tests for PR #2: boss vitals bars + Time-to-Kill + recommended power delta.
 *
 * What this PR added to the sim:
 *  - `BossSimulationOutput.effectiveDPS: number` (DPS at the time of the
 *    sim, after all multipliers including risk and player-level skills)
 *  - `BossSimulationOutput.timeToKill: number` (boss.health / effectiveDPS)
 *
 * What the HUD reads:
 *  - The 3-card grid (Win Chance / Time to Kill / Projected Failure) uses
 *    `timeToKill` and `effectiveDPS` directly.
 *  - The recommended-power delta uses `effectiveDPS` as the player
 *    comparison point (raw subtraction, then expressed as %).
 *
 * Edge cases the tests cover:
 *  - effectiveDPS is non-zero when a weapon is in play (regression for
 *    the same "0 DPS" complaint as PR #1, but in the sim this time).
 *  - timeToKill is finite even when effectiveDPS is 0 (no Infinity).
 *  - timeToKill scales inversely with effectiveDPS.
 */
import { describe, expect, it } from 'vitest';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';
import type { BossDef } from '../types/boss';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 75,
    baseDamage: 10,
    attackSpeed: 1,
    critChance: 0,
    critDamage: 1,
    statusChance: 0,
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

function makeBoss(overrides: Partial<BossDef> = {}): BossDef {
  return {
    id: 'test-boss',
    name: 'Test Boss',
    tier: 1,
    level: 50,
    health: 10_000,
    shield: 0,
    armor: 0,
    dps: 50,
    weaknesses: [],
    resistances: [],
    mechanic: { id: 'm1', name: 'None', description: '', checkType: 'survival' },
    tags: [],
    phases: [],
    recommendedPower: 100,
    entryCost: 0,
    rematchCost: 0,
    dropTable: [],
    dedicatedDrops: [],
    ...overrides,
  };
}

describe('simulateBoss — PR #2: effectiveDPS and timeToKill', () => {
  it('exposes effectiveDPS as a non-zero number when a weapon is in play', () => {
    const weapon = makeWeapon({ baseDamage: 100, attackSpeed: 5, critChance: 0.2, critDamage: 1.5 });
    const sim = simulateBoss({
      primary: weapon, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced, boss: makeBoss(), playerLevel: 50, skillBonuses: {},
    });
    expect(sim.effectiveDPS).toBeGreaterThan(0);
  });

  it('exposes timeToKill as a finite number when effectiveDPS is positive', () => {
    const weapon = makeWeapon({ baseDamage: 100, attackSpeed: 5 });
    const sim = simulateBoss({
      primary: weapon, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced, boss: makeBoss({ health: 10_000 }), playerLevel: 50, skillBonuses: {},
    });
    expect(Number.isFinite(sim.timeToKill)).toBe(true);
  });

  it('exposes timeToKill = boss.health / effectiveDPS', () => {
    // 100 base × 5 speed × 1.3 crit = 650 standard. effectiveDPS is the
    // post-multiplier value; the formula must hold regardless.
    const weapon = makeWeapon({ baseDamage: 100, attackSpeed: 5, critChance: 0.2, critDamage: 1.5 });
    const sim = simulateBoss({
      primary: weapon, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced, boss: makeBoss({ health: 10_000 }), playerLevel: 50, skillBonuses: {},
    });
    expect(sim.timeToKill).toBeCloseTo(10_000 / sim.effectiveDPS, 5);
  });

  it('scales timeToKill inversely with effectiveDPS (faster DPS = shorter TTK)', () => {
    // Same boss, two weapons of different strength. Stronger weapon
    // must produce a strictly shorter timeToKill.
    const weak = makeWeapon({ id: 'weak', baseDamage: 10, attackSpeed: 1, critChance: 0, critDamage: 1 });
    const strong = makeWeapon({ id: 'strong', baseDamage: 200, attackSpeed: 5, critChance: 0.2, critDamage: 1.5 });
    const boss = makeBoss({ health: 50_000 });
    const simWeak = simulateBoss({
      primary: weak, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 50, skillBonuses: {},
    });
    const simStrong = simulateBoss({
      primary: strong, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 50, skillBonuses: {},
    });
    expect(simStrong.timeToKill).toBeLessThan(simWeak.timeToKill);
  });

  it('does not return Infinity for timeToKill when effectiveDPS is zero', () => {
    // Edge case: a level-1 player with no weapon, vs a beefy boss. The
    // sim should never report Infinity — it must fall back to a finite
    // sentinel (boss.health, per the BossSimulationOutput contract).
    const sim = simulateBoss({
      primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null,
      consumables: {}, risk: RiskSetting.Balanced, boss: makeBoss({ health: 9999 }), playerLevel: 1, skillBonuses: {},
    });
    expect(Number.isFinite(sim.timeToKill)).toBe(true);
    expect(sim.timeToKill).toBeGreaterThan(0);
  });
});
