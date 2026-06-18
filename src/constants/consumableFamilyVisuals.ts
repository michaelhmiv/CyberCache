/**
 * Consumable Family Visual Registry — visual identity per consumable family.
 *
 * Replaces duplicated FAMILY_ICONS lucide maps in ConsumableInspectSheet
 * and VendorScreen with a single central registry.
 */
import type { ConsumableFamily } from './consumables';

export interface ConsumableFamilyVisual {
  family: ConsumableFamily;
  glyph: string;
  color: string;
  accentColor: string;
  label: string;
  shortLabel: string;
  description: string;
}

export const CONSUMABLE_FAMILY_VISUALS: Record<ConsumableFamily, ConsumableFamilyVisual> = {
  survival: {
    family: 'survival',
    glyph: '✚',
    color: '#7CFC00',
    accentColor: '#F5F5F5',
    label: 'Survival',
    shortLabel: 'SRV',
    description: 'Health and shield restoration consumables.',
  },
  ammo: {
    family: 'ammo',
    glyph: '▣',
    color: '#FF4B5C',
    accentColor: '#FFEA3A',
    label: 'Ammunition',
    shortLabel: 'AMM',
    description: 'Ammo coverage and reload consumables.',
  },
  ordnance: {
    family: 'ordnance',
    glyph: '●',
    color: '#FF9000',
    accentColor: '#FFEA3A',
    label: 'Ordnance',
    shortLabel: 'ORD',
    description: 'Explosive throwables and heavy payloads.',
  },
  tactical: {
    family: 'tactical',
    glyph: '📡',
    color: '#00E5FF',
    accentColor: '#A5F3FC',
    label: 'Tactical',
    shortLabel: 'TAC',
    description: 'Scanners, intel, and battlefield awareness.',
  },
  economy: {
    family: 'economy',
    glyph: '★',
    color: '#FFB300',
    accentColor: '#FF9000',
    label: 'Economy',
    shortLabel: 'ECO',
    description: 'Loot chance and reward boosters.',
  },
  corrupted: {
    family: 'corrupted',
    glyph: '⚠',
    color: '#B66BFF',
    accentColor: '#FF9DF5',
    label: 'Corrupted',
    shortLabel: 'CRP',
    description: 'Volatile items with drawbacks and high risk.',
  },
};

export function getConsumableFamilyVisual(family: ConsumableFamily): ConsumableFamilyVisual {
  return CONSUMABLE_FAMILY_VISUALS[family] ?? {
    family,
    glyph: '?',
    color: '#B8B0A8',
    accentColor: '#34303A',
    label: String(family),
    shortLabel: '???',
    description: 'Unknown consumable family.',
  };
}
