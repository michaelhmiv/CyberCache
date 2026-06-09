import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import type { GearVisualId } from '@/constants/visualAssets';

function isWeapon(item: GearItem): item is Weapon {
  return 'weaponType' in item;
}
function isShield(item: GearItem): item is Shield {
  return 'hp' in item && !('weaponType' in item);
}
function isClassMod(item: GearItem): item is ClassMod {
  return 'treeBonus' in item;
}
function isOrdnance(item: GearItem): item is Ordnance {
  return 'damage' in item && 'effect' in item && !('weaponType' in item);
}
function isRelic(item: GearItem): item is Relic {
  return 'affixes' in item && !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);
}

export function getGearVisualId(item: GearItem): GearVisualId {
  if (isWeapon(item)) return 'weapon';
  if (isShield(item)) return 'shield';
  if (isClassMod(item)) return 'classMod';
  if (isRelic(item)) return 'relic';
  return 'ordnance';
}
