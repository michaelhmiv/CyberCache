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
      currentZoneId: 'dustwaste_1',
      highestZoneId: 'dustwaste_1',
      offlineCapHours: 2,
      lastClaimTime: Date.now(),
      deathFeeInsurance: false,

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
    }),
    {
      name: 'cc-player',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
