import { emptySlots, type LoadoutSlot } from '@/store/slices/loadoutSlice';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';

export const LOADOUT_SLOT_ORDER: LoadoutSlot[] = [
  'primary',
  'secondary',
  'heavy',
  'ordnance',
  'shield',
  'classMod',
  'relic',
];

export const WEAPON_LOADOUT_SLOTS: LoadoutSlot[] = ['primary', 'secondary', 'heavy'];

export const LOADOUT_SLOT_LABEL: Record<LoadoutSlot, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  heavy: 'Heavy',
  ordnance: 'Ordnance',
  shield: 'Shield',
  classMod: 'Class Mod',
  relic: 'Relic',
};

export type EquippedLoadoutItem = Weapon | Shield | ClassMod | Relic | Ordnance;

export type LoadoutSlotStatus = 'empty' | 'equipped' | 'missing-item' | 'wrong-slot-type';

export type LoadoutSlotRow = {
  slot: LoadoutSlot;
  label: string;
  itemId: string | null;
  item: EquippedLoadoutItem | null;
  status: LoadoutSlotStatus;
};

export function isWeaponItem(item: GearItem | undefined | null): item is Weapon {
  return !!(item && 'weaponType' in item);
}

export function isShieldItem(item: GearItem | undefined | null): item is Shield {
  return !!(item && 'hp' in item && !('weaponType' in item));
}

export function isClassModItem(item: GearItem | undefined | null): item is ClassMod {
  return !!(item && 'treeBonus' in item);
}

export function isOrdnanceItem(item: GearItem | undefined | null): item is Ordnance {
  return !!(item && 'damage' in item && 'effect' in item && !('weaponType' in item));
}

export function isRelicItem(item: GearItem | undefined | null): item is Relic {
  return !!(
    item &&
    'affixes' in item &&
    !isWeaponItem(item) &&
    !isShieldItem(item) &&
    !isClassModItem(item) &&
    !isOrdnanceItem(item)
  );
}

export function loadoutSlotAccepts(slot: LoadoutSlot, item: GearItem | undefined | null): item is EquippedLoadoutItem {
  if (!item) return false;
  switch (slot) {
    case 'primary':
    case 'secondary':
    case 'heavy':
      return isWeaponItem(item);
    case 'shield':
      return isShieldItem(item);
    case 'classMod':
      return isClassModItem(item);
    case 'ordnance':
      return isOrdnanceItem(item);
    case 'relic':
      return isRelicItem(item);
    default:
      return false;
  }
}

export function normalizeLoadoutSlots(slots: Partial<Record<LoadoutSlot, string | null>> | null | undefined): Record<LoadoutSlot, string | null> {
  return { ...emptySlots, ...(slots ?? {}) };
}

export function buildLoadoutRows(
  slots: Partial<Record<LoadoutSlot, string | null>> | null | undefined,
  items: GearItem[],
): LoadoutSlotRow[] {
  const normalized = normalizeLoadoutSlots(slots);
  const itemById = new Map(items.map((item) => [item.id, item]));

  return LOADOUT_SLOT_ORDER.map((slot) => {
    const itemId = normalized[slot];
    if (!itemId) {
      return { slot, label: LOADOUT_SLOT_LABEL[slot], itemId: null, item: null, status: 'empty' as const };
    }

    const item = itemById.get(itemId);
    if (!item) {
      return { slot, label: LOADOUT_SLOT_LABEL[slot], itemId, item: null, status: 'missing-item' as const };
    }

    if (!loadoutSlotAccepts(slot, item)) {
      return { slot, label: LOADOUT_SLOT_LABEL[slot], itemId, item: null, status: 'wrong-slot-type' as const };
    }

    return { slot, label: LOADOUT_SLOT_LABEL[slot], itemId, item, status: 'equipped' as const };
  });
}

export function getLoadoutRow(rows: LoadoutSlotRow[], slot: LoadoutSlot): LoadoutSlotRow {
  return rows.find((row) => row.slot === slot) ?? { slot, label: LOADOUT_SLOT_LABEL[slot], itemId: null, item: null, status: 'empty' };
}

export function getEquippedItemIdSet(rows: LoadoutSlotRow[]): Set<string> {
  return new Set(rows.filter((row) => row.status === 'equipped' && row.itemId).map((row) => row.itemId as string));
}

export function countEquippedLoadoutSlots(rows: LoadoutSlotRow[]): number {
  return rows.filter((row) => row.status === 'equipped').length;
}

export function getLoadoutIntegrityIssues(rows: LoadoutSlotRow[]): LoadoutSlotRow[] {
  return rows.filter((row) => row.status === 'missing-item' || row.status === 'wrong-slot-type');
}

export function chooseDefaultSlotForItem(item: GearItem, rows: LoadoutSlotRow[]): LoadoutSlot | null {
  if (isShieldItem(item)) return 'shield';
  if (isClassModItem(item)) return 'classMod';
  if (isOrdnanceItem(item)) return 'ordnance';
  if (isRelicItem(item)) return 'relic';

  if (isWeaponItem(item)) {
    const currentWeaponSlot = rows.find((row) => WEAPON_LOADOUT_SLOTS.includes(row.slot) && row.itemId === item.id)?.slot;
    if (currentWeaponSlot) return currentWeaponSlot;

    const firstEmptyWeaponSlot = rows.find((row) => WEAPON_LOADOUT_SLOTS.includes(row.slot) && row.status === 'empty')?.slot;
    return firstEmptyWeaponSlot ?? 'primary';
  }

  return null;
}
