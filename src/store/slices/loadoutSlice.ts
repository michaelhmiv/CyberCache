import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance } from '../../types/items';

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
  setConsumables: (type: string, count: number) => void;
}

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
        // Would normally pull from inventory store; stub for now
        return undefined;
      },
      getShield: () => undefined,
      getClassMod: () => undefined,
      getRelic: () => undefined,
      getOrdnance: () => undefined,

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
