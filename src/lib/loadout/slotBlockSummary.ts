/**
 * slotBlockSummary — the merged Gear page's per-slot block content.
 *
 * One derivation for what a loadout slot block prints on the merged
 * Gear page (Exec C, "the Split"): the gun rows down the right column
 * and the accessory cards in the band beneath the figure. Each block
 * shows the equipped item's name in its rarity color, and ONE perk
 * line: the headline stat first, then the item's next real perks —
 * derived per kind from the item's actual rolled stats.
 *
 * OWNER RULING (2026-11-03): rarity and element never print as
 * words in the line — rarity reads from the NAME's color, element
 * from color coding (elementTintOf below tints the block's icon;
 * the item's own render is element-tinted by the compositor). The
 * line's room belongs to perks:
 *
 *   - Weapon:   "DPS 486 · Status 10% · Crit 18%" (proc chance,
 *               crit, boss/wave mods; Roll as the fallback perk)
 *   - Shield:   "HP 640 · Mit 20% · Rech 12/s" (behavior name when
 *               the shield's behavior is not Standard)
 *   - ClassMod: "4 nodes · Boost +5 · Gunslinger"
 *   - Relic:    the lead affixes themselves ("+6% rare drop · …")
 *   - Ordnance: "Payload 310 · Shield 40 · Armor 20"
 *
 * Headlines match the figures the picker and the Grid print
 * (gearCardSummary: combatPower as DPS, hp, damage as payload,
 * nodeBoosts count). This module is the ONLY place that chooses
 * what a block's line carries — changing the information is a
 * change here (plus its test), never surgery in the components.
 */
import {
  affixesOf,
  isClassMod,
  isOrdnance,
  isShield,
  isWeapon,
  sumNodeBoosts,
  topActivityModule,
} from '@/lib/gear/gearCardSummary';
import { SHIELD_BEHAVIORS, shieldBehaviorOf } from '@/lib/combat/shieldBehaviors';
import { ELEMENTS } from '@/constants/elements';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
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

const pct = (value: number): string => `${Math.round(value * 100)}%`;

const signedPct = (value: number): string =>
  `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;

/**
 * The element's canonical color (constants/elements) for items that
 * carry an element — weapons, shields, ordnance. Blocks tint their
 * icon with it so the element reads by color, never by word.
 */
export function elementTintOf(item: GearItem | null): string | null {
  if (!item || !('element' in item)) return null;
  return ELEMENTS[item.element]?.color ?? null;
}

export interface SlotBlockSummary {
  slot: LoadoutSlot;
  /** 'gun' for the weapon slots, 'accessory' for the band. */
  kind: 'gun' | 'accessory';
  slotLabel: string;
  filled: boolean;
  /** The equipped item's name; 'No weapon' / 'Open' when empty. */
  name: string;
  /** The perk line as segments: headline first, then the item's
   *  next real perks (at most two). ['Tap to fill'] when empty. */
  statSegments: string[];
  /** The perk line joined for one-line rendering. */
  statLine: string;
}

function weaponPerks(item: Weapon): string[] {
  const perks: string[] = [];
  if (item.statusChance > 0) perks.push(`Status ${pct(item.statusChance)}`);
  if (item.critChance > 0) perks.push(`Crit ${pct(item.critChance)}`);
  if (item.bossDamageMod !== 0) perks.push(`Boss ${signedPct(item.bossDamageMod)}`);
  if (item.waveDamageMod !== 0) perks.push(`Wave ${signedPct(item.waveDamageMod)}`);
  if (perks.length === 0) perks.push(`Roll ${item.rollQuality}`);
  return [`DPS ${fmt(item.combatPower)}`, ...perks.slice(0, 2)];
}

function shieldPerks(item: Shield): string[] {
  const perks: string[] = [];
  if (item.mitigation > 0) perks.push(`Mit ${pct(item.mitigation)}`);
  const behavior = shieldBehaviorOf(item);
  if (behavior !== 'standard') perks.push(SHIELD_BEHAVIORS[behavior].name);
  if (item.rechargeRate > 0) perks.push(`Rech ${fmt(item.rechargeRate)}/s`);
  return [`HP ${fmt(item.hp)}`, ...perks.slice(0, 2)];
}

function classModPerks(item: ClassMod): string[] {
  const nodes = Object.keys(item.nodeBoosts).length;
  const perks: string[] = [];
  const boost = sumNodeBoosts(item);
  if (boost > 0) perks.push(`Boost +${boost}`);
  if (item.treeBonus) perks.push(item.treeBonus);
  return [`${nodes} node${nodes === 1 ? '' : 's'}`, ...perks.slice(0, 2)];
}

function relicPerks(item: Relic): string[] {
  // The relic's perks ARE its affixes: the activity module leads
  // when present (the gearCardSummary rule), then affix heads.
  const segments: string[] = [];
  const activity = topActivityModule(item);
  if (activity) segments.push(activity.label);
  for (const affix of affixesOf(item)) {
    if (segments.length >= 2) break;
    const head = affix.displayText.split(' · ')[0] || affix.displayText;
    if (head && !segments.includes(head)) segments.push(head);
  }
  if (segments.length === 0) segments.push(`${affixesOf(item).length} affixes`);
  return segments.slice(0, 2);
}

function ordnancePerks(item: Ordnance): string[] {
  const perks: string[] = [];
  if (item.shieldDamage > 0) perks.push(`Shield ${fmt(item.shieldDamage)}`);
  if (item.armorDamage > 0) perks.push(`Armor ${fmt(item.armorDamage)}`);
  if (perks.length === 0 && item.effect) perks.push(item.effect.split(':')[0]);
  return [`Payload ${fmt(item.damage)}`, ...perks.slice(0, 2)];
}

function perksOf(item: GearItem): string[] {
  if (isWeapon(item)) return weaponPerks(item);
  if (isShield(item)) return shieldPerks(item);
  if (isClassMod(item)) return classModPerks(item);
  if (isOrdnance(item)) return ordnancePerks(item);
  return relicPerks(item);
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
      statSegments: ['Tap to fill'],
      statLine: 'Tap to fill',
    };
  }
  const segments = perksOf(item);
  return {
    slot,
    kind,
    slotLabel,
    filled: true,
    name: item.name,
    statSegments: segments,
    statLine: segments.join(' · '),
  };
}
