import { Element, Rarity, WeaponType, Manufacturer, DropSource } from './game';

export interface WeaponPart {
  slot: 'Barrel' | 'Grip' | 'Core' | 'Magazine' | 'Sight' | 'Chamber';
  modifier: Partial<WeaponStats>;
}

export interface WeaponStats {
  baseDamage: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  statusChance: number;
  statusDamage: number;
  bossDamageMod: number;
  waveDamageMod: number;
  shieldDamageMod: number;
  armorDamageMod: number;
  offlineEarningsMod: number;
  rareDropChanceMod: number;
  scrapYieldMod: number;
}

export interface Affix {
  id: string;
  category: 'combat' | 'elemental' | 'boss' | 'idle' | 'skill';
  stat: keyof WeaponStats | string;
  value: number;
  displayText: string;
}

export interface LegendaryEffectDef {
  id: string;
  name: string;
  description: string;
  eligibleSources: DropSource[];
  minBossTier?: number;
}

export interface Weapon {
  id: string;
  name: string;
  level: number;
  rarity: Rarity;
  weaponType: WeaponType;
  manufacturer: Manufacturer;
  element: Element;
  rollQuality: number; // 0-100
  baseDamage: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  statusChance: number;
  statusDamage: number;
  bossDamageMod: number;
  waveDamageMod: number;
  shieldDamageMod: number;
  armorDamageMod: number;
  offlineEarningsMod: number;
  rareDropChanceMod: number;
  scrapYieldMod: number;
  parts: WeaponPart[];
  affixes: Affix[];
  legendaryEffectId?: string;
  sourceTag: DropSource;
  isLocked: boolean;
  pixelSeed: number;
  marketHistory?: { listedAt: number; price: number }[];
  // Effective power scores (computed)
  combatPower: number;
  bossPower: number;
  farmPower: number;
  economyScore: number;
}

export interface Shield {
  id: string;
  name: string;
  level: number;
  rarity: Rarity;
  hp: number;
  rechargeRate: number;
  mitigation: number;
  element: Element;
  affixes: Affix[];
  sourceTag: DropSource;
  isLocked: boolean;
  pixelSeed: number;
}

export interface ClassMod {
  id: string;
  name: string;
  level: number;
  rarity: Rarity;
  treeBonus: string; // which tree it boosts
  nodeBoosts: Record<string, number>;
  affixes: Affix[];
  sourceTag: DropSource;
  isLocked: boolean;
}

export interface Relic {
  id: string;
  name: string;
  level: number;
  rarity: Rarity;
  affixes: Affix[];
  sourceTag: DropSource;
  isLocked: boolean;
}

export interface Ordnance {
  id: string;
  name: string;
  level: number;
  rarity: Rarity;
  damage: number;
  shieldDamage: number;
  armorDamage: number;
  element: Element;
  effect: string;
  sourceTag: DropSource;
  isLocked: boolean;
}

export type GearItem = Weapon | Shield | ClassMod | Relic | Ordnance;
