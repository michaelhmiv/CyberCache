import { create } from 'zustand';
import { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance } from '../../types/items';
import { useInventoryStore } from './inventorySlice';
import { useSkillStore } from './skillSlice';

export type LoadoutSlot =
  | 'primary'
  | 'secondary'
  | 'heavy'
  | 'ordnance'
  | 'shield'
  | 'classMod'
  | 'relic';

export interface LoadoutConsumables {
  PreFight: string | null;
  MidFight: string | null;
  Emergency: string | null;
}

export const emptySlots: Record<LoadoutSlot, string | null> = {
  primary: null,
  secondary: null,
  heavy: null,
  ordnance: null,
  shield: null,
  classMod: null,
  relic: null,
};

export interface LoadoutState {
  slots: Record<LoadoutSlot, string | null>;
  consumables: LoadoutConsumables;
  setSlots: (slots: Partial<Record<LoadoutSlot, string | null>>) => void;
  setSlot: (slot: LoadoutSlot, itemId: string | null) => void;
  getEquipped: (slot: LoadoutSlot) => string | null;
  getWeapon: (slot: 'primary' | 'secondary' | 'heavy') => Weapon | undefined;
  getShield: () => Shield | undefined;
  getClassMod: () => ClassMod | undefined;
  getRelic: () => Relic | undefined;
  getOrdnance: () => Ordnance | undefined;
  getEquippedConsumables: () => LoadoutConsumables;
  setConsumableSlot: (slot: keyof LoadoutConsumables, type: string | null) => void;
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

export const useLoadoutStore = create<LoadoutState>()((set, get) => ({
  slots: emptySlots,
  consumables: {
    PreFight: null,
    MidFight: null,
    Emergency: null,
  },

  setSlots: (slots) => {
    // Handle class mod equip / unequip if classMod is in the new slots.
    if ('classMod' in slots) {
      const skillStore = useSkillStore.getState();
      const prevId = get().slots.classMod;

      if (prevId) {
        skillStore.removeClassMod();
      }

      const newClassModId = slots.classMod;
      if (newClassModId) {
        const item = getInventoryItem(newClassModId);
        if (isClassMod(item)) {
          skillStore.applyClassMod(item);
        }
      }
    }

    set({ slots: { ...emptySlots, ...slots } });
  },

  setSlot: (slot, itemId) => {
    const prevId = get().slots[slot];

    // Handle class mod equip / unequip side effects.
    if (slot === 'classMod') {
      const skillStore = useSkillStore.getState();

      // Remove previous class mod boosts if any.
      if (prevId) {
        skillStore.removeClassMod();
      }

      // Apply new class mod boosts.
      if (itemId) {
        const item = getInventoryItem(itemId);
        if (isClassMod(item)) {
          skillStore.applyClassMod(item);
        }
      }
    }

    set((s) => ({ slots: { ...s.slots, [slot]: itemId } }));
  },

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

  setConsumableSlot: (slot, type) => {
    set((s) => {
      // Dedup guard: if the consumable is already in another slot, clear it
      // from that slot first (swap behavior, not block behavior). This is
      // the single chokepoint — all callers (Ledger, ConsumablesScreen,
      // BossPrepModal, presets) are protected by this guard.
      const others = (['PreFight', 'MidFight', 'Emergency'] as const).filter(
        (k) => k !== slot,
      );
      const consumables = { ...s.consumables };
      if (type) {
        for (const other of others) {
          if (consumables[other] === type) {
            consumables[other] = null;
          }
        }
      }
      consumables[slot] = type;
      return { consumables };
    });
  },
}));
