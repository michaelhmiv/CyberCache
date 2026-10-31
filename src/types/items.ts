import { Element, Rarity, WeaponType, Manufacturer, DropSource } from './game';
import type { ShieldBehaviorId } from '../lib/combat/shieldBehaviors';

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
  category: 'combat' | 'elemental' | 'boss' | 'idle' | 'skill' | 'activity';
  stat: keyof WeaponStats | string;
  value: number;
  /** Multi-dimensional outputs for activity modules. Undefined for combat affixes. */
  subStats?: Record<string, number>;
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
  /**
   * Behavior archetype (Phase 2c) — Nova / Absorb / Amp / Turtle,
   * defined in src/lib/combat/shieldBehaviors.ts. Optional because
   * legacy shields generated before behaviors existed carry no field;
   * they read as Standard via shieldBehaviorOf and are never rewritten.
   */
  behavior?: ShieldBehaviorId;
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
  affixes: Affix[];
  sourceTag: DropSource;
  isLocked: boolean;
  pixelSeed: number;
}

/**
 * A vehicle instance's payload (item_instances kind 'vehicle').
 * Deliberately NOT part of the GearItem union: combat engines read
 * GearItem, and a vehicle must never be priced as a weapon/relic —
 * the roaming engine reads it through its own typed channel
 * (ClaimRequest.vehicle, derived server-side from the instance row).
 * Class stats live in src/lib/vehicles/vehicles.ts, never here.
 * Condition lives on the item_instances row (condition_current/max);
 * the payload mirrors the max for display.
 */
export interface Vehicle {
  id: string;
  name: string;
  vehicleClassId: string;
  level: number;
  rarity: Rarity;
  affixes: Affix[];
  sourceTag: DropSource;
  isLocked: boolean;
  pixelSeed: number;
}

export type GearItem = Weapon | Shield | ClassMod | Relic | Ordnance;
