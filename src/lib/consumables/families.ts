/**
 * families — shared family→label and family→tone maps for consumable UI.
 *
 * Extracted from VendorScreen and ConsumablesScreen so the new
 * ConsumablePicker can reuse them without coupling to either screen.
 */
import type { ConsumableFamily } from '@/constants/consumables';

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
