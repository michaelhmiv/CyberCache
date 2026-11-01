import { create } from 'zustand';
import { ConsumableBatch, PlayerProfile } from '../../types/player';
import { WorkshopQueue } from '../../types/workshop';

export interface PlayerState extends PlayerProfile {
  /**
   * True once a server profile has actually landed via syncFromServer
   * (audit UX-04). The store's initial values are placeholders
   * (5000cr/500 scrap/3 keys), so surfaces that paint resources must
   * skeleton until this flips — never show numbers the server has
   * not confirmed yet.
   */
  profileLoaded: boolean;
  setPlayer: (partial: Partial<PlayerProfile>) => void;
  /** Sync canonical values from the server. Pure replace — no local deltas merged. */
  syncFromServer: (server: Partial<PlayerProfile>) => void;
  /** Remove credits (e.g. market purchase). Server confirms via RPC. */
  removeCredits: (amount: number) => void;
  /** Remove scrap (e.g. crafting). Server confirms via RPC. */
  removeScrap: (amount: number) => void;
  removeCacheKeys: (amount: number) => void;
  /** Remove a material (e.g. crafting). Server confirms via RPC. */
  removeMaterial: (type: string, count: number) => void;
  /** Add a material (local only — workshop refunds). Server confirms via RPC. */
  addMaterial: (type: string, count: number) => void;
  /** Remove an essence (e.g. crafting). Server confirms via RPC. */
  removeEssence: (type: string, count: number) => void;
  /** Add an essence (local only — workshop refunds). Server confirms via RPC. */
  addEssence: (type: string, count: number) => void;
  /** Remove a consumable (e.g. boss prep). Server confirms via RPC. */
  removeConsumable: (type: string, count: number) => void;
  getConsumableCount: (type: string) => number;
  setConsumableBatches: (batches: ConsumableBatch[]) => void;
  addConsumableBatch: (batch: ConsumableBatch) => void;
  consumeBestConsumableBatch: (type: string, count: number) => void;
  getBestConsumableQuality: (type: string) => number;
  getConsumableBatchesByType: (type: string) => ConsumableBatch[];
  setWorkshopQueues: (queues: WorkshopQueue[]) => void;
  setLastWorkshopTick: (timestamp: number) => void;
}

const initialPlayerState = (): PlayerProfile => ({
  id: 'player_1',
  name: 'Gunrunner',
  level: 1,
  xp: 0,
  credits: 5000,
  scrap: 500,
  cacheKeys: 3,
  cacheKeyFragments: 0,
  legendaryCores: 0,
  cacheRankTokens: 0,
  cacheRankSpends: {},
  currentZoneId: 'dustwaste_1',
  highestZoneId: 'dustwaste_1',
  offlineCapHours: 2,
  lastClaimTime: Date.now(),
  deathFeeInsurance: false,
  consumables: {},
  consumableBatches: [],
  materials: {},
  essences: {},
  workshopQueues: [],
  lastWorkshopTick: Date.now(),
  lastClaimedTick: 0,
  vehicleFuel: 0,
});

function normalizeBatch(raw: ConsumableBatch): ConsumableBatch {
  return {
    ...raw,
    quality_percent: Number(raw.quality_percent) || 100,
    quantity: Math.max(0, Number(raw.quantity) || 0),
  };
}

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  ...initialPlayerState(),
  profileLoaded: false,

  /**
   * Apply server-canonical values. Pure replace — no local deltas,
   * no optimistic merge. The values shown in the UI are exactly what
   * the server returned.
   */
  syncFromServer: (server) => set((state) => {
    const consumableBatches = Array.isArray(server.consumableBatches)
      ? server.consumableBatches.map(normalizeBatch).filter((batch) => batch.quantity > 0)
      : state.consumableBatches;
    return { ...state, ...server, consumableBatches, profileLoaded: true };
  }),

  setPlayer: (partial) => set((state) => ({ ...state, ...partial })),

  // Credits — only the server adds credits via syncFromServer.
  // removeCredits is for optimistic UI on market purchases (server confirms).
  removeCredits: (amount) => set((s) => ({ credits: Math.max(0, s.credits - amount) })),

  removeScrap: (amount) => set((s) => ({ scrap: Math.max(0, s.scrap - amount) })),
  removeCacheKeys: (amount) => set((s) => ({ cacheKeys: Math.max(0, s.cacheKeys - amount) })),

  removeConsumable: (type, count) =>
    set((s) => ({
      consumables: { ...s.consumables, [type]: Math.max(0, (s.consumables[type] || 0) - count) },
    })),

  getConsumableCount: (type) => {
    const s = get();
    return s.consumables[type] || 0;
  },

  setConsumableBatches: (batches) => set({ consumableBatches: batches.map(normalizeBatch).filter((batch) => batch.quantity > 0) }),
  addConsumableBatch: (batch) => set((s) => {
    const normalized = normalizeBatch(batch);
    const existingIndex = s.consumableBatches.findIndex((entry) =>
      entry.consumable_type === normalized.consumable_type &&
      entry.quality_percent === normalized.quality_percent &&
      entry.origin === normalized.origin &&
      (entry.creator_user_id ?? null) === (normalized.creator_user_id ?? null) &&
      (entry.source_recipe_id ?? null) === (normalized.source_recipe_id ?? null)
    );
    if (existingIndex === -1) return { consumableBatches: [normalized, ...s.consumableBatches] };
    return {
      consumableBatches: s.consumableBatches.map((entry, index) => index === existingIndex ? { ...entry, quantity: entry.quantity + normalized.quantity } : entry),
    };
  }),
  consumeBestConsumableBatch: (type, count) => set((s) => {
    let remaining = count;
    const sorted = [...s.consumableBatches].sort((a, b) => {
      if (a.consumable_type !== b.consumable_type) return 0;
      return a.quality_percent - b.quality_percent || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
    });
    const next = sorted.map((batch) => {
      if (remaining <= 0 || batch.consumable_type !== type || batch.quantity <= 0) return batch;
      const consumed = Math.min(remaining, batch.quantity);
      remaining -= consumed;
      return { ...batch, quantity: batch.quantity - consumed };
    }).filter((batch) => batch.quantity > 0);
    return { consumableBatches: next };
  }),
  getBestConsumableQuality: (type) => {
    const batches = get().consumableBatches.filter((batch) => batch.consumable_type === type && batch.quantity > 0);
    if (!batches.length) return 100;
    return Math.max(...batches.map((batch) => batch.quality_percent));
  },
  getConsumableBatchesByType: (type) => get().consumableBatches
    .filter((batch) => batch.consumable_type === type && batch.quantity > 0)
    .sort((a, b) => b.quality_percent - a.quality_percent || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))),

  removeMaterial: (type, count) =>
    set((s) => ({
      materials: { ...s.materials, [type]: Math.max(0, (s.materials[type] || 0) - count) },
    })),
  addMaterial: (type, count) =>
    set((s) => ({
      materials: { ...s.materials, [type]: (s.materials[type] || 0) + count },
    })),

  removeEssence: (type, count) =>
    set((s) => ({
      essences: { ...s.essences, [type]: Math.max(0, (s.essences[type] || 0) - count) },
    })),
  addEssence: (type, count) =>
    set((s) => ({
      essences: { ...s.essences, [type]: (s.essences[type] || 0) + count },
    })),

  setWorkshopQueues: (queues) => set({ workshopQueues: queues }),
  setLastWorkshopTick: (timestamp) => set({ lastWorkshopTick: timestamp }),
}));
