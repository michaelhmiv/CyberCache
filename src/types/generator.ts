import type { DropSource, Element, Manufacturer, Rarity, WeaponType } from './game';

export interface GenerateWeaponOptions {
  source: DropSource;
  level?: number;
  forcedType?: WeaponType;
  forcedRarity?: Rarity;
  /**
   * Force this legendary effect id when the roll lands on Legendary
   * (boss dedicated drops). Honored only when the id is eligible for
   * the drop source/tier; otherwise the generator falls back to its
   * normal eligible-pool pick.
   */
  forcedLegendaryEffectId?: string;
  forcedElement?: Element;
  forcedManufacturer?: Manufacturer;
  luckBonus?: number; // 0-1 flat increase to rarity roll
  bossTier?: number;
  zoneWeights?: Record<string, number>; // per-zone rarity weights
  _luckBonus?: number; // internal — destructured from options
}
