import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import { GenerateWeaponOptions } from '../lib/generators/weaponGenerator';

export type ManufacturerInfluence = Manufacturer | 'Mixed';
export type DangerRating = 'Low' | 'Medium' | 'Medium/High' | 'Variable' | 'High';
export type GearDropKind = 'weapon' | 'shield' | 'classMod' | 'relic' | 'ordnance';

export interface RoamingAreaDef {
  id: string;
  name: string;
  manufacturerInfluence: ManufacturerInfluence;
  shortDescription: string;
  gameplayIdentity: string;
  enemyType: string;
  dangerRating: DangerRating;
  unlockLevel: number;
  idleCreditsPerMinute: number;
  idleScrapPerMinute: number;
  /**
   * XP awarded per successful tick in this area. Scales with unlock level
   * and danger rating so that high-tier areas reward more progression.
   * Formula in src/content/simulation.ts:areaXpMultiplier.
   * Mirrored server-side in supabase/migrations/202606080058_idle_xp_per_tick.sql.
   */
  idleXpPerTick: number;
  dropPoolRarityWeights: Record<Rarity, number>;
  materialBias: string[];
  essenceBias: string[];
  lootBias: string[];
  weaponBias: WeaponType[];
  elementBias?: Element[];
  gearDropWeights: Record<GearDropKind, number>;
  selectionHint: string;
  futureHooks?: string[];
}

const BASE_RARITY_WEIGHTS: Record<Rarity, number> = {
  [Rarity.Common]: 60,
  [Rarity.Uncommon]: 25,
  [Rarity.Rare]: 10,
  [Rarity.Epic]: 4,
  [Rarity.Legendary]: 1,
};

const BALANCED_GEAR_WEIGHTS: Record<GearDropKind, number> = {
  weapon: 12,
  shield: 4,
  classMod: 2,
  relic: 2,
  ordnance: 2,
};

export const DEFAULT_ROAMING_AREA_ID = 'dustwaste_frontier';

