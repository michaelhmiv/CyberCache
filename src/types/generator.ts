import type { DropSource, Element, Manufacturer, Rarity, WeaponType } from './game';

export interface GenerateWeaponOptions {
  source: DropSource;
  level?: number;
  forcedType?: WeaponType;
  forcedRarity?: Rarity;
  forcedElement?: Element;
  forcedManufacturer?: Manufacturer;
  luckBonus?: number; // 0-1 flat increase to rarity roll
  bossTier?: number;
  zoneWeights?: Record<string, number>; // per-zone rarity weights
  _luckBonus?: number; // internal — destructured from options
}
