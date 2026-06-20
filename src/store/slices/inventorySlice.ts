import { create } from 'zustand';
import { GearItem, Weapon } from '../../types/items';
import { generateWeapon } from '../../lib/generators/weaponGenerator';
import { generateShield } from '../../lib/generators/shieldGenerator';
import { generateClassMod } from '../../lib/generators/classModGenerator';
import { generateRelic } from '../../lib/generators/relicGenerator';
import { generateOrdnance } from '../../lib/generators/ordnanceGenerator';
import { calculateSalvageYield } from '../../constants/salvageRules';

export interface InventoryState {
  items: GearItem[];
  setItems: (items: GearItem[]) => void;
  upsertItem: (item: GearItem) => void;
  addItem: (item: GearItem) => void;
  removeItem: (id: string) => void;
  scrapItem: (id: string) => { scrapValue: number; materials: Record<string, number>; essences: Record<string, number> };
  lockItem: (id: string) => void;
  unlockItem: (id: string) => void;
  generateAndAdd: (opts: Parameters<typeof generateWeapon>[0], rng?: () => number) => Weapon;
  generateAndAddShield: (level?: number, rng?: () => number) => ReturnType<typeof generateShield>;
  generateAndAddClassMod: (level?: number, rng?: () => number) => ReturnType<typeof generateClassMod>;
  generateAndAddRelic: (level?: number, rng?: () => number) => ReturnType<typeof generateRelic>;
  generateAndAddOrdnance: (level?: number, rng?: () => number) => ReturnType<typeof generateOrdnance>;
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
    const item = get().items.find((i) => i.id === id);
    if (!item) return { scrapValue: 0, materials: {}, essences: {} };
    let scrapValue = 10;
    if ('rarity' in item) {
      const rarityMulti = item.rarity === 'Common' ? 1 : item.rarity === 'Uncommon' ? 1.5 : item.rarity === 'Rare' ? 2.5 : item.rarity === 'Epic' ? 4 : 8;
      scrapValue = Math.round((10 + (item.level || 1) * 5) * rarityMulti * (((item as unknown as { rollQuality?: number }).rollQuality ?? 100) / 100));
    }
    const salvage = calculateSalvageYield(item);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
    return { scrapValue, materials: { ScrapAlloy: salvage.scrapAlloy, BallisticParts: salvage.ballisticParts, ReactiveComponents: salvage.reactiveComponents, TechFragments: salvage.techFragments, VoidDust: salvage.voidDust }, essences: salvage.essences };
  },

  lockItem: (id) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, isLocked: true } : i)),
    })),

  unlockItem: (id) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, isLocked: false } : i)),
    })),

  generateAndAdd: (opts, rng) => {
    const weapon = generateWeapon(opts, rng);
    set((s) => ({ items: [weapon, ...s.items] }));
    return weapon;
  },

  generateAndAddShield: (level = 1, rng) => {
    const shield = generateShield(level, rng);
    set((s) => ({ items: [shield, ...s.items] }));
    return shield;
  },

  generateAndAddClassMod: (level = 1, rng) => {
    const mod = generateClassMod(level, rng);
    set((s) => ({ items: [mod, ...s.items] }));
    return mod;
  },

  generateAndAddRelic: (level = 1, rng) => {
    const relic = generateRelic(level, rng);
    set((s) => ({ items: [relic, ...s.items] }));
    return relic;
  },

  generateAndAddOrdnance: (level = 1, rng) => {
    const ordnance = generateOrdnance(level, rng);
    set((s) => ({ items: [ordnance, ...s.items] }));
    return ordnance;
  },

  receiveServerItems: (items) => set({ items }),

  getWeapons: () => get().items.filter((i) => 'weaponType' in i) as Weapon[],
  getById: (id) => get().items.find((i) => i.id === id),
}));
