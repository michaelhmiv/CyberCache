/**
 * Boss-sim honesty wiring (consumable strategy audit follow-up).
 *
 * The boss simulator used to read a hardcoded guest list: four
 * hardwired break multipliers, three hardwired survival pool values,
 * and rule totals summed from BASE effectRules (quality ornamental).
 * These tests pin the def-driven behavior that replaced it:
 *
 *  1. Break multipliers come from the prepared consumables'
 *     definitions, generically, once per prepared type, at the
 *     prepared batch's quality — including the coatings/charges that
 *     were inert before (Prism above all) and Corrosive Ammo at its
 *     card value ×1.30 instead of the flattened ×1.25.
 *  2. Survival pool values come from the defs (Shield Cell 120,
 *     Nano Swarm 300 — not the sim's old 100 / 250), and Med Kit
 *     (Refined) pools at its def value 260 instead of zero.
 *  3. Rule totals (loot chances, death-fee reduction, scanner
 *     intel) are read at crafted quality, and the Boss Scanner's
 *     quality tiers (2 at Q115, 3 at Q130, 4 at Q145, 5 at Q160)
 *     gate real readout lines.
 */
import { describe, expect, it } from 'vitest';
import { simulateBoss, type BossSimulationInput } from '../lib/simulation/bossSimulator';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';
import type { BossDef } from '../types/boss';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'wiring-test-gun',
    name: 'Wiring Test Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic, // neutral element: matchup 1.0 vs shield and armor
    rollQuality: 100,
    baseDamage: 100,
    attackSpeed: 1,
    critChance: 0,
    critDamage: 1,
    statusChance: 0,
    statusDamage: 1,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 1,
    armorDamageMod: 1,
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
  } as Weapon;
}

function makeBoss(overrides: Partial<BossDef> = {}): BossDef {
  return {
    id: 'wiring-test-boss',
    name: 'Wiring Test Boss',
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
    ...overrides,
  } as BossDef;
}

function baseInput(overrides: Partial<BossSimulationInput> = {}): BossSimulationInput {
  return {
    primary: makeWeapon(),
    secondary: null,
    heavy: null,
    ordnance: null,
    shield: null,
    classMod: null,
    relic: null,
    consumables: {},
    risk: RiskSetting.Balanced,
    boss: makeBoss(),
    playerLevel: 10,
    skillBonuses: {},
    pityCount: 0,
    playerCredits: 0,
    ...overrides,
  };
}

// With the fixture weapon (100 base damage, ×1 break mods, neutral
// element) the raw break totals are exactly 100 shield / 100 armor.
// breakScore is the MIN of the two axis scores, so each axis is
// observed against a 100-point pool while the other axis sits
// against a 50-point pool (score 2.0, above every multiplier under
// test) — the observed axis is always the minimum.
function shieldScore(consumables: Record<string, number>, quality?: Record<string, number>): number {
  return simulateBoss(baseInput({
    boss: makeBoss({ shield: 100, armor: 50 }),
    consumables,
    consumableQuality: quality,
  })).breakScore;
}

function armorScore(consumables: Record<string, number>, quality?: Record<string, number>): number {
  return simulateBoss(baseInput({
    boss: makeBoss({ shield: 50, armor: 100 }),
    consumables,
    consumableQuality: quality,
  })).breakScore;
}

// A boss with one explicit survival phase (the sim's phase analysis
// needs a phase to project a failure onto).
function phasedBoss(overrides: Partial<BossDef> = {}): BossDef {
  return makeBoss({
    tags: ['elite'],
    phases: [{
      id: 'p1',
      name: 'Survival Check',
      description: '',
      type: 'survival',
      targetValue: 1,
      recommendedCounters: [],
      failureReason: 'The boss overwhelms the hunter.',
      successReason: 'The hunter holds.',
      eventTrigger: 'bossMechanic',
    } as BossDef['phases'][number]],
    ...overrides,
  });
}

