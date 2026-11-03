import { create } from 'zustand';
import type { GearItem, Weapon } from '../../types/items';
import { projectSalvageYield } from '../../lib/gear/salvageAward';
import { useSkillStore } from './skillSlice';

export interface InventoryState {
  items: GearItem[];
  setItems: (items: GearItem[]) => void;
  upsertItem: (item: GearItem) => void;
  addItem: (item: GearItem) => void;
  removeItem: (id: string) => void;
  scrapItem: (id: string) => { scrapValue: number; materials: Record<string, number>; essences: Record<string, number> };
  lockItem: (id: string) => void;
  unlockItem: (id: string) => void;
  /** Reconcile inventory to server-authoritative items. Replaces all local items. */
  receiveServerItems: (items: GearItem[]) => void;
  getWeapons: () => Weapon[];
  getById: (id: string) => GearItem | undefined;
}

export const useInventoryStore = create<InventoryState>()((set, get) => ({
  items: [],

  setItems: (items) => set({ items }),

  upsertItem: (item) => set((s) => {
    const exists = s.items.some((current) => current.id === item.id);
    return {
      items: exists
        ? s.items.map((current) => (current.id === item.id ? item : current))
        : [item, ...s.items],
    };
  }),

  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),

  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  scrapItem: (id) => {
    // RETIRED local path (AGENTS.md: UI salvage goes through
    // verifiedOps.recycleItem, never this). Its quote is the LIVE
    // projection — projectSalvageYield over the server's own salvage
    // composition with the player's skill bonuses — so even this
    // path names what cc_recycle_item actually pays: Scrap, and no
    // guaranteed materials or essences.
    const item = get().items.find((i) => i.id === id);
    if (!item) return { scrapValue: 0, materials: {}, essences: {} };
    const salvage = projectSalvageYield(item, useSkillStore.getState().getBonuses());
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
    return { scrapValue: salvage.scrapValue, materials: {}, essences: {} };
  },

  lockItem: (id) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, isLocked: true } : i)),
    })),

  unlockItem: (id) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, isLocked: false } : i)),
    })),

  receiveServerItems: (items) => set({ items }),

  getWeapons: () => get().items.filter((i) => 'weaponType' in i) as Weapon[],
  getById: (id) => get().items.find((i) => i.id === id),
}));
