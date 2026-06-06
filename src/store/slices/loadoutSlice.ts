import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance } from '../../types/items';
import { useInventoryStore } from './inventorySlice';

export type LoadoutSlot =
  | 'primary'
  | 'secondary'
  | 'heavy'
  | 'ordnance'
  | 'shield'
  | 'classMod'
  | 'relic';

interface LoadoutState {
  slots: Record<LoadoutSlot, string | null>; // item IDs
  consumables: Record<string, number>; // consumableType -> count loaded
  setSlot: (slot: LoadoutSlot, itemId: string | null) => void;
  getEquipped: (slot: LoadoutSlot) => string | null;
  getWeapon: (slot: 'primary' | 'secondary' | 'heavy') => Weapon | undefined;
  getShield: () => Shield | undefined;
  getClassMod: () => ClassMod | undefined;
  getRelic: () => Relic | undefined;
  getOrdnance: () => Ordnance | undefined;
  getEquippedConsumables: () => Record<string, number>;
  setConsumables: (type: string, count: number) => void;
}

const getInventoryItem = (id: string | null): GearItem | undefined => {
  if (!id) return undefined;
  return useInventoryStore.getState().getById(id);
};

const isWeapon = (item: GearItem | undefined): item is Weapon =>
  !!(item && 'weaponType' in item);

const isShield = (item: GearItem | undefined): item is Shield =>
  !!(item && 'hp' in item && !('weaponType' in item));

const isClassMod = (item: GearItem | undefined): item is ClassMod =>
  !!(item && 'treeBonus' in item);

const isOrdnance = (item: GearItem | undefined): item is Ordnance =>
  !!(item && 'damage' in item && 'effect' in item);

const isRelic = (item: GearItem | undefined): item is Relic =>
  !!(item && 'affixes' in item && !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item));

export const useLoadoutStore = create<LoadoutState>()(
  persist(
    (set, get) => ({
      slots: {
        primary: null,
        secondary: null,
        heavy: null,
        ordnance: null,
        shield: null,
        classMod: null,
        relic: null,
      },
      consumables: {},

      setSlot: (slot, itemId) =>
        set((s) => ({ slots: { ...s.slots, [slot]: itemId } })),

      getEquipped: (slot) => get().slots[slot],

      getWeapon: (slot) => {
        const id = get().slots[slot];
        const item = getInventoryItem(id);
        return isWeapon(item) ? item : undefined;
      },
      getShield: () => {
        const id = get().slots.shield;
        const item = getInventoryItem(id);
        return isShield(item) ? item : undefined;
      },
      getClassMod: () => {
        const id = get().slots.classMod;
        const item = getInventoryItem(id);
        return isClassMod(item) ? item : undefined;
      },
      getRelic: () => {
        const id = get().slots.relic;
        const item = getInventoryItem(id);
        return isRelic(item) ? item : undefined;
      },
      getOrdnance: () => {
        const id = get().slots.ordnance;
        const item = getInventoryItem(id);
        return isOrdnance(item) ? item : undefined;
      },

      getEquippedConsumables: () => get().consumables,

      setConsumables: (type, count) =>
        set((s) => ({
          consumables: { ...s.consumables, [type]: count },
        })),
    }),
    {
      name: 'cc-loadout',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
