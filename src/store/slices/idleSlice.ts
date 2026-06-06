import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface IdleState {
  isFarming: boolean;
  farmTickCount: number;
  autoSalvageRarity: string;
  autoSalvageQuality: number;
  setFarming: (v: boolean) => void;
  tick: () => void;
  setAutoSalvage: (rarity: string, quality: number) => void;
}

export const useIdleStore = create<IdleState>()(
  persist(
    (set) => ({
      isFarming: true,
      farmTickCount: 0,
      autoSalvageRarity: 'Common',
      autoSalvageQuality: 20,
      setFarming: (v) => set({ isFarming: v }),
      tick: () => set((s) => ({ farmTickCount: s.farmTickCount + 1 })),
      setAutoSalvage: (rarity, quality) => set({ autoSalvageRarity: rarity, autoSalvageQuality: quality }),
    }),
    {
      name: 'cc-idle',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
