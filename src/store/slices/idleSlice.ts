import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_ROAMING_AREA_ID } from '../../constants/roamingAreas';

interface IdleState {
  isFarming: boolean;
  farmTickCount: number;
  autoSalvageRarity: string;
  autoSalvageQuality: number;
  autoSalvageToMaterials: boolean;
  selectedRoamingAreaId: string;
  setFarming: (v: boolean) => void;
  tick: () => void;
  setAutoSalvage: (rarity: string, quality: number) => void;
  setAutoSalvageToMaterials: (v: boolean) => void;
  setSelectedRoamingArea: (areaId: string) => void;
}

export const useIdleStore = create<IdleState>()(
  persist(
    (set) => ({
      isFarming: true,
      farmTickCount: 0,
      autoSalvageRarity: 'Common',
      autoSalvageQuality: 20,
      autoSalvageToMaterials: false,
      selectedRoamingAreaId: DEFAULT_ROAMING_AREA_ID,
      setFarming: (v) => set({ isFarming: v }),
      tick: () => set((s) => ({ farmTickCount: s.farmTickCount + 1 })),
      setAutoSalvage: (rarity, quality) => set({ autoSalvageRarity: rarity, autoSalvageQuality: quality }),
      setAutoSalvageToMaterials: (v) => set({ autoSalvageToMaterials: v }),
      setSelectedRoamingArea: (areaId) => set({ selectedRoamingAreaId: areaId }),
    }),
    {
      name: 'cc-idle',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