export const ROAMING_AREAS: RoamingAreaDef[] = [
  {
    id: DEFAULT_ROAMING_AREA_ID,
    name: 'Dustwaste Frontier',
    manufacturerInfluence: 'Mixed',
    shortDescription: 'Open scrapland routes where new runners learn the roaming loop.',
    gameplayIdentity: 'Starter roaming, balanced gear drops, salvage, and cache fragments.',
    enemyType: 'Raiders, scrap drones, and scavengers',
    dangerRating: 'Low',
    unlockLevel: 1,
    idleCreditsPerMinute: 15,
    idleScrapPerMinute: 3,
    idleXpPerTick: 1.0,
    dropPoolRarityWeights: BASE_RARITY_WEIGHTS,
    materialBias: ['ScrapAlloy', 'BallisticParts'],
    essenceBias: [],
    lootBias: ['Balanced gear', 'early salvage', 'cache fragments'],
    weaponBias: [],
    gearDropWeights: BALANCED_GEAR_WEIGHTS,
    selectionHint: 'Need general early loot? Stay in Dustwaste Frontier.',
    futureHooks: ['tutorial routes', 'starter boss trail'],
  },
  {
    id: 'redline_circuit',
    name: 'Redline Circuit',
    manufacturerInfluence: Manufacturer.Redline,
    shortDescription: 'Burned highway loops owned by speed crews and pursuit drones.',
    gameplayIdentity: 'High enemy density, kills per minute, sustained DPS, and attrition pressure.',
    enemyType: 'Fast raiders, pursuit drones, and overheating runners',
    dangerRating: 'Medium',
    unlockLevel: 4,
    idleCreditsPerMinute: 18,
    idleScrapPerMinute: 3,
    idleXpPerTick: 1.2,
    dropPoolRarityWeights: {
      [Rarity.Common]: 56,
      [Rarity.Uncommon]: 27,
      [Rarity.Rare]: 12,
      [Rarity.Epic]: 4,
      [Rarity.Legendary]: 1,
    },
    materialBias: ['ScrapAlloy', 'BallisticParts'],
    essenceBias: [],
    lootBias: ['SMGs', 'pistols', 'attack speed', 'reload and ramp affixes'],
    weaponBias: [WeaponType.SMG, WeaponType.Pistol],
    gearDropWeights: { weapon: 14, shield: 3, classMod: 1, relic: 2, ordnance: 2 },
    selectionHint: 'Need speed farming gear? Roam Redline Circuit.',
    futureHooks: ['density modifiers', 'sustained-kill streaks'],
  },
  {
    id: 'ironwood_bastion',
    name: 'Ironwood Bastion',
    manufacturerInfluence: Manufacturer.Ironwood,
    shortDescription: 'Fortified ridge posts where precision crews hold long sightlines.',
    gameplayIdentity: 'Fewer enemies, tougher elites, precision weapons, and better quality drops.',
    enemyType: 'Marksmen, armored captains, and sentry posts',
    dangerRating: 'Medium/High',
    unlockLevel: 8,
    idleCreditsPerMinute: 17,
    idleScrapPerMinute: 4,
    idleXpPerTick: 1.4,
    dropPoolRarityWeights: {
      [Rarity.Common]: 50,
      [Rarity.Uncommon]: 29,
      [Rarity.Rare]: 14,
      [Rarity.Epic]: 5.5,
      [Rarity.Legendary]: 1.5,
    },
    materialBias: ['BallisticParts', 'TechFragments'],
    essenceBias: [],
    lootBias: ['Snipers', 'pistols', 'crit rolls', 'weakpoint and boss-damage flavor'],
    weaponBias: [WeaponType.Sniper, WeaponType.Pistol],
    gearDropWeights: { weapon: 12, shield: 4, classMod: 3, relic: 2, ordnance: 1 },
    selectionHint: 'Need better crit or boss weapons? Roam Ironwood Bastion.',
    futureHooks: ['elite packs', 'weakpoint contracts'],
  },
  {
    id: 'blastforge_yards',
    name: 'BlastForge Yards',
    manufacturerInfluence: Manufacturer.BlastForge,
    shortDescription: 'Industrial breaker yards packed with refinery bots and live ordnance.',
    gameplayIdentity: 'Armor break, explosive gear, stagger pressure, and heavy material farming.',
    enemyType: 'Armored machines, refinery bots, and demolition crews',
    dangerRating: 'Medium/High',
    unlockLevel: 12,
    idleCreditsPerMinute: 16,
    idleScrapPerMinute: 5,
    idleXpPerTick: 1.65,
    dropPoolRarityWeights: {
      [Rarity.Common]: 52,
      [Rarity.Uncommon]: 28,
      [Rarity.Rare]: 13,
      [Rarity.Epic]: 5,
      [Rarity.Legendary]: 2,
    },
    materialBias: ['ScrapAlloy', 'BallisticParts', 'ReactiveComponents'],
    essenceBias: ['IgnitionFluid'],
    lootBias: ['Launchers', 'shotguns', 'armor break', 'stagger and explosive flavor'],
    weaponBias: [WeaponType.Launcher, WeaponType.Shotgun],
    elementBias: [Element.Fire, Element.Corrosive, Element.Kinetic],
    gearDropWeights: { weapon: 11, shield: 3, classMod: 1, relic: 1, ordnance: 6 },
    selectionHint: 'Need armor-breaking materials? Roam BlastForge Yards.',
    futureHooks: ['armor-break objectives', 'stagger events'],
  },
  {
    id: 'prismatek_reactor',
    name: 'Prismatek Reactor',
    manufacturerInfluence: Manufacturer.Prismatek,
    shortDescription: 'A leaking test reactor where elemental anomalies rewrite the battlefield.',
    gameplayIdentity: 'Elemental specialization, status effects, and weakness matching.',
    enemyType: 'Elemental anomalies, shielded test subjects, and reactor constructs',
    dangerRating: 'Variable',
    unlockLevel: 16,
    idleCreditsPerMinute: 18,
    idleScrapPerMinute: 4,
    idleXpPerTick: 1.9,
    dropPoolRarityWeights: {
      [Rarity.Common]: 51,
      [Rarity.Uncommon]: 27,
      [Rarity.Rare]: 14,
      [Rarity.Epic]: 6,
      [Rarity.Legendary]: 2,
    },
    materialBias: ['TechFragments'],
    essenceBias: ['IgnitionFluid', 'ConduitWire', 'AcidCompound', 'CryoGel', 'VoidEssence'],
    lootBias: ['Beams', 'elemental weapons', 'status affixes', 'weakness exploitation'],
    weaponBias: [WeaponType.Beam, WeaponType.Shotgun],
    elementBias: [Element.Fire, Element.Shock, Element.Corrosive, Element.Cryo, Element.Void],
    gearDropWeights: { weapon: 12, shield: 4, classMod: 2, relic: 3, ordnance: 1 },
    selectionHint: 'Need elemental essences? Roam Prismatek Reactor.',
    futureHooks: ['daily element rotations', 'weakness-match bonuses'],
  },
  {
    id: 'throwtech_dumpnet',
    name: 'ThrowTech Dumpnet',
    manufacturerInfluence: Manufacturer.ThrowTech,
    shortDescription: 'A hacked junk-grid of turret nests, signal traps, and cheap disposable tech.',
    gameplayIdentity: 'Utility, deployables, drones, tech materials, and gadget-flavored loot.',
    enemyType: 'Hacked drones, turret nests, minefields, and signal traps',
    dangerRating: 'Medium',
    unlockLevel: 20,
    idleCreditsPerMinute: 19,
    idleScrapPerMinute: 4,
    idleXpPerTick: 2.15,
    dropPoolRarityWeights: {
      [Rarity.Common]: 53,
      [Rarity.Uncommon]: 27,
      [Rarity.Rare]: 13,
      [Rarity.Epic]: 5,
      [Rarity.Legendary]: 2,
    },
    materialBias: ['TechFragments', 'ReactiveComponents'],
    essenceBias: ['ConduitWire'],
    lootBias: ['Deployable-flavored gear', 'ordnance', 'utility drops', 'drone parts'],
    weaponBias: [WeaponType.Launcher, WeaponType.SMG],
    elementBias: [Element.Shock, Element.Kinetic],
    gearDropWeights: { weapon: 10, shield: 3, classMod: 3, relic: 2, ordnance: 4 },
    selectionHint: 'Need utility tech and deployable flavor? Roam ThrowTech Dumpnet.',
    futureHooks: ['turret events', 'drone salvage'],
  },
  {
    id: 'helixworks_labyrinth',
    name: 'HelixWorks Labyrinth',
    manufacturerInfluence: Manufacturer.HelixWorks,
    shortDescription: 'A shifting prototype complex where modular test rigs rebuild themselves.',
    gameplayIdentity: 'Modular gear, better roll-quality flavor, crafting materials, and experiments.',
    enemyType: 'Prototype constructs, unstable test rigs, and shifting lab defenses',
    dangerRating: 'High',
    unlockLevel: 25,
    idleCreditsPerMinute: 21,
    idleScrapPerMinute: 5,
    idleXpPerTick: 2.4,
    dropPoolRarityWeights: {
      [Rarity.Common]: 48,
      [Rarity.Uncommon]: 29,
      [Rarity.Rare]: 15,
      [Rarity.Epic]: 6,
      [Rarity.Legendary]: 2,
    },
    materialBias: ['TechFragments', 'VoidDust', 'ScrapAlloy', 'ReactiveComponents'],
    essenceBias: ['VoidEssence'],
    lootBias: ['HelixWorks gear', 'higher roll quality flavor', 'modular parts'],
    weaponBias: [WeaponType.Beam, WeaponType.Pistol, WeaponType.Sniper],
    elementBias: [Element.Void, Element.Kinetic, Element.Shock],
    gearDropWeights: { weapon: 11, shield: 3, classMod: 3, relic: 4, ordnance: 1 },
    selectionHint: 'Need modular crafting depth? Roam HelixWorks Labyrinth.',
    futureHooks: ['fusion lab hooks', 'prototype modifiers'],
  },
];

