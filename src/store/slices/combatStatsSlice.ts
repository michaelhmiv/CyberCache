import { create } from 'zustand';
import { Element, WeaponType } from '@/types/game';

export type KillContext = {
  areaId?: string;
  weaponType?: WeaponType;
  element?: Element;
  bossId?: string;
  /** Allows the tick to report multiple kills in a single update (offline catchup). */
  count?: number;
};

export interface CombatStatsState {
  totalKills: number;
  totalDeaths: number;
  longestKillStreak: number;
  currentKillStreak: number;
  lastKillAt: number | null;
  killsByArea: Record<string, number>;
  killsByWeaponType: Partial<Record<WeaponType, number>>;
  killsByBoss: Record<string, number>;
  killsByElement: Partial<Record<Element, number>>;
  highestBossTier: number;

  recordKill: (context: KillContext) => void;
  recordDeath: (context: { bossId?: string }) => void;
  resetStreak: () => void;
  /** Used by the runtime snapshot to overwrite state on hydrate. */
  setAll: (snapshot: Partial<CombatStatsState>) => void;
}

const emptyState = (): Omit<CombatStatsState, 'recordKill' | 'recordDeath' | 'resetStreak' | 'setAll'> => ({
  totalKills: 0,
  totalDeaths: 0,
  longestKillStreak: 0,
  currentKillStreak: 0,
  lastKillAt: null,
  killsByArea: {},
  killsByWeaponType: {},
  killsByBoss: {},
  killsByElement: {},
  highestBossTier: 0,
});

export const useCombatStatsStore = create<CombatStatsState>()((set) => ({
  ...emptyState(),
  recordKill: (context) => set((state) => {
    const count = Math.max(1, context.count ?? 1);
    const killsByArea = { ...state.killsByArea };
    if (context.areaId) killsByArea[context.areaId] = (killsByArea[context.areaId] ?? 0) + count;
    const killsByWeaponType = { ...state.killsByWeaponType };
    if (context.weaponType) killsByWeaponType[context.weaponType] = (killsByWeaponType[context.weaponType] ?? 0) + count;
    const killsByBoss = { ...state.killsByBoss };
    if (context.bossId) killsByBoss[context.bossId] = (killsByBoss[context.bossId] ?? 0) + count;
    const killsByElement = { ...state.killsByElement };
    if (context.element) killsByElement[context.element] = (killsByElement[context.element] ?? 0) + count;
    const newStreak = state.currentKillStreak + count;
    return {
      totalKills: state.totalKills + count,
      currentKillStreak: newStreak,
      longestKillStreak: Math.max(state.longestKillStreak, newStreak),
      lastKillAt: Date.now(),
      killsByArea,
      killsByWeaponType,
      killsByBoss,
      killsByElement,
    };
  }),
  recordDeath: (context) => set((state) => {
    const killsByBoss = { ...state.killsByBoss };
    if (context.bossId) killsByBoss[context.bossId] = killsByBoss[context.bossId] ?? 0;
    return {
      totalDeaths: state.totalDeaths + 1,
      currentKillStreak: 0,
      killsByBoss,
    };
  }),
  resetStreak: () => set({ currentKillStreak: 0 }),
  setAll: (snapshot) => set((state) => ({ ...state, ...snapshot })),
}));
