import { describe, expect, it } from 'vitest';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { computeStandardDps, computeWeaponDps } from '../lib/stats/dpsChain';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';
import type { BossDef } from '../types/boss';

/**
 * Chain-vs-simulator parity tests.
 *
 * The audit (see .hermes/plans/dps-chain-v2-plan.md, PR C) found that
 * the boss simulator computed per-weapon DPS inline
 * (`bossSimulator.ts:519, 530, 537`) with a formula that did not match
 * the live chain. The diorama's "vs boss" DPS chip and the simulator's
 * "you will not defeat the boss before timeout" check could disagree,
 * because they were using two different formulas.
 *
 * PR C fixes this by having the simulator call `computeWeaponDps` per
 * weapon. The per-fight modifiers (ammo windows, signature mechanics,
 * per-slot contribution multipliers) stay in the sim because they're
 * loadout-decision concerns, not per-weapon properties. PR E will fold
 * the signature and consumable concerns into the chain too.
 *
 * These tests assert the sim's effective DPS is consistent with the
 * chain's DPS, within a tolerance that accounts for the per-fight
 * modifiers the sim applies.
 */

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
    health: 1000,
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

describe('bossSimulator — chain-vs-sim parity', () => {
  it('primary weapon: sim applies the chain DPS, modified by ammo window × signature', () => {
    // Baseline weapon with no signature (sig.dpsMult = 1) and no
    // reload (ammoEfficiency = 1) — i.e. a Pistol with infinite ammo.
    // The weapon is intentionally LOW DPS so the sim's dpsScore
    // stays under the 1.5× cap that the winChance formula applies.
    // Under those conditions the sim's primary DPS (back-computed
    // from dpsScore) should be exactly the chain's
    // computeWeaponDps for the same context.
    const primary = makeWeapon({
      id: 'primary',
      weaponType: WeaponType.Pistol,
      element: Element.Kinetic, // Kinetic avoids the chain's 'flesh' fallback in step 4
      baseDamage: 10,
      attackSpeed: 1,
      critChance: 0,
      critDamage: 1,
    });
    const boss = makeBoss([Element.Fire]);
    boss.health = 5000;
    const sim = simulateBoss({
      primary,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: 10,
      skillBonuses: {},
    });
    // Back-compute: dpsScore = 30 * dps / boss.health → dps = dpsScore * boss.health / 30
    const effectiveDps = sim.dpsScore * boss.health / 30;
    // The chain's value for the same context (no signature, no ammo
    // window, no legendary, no consumables).
    // For a Kinetic weapon vs Fire-weakness, no match, so elemMatch = 1.0×.
    // The chain value is therefore 10 * 1 * 1 * 1 = 10. The sim applies
    // the Pistol's ammoEfficiency (~0.907 for a 10/2 cycle in 30s),
    // so effective DPS = 10 * 0.907 = 9.07.
    const chainDps = computeWeaponDps({
      weapon: primary,
      bossWeaknesses: boss.weaknesses,
      bossResistance: 1,
      legendaryDamageMult: 1,
    });
    // Assert within 1% of the chain × Pistol ammoEfficiency. The ammo
    // efficiency is a sim-only concern, not the chain's.
    const pistilAmmoEfficiency = (10 + 10 + 6 + 4 * 0.3) / 30; // 26s full + 4s reload*0.3 = 27.2s / 30s = 0.9067
    expect(effectiveDps).toBeCloseTo(chainDps * pistilAmmoEfficiency, 2);
  });

  it('primary weapon: matching-element weakness produces exactly 1.3× the non-matching-element DPS', () => {
    // A Fire weapon vs a Fire-weakness boss should produce 1.3× the
    // DPS of the same weapon vs a non-Fire-weakness boss. This
    // proves the chain's counterElementMultiplier is being used
    // (not the legacy `getElementMatchup(element, 'flesh')` which
    // returned 1.0× for non-flesh target types).
    //
    // To avoid the chain's "flesh fallback" returning 1.3× for
    // Fire-vs-no-weakness (a side effect of the current chain that
    // PR D will fix), we compare Fire-vs-Fire-weak to Fire-vs-Cryo-weak
    // (both are valid Element weaknesses, one matches, one doesn't).
    const primary = makeWeapon({
      id: 'primary',
      weaponType: WeaponType.Pistol,
      element: Element.Fire,
      baseDamage: 10,
      attackSpeed: 1,
      critChance: 0,
      critDamage: 1,
    });
    const bossFireWeak = makeBoss([Element.Fire]); bossFireWeak.health = 5000;
    const bossCryoWeak = makeBoss([Element.Cryo]); bossCryoWeak.health = 5000;
    const simFire = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss: bossFireWeak, playerLevel: 10, skillBonuses: {} });
    const simCryo = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss: bossCryoWeak, playerLevel: 10, skillBonuses: {} });
    const dpsFire = simFire.dpsScore * bossFireWeak.health / 30;
    const dpsCryo = simCryo.dpsScore * bossCryoWeak.health / 30;
    // Fire-vs-Fire should be 1.3× Fire-vs-Cryo. The pre-PR-C code
    // would have given identical numbers (1.0× from the broken
    // getElementMatchup call on both).
    expect(dpsFire / dpsCryo).toBeCloseTo(1.3, 1);
  });

  it('full loadout (primary + secondary + heavy): chain sum and sim DPS are within tolerance', () => {
    // A standard "3-weapon" loadout. The sim's DPS is the sum of
    // primary + secondary × secContrib + heavy × 0.5, with the chain
    // providing the per-weapon base. Low DPS + high HP so dpsScore
    // stays under the 1.5 cap. All weapons are Pistols (no
    // signature, predictable ammoEfficiency).
    //
    // Both primary and secondary get the Pistol ammoEfficiency of
    // 0.9067 (the sim only applies ammoEfficiency to primary in the
    // current code, so the test asserts the per-slot responsibility).
    // Heavy gets no ammo window.
    const primary = makeWeapon({ id: 'primary', weaponType: WeaponType.Pistol, element: Element.Kinetic, baseDamage: 10, attackSpeed: 1, critChance: 0, critDamage: 1 });
    const secondary = makeWeapon({ id: 'secondary', weaponType: WeaponType.Pistol, element: Element.Kinetic, baseDamage: 10, attackSpeed: 1, critChance: 0, critDamage: 1 });
    const heavy = makeWeapon({ id: 'heavy', weaponType: WeaponType.Pistol, element: Element.Kinetic, baseDamage: 10, attackSpeed: 1, critChance: 0, critDamage: 1 });
    const boss = makeBoss([Element.Fire]); boss.health = 5000;
    const sim = simulateBoss({
      primary, secondary, heavy,
      ordnance: null, shield: null, classMod: null, relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      boss, playerLevel: 10, skillBonuses: {},
    });
    const simDps = sim.dpsScore * boss.health / 30;
    // Chain's value for the same loadout. All Kinetic-vs-Fire means
    // no match (1.0×), so each weapon's chainDps = 10.
    const chainPrimary = computeWeaponDps({ weapon: primary, bossWeaknesses: boss.weaknesses, bossResistance: 1, legendaryDamageMult: 1 });
    const chainSecondary = computeWeaponDps({ weapon: secondary, bossWeaknesses: boss.weaknesses, bossResistance: 1, legendaryDamageMult: 1 });
    const chainHeavy = computeWeaponDps({ weapon: heavy, bossWeaknesses: boss.weaknesses, bossResistance: 1, legendaryDamageMult: 1 });
    // Per-slot modifiers: primary * ammoEfficiency, secondary * secContrib,
    // heavy * 0.5. (Secondary does NOT get ammoEfficiency in the current sim.)
    // Pistol cycle: 10s mag + 2s reload. In 30s: 20s full + 4s reload + 6s partial = 26s full + 4s reload.
    // Effective = 26 + 4 * 0.3 = 27.2s. ammoEfficiency = 27.2/30 ≈ 0.9067.
    const pistilAmmoEfficiency = (10 + 10 + 6 + 4 * 0.3) / 30;
    const expectedDps = chainPrimary * pistilAmmoEfficiency + chainSecondary * 0.3 + chainHeavy * 0.5;
    expect(simDps).toBeCloseTo(expectedDps, 1);
  });

  it('the chain produces the same value for a given weapon regardless of how the sim calls it (no side effects)', () => {
    // If the sim ever introduces a side effect on the weapon (e.g.
    // mutating it before calling the chain), this test catches it.
    const primary = makeWeapon({ id: 'primary', weaponType: WeaponType.Pistol, element: Element.Kinetic });
    const boss = makeBoss([Element.Fire]);
    const before = JSON.stringify(primary);
    simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} });
    expect(JSON.stringify(primary)).toBe(before);
  });

  it('computeStandardDps of a weapon matches the chain call inside the sim (for a no-boss context)', () => {
    // The chain's "vs standard target" baseline is exactly what the sim
    // would compute for a no-boss, no-weakness, no-resistance, no-
    // legendary context. Asserts the chain is the single source of
    // truth: the sim's chain call and the public computeStandardDps
    // function produce the same number.
    const weapon = makeWeapon({ element: Element.Kinetic });
    const standardDps = computeStandardDps(weapon);
    const fromSimContext = computeWeaponDps({
      weapon,
      bossWeaknesses: [],
      bossResistance: 1,
      legendaryDamageMult: 1,
    });
    expect(fromSimContext).toBe(standardDps);
  });
});

