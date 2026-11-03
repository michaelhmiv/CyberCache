/**
 * slotBlockSummary — the merged Gear page's per-slot block content.
 *
 * One derivation for what a loadout slot block prints on the merged
 * Gear page (Exec C, "the Split"): the gun rows down the right column
 * and the accessory cards in the band beneath the figure. Each block
 * shows the equipped item's name in its rarity color, and ONE line of
 * decision data:
 *
 *   - Guns (Primary · Secondary · Heavy): a four-term stat line —
 *     slot · rarity · element · headline stat ("Primary · Epic ·
 *     Shock · DPS 486"), the headline being the same DPS figure the
 *     picker and the Grid print (gearCardSummary's combatPower).
 *   - Accessories (Shield · Class Mod · Relic · Ordnance): the
 *     headline stat alone ("HP 640", "4 nodes", "+6% rare drop",
 *     "Payload 310") — a half-width card cannot hold the four-term
 *     line at the §5 floor, so rarity rides the name's data color
 *     and prints in full at the picker/inspect destination.
 *
 * This module is the ONLY place that chooses which datum a block
 * carries. Changing what a block shows is a change here (plus its
 * test), never surgery in the components — the components render
 * segments, they do not pick stats.
 */
import {
  affixesOf,
  isClassMod,
  isOrdnance,
  isShield,
  isWeapon,
  topActivityModule,
} from '@/lib/gear/gearCardSummary';
import type { GearItem } from '@/types/items';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

export const SLOT_BLOCK_LABELS: Record<LoadoutSlot, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  heavy: 'Heavy',
  shield: 'Shield',
  classMod: 'Class Mod',
  relic: 'Relic',
  ordnance: 'Ordnance',
};

/** The three weapon slots — the right column of the Split. */
export const GUN_SLOTS: LoadoutSlot[] = ['primary', 'secondary', 'heavy'];

/** The four accessory slots — the band beneath the figure zone. */
export const ACCESSORY_SLOTS: LoadoutSlot[] = ['shield', 'classMod', 'relic', 'ordnance'];

const fmt = (value: number): string =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : '0';

export interface SlotBlockSummary {
  slot: LoadoutSlot;
  /** 'gun' for the weapon slots, 'accessory' for the band. */
  kind: 'gun' | 'accessory';
  slotLabel: string;
  filled: boolean;
  /** The equipped item's name; 'No weapon' / 'Open' when empty. */
  name: string;
  /** Guns only: the four-term stat line; 'Tap to fill' when empty. */
  statLine: string | null;
  /** Accessories only: the headline stat; 'Tap to fill' when empty. */
  headline: string | null;
}

function gunStatLine(slotLabel: string, item: GearItem): string {
  if (!isWeapon(item)) return slotLabel;
  // DPS is the picker's and the Grid's headline for a weapon
  // (gearCardSummary primaryStats[0] = combatPower as "DPS").
  return [slotLabel, item.rarity, item.element, `DPS ${fmt(item.combatPower)}`].join(' · ');
}

function accessoryHeadline(item: GearItem): string {
  if (isShield(item)) return `HP ${fmt(item.hp)}`;
  if (isClassMod(item)) {
    const nodes = Object.keys(item.nodeBoosts).length;
    return `${nodes} node${nodes === 1 ? '' : 's'}`;
  }
  if (isOrdnance(item)) return `Payload ${fmt(item.damage)}`;
  // Relic: the lead affix is the decision datum (an activity module
  // outranks a plain affix, the gearCardSummary bestAffixText rule).
  const activity = topActivityModule(item);
  if (activity) return activity.label;
  const first = affixesOf(item)[0];
  if (first) return first.displayText.split(' · ')[0] || first.displayText;
  return `${affixesOf(item).length} affixes`;
}

/**
 * The block content for one slot. `item` is the slot's equipped
 * instance (or null) — the caller resolves it from the loadout read
 * model so the block always describes the ACTUAL equipped item.
 */
export function slotBlockSummary(slot: LoadoutSlot, item: GearItem | null): SlotBlockSummary {
  const slotLabel = SLOT_BLOCK_LABELS[slot];
  const kind = GUN_SLOTS.includes(slot) ? 'gun' : 'accessory';
  if (!item) {
    return {
      slot,
      kind,
      slotLabel,
      filled: false,
      name: slot === 'primary' ? 'No weapon' : 'Open',
      statLine: kind === 'gun' ? 'Tap to fill' : null,
      headline: kind === 'accessory' ? 'Tap to fill' : null,
    };
  }
  return {
    slot,
    kind,
    slotLabel,
    filled: true,
    name: item.name,
    statLine: kind === 'gun' ? gunStatLine(slotLabel, item) : null,
    headline: kind === 'accessory' ? accessoryHeadline(item) : null,
  };
}
