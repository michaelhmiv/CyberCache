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
  /** Unix ms when the current idle run started; null = not currently running. */
  runStartedAt: number | null;
  killsByArea: Record<string, number>;
  killsByWeaponType: Partial<Record<WeaponType, number>>;
  killsByBoss: Record<string, number>;
  killsByElement: Partial<Record<Element, number>>;
  highestBossTier: number;
  /** Total seconds the player has spent actively playing (not idle-roaming). */
  activePlaySeconds: number;
  /** Total seconds the player has spent idle-roaming. */
  idlePlaySeconds: number;

  recordKill: (context: KillContext) => void;
  recordDeath: (context: { bossId?: string }) => void;
  resetStreak: () => void;
  startRun: () => void;
  endRun: () => void;
  /** Add idle/active playtime seconds (called on heartbeat). */
  addPlaytime: (seconds: number, kind: 'idle' | 'active') => void;
  /** Used by the runtime snapshot to overwrite state on hydrate. */
  setAll: (snapshot: Partial<CombatStatsState>) => void;
}

const emptyState = (): Omit<CombatStatsState, 'recordKill' | 'recordDeath' | 'resetStreak' | 'setAll' | 'startRun' | 'endRun' | 'addPlaytime'> => ({
  totalKills: 0,
  totalDeaths: 0,
  longestKillStreak: 0,
  currentKillStreak: 0,
  lastKillAt: null,
  runStartedAt: null,
  killsByArea: {},
  killsByWeaponType: {},
  killsByBoss: {},
  killsByElement: {},
  highestBossTier: 0,
  activePlaySeconds: 0,
  idlePlaySeconds: 0,
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
  startRun: () => set({ runStartedAt: Date.now() }),
  endRun: () => set({ runStartedAt: null }),
  addPlaytime: (seconds, kind) => set((state) => kind === 'idle'
    ? { idlePlaySeconds: state.idlePlaySeconds + seconds }
    : { activePlaySeconds: state.activePlaySeconds + seconds }),
  setAll: (snapshot) => set((state) => ({ ...state, ...snapshot })),
}));

/**
 * Computed selectors. These are not part of the state but live in the
 * slice module so consumers (Dashboard "kills/min", ProfileScreen
 * "Playtime Breakdown") can read derived values without recomputing
 * them on every render.
 */
export const combatStatsSelectors = {
  /** Kills per minute over the last 60 seconds. Replaces the old 0.75 fudge factor. */
  killsPerMinuteLastHour: (state: Pick<CombatStatsState, 'lastKillAt' | 'totalKills'>): number => {
    if (!state.lastKillAt) return 0;
    const elapsed = (Date.now() - state.lastKillAt) / 60_000;
    if (elapsed > 60) return 0; // No kills in the last hour
    return state.totalKills > 0 ? Math.round(60 / Math.max(elapsed, 1)) : 0;
  },
  /** Average kills per minute across the player's entire history. */
  averageKillsPerMinute: (state: Pick<CombatStatsState, 'totalKills' | 'idlePlaySeconds' | 'activePlaySeconds'>): number => {
    const totalMinutes = (state.idlePlaySeconds + state.activePlaySeconds) / 60;
    if (totalMinutes < 1) return 0;
    return Math.round((state.totalKills / totalMinutes) * 10) / 10;
  },
  /** Top 3 areas by kill count, sorted desc. */
  topAreas: (state: Pick<CombatStatsState, 'killsByArea'>): Array<{ areaId: string; kills: number }> => {
    return Object.entries(state.killsByArea)
      .map(([areaId, kills]) => ({ areaId, kills }))
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 3);
  },
  /** Most-used weapon type (the "build identity" stat for ProfileScreen). */
  dominantWeaponType: (state: Pick<CombatStatsState, 'killsByWeaponType'>): WeaponType | null => {
    const entries = Object.entries(state.killsByWeaponType) as Array<[WeaponType, number]>;
    if (entries.length === 0) return null;
    return entries.sort(([, a], [, b]) => b - a)[0][0];
  },
};
