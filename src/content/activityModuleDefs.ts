/**
 * Activity Module Definitions — the shared ground truth for procedural
 * activity gear generation.
 *
 * Each entry defines one sub-stat dimension for a specific activity's module
 * type. The generator (activityModuleGenerator.ts) reads these definitions
 * to compute sub-stat values scaled by level, rarity, manufacturer, and
 * quality roll.
 *
 * ARCHITECTURE:
 *   - This file is imported by the generator (client-side item creation)
 *     AND by the Chef (server-side verification via deterministic re-roll).
 *   - `sumActivityModifier` in activityModifiers.ts only reads the final
 *     subStats on affixes — it does NOT import this file.
 *
 * ADDING A NEW SUB-STAT:
 *   1. Add an entry to the appropriate ACTIVITY_MODULE_DEFS[activity] array.
 *   2. The generator picks it up automatically.
 *   3. If it's a manufacturer-specific bonus, add the manufacturer key to
 *      the `mfgBonus` field on the parent module def.
 */

import type { ActivityKind } from '@/types/activity';
import { Rarity, Manufacturer } from '@/types/game';

// ── Types ─────────────────────────────────────────────────────────

export interface SubStatDef {
  /** Stat key — becomes a key in the affix's subStats map. */
  key: string;
  /** Display label for UI. */
  label: string;
  /** Base value at level 1, Common rarity (before scaling). */
  baseValue: number;
  /** Per-level growth rate (additive). level 50 → 1 + 49 * levelGrowth. */
  levelGrowth: number;
  /** Minimum rarity required for this sub-stat to appear. */
  rarityMin: Rarity;
  /** Display format. `{v}` is replaced with the computed value as percentage. */
  displayFormat: string;
  /** Is this the primary stat for this module type? (used for ordering) */
  isPrimary?: boolean;
}

export interface ActivityModuleDef {
  /** Activity kind this module targets. */
  activityKind: ActivityKind;
  /** Human-readable module name (e.g., 'Crafting Module'). */
  name: string;
  /** Sub-stat definitions for this module type. */
  subStats: SubStatDef[];
  /**
   * Manufacturer-specific bonus dimensions. Keys are Manufacturer enum values;
   * each maps to a sub-stat key that gets an amplified roll when the item's
   * manufacturer matches.
   */
  mfgBonus?: Partial<Record<Manufacturer, { stat: string; mult: number }>>;
}

// ── Scaling Constants (shared with generator) ─────────────────────

/** How much each level adds to the sub-stat scalar. */
export const LEVEL_GROWTH_RATE = 0.015;

/** Rarity multiplier table. Applied multiplicatively on top of level scaling. */
export const RARITY_MULT: Record<Rarity, number> = {
  [Rarity.Common]: 0.6,
  [Rarity.Uncommon]: 1.0,
  [Rarity.Rare]: 1.4,
  [Rarity.Epic]: 1.85,
  [Rarity.Legendary]: 2.5,
};

/**
 * Manufacturer bias multipliers. These modify specific sub-stat values when
 * the item's manufacturer matches a favored stat. Applied multiplicatively.
 *
 * Also used as a soft floor: manufacturers get +5% to all activity-relevant
 * stats, and their anti-bias stats get -10%.
 */
export const MFG_BIAS_MULT = 1.15;  // favored stat bonus
export const MFG_ANTI_MULT = 0.90;  // anti-favored stat penalty

/** Quality roll range: minQuality → 1.0. */
export const QUALITY_MIN = 0.85;

/** Activity module roll chance base (before rarity/mfg bonuses). */
export const BASE_ACTIVITY_MODULE_CHANCE = 0.25;

// ── Module Definitions ────────────────────────────────────────────