describe('generic break reader — def values, once per type', () => {
  it('weapon-only baseline is exactly 1.0 on both axes', () => {
    expect(shieldScore({})).toBeCloseTo(1, 10);
    expect(armorScore({})).toBeCloseTo(1, 10);
  });

  it('Shock Ammo pays ×1.30 shield at quality 100 (its def, unchanged)', () => {
    expect(shieldScore({ ShockAmmo: 1 })).toBeCloseTo(1.3, 10);
  });

  it('Corrosive Ammo pays its card value ×1.30 armor — NOT the old flattened ×1.25', () => {
    expect(armorScore({ CorrosiveAmmo: 1 })).toBeCloseTo(1.3, 10);
    expect(armorScore({ CorrosiveAmmo: 1 })).not.toBeCloseTo(1.25, 10);
  });

  it('Armor-Piercing Ammo pays ×1.25 armor at quality 100', () => {
    expect(armorScore({ ArmorPiercingAmmo: 1 })).toBeCloseTo(1.25, 10);
  });

  it('Phase Shift Grenade pays ×1.50 armor at quality 100', () => {
    expect(armorScore({ PhaseShiftGrenade: 1 })).toBeCloseTo(1.5, 10);
  });

  it('Prism Coating — inert before this wiring — now applies ×1.12 to BOTH axes', () => {
    expect(shieldScore({ PrismCoating: 1 })).toBeCloseTo(1.12, 10);
    expect(armorScore({ PrismCoating: 1 })).toBeCloseTo(1.12, 10);
  });

  it('EMP Charge applies ×1.35 shield; Corrosive Charge ×1.35 armor; Forgeheart Charge ×1.15 armor', () => {
    expect(shieldScore({ EMPCharge: 1 })).toBeCloseTo(1.35, 10);
    expect(armorScore({ CorrosiveCharge: 1 })).toBeCloseTo(1.35, 10);
    expect(armorScore({ ForgeheartCharge: 1 })).toBeCloseTo(1.15, 10);
  });

  it('Ordnance Charge applies its def ×1.15/×1.15 on top of the gear-scaled use count', () => {
    expect(shieldScore({ OrdnanceCharge: 1 })).toBeCloseTo(1.15, 10);
    expect(armorScore({ OrdnanceCharge: 1 })).toBeCloseTo(1.15, 10);
  });

  it('Elemental Coating applies ×1.08/×1.08 through the generic reader alone (the #379 composition pin: exactly once)', () => {
    expect(shieldScore({ ElementalCoating: 1 })).toBeCloseTo(1.08, 10);
    expect(armorScore({ ElementalCoating: 1 })).toBeCloseTo(1.08, 10);
    // Multiple prepared units still apply the multiplier once per type.
    expect(shieldScore({ ElementalCoating: 3 })).toBeCloseTo(1.08, 10);
  });

  it('Elemental Coating at quality 150 pays ×1.12 through the generic reader after the #379 fold (no double-apply, no loss)', () => {
    // #379 shipped a SPECIFIC ElementalCoating reader (×1.08 at Q100,
    // ×1.12 at Q150 per its def delta). The rebase folded that block
    // into this generic reader and deleted the special case — these
    // pins prove the fold preserved #379's exact outcomes: if both
    // readers survived, Q100 would read 1.08² ≈ 1.1664; if the fold
    // dropped the coating, both would read 1.0.
    expect(shieldScore({ ElementalCoating: 1 }, { ElementalCoating: 100 })).toBeCloseTo(1.08, 10);
    expect(armorScore({ ElementalCoating: 1 }, { ElementalCoating: 100 })).toBeCloseTo(1.08, 10);
    expect(shieldScore({ ElementalCoating: 1 }, { ElementalCoating: 150 })).toBeCloseTo(1.12, 10);
    expect(armorScore({ ElementalCoating: 1 }, { ElementalCoating: 150 })).toBeCloseTo(1.12, 10);
  });

  it('a multiplier applies once per prepared TYPE, never per unit', () => {
    expect(shieldScore({ ShockAmmo: 4 })).toBeCloseTo(1.3, 10);
  });

  it('distinct types stack multiplicatively (Shock + Prism on shield)', () => {
    expect(shieldScore({ ShockAmmo: 1, PrismCoating: 1 })).toBeCloseTo(1.3 * 1.12, 10);
  });

  it('crafted quality scales break through the def (Shock Q150 → ×1.45, Q75 → ×1.225)', () => {
    expect(shieldScore({ ShockAmmo: 1 }, { ShockAmmo: 150 })).toBeCloseTo(1.45, 10);
    expect(shieldScore({ ShockAmmo: 1 }, { ShockAmmo: 75 })).toBeCloseTo(1.225, 10);
  });
});

describe('def-driven survival pool', () => {
  // Player HP at level 10 = 700 + 60×10 = 1300; boss dps 100 → the
  // survival denominator is 100 × 30 = 3000. No shield, Balanced
  // risk, no legendary/skills: survivalScore is pool / 3000 exactly.
  const survivalInput = (consumables: Record<string, number>, quality?: Record<string, number>) =>
    baseInput({ boss: makeBoss({ dps: 100 }), consumables, consumableQuality: quality });

  it('no consumables: bare HP only', () => {
    expect(simulateBoss(survivalInput({})).survivalScore).toBeCloseTo(1300 / 3000, 10);
  });

  it('Med Kit pools at its def 150 (unchanged)', () => {
    expect(simulateBoss(survivalInput({ MedKit: 1 })).survivalScore).toBeCloseTo((1300 + 150) / 3000, 10);
  });

  it('Med Kit (Refined) pools at its def 260 — it contributed ZERO before this wiring', () => {
    expect(simulateBoss(survivalInput({ MedKitRefined: 1 })).survivalScore).toBeCloseTo((1300 + 260) / 3000, 10);
  });

  it('Shield Cell pools at its def 120 — not the sim’s old private 100', () => {
    expect(simulateBoss(survivalInput({ ShieldCell: 1 })).survivalScore).toBeCloseTo((1300 + 120) / 3000, 10);
  });

  it('Nano Swarm pools at its def 300 — not the sim’s old private 250', () => {
    expect(simulateBoss(survivalInput({ NanoSwarm: 1 })).survivalScore).toBeCloseTo((1300 + 300) / 3000, 10);
  });

  it('quality scales the def pool value (Refined at Q150 pays 390)', () => {
    expect(simulateBoss(survivalInput({ MedKitRefined: 1 }, { MedKitRefined: 150 })).survivalScore)
      .toBeCloseTo((1300 + 390) / 3000, 10);
  });
});