export const ROAMING_AREA_BY_ID = Object.fromEntries(
  ROAMING_AREAS.map((area) => [area.id, area])
) as Record<string, RoamingAreaDef>;

export function getRoamingArea(areaId?: string): RoamingAreaDef {
  return ROAMING_AREA_BY_ID[areaId || DEFAULT_ROAMING_AREA_ID] || ROAMING_AREA_BY_ID[DEFAULT_ROAMING_AREA_ID];
}

export function isRoamingAreaUnlocked(area: RoamingAreaDef, playerLevel: number): boolean {
  return playerLevel >= area.unlockLevel;
}

function pickWeightedValue<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;

  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }

  return entries[0][0];
}

function pickArrayValue<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values[Math.floor(Math.random() * values.length)];
}

export function rollAreaDropKind(area: RoamingAreaDef): GearDropKind {
  return pickWeightedValue(area.gearDropWeights);
}

export function buildAreaWeaponDropOptions(
  area: RoamingAreaDef,
  level: number
): GenerateWeaponOptions {
  const dominantManufacturer =
    area.manufacturerInfluence === 'Mixed' ? undefined : area.manufacturerInfluence;

  return {
    source: DropSource.WorldDrop,
    level,
    zoneWeights: area.dropPoolRarityWeights,
    forcedManufacturer:
      dominantManufacturer && Math.random() < 0.65 ? dominantManufacturer : undefined,
    forcedType: area.weaponBias.length > 0 && Math.random() < 0.55 ? pickArrayValue(area.weaponBias) : undefined,
    forcedElement: area.elementBias && Math.random() < 0.55 ? pickArrayValue(area.elementBias) : undefined,
  };
}

export function rollAreaMaterialFind(area: RoamingAreaDef): { type: string; kind: 'material' | 'essence' } | null {
  const pool = [
    ...area.materialBias.map((type) => ({ type, kind: 'material' as const })),
    ...area.essenceBias.map((type) => ({ type, kind: 'essence' as const })),
  ];

  return pickArrayValue(pool) || null;
}
