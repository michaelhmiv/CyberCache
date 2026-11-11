import { describe, expect, it } from 'vitest';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Ordnance, Weapon } from '../types/items';
import type { BossDef } from '../types/boss';

/**
 * Wiring package (2026-11-04) — the boss sim READS the consumable
 * defs instead of hardcoding a guest list. Source of truth for the
 * defects: ~/workspace/cybercache-prep/consumable-strategy-audit-2026-11-04.md
 *
 * Pins:
 *  - the generic break reader (legacy effects resolve to DEF values;
 *    Corrosive ×1.30 is a DELIBERATE delta over the old ×1.25
 *    hardcode);
 *  - Prism Coating's break effect is real (changes the outcome);
 *  - the generic survival pool (priced from the defs; since tuning
 *    T2 the survival family pools as % of the hunter pool — MedKit
 *    Refined joins at 30% of pool);
 *  - quality read in boss attempts (Luck/Data/Insurance rule totals
 *    scale with the def's declared quality scaling; Q100 = base);
 *  - mechanic flats / repair suppression / crit bonus reads.
 */

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: 'Test Gun',
    level: 50,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Kinetic,
    rollQuality: 75,
    baseDamage: 100,
    attackSpeed: 5,
    critChance: 0.2,
    critDamage: 1.5,
    statusChance: 0.1,
    statusDamage: 1.0,
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
  };
}

function makeOrdnance(overrides: Partial<Ordnance> = {}): Ordnance {
  return {
    id: 'test-ordnance',
    name: 'Test Ordnance',
    level: 50,
    rarity: Rarity.Epic,
    damage: 0,
    shieldDamage: 50,
    armorDamage: 50,
    element: Element.Kinetic,
    effect: '',
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 0,
    ...overrides,
  };
}

