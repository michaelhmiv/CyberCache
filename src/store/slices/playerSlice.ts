import { create } from 'zustand';
import { PlayerProfile } from '../../types/player';
import { WorkshopQueue } from '../../types/workshop';
import { XP_CURVE_FORMULA } from '@/content/simulation';

export interface PlayerState extends PlayerProfile {
  setPlayer: (partial: Partial<PlayerProfile>) => void;
  /** Sync canonical values from the server. Merges pending local deltas on top. */
  syncFromServer: (server: Partial<PlayerProfile>) => void;
  addXP: (amount: number) => void;
  addCredits: (amount: number) => void;
  removeCredits: (amount: number) => void;
  addScrap: (amount: number) => void;
  removeScrap: (amount: number) => void;
  addCacheKeys: (amount: number) => void;
  removeCacheKeys: (amount: number) => void;
  addCacheKeyFragments: (amount: number) => void;
  addConsumable: (type: string, count: number) => void;
  removeConsumable: (type: string, count: number) => void;
  getConsumableCount: (type: string) => number;
  addMaterial: (type: string, count: number) => void;
  removeMaterial: (type: string, count: number) => void;
  addEssence: (type: string, count: number) => void;
  removeEssence: (type: string, count: number) => void;
  setWorkshopQueues: (queues: WorkshopQueue[]) => void;
  setLastWorkshopTick: (timestamp: number) => void;
  /** Pending local deltas not yet confirmed by the server. */
  _pending: { xp: number; credits: number; scrap: number; materials: Record<string, number>; essences: Record<string, number> };
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
  currentZoneId: 'dustwaste_1',
  highestZoneId: 'dustwaste_1',
  offlineCapHours: 2,
  lastClaimTime: Date.now(),
  deathFeeInsurance: false,
  consumables: {},
  materials: {},
  essences: {},
  workshopQueues: [],
  lastWorkshopTick: Date.now(),
  lastClaimedTick: 0,
});

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  ...initialPlayerState(),
  _pending: { xp: 0, credits: 0, scrap: 0, materials: {}, essences: {} },

  /** Apply server-canonical values, then add pending local deltas on top. */
  syncFromServer: (server) => set((state) => {
    const p = state._pending;
    let xp = (typeof server.xp === 'number' ? server.xp : state.xp) + p.xp;
    let level = typeof server.level === 'number' ? server.level : state.level;
    while (xp >= XP_CURVE_FORMULA(level)) { xp -= XP_CURVE_FORMULA(level); level += 1; }
    const credits = (typeof server.credits === 'number' ? server.credits : state.credits) + p.credits;
    const scrap = (typeof server.scrap === 'number' ? server.scrap : state.scrap) + p.scrap;
    const serverMats = (server.materials && typeof server.materials === 'object' ? server.materials : {}) as Record<string, number>;
    const serverEss = (server.essences && typeof server.essences === 'object' ? server.essences : {}) as Record<string, number>;
    const materials: Record<string, number> = { ...serverMats };
    for (const [k, v] of Object.entries(p.materials)) materials[k] = (materials[k] || 0) + v;
    const essences: Record<string, number> = { ...serverEss };
    for (const [k, v] of Object.entries(p.essences)) essences[k] = (essences[k] || 0) + v;
    return { ...state, ...server, xp, level, credits, scrap, materials, essences, _pending: { xp: 0, credits: 0, scrap: 0, materials: {}, essences: {} } };
  }),

  setPlayer: (partial) => set((state) => ({ ...state, ...partial })),

  addXP: (amount) => {
    set((s) => ({ _pending: { ...s._pending, xp: s._pending.xp + amount }, xp: s.xp + amount }));
    const state = get();
    let newXP = state.xp;
    let newLevel = state.level;
    while (newXP >= XP_CURVE_FORMULA(newLevel)) {
      newXP -= XP_CURVE_FORMULA(newLevel);
      newLevel += 1;
    }
    if (newLevel !== state.level) set({ xp: newXP, level: newLevel });
  },
  addCredits: (amount) => set((s) => ({ _pending: { ...s._pending, credits: s._pending.credits + amount }, credits: s.credits + amount })),
  removeCredits: (amount) => set((s) => ({ credits: Math.max(0, s.credits - amount) })),
  addScrap: (amount) => set((s) => ({ _pending: { ...s._pending, scrap: s._pending.scrap + amount }, scrap: s.scrap + amount })),
  removeScrap: (amount) => set((s) => ({ scrap: Math.max(0, s.scrap - amount) })),
  addCacheKeys: (amount) => set((s) => ({ cacheKeys: s.cacheKeys + amount })),
  removeCacheKeys: (amount) => set((s) => ({ cacheKeys: Math.max(0, s.cacheKeys - amount) })),
  addCacheKeyFragments: (_amount) => {
    // Cache keys/fragments are enforced by the verified `profiles.cache_tokens` fields.
    // Frontend-only fragment minting creates phantom keys that `cc_make_item` correctly rejects.
  },
  addConsumable: (type, count) =>
    set((s) => ({
      consumables: { ...s.consumables, [type]: (s.consumables[type] || 0) + count },
    })),
  removeConsumable: (type, count) =>
    set((s) => ({
      consumables: { ...s.consumables, [type]: Math.max(0, (s.consumables[type] || 0) - count) },
    })),
  getConsumableCount: (type) => {
    const s = get();
    return s.consumables[type] || 0;
  },
  addMaterial: (type, count) =>
    set((s) => ({
      _pending: { ...s._pending, materials: { ...s._pending.materials, [type]: (s._pending.materials[type] || 0) + count } },
      materials: { ...s.materials, [type]: (s.materials[type] || 0) + count },
    })),
  removeMaterial: (type, count) =>
    set((s) => ({
      materials: { ...s.materials, [type]: Math.max(0, (s.materials[type] || 0) - count) },
    })),
  addEssence: (type, count) =>
    set((s) => ({
      _pending: { ...s._pending, essences: { ...s._pending.essences, [type]: (s._pending.essences[type] || 0) + count } },
      essences: { ...s.essences, [type]: (s.essences[type] || 0) + count },
    })),
  removeEssence: (type, count) =>
    set((s) => ({
      essences: { ...s.essences, [type]: Math.max(0, (s.essences[type] || 0) - count) },
    })),
  setWorkshopQueues: (queues) => set({ workshopQueues: queues }),
  setLastWorkshopTick: (timestamp) => set({ lastWorkshopTick: timestamp }),
}));