// Extraction (0033) is excluded by law: gear activity modules /
// activity modifiers never apply to a pass — its yield reads the
// gear factor, mastery, method, and hot-area terms only.
export const ACTIVITY_MODULE_DEFS: Record<Exclude<ActivityKind, 'none' | 'boss_prep' | 'boss_fight' | 'extraction'>, ActivityModuleDef> = {

  // ── Crafting Module ────────────────────────────────────────────

  crafting: {
    activityKind: 'crafting',
    name: 'Crafting Module',
    subStats: [
      {
        key: 'craftingSpeed', label: 'Crafting Speed', baseValue: 0.08,
        levelGrowth: LEVEL_GROWTH_RATE, rarityMin: Rarity.Common,
        displayFormat: '+{v}% Crafting Speed', isPrimary: true,
      },
      {
        key: 'materialEfficiency', label: 'Material Efficiency', baseValue: 0.05,
        levelGrowth: LEVEL_GROWTH_RATE, rarityMin: Rarity.Uncommon,
        displayFormat: '+{v}% Material Efficiency',
      },
      {
        key: 'critCraftChance', label: 'Crit Craft Chance', baseValue: 0.03,
        levelGrowth: LEVEL_GROWTH_RATE * 0.8, rarityMin: Rarity.Rare,
        displayFormat: '+{v}% Crit Craft',
      },
      {
        key: 'burstCraftChance', label: 'Burst Craft', baseValue: 0.04,
        levelGrowth: LEVEL_GROWTH_RATE * 0.7, rarityMin: Rarity.Epic,
        displayFormat: '+{v}% Burst Craft',
      },
      {
        key: 'elementalCraftBonus', label: 'Elemental Bonus', baseValue: 0.05,
        levelGrowth: LEVEL_GROWTH_RATE * 0.6, rarityMin: Rarity.Epic,
        displayFormat: '+{v}% Element Craft',
      },
      {
        key: 'droneAssistSpeed', label: 'Drone Assist', baseValue: 0.04,
        levelGrowth: LEVEL_GROWTH_RATE * 0.5, rarityMin: Rarity.Legendary,
        displayFormat: '+{v}% Drone Speed',
      },
    ],
    mfgBonus: {
      [Manufacturer.Redline]: { stat: 'burstCraftChance', mult: 1.3 },
      [Manufacturer.Ironwood]: { stat: 'critCraftChance', mult: 1.25 },
      [Manufacturer.BlastForge]: { stat: 'burstCraftChance', mult: 1.4 },
      [Manufacturer.Prismatek]: { stat: 'elementalCraftBonus', mult: 1.35 },
      [Manufacturer.ThrowTech]: { stat: 'droneAssistSpeed', mult: 1.5 },
      [Manufacturer.HelixWorks]: { stat: 'materialEfficiency', mult: 1.15 },
    },
  },

  // ── Salvage Module ─────────────────────────────────────────────

  salvaging: {
    activityKind: 'salvaging',
    name: 'Salvage Module',
    subStats: [
      {
        key: 'salvageYield', label: 'Salvage Yield', baseValue: 0.10,
        levelGrowth: LEVEL_GROWTH_RATE, rarityMin: Rarity.Common,
        displayFormat: '+{v}% Salvage Yield', isPrimary: true,
      },
      {
        key: 'rareMaterialChance', label: 'Rare Material', baseValue: 0.04,
        levelGrowth: LEVEL_GROWTH_RATE * 0.8, rarityMin: Rarity.Uncommon,
        displayFormat: '+{v}% Rare Material',
      },
      {
        key: 'essenceExtraction', label: 'Essence Extraction', baseValue: 0.05,
        levelGrowth: LEVEL_GROWTH_RATE * 0.7, rarityMin: Rarity.Rare,
        displayFormat: '+{v}% Essence Yield',
      },
      {
        key: 'explosiveSalvage', label: 'Explosive Salvage', baseValue: 0.06,
        levelGrowth: LEVEL_GROWTH_RATE * 0.6, rarityMin: Rarity.Epic,
        displayFormat: '+{v}% Explosive Salvage',
      },
      {
        key: 'precisionExtraction', label: 'Precision Extract', baseValue: 0.03,
        levelGrowth: LEVEL_GROWTH_RATE * 0.5, rarityMin: Rarity.Epic,
        displayFormat: '+{v}% Part Save',
      },
      {
        key: 'autoCollectChance', label: 'Auto Collect', baseValue: 0.03,
        levelGrowth: LEVEL_GROWTH_RATE * 0.4, rarityMin: Rarity.Legendary,
        displayFormat: '+{v}% Auto Collect',
      },
    ],
    mfgBonus: {
      [Manufacturer.Redline]: { stat: 'salvageYield', mult: 1.15 },
      [Manufacturer.Ironwood]: { stat: 'precisionExtraction', mult: 1.35 },
      [Manufacturer.BlastForge]: { stat: 'explosiveSalvage', mult: 1.4 },
      [Manufacturer.Prismatek]: { stat: 'essenceExtraction', mult: 1.35 },
      [Manufacturer.ThrowTech]: { stat: 'autoCollectChance', mult: 1.5 },
      [Manufacturer.HelixWorks]: { stat: 'rareMaterialChance', mult: 1.15 },
    },
  },

  // ── Market Module ──────────────────────────────────────────────

  market_listing: {
    activityKind: 'market_listing',
    name: 'Market Module',
    subStats: [
      {
        key: 'marketFeeReduction', label: 'Fee Reduction', baseValue: 0.06,
        levelGrowth: LEVEL_GROWTH_RATE, rarityMin: Rarity.Common,
        displayFormat: '-{v}% Market Fee', isPrimary: true,
      },
      {
        key: 'marketSaleBonus', label: 'Sale Bonus', baseValue: 0.05,
        levelGrowth: LEVEL_GROWTH_RATE * 0.9, rarityMin: Rarity.Uncommon,
        displayFormat: '+{v}% Sale Price',
      },
      {
        key: 'listingDurationBonus', label: 'Duration', baseValue: 0.08,
        levelGrowth: LEVEL_GROWTH_RATE * 0.6, rarityMin: Rarity.Rare,
        displayFormat: '+{v}% Duration',
      },
      {
        key: 'premiumPricingChance', label: 'Premium Price', baseValue: 0.04,
        levelGrowth: LEVEL_GROWTH_RATE * 0.5, rarityMin: Rarity.Epic,
        displayFormat: '+{v}% Premium',
      },
      {
        key: 'affinityPricing', label: 'Affinity Price', baseValue: 0.05,
        levelGrowth: LEVEL_GROWTH_RATE * 0.6, rarityMin: Rarity.Epic,
        displayFormat: '+{v}% Affinity',
      },
      {
        key: 'bulkListingSlots', label: 'Bulk Slots', baseValue: 1,
        levelGrowth: 0, rarityMin: Rarity.Legendary,
        displayFormat: '+{v} Listings',
      },
    ],
    mfgBonus: {
      [Manufacturer.Redline]: { stat: 'listingDurationBonus', mult: 1.2 },
      [Manufacturer.Ironwood]: { stat: 'premiumPricingChance', mult: 1.3 },
      [Manufacturer.BlastForge]: { stat: 'bulkListingSlots', mult: 1.5 },
      [Manufacturer.Prismatek]: { stat: 'affinityPricing', mult: 1.35 },
      [Manufacturer.ThrowTech]: { stat: 'listingDurationBonus', mult: 1.15 },
      [Manufacturer.HelixWorks]: { stat: 'marketSaleBonus', mult: 1.1 },
    },
  },

  // ── Workshop Module ────────────────────────────────────────────

  workshop_service: {
    activityKind: 'workshop_service',
    name: 'Workshop Module',
    subStats: [
      {
        key: 'workshopSpeed', label: 'Workshop Speed', baseValue: 0.08,
        levelGrowth: LEVEL_GROWTH_RATE, rarityMin: Rarity.Common,
        displayFormat: '+{v}% Workshop Speed', isPrimary: true,
      },
      {
        key: 'parallelQueueSlots', label: 'Parallel Slots', baseValue: 1,
        levelGrowth: 0, rarityMin: Rarity.Rare,
        displayFormat: '+{v} Queue Slots',
      },
      {
        key: 'overclockChance', label: 'Overclock', baseValue: 0.05,
        levelGrowth: LEVEL_GROWTH_RATE * 0.6, rarityMin: Rarity.Rare,
        displayFormat: '+{v}% Overclock',
      },
      {
        key: 'droneAssistSpeed', label: 'Drone Assist', baseValue: 0.04,
        levelGrowth: LEVEL_GROWTH_RATE * 0.5, rarityMin: Rarity.Epic,
        displayFormat: '+{v}% Drone Speed',
      },
      {
        key: 'failureReduction', label: 'Failure Reduction', baseValue: 0.06,
        levelGrowth: LEVEL_GROWTH_RATE * 0.5, rarityMin: Rarity.Epic,
        displayFormat: '-{v}% Fail Rate',
      },
      {
        key: 'qualityTierBonus', label: 'Quality Tier', baseValue: 0.04,
        levelGrowth: LEVEL_GROWTH_RATE * 0.35, rarityMin: Rarity.Legendary,
        displayFormat: '+{v}% Tier Bonus',
      },
    ],
    mfgBonus: {
      [Manufacturer.Redline]: { stat: 'workshopSpeed', mult: 1.2 },
      [Manufacturer.Ironwood]: { stat: 'qualityTierBonus', mult: 1.35 },
      [Manufacturer.BlastForge]: { stat: 'overclockChance', mult: 1.4 },
      [Manufacturer.Prismatek]: { stat: 'failureReduction', mult: 1.2 },
      [Manufacturer.ThrowTech]: { stat: 'droneAssistSpeed', mult: 1.5 },
      [Manufacturer.HelixWorks]: { stat: 'parallelQueueSlots', mult: 1.4 },
    },
  },

  // ── Roaming Module ─────────────────────────────────────────────

  roaming_loot: {
    activityKind: 'roaming_loot',
    name: 'Roaming Module',
    subStats: [
      {
        key: 'creditsPerKill', label: 'Credits/Kill', baseValue: 0.06,
        levelGrowth: LEVEL_GROWTH_RATE, rarityMin: Rarity.Common,
        displayFormat: '+{v}% Credits', isPrimary: true,
      },
      {
        key: 'rareDropChanceMod', label: 'Rare Drops', baseValue: 0.03,
        levelGrowth: LEVEL_GROWTH_RATE * 0.7, rarityMin: Rarity.Uncommon,
        displayFormat: '+{v}% Rare Drops',
      },
      {
        key: 'scrapYieldMod', label: 'Scrap Yield', baseValue: 0.05,
        levelGrowth: LEVEL_GROWTH_RATE * 0.8, rarityMin: Rarity.Uncommon,
        displayFormat: '+{v}% Scrap',
      },
      {
        key: 'materialFindChance', label: 'Material Find', baseValue: 0.04,
        levelGrowth: LEVEL_GROWTH_RATE * 0.6, rarityMin: Rarity.Rare,
        displayFormat: '+{v}% Materials',
      },
      {
        key: 'xpBoostMod', label: 'XP Boost', baseValue: 0.05,
        levelGrowth: LEVEL_GROWTH_RATE * 0.7, rarityMin: Rarity.Rare,
        displayFormat: '+{v}% XP',
      },
      {
        key: 'cacheFragmentChance', label: 'Cache Fragments', baseValue: 0.04,
        levelGrowth: LEVEL_GROWTH_RATE * 0.5, rarityMin: Rarity.Epic,
        displayFormat: '+{v}% Fragments',
      },
    ],
    mfgBonus: {
      [Manufacturer.Redline]: { stat: 'creditsPerKill', mult: 1.15 },
      [Manufacturer.Ironwood]: { stat: 'rareDropChanceMod', mult: 1.2 },
      [Manufacturer.BlastForge]: { stat: 'scrapYieldMod', mult: 1.25 },
      [Manufacturer.Prismatek]: { stat: 'materialFindChance', mult: 1.2 },
      [Manufacturer.ThrowTech]: { stat: 'xpBoostMod', mult: 1.15 },
      [Manufacturer.HelixWorks]: { stat: 'cacheFragmentChance', mult: 1.15 },
    },
  },

  // ── Idle Module ────────────────────────────────────────────────

  idle_standby: {
    activityKind: 'idle_standby',
    name: 'Idle Module',
    subStats: [
      {
        key: 'offlineEarningsMod', label: 'Offline Earnings', baseValue: 0.08,
        levelGrowth: LEVEL_GROWTH_RATE, rarityMin: Rarity.Common,
        displayFormat: '+{v}% Credits', isPrimary: true,
      },
      {
        key: 'offlineScrapMod', label: 'Offline Scrap', baseValue: 0.05,
        levelGrowth: LEVEL_GROWTH_RATE * 0.7, rarityMin: Rarity.Uncommon,
        displayFormat: '+{v}% Scrap',
      },
      {
        key: 'offlineXpMod', label: 'Offline XP', baseValue: 0.04,
        levelGrowth: LEVEL_GROWTH_RATE * 0.6, rarityMin: Rarity.Rare,
        displayFormat: '+{v}% XP',
      },
      {
        key: 'offlineMaterialMod', label: 'Offline Materials', baseValue: 0.03,
        levelGrowth: LEVEL_GROWTH_RATE * 0.5, rarityMin: Rarity.Epic,
        displayFormat: '+{v}% Materials',
      },
    ],
    mfgBonus: {
      [Manufacturer.Redline]: { stat: 'offlineEarningsMod', mult: 1.15 },
      [Manufacturer.Ironwood]: { stat: 'offlineXpMod', mult: 1.2 },
      [Manufacturer.BlastForge]: { stat: 'offlineScrapMod', mult: 1.25 },
      [Manufacturer.Prismatek]: { stat: 'offlineMaterialMod', mult: 1.2 },
      [Manufacturer.ThrowTech]: { stat: 'offlineEarningsMod', mult: 1.1 },
      [Manufacturer.HelixWorks]: { stat: 'offlineEarningsMod', mult: 1.05 },
    },
  },
};