describe('rule totals read crafted quality; scanner tiers are real', () => {
  it('Luck Booster: 0.25 at Q100, 0.375 at Q150 (cap 0.40)', () => {
    expect(simulateBoss(baseInput({ consumables: { LuckBooster: 1 } })).bonusLootChance).toBeCloseTo(0.25, 10);
    expect(simulateBoss(baseInput({
      consumables: { LuckBooster: 1 }, consumableQuality: { LuckBooster: 150 },
    })).bonusLootChance).toBeCloseTo(0.375, 10);
  });

  it('Helix Calibration Kit reads at quality too (0.20 base, 0.30 at Q150)', () => {
    expect(simulateBoss(baseInput({
      consumables: { HelixCalibrationKit: 1 }, consumableQuality: { HelixCalibrationKit: 150 },
    })).bonusLootChance).toBeCloseTo(0.3, 10);
  });

  it('Data Skimmer extra-roll chance scales with quality (0.25 → 0.375 at Q150)', () => {
    expect(simulateBoss(baseInput({
      consumables: { DataSkimmer: 1 }, consumableQuality: { DataSkimmer: 150 },
    })).extraLootRollChance).toBeCloseTo(0.375, 10);
  });

  it('Insurance Token death-fee reduction scales with quality (50% at Q100, 70% cap at Q140)', () => {
    // Tier-1 boss: fee 3% of credits, cap 2500. 10,000 credits → 300 base fee.
    const fee = (quality: number) => simulateBoss(baseInput({
      consumables: { InsuranceToken: 1 },
      consumableQuality: { InsuranceToken: quality },
      playerCredits: 10_000,
    })).deathFee;
    expect(fee(100)).toBe(150);
    expect(fee(140)).toBe(90);
  });

  it('scanner tier ladder: 0 without a scanner, 1 at Q100, 2/3/4/5 at Q115/130/145/160 — max unlocked, never a sum', () => {
    const tier = (quality?: number) => simulateBoss(baseInput({
      consumables: { BossScanner: 1 },
      consumableQuality: quality === undefined ? undefined : { BossScanner: quality },
    })).scannerIntelTier;
    expect(simulateBoss(baseInput({ consumables: {} })).scannerIntelTier).toBe(0);
    expect(tier(undefined)).toBe(1);
    expect(tier(100)).toBe(1);
    expect(tier(115)).toBe(2);
    expect(tier(130)).toBe(3);
    expect(tier(145)).toBe(4);
    expect(tier(160)).toBe(5);
  });

  it('tier 1 readout names the weakest projected check', () => {
    const out = simulateBoss(baseInput({ consumables: { BossScanner: 1 } }));
    expect(out.recommendations.some((r) => r.includes('weakest projected check'))).toBe(true);
  });

  it('tier 2 readout names the channels answering the projected failure phase', () => {
    // The scanner's 'elite' counter-tag makes it a relevant channel
    // for the survival phase.
    const out = simulateBoss(baseInput({
      boss: phasedBoss(),
      consumables: { BossScanner: 1 },
      consumableQuality: { BossScanner: 115 },
    }));
    expect(out.recommendations.some((r) => r.includes('(tier 2)') && r.includes('Boss Scanner'))).toBe(true);
  });

  it('tier 4 readout projects the consumable burn', () => {
    const out = simulateBoss(baseInput({
      boss: phasedBoss(),
      consumables: { BossScanner: 1 },
      consumableQuality: { BossScanner: 145 },
    }));
    expect(out.recommendations.some((r) => r.includes('(tier 4)') && r.includes('projected consumable burn'))).toBe(true);
  });

  it('tier 5 readout calls the phase warning on a failing projection — and no readout ever quotes a win chance', () => {
    const out = simulateBoss(baseInput({
      boss: phasedBoss({ dps: 100_000, shield: 1_000_000, armor: 1_000_000, health: 1_000_000 }),
      consumables: { BossScanner: 1 },
      consumableQuality: { BossScanner: 160 },
    }));
    expect(out.scannerIntelTier).toBe(5);
    expect(out.recommendations.some((r) => r.includes('(tier 5)') && r.includes('phase warning'))).toBe(true);
    for (const line of [...out.recommendations, ...out.reasons]) {
      expect(line.toLowerCase()).not.toContain('win chance');
      expect(line).not.toMatch(/\d+(\.\d+)?% chance/);
    }
  });
});
