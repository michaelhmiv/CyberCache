import { create } from 'zustand';
import { BossAttemptResult } from '../../types/boss';
import { RiskSetting } from '../../types/game';

export interface BossState {
  currentBossId: string | null;
  unlockedBossIds: string[];
  defeatedBossIds: string[];
  pityCounters: Record<string, number>;
  attemptHistory: BossAttemptResult[];
  preparedConsumables: Record<string, number>;
  selectedRisk: RiskSetting;
  setCurrentBoss: (id: string | null) => void;
  unlockBoss: (id: string) => void;
  defeatBoss: (id: string) => void;
  incrementPity: (id: string) => void;
  resetPity: (id: string) => void;
  addAttempt: (result: BossAttemptResult) => void;
  setConsumablePrep: (type: string, count: number) => void;
  setRisk: (risk: RiskSetting) => void;
  clearPrep: () => void;
}

export const useBossStore = create<BossState>()((set) => ({
  currentBossId: null,
  unlockedBossIds: ['dune_tyrant'],
  defeatedBossIds: [],
  pityCounters: {},
  attemptHistory: [],
  preparedConsumables: {},
  selectedRisk: RiskSetting.Balanced,

  setCurrentBoss: (id) => set({ currentBossId: id }),
  unlockBoss: (id) =>
    set((s) => ({
      unlockedBossIds: s.unlockedBossIds.includes(id) ? s.unlockedBossIds : [...s.unlockedBossIds, id],
    })),
  defeatBoss: (id) =>
    set((s) => ({
      defeatedBossIds: s.defeatedBossIds.includes(id) ? s.defeatedBossIds : [...s.defeatedBossIds, id],
    })),
  incrementPity: (id) =>
    set((s) => ({
      pityCounters: { ...s.pityCounters, [id]: (s.pityCounters[id] || 0) + 1 },
    })),
  resetPity: (id) =>
    set((s) => ({
      pityCounters: { ...s.pityCounters, [id]: 0 },
    })),
  addAttempt: (result) =>
    set((s) => ({
      attemptHistory: [result, ...s.attemptHistory].slice(0, 100),
    })),
  setConsumablePrep: (type, count) =>
    set((s) => ({
      preparedConsumables: { ...s.preparedConsumables, [type]: count },
    })),
  setRisk: (risk) => set({ selectedRisk: risk }),
  clearPrep: () => set({ preparedConsumables: {}, selectedRisk: RiskSetting.Balanced }),
}));
