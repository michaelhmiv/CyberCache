/**
 * Salvage feed store — lightweight event bus for salvage result toasts.
 * Salvage call sites push events here; the SalvageToast component reads them.
 *
 * Two event kinds: 'item' (one item scrapped through the per-item op)
 * and 'batch' (ONE summary for a whole ceiling settlement, 0055).
 * Batch salvage pushes exactly one 'batch' event no matter how many
 * items it settled — per-item events for a batch are suppressed at
 * the source, never generated.
 */
import { create } from 'zustand';
import type { SalvageYield } from '@/lib/gear/salvageAward';
import type { GearItem } from '@/types/items';

export interface SalvageFeedEvent {
  id: string;
  kind: 'item';
  item: GearItem;
  yield: SalvageYield;
  timestamp: number;
}

/** Aggregate yields of one batch settlement (the server's totals). */
export interface SalvageBatchSummary {
  maxRarity: string;
  totalItems: number;
  countsByRarity: Record<string, number>;
  scrap: number;
  cores: number;
  bonusMaterials: Record<string, number>;
}

export interface SalvageBatchFeedEvent {
  id: string;
  kind: 'batch';
  summary: SalvageBatchSummary;
  timestamp: number;
}

export type SalvageFeedEntry = SalvageFeedEvent | SalvageBatchFeedEvent;

interface SalvageFeedState {
  events: SalvageFeedEntry[];
  push: (item: GearItem, salvageYield: SalvageYield) => void;
  pushBatch: (summary: SalvageBatchSummary) => void;
  dismiss: (id: string) => void;
}

let nextId = 0;

export const useSalvageFeedStore = create<SalvageFeedState>((set) => ({
  events: [],
  push: (item, salvageYield) => {
    const id = `salvage-${++nextId}-${Date.now()}`;
    set((s) => ({
      events: [{ id, kind: 'item' as const, item, yield: salvageYield, timestamp: Date.now() }, ...s.events].slice(0, 5),
    }));
  },
  pushBatch: (summary) => {
    const id = `salvage-batch-${++nextId}-${Date.now()}`;
    set((s) => ({
      events: [{ id, kind: 'batch' as const, summary, timestamp: Date.now() }, ...s.events].slice(0, 5),
    }));
  },
  dismiss: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
}));
