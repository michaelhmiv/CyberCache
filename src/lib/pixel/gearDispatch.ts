import type {
  ClassMod,
  GearItem,
  Ordnance,
  Relic,
  Shield,
  Weapon,
} from '@/types/items';
import type { GearGrammar, GearKindId } from './gearCardCompositor';
import { classModGrammar } from './classModGrammar';
import { ordnanceGrammar } from './ordnanceGrammar';
import { relicGrammar } from './relicGrammar';
import { shieldGrammar } from './shieldGrammar';

/**
 * The gear dispatch table — the single classification + grammar
 * registry every gear render goes through. GearIllustration (the
 * one dispatcher) classifies the item, looks the kind up here, and
 * PixelGear paints.
 *
 * History: slices 0–4 of the gear marriage flipped each kind from
 * its procedural SVG illustration to the pixel plate engine behind
 * a flag + route seam (the retired gearRenderFlags): a kind
 * rendered pixel only when its flag was on AND a grammar was
 * registered, and failed safe to the SVG otherwise. Slice 5
 * retired the SVG island entirely, so the flags and the route
 * function are gone — this registry is TOTAL (a Record, not a
 * Partial), which moves the old runtime fail-safe to compile time:
 * a kind without a grammar is a type error, never a blank card or
 * a wrong-art fallback.
 *
 * The bespoke hook (BESPOKE_GEAR_SPRITES, intentionally empty)
 * lives in gearCardCompositor.ts and still resolves before this
 * registry inside PixelGear — untouched by the retirement.
 */
export const GEAR_GRAMMARS: Record<GearKindId, GearGrammar> = {
  shield: shieldGrammar,
  relic: relicGrammar,
  classMod: classModGrammar,
  ordnance: ordnanceGrammar,
};

/** The grammar for a kind — always defined (see the totality note). */
export function gearGrammarFor(kind: GearKindId): GearGrammar {
  return GEAR_GRAMMARS[kind];
}

/**
 * Kind guards — GearItem is a discriminated union but the
 * discriminant lives on different fields per kind (weaponType /
 * hp+rechargeRate / damage+effect / treeBonus / fallback for
 * relics), so classification lives in one place, here, never
 * re-derived at call sites. These are the exact predicates the
 * retired seam shipped — slice 5 moved them, it did not change
 * them.
 */
export function isWeaponItem(item: GearItem): item is Weapon {
  return 'weaponType' in item;
}

export function isShieldItem(item: GearItem): item is Shield {
  return 'hp' in item && 'rechargeRate' in item && !isWeaponItem(item);
}

export function isOrdnanceItem(item: GearItem): item is Ordnance {
  return 'damage' in item && 'effect' in item && !isWeaponItem(item);
}

export function isClassModItem(item: GearItem): item is ClassMod {
  return 'treeBonus' in item;
}

export function isRelicItem(item: GearItem): item is Relic {
  return !isWeaponItem(item) && !isShieldItem(item) && !isOrdnanceItem(item) && !isClassModItem(item);
}

export function gearKindOf(item: GearItem): GearKindId | 'weapon' {
  if (isWeaponItem(item)) return 'weapon';
  if (isShieldItem(item)) return 'shield';
  if (isOrdnanceItem(item)) return 'ordnance';
  if (isClassModItem(item)) return 'classMod';
  return 'relic';
}
