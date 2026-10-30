import { create } from 'zustand';
import { BossAttemptResult } from '../../types/boss';
import { RiskSetting } from '../../types/game';

export type BossFightStatus = 'idle' | 'active' | 'victory' | 'defeat';

export interface BossFightState {
  /** Boss currently being fought live (in the ticker). null when idle. */
  activeBossId: string | null;
  /** Boss's current HP during the live fight. */
  activeBossHp: number;
  /** Boss's starting HP at fight start (for the HP bar denominator). */
  activeBossMaxHp: number;
  /** 'idle' = no fight, 'active' = ticker driving, 'victory'/'defeat' = ended. */
  activeStatus: BossFightStatus;
  /** Total medkits auto-consumed during the current fight. */
  activeMedkitsConsumed: number;
  /** Total damage dealt to the boss so far. */
  activeDamageDealt: number;
  /** Tick count of the current fight. */
  activeTickCount: number;
  /** Wall-clock ms when the fight started. */
  activeStartedAt: number;
}

export interface BossState extends BossFightState {
  currentBossId: string | null;
  unlockedBossIds: string[];
  defeatedBossIds: string[];
  /**
   * Victories per boss on the current UTC day, server-reported (profile
   * read + verify-boss responses). Drives the prep panel's escalated
   * rematch-fee display only — the Chef re-derives and charges the fee
   * from the ledger on every attempt.
   */
  bossVictoriesToday: Record<string, number>;
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
  // PR 6 — live fight mutations
  startLiveFight: (bossId: string, maxHp: number) => void;
  applyLiveTick: (patch: { bossHp: number; medkitsConsumed: number; damageDealt: number }) => void;
  endLiveFight: (status: 'victory' | 'defeat') => void;
  clearLiveFight: () => void;
}

const initialFight: BossFightState = {
  activeBossId: null,
  activeBossHp: 0,
  activeBossMaxHp: 0,
  activeStatus: 'idle',
  activeMedkitsConsumed: 0,
  activeDamageDealt: 0,
  activeTickCount: 0,
  activeStartedAt: 0,
};

export const useBossStore = create<BossState>()((set) => ({
  ...initialFight,
  currentBossId: null,
  unlockedBossIds: ['dune_tyrant'],
  defeatedBossIds: [],
  bossVictoriesToday: {},
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

  // PR 6 — live fight mutations
  startLiveFight: (bossId, maxHp) =>
    set({
      activeBossId: bossId,
      activeBossHp: maxHp,
      activeBossMaxHp: maxHp,
      activeStatus: 'active',
      activeMedkitsConsumed: 0,
      activeDamageDealt: 0,
      activeTickCount: 0,
      activeStartedAt: Date.now(),
    }),
  applyLiveTick: (patch) =>
    set((s) => ({
      activeBossHp: patch.bossHp,
      activeMedkitsConsumed: s.activeMedkitsConsumed + patch.medkitsConsumed,
      activeDamageDealt: s.activeDamageDealt + patch.damageDealt,
      activeTickCount: s.activeTickCount + 1,
    })),
  endLiveFight: (status) => set({ activeStatus: status }),
  clearLiveFight: () => set({ ...initialFight }),
}));
