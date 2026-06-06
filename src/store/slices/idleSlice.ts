import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface IdleState {
  isFarming: boolean;
  farmTickCount: number;
  autoSalvageRarity: string;
  autoSalvageQuality: number;
  autoSalvageToMaterials: boolean;
  setFarming: (v: boolean) => void;
  tick: () => void;
  setAutoSalvage: (rarity: string, quality: number) => void;
  setAutoSalvageToMaterials: (v: boolean) => void;
}

export const useIdleStore = create<IdleState>()(
  persist(
    (set) => ({
      isFarming: true,
      farmTickCount: 0,
      autoSalvageRarity: 'Common',
      autoSalvageQuality: 20,
      autoSalvageToMaterials: false,
      setFarming: (v) => set({ isFarming: v }),
      tick: () => set((s) => ({ farmTickCount: s.farmTickCount + 1 })),
      setAutoSalvage: (rarity, quality) => set({ autoSalvageRarity: rarity, autoSalvageQuality: quality }),
      setAutoSalvageToMaterials: (v) => set({ autoSalvageToMaterials: v }),
    }),
    {
      name: 'cc-idle',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
