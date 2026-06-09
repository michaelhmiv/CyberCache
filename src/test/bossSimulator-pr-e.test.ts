import { describe, expect, it } from 'vitest';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { computeWeaponDps } from '../lib/stats/dpsChain';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';
import type { BossDef } from '../types/boss';

/**
 * PR E tests for the new chain-vs-sim integration: signature,
 * consumables, and ammoEfficiency are now folded into the chain
 * (no longer applied as separate multipliers in the sim).
 *
 * The full parity suite for the chain-vs-sim relationship lives on
 * the PR C branch (src/test/bossSimulator.test.ts). This file is
 * deliberately narrow: it asserts only the new PR E contract that
 * (a) signature applies, (b) consumables apply, (c) ammoEfficiency
 * applies, all via the chain — and the sim's outer DPS value
 * reflects them.
 */

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic, // Neutral element so element matchup doesn't distort the test
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
    health: 5000, // High HP so dpsScore stays under 1.5 cap
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

describe('bossSimulator — PR E chain absorption of signature + consumables + ammoEfficiency', () => {
  it('sim applies signature dpsMult via the chain (no separate sig.dpsMult multiplication on top)', () => {
    // Pre-PR-E: sim did `chainDps * ammoEff * sig.dpsMult` (sig on top).
    // Post-PR-E: chain does `rawDps * sig.dpsMult * ... * ammoEff` (sig inside).
    // The sim's `primaryDPS` should equal the chain's output for the
    // same context. The test asserts: changing the signature changes
    // primaryDPS proportionally to the signature's dpsMult.
    //
    // The sim's `calculateAmmoWindows` doesn't differentiate by
    // signature (the ammo window math is independent of the
    // signature mechanic). So a Pistol (sidearm_recovery, 1.0×) and
    // a Launcher (reload_lock_stagger, 0.85×) both get the same
    // ammoEfficiency for default mag/reload. The ratio is purely
    // the signature's dpsMult ratio: 0.85.
    const pistol = makeWeapon({ id: 'pistol', signatureMechanic: 'sidearm_recovery' } as Partial<Weapon>);
    const launcher = makeWeapon({ id: 'launcher', signatureMechanic: 'reload_lock_stagger' } as Partial<Weapon>);
    const boss = makeBoss();
    const simPistol = simulateBoss({ primary: pistol, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const simLauncher = simulateBoss({ primary: launcher, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const dpsPistol = simPistol.dpsScore * boss.health / 30;
    const dpsLauncher = simLauncher.dpsScore * boss.health / 30;
    // Launcher signature 0.85×, Pistol signature 1.0×. Same ammo
    // efficiency. Ratio = 0.85.
    expect(dpsLauncher / dpsPistol).toBeCloseTo(0.85, 2);
  });

  it('sim applies pre-fight consumable DPS multiplier via the chain (no separate consumable × dps block)', () => {
    // Pre-PR-E: sim applied `dps *= 1.15` for TargetPainter AFTER the
    // chain call. Post-PR-E: chain consumes the consumables table
    // directly. Test: same weapon, two consumable sets, ratio matches
    // the consumable multiplier.
    const primary = makeWeapon({ id: 'primary', weaponType: WeaponType.Pistol });
    const boss = makeBoss();
    const simNoConsumable = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const simWithTargetPainter = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: { TargetPainter: 1 }, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const simWithOverchargeStim = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: { OverchargeStim: 1 }, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const dpsNo = simNoConsumable.dpsScore * boss.health / 30;
    const dpsTP = simWithTargetPainter.dpsScore * boss.health / 30;
    const dpsOS = simWithOverchargeStim.dpsScore * boss.health / 30;
    // TargetPainter = +15% (chain), OverchargeStim = +12% (chain)
    expect(dpsTP / dpsNo).toBeCloseTo(1.15, 3);
    expect(dpsOS / dpsNo).toBeCloseTo(1.12, 3);
  });

  it('sim applies ammoEfficiency via the chain (no separate ammoEff × chain multiplication on top)', () => {
    // Pre-PR-E: sim did `chainDps * ammoEff` (ammo on top). Post-PR-E:
    // chain does `* ammoEff` (ammo inside). The numerical effect is
    // the same. The test asserts the chain and the sim agree on the
    // ammo-window output for a primary weapon.
    //
    // Setup: Pistol (10s mag, 2s reload, no ammo pack). Chain sees
    // ammoEfficiency = 27.2/30 = 0.9067. Sim pre-computes the same
    // and passes it in. The sim's primaryDPS should equal the chain's
    // output for the same context.
    const primary = makeWeapon({ id: 'primary', weaponType: WeaponType.Pistol, baseDamage: 10, attackSpeed: 1 });
    const boss = makeBoss();
    const sim = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const simDps = sim.dpsScore * boss.health / 30;
    // Chain's value for the same context, with Pistol ammoEfficiency.
    const chainDps = computeWeaponDps({
      weapon: primary,
      bossWeaknesses: boss.weaknesses,
      bossResistances: boss.resistances,
      consumables: {},
      legendaryDamageMult: 1,
      ammoEfficiency: (10 + 10 + 6 + 4 * 0.3) / 30, // 0.9067
    });
    expect(simDps).toBeCloseTo(chainDps, 4); // DEBUG: simDps=${simDps} chainDps=${chainDps} sim.dpsScore=${sim.dpsScore}
  });

  it('sim chain call and direct chain call produce the same value for full context (smoke test)', () => {
    // The chain is the single source of truth. For any (weapon,
    // boss, consumables, legendary) tuple, the sim's primaryDPS
    // should match the chain's computeWeaponDps output (modulo
    // secondary/heavy contributions and per-slot multipliers which
    // are zero in this single-weapon test).
    //
    // Consumables: TargetPainter + OverchargeStim (DPS-affecting,
    // no ammo-pack types). The sim's ammoEfficiency for a Pistol
    // with no ammo packs is (10+10+6+4*0.3)/30 = 0.9067. We pass the
    // same value to the chain.
    const primary = makeWeapon({
      id: 'primary',
      weaponType: WeaponType.Pistol,
      element: Element.Fire,
      baseDamage: 10,
      attackSpeed: 1,
    });
    const boss = makeBoss([Element.Fire]);
    const consumables = { TargetPainter: 1, OverchargeStim: 1 };
    const ammoEfficiencyForPistolNoAmmo = (10 + 10 + 6 + 4 * 0.3) / 30;
    const sim = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    const simDps = sim.dpsScore * boss.health / 30;
    const chainDps = computeWeaponDps({
      weapon: primary,
      bossWeaknesses: boss.weaknesses,
      bossResistances: boss.resistances,
      consumables,
      legendaryDamageMult: 1,
      ammoEfficiency: ammoEfficiencyForPistolNoAmmo,
    });
    expect(simDps).toBeCloseTo(chainDps, 4);
  });
});
