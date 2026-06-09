import { describe, expect, it } from 'vitest';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { computeWeaponDps } from '../lib/stats/dpsChain';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';
import type { BossDef } from '../types/boss';

/**
 * PR D tests for the new `bossResistances: Element[]` parameter on the
 * DPS chain, consumed by the boss simulator.
 *
 * The full chain-vs-sim parity suite lives on the PR C branch
 * (src/test/bossSimulator.test.ts) and covers primary/secondary/heavy
 * matchup, signature, ammo windows, etc. This file is deliberately
 * narrow: it only asserts the new PR D contract — that the sim
 * actually consumes `boss.resistances` and applies the 0.7× penalty
 * to a matching element, with no involvement of the legacy
 * `bossResistance: number` parameter.
 */

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Redline,
    element: Element.Fire,
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

function makeBoss(weaknesses: Element[] = [], resistances: Element[] = []): BossDef {
  return {
    id: 'test-boss',
    name: 'Test Boss',
    tier: 1,
    level: 10,
    health: 5000, // High HP so the resulting dpsScore stays under the 1.5 cap
    shield: 0,
    armor: 0,
    dps: 100,
    weaknesses,
    resistances,
    mechanic: { id: 'enrage', name: 'Enrage', description: '', checkType: 'dps' },
    tags: [],
    phases: [],
    recommendedPower: 100,
    entryCost: 0,
    rematchCost: 0,
    dropTable: [],
    dedicatedDrops: [],
  };
}

describe('bossSimulator — PR D bossResistances array consumption', () => {
  it('sim applies the 0.7× penalty when player element matches boss.resistances', () => {
    // Fire weapon vs Fire-resistant boss. The chain should return
    // rawDps * 0.7 (no other modifiers in play for this test).
    const primary = makeWeapon({ id: 'primary', weaponType: WeaponType.Pistol, element: Element.Fire });
    const bossFireResist = makeBoss([], [Element.Fire]);
    const bossNoResist = makeBoss([], []);
    const simResist = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss: bossFireResist, playerLevel: 10, skillBonuses: {} });
    const simNoResist = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss: bossNoResist, playerLevel: 10, skillBonuses: {} });
    const dpsResist = simResist.dpsScore * bossFireResist.health / 30;
    const dpsNoResist = simNoResist.dpsScore * bossNoResist.health / 30;
    // Fire-vs-Fire-resistant should be 0.7× Fire-vs-no-resistance. The
    // pre-PR-D code (and any code that doesn't pass bossResistances)
    // would have given identical numbers.
    expect(dpsResist / dpsNoResist).toBeCloseTo(0.7, 1);
  });

  it('sim applies 0.7× from the chain, not from inline math', () => {
    // The chain and the sim should produce the same ratio for the
    // same context (resistances: [Fire], weapon: Fire, no other
    // modifiers). This proves the new contract: the sim consumes
    // bossResistances via the chain, not via inline math.
    const primary = makeWeapon({ id: 'primary', weaponType: WeaponType.Pistol, element: Element.Fire });
    const bossFireResist = makeBoss([], [Element.Fire]);
    const sim = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss: bossFireResist, playerLevel: 10, skillBonuses: {} });
    const simDps = sim.dpsScore * bossFireResist.health / 30;
    // Chain's value for the same context. No signature, no legendary,
    // no consumables. The chain applies 0.7× for matching resistance.
    const chainDps = computeWeaponDps({
      weapon: primary,
      bossWeaknesses: bossFireResist.weaknesses,
      bossResistances: bossFireResist.resistances,
      legendaryDamageMult: 1,
    });
    // Pistol ammoEfficiency for a 10/2 cycle in 30s = 27.2/30 ≈ 0.9067.
    // (The sim applies ammoEfficiency to primary; the chain does not.)
    const pistilAmmoEfficiency = (10 + 10 + 6 + 4 * 0.3) / 30;
    expect(simDps).toBeCloseTo(chainDps * pistilAmmoEfficiency, 2);
  });

  it('sim applies 1.3× weakness × 0.7× resistance correctly when both are present (compositional)', () => {
    // A boss weak to Fire AND resistant to Kinetic. A Fire weapon
    // gets 1.3× (weakness). A Kinetic weapon gets 0.7× (resistance).
    // A Shock weapon gets 1.0× (neither). This is the full 3-state
    // counter table in one sim call.
    const fireWeapon = makeWeapon({ id: 'fire', element: Element.Fire });
    const kineticWeapon = makeWeapon({ id: 'kinetic', element: Element.Kinetic });
    const shockWeapon = makeWeapon({ id: 'shock', element: Element.Shock });
    const boss = makeBoss([Element.Fire], [Element.Kinetic]);
    const simFire = simulateBoss({ primary: fireWeapon, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const simKinetic = simulateBoss({ primary: kineticWeapon, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const simShock = simulateBoss({ primary: shockWeapon, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const dpsFire = simFire.dpsScore * boss.health / 30;
    const dpsKinetic = simKinetic.dpsScore * boss.health / 30;
    const dpsShock = simShock.dpsScore * boss.health / 30;
    // Fire = Shock * 1.3 (weakness match)
    expect(dpsFire / dpsShock).toBeCloseTo(1.3, 1);
    // Kinetic = Shock * 0.7 (resistance match)
    expect(dpsKinetic / dpsShock).toBeCloseTo(0.7, 1);
  });
});