// ── Slot → Activity Weight Table ──────────────────────────────────

/**
 * When an activity module is rolled, the activity kind is picked with
 * weighted probabilities based on the gear slot. These weights create
 * natural specialization without hard-locking slots.
 */
export type GearSlot = 'weapon' | 'shield' | 'ordnance' | 'relic' | 'classMod';

export const SLOT_ACTIVITY_WEIGHTS: Record<GearSlot, Partial<Record<ActivityKind, number>>> = {
  weapon: {
    roaming_loot: 3.0,
    boss_fight: 2.0,
    crafting: 0.5,
    salvaging: 1.0,
    workshop_service: 0.5,
    market_listing: 0.5,
    idle_standby: 1.0,
  },
  shield: {
    idle_standby: 2.0,
    roaming_loot: 1.5,
    crafting: 1.0,
    salvaging: 0.5,
    workshop_service: 0.5,
    market_listing: 1.0,
    boss_fight: 1.5,
    boss_prep: 1.0,
  },
  ordnance: {
    salvaging: 3.0,
    workshop_service: 2.0,
    roaming_loot: 1.0,
    crafting: 0.5,
    market_listing: 0.5,
    idle_standby: 0.5,
  },
  relic: {
    idle_standby: 2.0,
    crafting: 1.5,
    roaming_loot: 1.5,
    salvaging: 1.0,
    market_listing: 1.0,
    workshop_service: 1.0,
  },
  classMod: {
    crafting: 3.0,
    workshop_service: 2.0,
    market_listing: 2.0,
    salvaging: 1.0,
    roaming_loot: 0.5,
    idle_standby: 0.5,
  },
};

/**
 * All activity kinds that can have modules (excludes none, boss_prep, boss_fight
 * which use combat affixes instead).
 */
export const MODULE_ACTIVITY_KINDS: ActivityKind[] = [
  'crafting', 'salvaging', 'market_listing', 'workshop_service',
  'roaming_loot', 'idle_standby',
];