function makeBoss(overrides: Partial<BossDef> = {}): BossDef {
  return {
    id: 'test-boss',
    name: 'Test Boss',
    tier: 1,
    level: 10,
    health: 100000,
    shield: 1000,
    armor: 1000,
    dps: 100,
    weaknesses: [],
    resistances: [],
    mechanic: { id: 'enrage', name: 'Enrage', description: '', checkType: 'dps' },
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

function simWith(
  consumables: Record<string, number>,
  opts: {
    boss?: Partial<BossDef>;
    primary?: Partial<Weapon> | null;
    ordnance?: Ordnance | null;
    skillBonuses?: Record<string, number>;
    consumableQuality?: Record<string, number>;
    playerCredits?: number;
  } = {},
) {
  return simulateBoss({
    primary: opts.primary === null ? null : makeWeapon(opts.primary ?? {}),
    secondary: null,
    heavy: null,
    ordnance: opts.ordnance ?? null,
    shield: null,
    classMod: null,
    relic: null,
    consumables,
    consumableQuality: opts.consumableQuality,
    risk: RiskSetting.Balanced,
    boss: makeBoss(opts.boss ?? {}),
    playerLevel: 10,
    skillBonuses: opts.skillBonuses ?? {},
    playerCredits: opts.playerCredits ?? 0,
  });
}

describe('wiring — generic break reader', () => {
  // The sim output exposes breakScore = min(shield, armor) score, so
  // each test aims at a boss where only one break dimension binds:
  // shieldBoss (armor 0 → armor score 1) makes breakScore the shield
  // score; armorBoss (shield 0) makes it the armor score.
  const shieldBoss = { armor: 0 };
  const armorBoss = { shield: 0 };

  it('Shock Ammo resolves to its def shield multiplier ×1.3', () => {
    const bare = simWith({}, { boss: shieldBoss });
    const withAmmo = simWith({ ShockAmmo: 1 }, { boss: shieldBoss });
    expect(withAmmo.breakScore / bare.breakScore).toBeCloseTo(1.3, 6);
  });

  it('Corrosive Ammo resolves to its DEF armor multiplier ×1.30 (deliberate delta: the old hardcode flattened it to ×1.25)', () => {
    const bare = simWith({}, { boss: armorBoss });
    const withAmmo = simWith({ CorrosiveAmmo: 1 }, { boss: armorBoss });
    expect(withAmmo.breakScore / bare.breakScore).toBeCloseTo(1.3, 6);
  });

  it('Armor-Piercing Ammo resolves to its def armor multiplier ×1.25', () => {
    const bare = simWith({}, { boss: armorBoss });
    const withAmmo = simWith({ ArmorPiercingAmmo: 1 }, { boss: armorBoss });
    expect(withAmmo.breakScore / bare.breakScore).toBeCloseTo(1.25, 6);
  });

  it('Phase Shift Grenade reads BOTH its ×1.5 armor multiplier and its 0.4 armor bypass', () => {
    const bare = simWith({}, { boss: armorBoss });
    const withAmmo = simWith({ PhaseShiftGrenade: 1 }, { boss: armorBoss });
    // score ratio = multiplier / (1 - bypass) = 1.5 / 0.6
    expect(withAmmo.breakScore / bare.breakScore).toBeCloseTo(2.5, 6);
  });

  it('Prism Coating\'s break effect is real: consuming it changes the sim outcome', () => {
    const bareShield = simWith({}, { boss: shieldBoss });
    const coatedShield = simWith({ PrismCoating: 1 }, { boss: shieldBoss });
    expect(coatedShield.breakScore / bareShield.breakScore).toBeCloseTo(1.18, 6);
    const bareArmor = simWith({}, { boss: armorBoss });
    const coatedArmor = simWith({ PrismCoating: 1 }, { boss: armorBoss });
    expect(coatedArmor.breakScore / bareArmor.breakScore).toBeCloseTo(1.18, 6);
    // A winnable-but-break-bound boss: the coating moves the actual
    // outcome number, not just the intermediate break totals.
    const winnable = { health: 2000, dps: 30 };
    const bare = simWith({}, { boss: winnable });
    const coated = simWith({ PrismCoating: 1 }, { boss: winnable });
    expect(coated.winChance).toBeGreaterThan(bare.winChance);
  });

  it('EMP Charge (never in the old hardcoded table) reads its def shield multiplier ×1.35', () => {
    const bare = simWith({}, { boss: shieldBoss });
    const withCharge = simWith({ EMPCharge: 1 }, { boss: shieldBoss });
    expect(withCharge.breakScore / bare.breakScore).toBeCloseTo(1.35, 6);
  });

  it('break multipliers apply once per prepared TYPE, not per unit', () => {
    const one = simWith({ ShockAmmo: 1 }, { boss: shieldBoss });
    const three = simWith({ ShockAmmo: 3 }, { boss: shieldBoss });
    expect(three.breakScore).toBeCloseTo(one.breakScore, 9);
  });

  it('Ordnance Charge units feed ordnance uses with NO break-multiplier double count', () => {
    const ordnance = makeOrdnance();
    const bareS = simWith({}, { ordnance, boss: shieldBoss });
    const loadedS = simWith({ OrdnanceCharge: 3 }, { ordnance, boss: shieldBoss });
    // 3 uses × 50 shield damage over a 1000 shield = +0.15 score,
    // exactly the gear contribution — NOT (base + 0.15) × 1.15.
    expect(loadedS.breakScore - bareS.breakScore).toBeCloseTo(0.15, 6);
    const bareA = simWith({}, { ordnance, boss: armorBoss });
    const loadedA = simWith({ OrdnanceCharge: 3 }, { ordnance, boss: armorBoss });
    expect(loadedA.breakScore - bareA.breakScore).toBeCloseTo(0.15, 6);
  });

  it('Magnetized Payload adds its def-declared 2 free ordnance uses', () => {
    const ordnance = makeOrdnance();
    const bare = simWith({}, { ordnance, boss: shieldBoss });
    const magnetized = simWith({ MagnetizedPayload: 1 }, { ordnance, boss: shieldBoss });
    expect(magnetized.breakScore - bare.breakScore).toBeCloseTo(0.1, 6);
  });
});

describe('wiring — generic survival pool', () => {
  // Weak boss (dps 10 → 300 total damage) keeps survivalScore > 1 so
  // the Adrenaline last-stand branch can never fire and the score is
  // exactly (hunter HP + pool) / 300: pool deltas read directly.
  const weakBoss = { dps: 10, shield: 0, armor: 0 };
  const poolOf = (consumables: Record<string, number>, quality?: Record<string, number>) => {
    const base = simWith({}, { boss: weakBoss });
    const withItem = simWith(consumables, { boss: weakBoss, consumableQuality: quality });
    return (withItem.survivalScore - base.survivalScore) * 300;
  };

  it('pool identity at Q100 (T2 %-of-pool): MedKit pools 260, Shield Cell pools 0 in this shield-less fixture, NanoSwarm pools 379.17', () => {
    // The sim hunter pool is 1300 (level 10, no shield equipped), so
    // Med Kit = 20% × 1300 at face, Nano Swarm = 35% × 1300 at the
    // sim's 5/6 repair rate, and Shield Cell = 25% of a zero shield
    // capacity — nothing to restore without a shield (nonzero restore
    // pricing is pinned in tuningT2Consumables / damageContract).
    expect(poolOf({ MedKit: 1 })).toBeCloseTo(260, 4);
    expect(poolOf({ ShieldCell: 1 })).toBeCloseTo(0, 4);
    expect(poolOf({ NanoSwarm: 1 })).toBeCloseTo(379.1667, 4);
  });

  it('MedKit Refined enters the pool at 30% of the 1300 pool — 390 (it used to add zero)', () => {
    expect(poolOf({ MedKitRefined: 1 })).toBeCloseTo(390, 4);
    expect(poolOf({ MedKitRefined: 1 })).toBeGreaterThan(poolOf({ MedKit: 1 }));
  });

  it('Adrenaline Shot\'s def-declared 10%-of-pool heal pools like any other heal', () => {
    // The sim's long-standing Adrenaline rule multiplies the WHOLE
    // survival pool ×1.25 whenever a shot is prepared, so the pooled
    // delta is (1300 hunter HP + 130 heal) × 1.25 − 1300 = 487.5.
    // Without the heal pooling it would be 1300 × 0.25 = 325 — the
    // extra 162.5 is exactly the 130 heal (10% of pool, T2) × 1.25,
    // proving the heal entered the pool.
    expect(poolOf({ AdrenalineShot: 1 })).toBeCloseTo(487.5, 4);
  });

  it('pool contributions scale by the def quality read: a Q150 MedKit pools 390', () => {
    expect(poolOf({ MedKit: 1 }, { MedKit: 150 })).toBeCloseTo(390, 4);
    // Shield Cell stays 0 at any quality in this shield-less fixture.
    expect(poolOf({ ShieldCell: 1 }, { ShieldCell: 150 })).toBeCloseTo(0, 4);
  });
});

describe('wiring — quality read in boss attempts (rule totals)', () => {
  it('Luck Booster: Q100 pays the base 0.25 bonus loot chance; Q160 pays the def-scaled 0.40', () => {
    expect(simWith({ LuckBooster: 1 }).bonusLootChance).toBeCloseTo(0.25, 9);
    expect(
      simWith({ LuckBooster: 1 }, { consumableQuality: { LuckBooster: 160 } }).bonusLootChance,
    ).toBeCloseTo(0.4, 9);
  });

  it('Data Skimmer: Q160 pays the def-scaled 0.40 extra roll chance vs 0.25 at Q100', () => {
    expect(simWith({ DataSkimmer: 1 }).extraLootRollChance).toBeCloseTo(0.25, 9);
    expect(
      simWith({ DataSkimmer: 1 }, { consumableQuality: { DataSkimmer: 160 } }).extraLootRollChance,
    ).toBeCloseTo(0.4, 9);
  });

  it('Insurance Token: Q160 cuts the death fee by its def-scaled 0.70 (vs 0.50 at Q100)', () => {
    const credits = { playerCredits: 100000 };
    // Tier-1 fee = 3% of credits × (1 - reduction).
    expect(simWith({ InsuranceToken: 1 }, credits).deathFee).toBe(1500);
    expect(
      simWith({ InsuranceToken: 1 }, { ...credits, consumableQuality: { InsuranceToken: 160 } }).deathFee,
    ).toBe(900);
  });

  it('no quality input = flat 100: rule totals are the shipped base values', () => {
    const sim = simWith({ LuckBooster: 2, DataSkimmer: 1 });
    expect(sim.bonusLootChance).toBeCloseTo(0.5, 9);
    expect(sim.extraLootRollChance).toBeCloseTo(0.25, 9);
  });
});

describe('wiring — mechanic and crit reads', () => {
  const unmetMechanicBoss = {
    mechanic: { id: 'sealed_vault', name: 'Sealed Vault', description: '', checkType: 'mechanic' as const, requiredLoadoutTrait: 'breach', threshold: 1 },
  };

  it('Boss Scanner\'s def mechanicScoreFlat lifts an unmet mechanic check (0.5 → 0.54)', () => {
    expect(simWith({}, { boss: unmetMechanicBoss }).mechanicScore).toBeCloseTo(0.5, 9);
    expect(simWith({ BossScanner: 1 }, { boss: unmetMechanicBoss }).mechanicScore).toBeCloseTo(0.54, 9);
  });

  it('Boss Scanner quality prices through its chance-scaled flat: Q160 lifts 0.5 → 0.564', () => {
    const q160 = simWith(
      { BossScanner: 1 },
      { boss: unmetMechanicBoss, consumableQuality: { BossScanner: 160 } },
    );
    expect(q160.mechanicScore).toBeCloseTo(0.564, 6);
  });

  it('repair suppression prices only against repair mechanics (Corrosive Ammo: flat + suppression vs flat alone)', () => {
    const repairBoss = {
      mechanic: { id: 'repair_loop', name: 'Repair Loop', description: '', checkType: 'mechanic' as const, requiredLoadoutTrait: 'breach', threshold: 1 },
    };
    // Corrosive Ammo declares mechanicScoreFlat 0.08 + repairSuppression 0.08.
    expect(simWith({ CorrosiveAmmo: 1 }, { boss: repairBoss }).mechanicScore).toBeCloseTo(0.66, 6);
    expect(simWith({ CorrosiveAmmo: 1 }, { boss: unmetMechanicBoss }).mechanicScore).toBeCloseTo(0.58, 6);
  });

  it('mechanic help never pushes the score past 1 (a handled mechanic is handled)', () => {
    const loaded = simWith(
      { BossScanner: 1, EMPCharge: 1, Jammer: 1, PhaseShiftGrenade: 1 },
      { boss: unmetMechanicBoss },
    );
    expect(loaded.mechanicScore).toBeLessThanOrEqual(1);
  });

  it('Heartwood Sight Oil\'s def critChanceBonus prices into the crit share of the DPS check', () => {
    const skills = { skillBonuses: { critDpsBonus: 0.5 } };
    const bare = simWith({}, skills);
    const oiled = simWith({ HeartwoodSightOil: 1 }, skills);
    expect(oiled.dpsScore).toBeGreaterThan(bare.dpsScore);
  });

  it('consumable crit can open the high-crit skill gate (0.48 weapon + 0.05 oil crosses 0.5)', () => {
    const skills = { skillBonuses: { highCritBossDamage: 0.3 } };
    const gateClosed = simWith({}, { ...skills, primary: { critChance: 0.48 } });
    const gateOpen = simWith({ HeartwoodSightOil: 1 }, { ...skills, primary: { critChance: 0.48 } });
    expect(gateOpen.dpsScore).toBeGreaterThan(gateClosed.dpsScore);
  });
});

describe('wiring — ElementalCoating fold pin (#379 reader folded into the generic loop)', () => {
  // PR #379 shipped ElementalCoating with its own special-case reader
  // in the sim; the wiring package folded it into the generic
  // def-driven break loop. These pins prove the fold preserved #379's
  // behavior EXACTLY ONCE: the coating is one def in the loop, priced
  // per type (never per unit, never squared by a leftover special
  // case), with crafted quality scaling the def’s 1.15 base (T2).
  const shieldBoss = { armor: 0 };
  const armorBoss = { shield: 0 };

  it('Q100 coating multiplies the shield break score by exactly the def’s 1.15', () => {
    const bare = simWith({}, { boss: shieldBoss });
    const coated = simWith(
      { ElementalCoating: 1 },
      { boss: shieldBoss, consumableQuality: { ElementalCoating: 100 } },
    );
    expect(bare.breakScore).toBeGreaterThan(0);
    expect(bare.breakScore).toBeLessThan(1); // the multiplier is not capped away
    expect(coated.breakScore / bare.breakScore).toBeCloseTo(1.15, 6);
  });

  it('Q100 coating multiplies the armor break score by exactly the def’s 1.15', () => {
    const bare = simWith({}, { boss: armorBoss });
    const coated = simWith(
      { ElementalCoating: 1 },
      { boss: armorBoss, consumableQuality: { ElementalCoating: 100 } },
    );
    expect(coated.breakScore / bare.breakScore).toBeCloseTo(1.15, 6);
  });

  it('a 150-quality batch multiplies by 1.225 — the fold keeps #379’s quality scaling', () => {
    const bare = simWith({}, { boss: shieldBoss });
    const coated = simWith(
      { ElementalCoating: 1 },
      { boss: shieldBoss, consumableQuality: { ElementalCoating: 150 } },
    );
    expect(coated.breakScore / bare.breakScore).toBeCloseTo(1.225, 6);
  });

  it('two units price identically to one — per type, exactly once (a leftover special case would square it to ×1.3225)', () => {
    const bare = simWith({}, { boss: shieldBoss });
    const one = simWith(
      { ElementalCoating: 1 },
      { boss: shieldBoss, consumableQuality: { ElementalCoating: 100 } },
    );
    const two = simWith(
      { ElementalCoating: 2 },
      { boss: shieldBoss, consumableQuality: { ElementalCoating: 100 } },
    );
    expect(two.breakScore).toBeCloseTo(one.breakScore, 10);
    expect(two.breakScore / bare.breakScore).toBeCloseTo(1.15, 6);
  });
});