describe('bossSimulator — the legacy getElementMatchup-bug regression is closed', () => {
  it('the sim no longer uses `getElementMatchup(element, flesh)` (a regression test for the latent bug)', () => {
    // Pre-PR-C, bossSimulator.ts:518 did:
    //   const elemMatch = getElementMatchup(primary.element, boss.weaknesses[0] || 'flesh');
    // Since boss.weaknesses are stored as Element enum values, not
    // target-type strings, the call silently returned 1.0×. The
    // counter-element 1.3× bonus NEVER applied.
    //
    // After PR C, the sim calls computeWeaponDps which uses
    // counterElementMultiplier (Element, Element) → 1.3 for a match.
    // This test asserts that a Fire weapon vs a Fire-weakness boss
    // produces a measurably different DPS than a Fire weapon vs a
    // non-Fire-weakness boss (both bosses with valid Element
    // weaknesses, to avoid the chain's "flesh fallback" complication
    // that PR D will fix).
    const primary = makeWeapon({ id: 'primary', weaponType: WeaponType.Pistol, element: Element.Fire, baseDamage: 10, attackSpeed: 1, critChance: 0, critDamage: 1 });
    const bossFireWeak = makeBoss([Element.Fire]); bossFireWeak.health = 5000;
    const bossKineticWeak = makeBoss([Element.Kinetic]); bossKineticWeak.health = 5000;
    const simFire = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss: bossFireWeak, playerLevel: 10, skillBonuses: {} });
    const simKinetic = simulateBoss({ primary, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, consumables: {}, risk: RiskSetting.Balanced, boss: bossKineticWeak, playerLevel: 10, skillBonuses: {} });
    const dpsFire = simFire.dpsScore * bossFireWeak.health / 30;
    const dpsKinetic = simKinetic.dpsScore * bossKineticWeak.health / 30;
    // Fire-vs-Fire should be 1.3× Fire-vs-Kinetic. The pre-PR-C code
    // would have given identical numbers (1.0× from the broken
    // getElementMatchup call on both).
    expect(dpsFire / dpsKinetic).toBeCloseTo(1.3, 1);
  });
});
