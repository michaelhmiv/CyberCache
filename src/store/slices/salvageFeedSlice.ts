/**
 * Salvage feed store — lightweight event bus for salvage result toasts.
 * Salgvage call sites push events here; the SalvageToast component reads them.
 */
import { create } from 'zustand';
import type { SalvageYield } from '@/constants/salvageRules';
import type { GearItem } from '@/types/items';

export interface SalvageFeedEvent {
  id: string;
  item: GearItem;
  yield: SalvageYield;
  timestamp: number;
}

interface SalvageFeedState {
  events: SalvageFeedEvent[];
  push: (item: GearItem, salvageYield: SalvageYield) => void;
  dismiss: (id: string) => void;
}

let nextId = 0;

export const useSalvageFeedStore = create<SalvageFeedState>((set) => ({
  events: [],
  push: (item, salvageYield) => {
    const id = `salvage-${++nextId}-${Date.now()}`;
    set((s) => ({
      events: [{ id, item, yield: salvageYield, timestamp: Date.now() }, ...s.events].slice(0, 5),
    }));
  },
  dismiss: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
}));
