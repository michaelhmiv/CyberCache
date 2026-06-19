import type { GearItem } from '@/types/items';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

/**
 * Client-side slot-compatibility rule.
 * This must stay in sync with `cc_item_accepts_slot` in the database.
 */
export function isItemCompatibleWithSlot(item: GearItem, slot: LoadoutSlot): boolean {
  switch (slot) {
    case 'primary':
    case 'secondary':
    case 'heavy':
      return 'weaponType' in item;
    case 'shield':
      return 'hp' in item && !('weaponType' in item);
    case 'classMod':
      return 'treeBonus' in item;
    case 'relic':
      return (
        'affixes' in item &&
        !('weaponType' in item) &&
        !('hp' in item) &&
        !('treeBonus' in item) &&
        !('damage' in item)
      );
    case 'ordnance':
      return 'damage' in item && 'effect' in item && !('weaponType' in item);
    default:
      return false;
  }
}
