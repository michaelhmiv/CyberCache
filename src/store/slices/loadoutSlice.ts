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

let applyingAuthoritativeLoadoutState = false;
let persistSequence = 0;
const latestPersistBySlot: Partial<Record<LoadoutSlot, number>> = {};

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

function applyClassModSideEffects(previousId: string | null, nextId: string | null): void {
  if (previousId === nextId) return;

  const skillStore = useSkillStore.getState();

  if (previousId) {
    skillStore.removeClassMod();
  }

  if (nextId) {
    const item = getInventoryItem(nextId);
    if (isClassMod(item)) {
      skillStore.applyClassMod(item);
    }
  }
}

async function persistVerifiedSlotChange(slot: LoadoutSlot, itemId: string | null, previousId: string | null): Promise<void> {
  const sequence = ++persistSequence;
  latestPersistBySlot[slot] = sequence;

  try {
    const { verifiedOps } = await import('@/lib/supabase/verifiedOps');
    if (itemId) {
      await verifiedOps.equipItem(itemId, slot);
    } else {
      await verifiedOps.unequipSlot(slot);
    }
  } catch (error) {
    if (latestPersistBySlot[slot] === sequence) {
      console.warn('[loadout] verified slot mutation failed; rolling back local slot:', error instanceof Error ? error.message : error);
      applyAuthoritativeLoadoutSlot(slot, previousId);
    }
  }
}

function persistChangedSlots(previous: Record<LoadoutSlot, string | null>, next: Record<LoadoutSlot, string | null>): void {
  if (applyingAuthoritativeLoadoutState) return;

  (Object.keys(next) as LoadoutSlot[]).forEach((slot) => {
    if (previous[slot] === next[slot]) return;
    void persistVerifiedSlotChange(slot, next[slot], previous[slot]);
  });
}

export const useLoadoutStore = create<LoadoutState>()((set, get) => ({
  slots: emptySlots,
  consumables: {
    PreFight: null,
    MidFight: null,
    Emergency: null,
  },

  setSlots: (slots) => {
    const previousSlots = get().slots;
    const nextSlots = { ...emptySlots, ...slots };

    applyClassModSideEffects(previousSlots.classMod, nextSlots.classMod);

    set({ slots: nextSlots });
    persistChangedSlots(previousSlots, nextSlots);
  },

  setSlot: (slot, itemId) => {
    const prevId = get().slots[slot];
    if (prevId === itemId) return;

    if (slot === 'classMod') {
      applyClassModSideEffects(prevId, itemId);
    }

    set((s) => ({ slots: { ...s.slots, [slot]: itemId } }));

    if (!applyingAuthoritativeLoadoutState) {
      void persistVerifiedSlotChange(slot, itemId, prevId);
    }
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

  setConsumableSlot: (slot, type) =>
    set((s) => ({
      consumables: { ...s.consumables, [slot]: type },
    })),
}));

export function applyAuthoritativeLoadoutSlot(slot: LoadoutSlot, itemId: string | null): void {
  applyingAuthoritativeLoadoutState = true;
  try {
    useLoadoutStore.getState().setSlot(slot, itemId);
  } finally {
    applyingAuthoritativeLoadoutState = false;
  }
}

export function applyAuthoritativeLoadoutSlots(slots: Partial<Record<LoadoutSlot, string | null>>): void {
  applyingAuthoritativeLoadoutState = true;
  try {
    useLoadoutStore.getState().setSlots(slots);
  } finally {
    applyingAuthoritativeLoadoutState = false;
  }
}
