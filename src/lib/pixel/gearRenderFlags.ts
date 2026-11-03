import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import type { GearGrammar, GearKindId } from './gearCardCompositor';
import { shieldGrammar } from './shieldGrammar';

/**
 * The gear-marriage dispatch seam. `GearIllustration` is the only
 * dispatcher for gear art; each kind flips from its procedural SVG
 * to the pixel plate engine by (a) registering its grammar in
 * GEAR_GRAMMARS and (b) turning its flag on in GEAR_PIXEL_KINDS.
 * Until BOTH are true the route stays 'svg' — so slice 0 ships the
 * seam with every kind's output byte-identical to today, and each
 * kind slice flips exactly one kind in its own PR.
 */
export const GEAR_PIXEL_KINDS: Record<GearKindId, boolean> = {
  shield: true, // gear marriage slice 1 — behavior grammar
  relic: false,
  classMod: false,
  ordnance: false,
};

/** Kind grammars, registered by the kind slices. */
export const GEAR_GRAMMARS: Partial<Record<GearKindId, GearGrammar>> = {
  shield: shieldGrammar,
};

export type GearRenderRoute = 'pixel' | 'svg';

/**
 * The route decision, pure and pinned by tests: pixel only when
 * the kind's flag is on AND a grammar is registered — a flag
 * without a grammar fails safe to the SVG, never to a blank.
 */
export function gearRenderRoute(
  kind: GearKindId,
  flags: Record<GearKindId, boolean> = GEAR_PIXEL_KINDS,
  grammars: Partial<Record<GearKindId, GearGrammar>> = GEAR_GRAMMARS,
): GearRenderRoute {
  return flags[kind] && grammars[kind] ? 'pixel' : 'svg';
}

/* Kind guards — the single classification of a GearItem record,
   shared by GearIllustration and PixelGear (moved here from
   GearIllustration so the seam and the dispatcher cannot drift). */
export const isWeaponItem = (item: GearItem): item is Weapon => 'weaponType' in item;
export const isShieldItem = (item: GearItem): item is Shield =>
  'hp' in item && 'rechargeRate' in item && !isWeaponItem(item);
export const isOrdnanceItem = (item: GearItem): item is Ordnance =>
  'damage' in item && 'effect' in item && !isWeaponItem(item);
export const isClassModItem = (item: GearItem): item is ClassMod => 'treeBonus' in item;
export const isRelicItem = (item: GearItem): item is Relic =>
  !isWeaponItem(item) && !isShieldItem(item) && !isOrdnanceItem(item) && !isClassModItem(item);

export function gearKindOf(item: GearItem): GearKindId | 'weapon' {
  if (isWeaponItem(item)) return 'weapon';
  if (isShieldItem(item)) return 'shield';
  if (isOrdnanceItem(item)) return 'ordnance';
  if (isClassModItem(item)) return 'classMod';
  return 'relic';
}
