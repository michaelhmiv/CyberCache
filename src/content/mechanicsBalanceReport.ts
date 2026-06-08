import { REGION_1_BOSSES } from '../constants/bosses';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { Element, DropSource, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { BossDef } from '../types/boss';
import type { Shield, Weapon } from '../types/items';

export interface MechanicsArchetype {
  name: string;
  primary: Weapon;
  secondary: Weapon | null;
  heavy: Weapon | null;
  shield: Shield;
  consumables: Record<string, number>;
  skillBonuses: Record<string, number>;
}

export interface BossArchetypeBalanceResult {
  bossId: string;
  bossName: string;
  archetypeName: string;
  winChance: number;
  projectedFailurePhase?: string;
  band: 'good' | 'ok' | 'bad' | 'critical';
}

export interface BossBalanceWarning {
  bossId: string;
  bossName: string;
  code: string;
  message: string;
}

export interface MechanicsBalanceReport {
  bossCount: number;
  archetypeCount: number;
  results: BossArchetypeBalanceResult[];
  warnings: BossBalanceWarning[];
}

function makeWeapon(overrides: {
  baseDamage: number;
  weaponType: WeaponType;
  element: Element;
  manufacturer: Manufacturer;
  shieldDamageMod?: number;
  armorDamageMod?: number;
  bossDamageMod?: number;
}): Weapon {
  return {
    id: `balance_${overrides.weaponType}_${overrides.element}_${overrides.manufacturer}`,
    name: `Balance ${overrides.weaponType}`,
    level: 25,
    rarity: Rarity.Rare,
    weaponType: overrides.weaponType,
    manufacturer: overrides.manufacturer,
    element: overrides.element,
    rollQuality: 60,
    baseDamage: overrides.baseDamage,
    attackSpeed: 1,
    critChance: 0.1,
    critDamage: 1.5,
    statusChance: 0.1,
    statusDamage: 1,
    bossDamageMod: overrides.bossDamageMod ?? 1,
    waveDamageMod: 1,
    shieldDamageMod: overrides.shieldDamageMod ?? 1,
    armorDamageMod: overrides.armorDamageMod ?? 1,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 42,
    combatPower: 200,
    bossPower: 200,
    farmPower: 150,
    economyScore: 50,
  };
}

function makeShield(hp: number): Shield {
  return {
    id: `balance_shield_${hp}`,
    name: `Balance Shield ${hp}`,
    level: 25,
    rarity: Rarity.Rare,
    hp,
    rechargeRate: 10,
    mitigation: 0.2,
    element: Element.Kinetic,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 99,
  };
}

export function createMechanicsBalanceArchetypes(): MechanicsArchetype[] {
  const shield = makeShield(400);

  return [
    {
      name: 'Basic Generalist',
      primary: makeWeapon({ baseDamage: 80, weaponType: WeaponType.Pistol, element: Element.Kinetic, manufacturer: Manufacturer.Redline }),
      secondary: null,
      heavy: null,
      shield,
      consumables: { MedKit: 1 },
      skillBonuses: {},
    },
    {
      name: 'Shield Breaker',
      primary: makeWeapon({ baseDamage: 70, weaponType: WeaponType.SMG, element: Element.Shock, manufacturer: Manufacturer.Prismatek, shieldDamageMod: 1.4 }),
      secondary: null,
      heavy: null,
      shield,
      consumables: { ShockAmmo: 1, OrdnanceCharge: 1 },
      skillBonuses: { shieldBreak: 0.15 },
    },
    {
      name: 'Armor Breaker',
      primary: makeWeapon({ baseDamage: 90, weaponType: WeaponType.Launcher, element: Element.Corrosive, manufacturer: Manufacturer.BlastForge, armorDamageMod: 1.5 }),
      secondary: null,
      heavy: null,
      shield,
      consumables: { CorrosiveAmmo: 1, PhaseShiftGrenade: 1 },
      skillBonuses: { armorBreak: 0.15 },
    },
    {
      name: 'DPS Burst',
      primary: makeWeapon({ baseDamage: 120, weaponType: WeaponType.Sniper, element: Element.Kinetic, manufacturer: Manufacturer.Ironwood, bossDamageMod: 1.3 }),
      secondary: makeWeapon({ baseDamage: 60, weaponType: WeaponType.Pistol, element: Element.Fire, manufacturer: Manufacturer.Redline }),
      heavy: null,
      shield,
      consumables: { TargetPainter: 1, VoidAmmo: 1, OverchargeStim: 1 },
      skillBonuses: { dps: 0.15 },
    },
    {
      name: 'Survival Heavy',
      primary: makeWeapon({ baseDamage: 60, weaponType: WeaponType.Beam, element: Element.Cryo, manufacturer: Manufacturer.Prismatek }),
      secondary: null,
      heavy: null,
      shield: makeShield(800),
      consumables: { MedKit: 2, ShieldCell: 2, NanoSwarm: 1, CryoAmmo: 1 },
      skillBonuses: { survival: 0.2 },
    },
    {
      name: 'No Consumable Baseline',
      primary: makeWeapon({ baseDamage: 80, weaponType: WeaponType.Pistol, element: Element.Kinetic, manufacturer: Manufacturer.Ironwood }),
      secondary: null,
      heavy: null,
      shield,
      consumables: {},
      skillBonuses: {},
    },
  ];
}

function bandForWinChance(winChance: number): BossArchetypeBalanceResult['band'] {
  if (winChance >= 0.75) return 'good';
  if (winChance >= 0.5) return 'ok';
  if (winChance >= 0.25) return 'bad';
  return 'critical';
}

export function createMechanicsBalanceReport(
  bosses: BossDef[] = REGION_1_BOSSES,
  archetypes: MechanicsArchetype[] = createMechanicsBalanceArchetypes()
): MechanicsBalanceReport {
  const results: BossArchetypeBalanceResult[] = [];

  for (const boss of bosses) {
    for (const archetype of archetypes) {
      const sim = simulateBoss({
        primary: archetype.primary,
        secondary: archetype.secondary,
        heavy: archetype.heavy,
        ordnance: null,
        shield: archetype.shield,
        classMod: null,
        relic: null,
        consumables: archetype.consumables,
        risk: RiskSetting.Balanced,
        boss,
        playerLevel: Math.max(boss.level, 10),
        skillBonuses: archetype.skillBonuses,
      });

      results.push({
        bossId: boss.id,
        bossName: boss.name,
        archetypeName: archetype.name,
        winChance: sim.winChance,
        projectedFailurePhase: sim.projectedFailurePhase?.phaseName,
        band: bandForWinChance(sim.winChance),
      });
    }
  }

  const warnings = buildBalanceWarnings(bosses, results);

  return {
    bossCount: bosses.length,
    archetypeCount: archetypes.length,
    results,
    warnings,
  };
}

function getResult(results: BossArchetypeBalanceResult[], bossId: string, archetypeName: string): BossArchetypeBalanceResult | undefined {
  return results.find((result) => result.bossId === bossId && result.archetypeName === archetypeName);
}

export function buildBalanceWarnings(bosses: BossDef[], results: BossArchetypeBalanceResult[]): BossBalanceWarning[] {
  const warnings: BossBalanceWarning[] = [];

  for (const boss of bosses) {
    const baseline = getResult(results, boss.id, 'No Consumable Baseline');
    const shieldBreaker = getResult(results, boss.id, 'Shield Breaker');
    const armorBreaker = getResult(results, boss.id, 'Armor Breaker');
    const survivalHeavy = getResult(results, boss.id, 'Survival Heavy');

    if ((boss.tags.includes('shield') || boss.shield > 500) && shieldBreaker && baseline && shieldBreaker.winChance <= baseline.winChance) {
      warnings.push({ bossId: boss.id, bossName: boss.name, code: 'shield_breaker_not_better', message: 'Shield Breaker should outperform baseline against shield-heavy bosses.' });
    }

    if ((boss.tags.includes('armor') || boss.armor > 500) && armorBreaker && baseline && armorBreaker.winChance <= baseline.winChance) {
      warnings.push({ bossId: boss.id, bossName: boss.name, code: 'armor_breaker_not_better', message: 'Armor Breaker should outperform baseline against armor-heavy bosses.' });
    }

    if ((boss.tags.includes('burstCheck') || boss.dps > 100) && survivalHeavy && baseline && survivalHeavy.winChance <= baseline.winChance) {
      warnings.push({ bossId: boss.id, bossName: boss.name, code: 'survival_heavy_not_better', message: 'Survival Heavy should outperform baseline against burst or high-DPS bosses.' });
    }
  }

  return warnings;
}

export function formatMechanicsBalanceReport(report: MechanicsBalanceReport): string {
  const lines: string[] = [];
  lines.push('CyberCache Boss Balance Report');
  lines.push(`Bosses: ${report.bossCount}`);
  lines.push(`Archetypes: ${report.archetypeCount}`);
  lines.push(`Results: ${report.results.length}`);
  lines.push(`Warnings: ${report.warnings.length}`);

  for (const result of report.results) {
    lines.push(`${result.bossName} | ${result.archetypeName} | ${(result.winChance * 100).toFixed(1)}% | ${result.band}`);
  }

  for (const warning of report.warnings) {
    lines.push(`WARN ${warning.bossName}: ${warning.message}`);
  }

  return lines.join('\n');
}
