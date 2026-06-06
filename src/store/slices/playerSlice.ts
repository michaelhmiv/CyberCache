import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { PlayerProfile } from '../../types/player';

export interface PlayerState extends PlayerProfile {
  setPlayer: (partial: Partial<PlayerProfile>) => void;
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
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
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

      setPlayer: (partial) => set((state) => ({ ...state, ...partial })),
      addXP: (amount) => {
        const state = get();
        let newXP = state.xp + amount;
        let newLevel = state.level;
        while (newXP >= newLevel * 100) {
          newXP -= newLevel * 100;
          newLevel++;
        }
        set({ xp: newXP, level: newLevel });
      },
      addCredits: (amount) => set((s) => ({ credits: s.credits + amount })),
      removeCredits: (amount) => set((s) => ({ credits: Math.max(0, s.credits - amount) })),
      addScrap: (amount) => set((s) => ({ scrap: s.scrap + amount })),
      removeScrap: (amount) => set((s) => ({ scrap: Math.max(0, s.scrap - amount) })),
      addCacheKeys: (amount) => set((s) => ({ cacheKeys: s.cacheKeys + amount })),
      removeCacheKeys: (amount) => set((s) => ({ cacheKeys: Math.max(0, s.cacheKeys - amount) })),
      addCacheKeyFragments: (amount) => set((s) => {
        let newFrags = s.cacheKeyFragments + amount;
        let newKeys = s.cacheKeys;
        while (newFrags >= 5) {
          newFrags -= 5;
          newKeys += 1;
        }
        return { cacheKeyFragments: newFrags, cacheKeys: newKeys };
      }),
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
    }),
    {
      name: 'cc-player',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
