/**
 * families — shared family→label and family→tone maps for consumable UI.
 *
 * Extracted from VendorScreen and ConsumablesScreen so the new
 * ConsumablePicker can reuse them without coupling to either screen.
 */
import type { ConsumableFamily, ConsumableTrigger } from '@/constants/consumables';

export const FAMILY_COLORS: Record<ConsumableFamily, string> = {
  survival: 'text-green',
  ammo: 'text-red',
  ordnance: 'text-orange',
  tactical: 'text-cyan',
  economy: 'text-amber',
  corrupted: 'text-purple',
};

export const FAMILY_LABELS: Record<ConsumableFamily, string> = {
  survival: 'Survival',
  ammo: 'Ammunition',
  ordnance: 'Ordnance',
  tactical: 'Tactical',
  economy: 'Economy',
  corrupted: 'Corrupted',
};

/**
 * Player-facing trigger labels. The trigger KEYS in
 * src/constants/consumables.ts are engine vocabulary (hpBelowThreshold,
 * activityStart, …) and must never print verbatim on a player surface
 * (DESIGN.md §1: no camelCase trigger tags in player text) — every
 * chip or row that names a trigger goes through this map.
 */
export const TRIGGER_LABELS: Record<ConsumableTrigger, string> = {
  fightStart: 'Fight start',
  shieldPhase: 'Shield phase',
  armorPhase: 'Armor phase',
  bossMechanic: 'Boss mechanic',
  survivalFailure: 'On survival failure',
  hpBelowThreshold: 'Low HP',
  shieldBelowThreshold: 'Low shield',
  activityStart: 'Activity start',
  ammoInterval: 'While roaming',
  craftStart: 'Craft start',
  scrapStart: 'Salvage start',
  repairStart: 'Repair start',
  victory: 'On victory',
  defeat: 'On defeat',
  lootRoll: 'On loot roll',
  manual: 'Manual',
};
