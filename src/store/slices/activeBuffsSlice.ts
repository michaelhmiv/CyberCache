import { create } from 'zustand';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';
import { ConsumableType } from '@/types/game';
import { CONSUMABLES } from '@/constants/consumables';

export interface ServerActiveBuff {
  consumableId: string;
  slot: string;
  remainingMs: number;
  remainingBuffer?: number;
  remainingTicks?: number;
  armed?: boolean;
  remainingBurstSeconds?: number;
  ordnanceNextFireSeconds?: number;
}

export interface ActiveBuffsState {
  buffs: ActiveBuff[];
  add: (buff: ActiveBuff) => void;
  upsert: (buff: ActiveBuff) => void;
  remove: (id: string) => void;
  clear: () => void;
  pruneExpired: (now?: number) => void;
  getVisible: (now?: number) => ActiveBuff[];
  getActive: (now?: number) => ActiveBuff[];
  getArmed: (now?: number) => ActiveBuff[];
  getRecent: (now?: number) => ActiveBuff[];
  /** Replace roaming buffs with server-authoritative data from Chef. */
  syncRoamingFromServer: (serverBuffs: ServerActiveBuff[]) => void;
  startCleanup: (intervalMs?: number) => () => void;
}

const isVisible = (buff: ActiveBuff, now: number): boolean => buff.expiresAt > now;
const byState = (state: ActiveBuff['displayState'], now: number) => (buff: ActiveBuff): boolean =>
  buff.displayState === state && isVisible(buff, now);

export const useActiveBuffsStore = create<ActiveBuffsState>()((set, get) => ({
  buffs: [],
  add: (buff) => set((state) => ({ buffs: [...state.buffs.filter((candidate) => candidate.id !== buff.id), buff] })),
  upsert: (buff) => set((state) => ({
    buffs: state.buffs.some((candidate) => candidate.id === buff.id)
      ? state.buffs.map((candidate) => candidate.id === buff.id ? buff : candidate)
      : [...state.buffs, buff],
  })),
  remove: (id) => set((state) => ({ buffs: state.buffs.filter((buff) => buff.id !== id) })),
  clear: () => set({ buffs: [] }),
  pruneExpired: (now = Date.now()) => set((state) => ({ buffs: state.buffs.filter((buff) => isVisible(buff, now)) })),
  getVisible: (now = Date.now()) => get().buffs.filter((buff) => isVisible(buff, now)),
  getActive: (now = Date.now()) => get().buffs.filter(byState('active', now)),
  getArmed: (now = Date.now()) => get().buffs.filter(byState('armed', now)),
  getRecent: (now = Date.now()) => get().buffs.filter(byState('recent', now)),

  syncRoamingFromServer: (serverBuffs) => set((state) => {
    const now = Date.now();
    // Remove old roaming-sourced buffs, keep boss/activity buffs
    const nonRoaming = state.buffs.filter((b) => b.source !== 'roaming-coverage');
    const roaming: ActiveBuff[] = serverBuffs.map((sb) => {
      const def = CONSUMABLES[sb.consumableId as ConsumableType];
      const isArmed = sb.armed === true;
      const isBuffer = sb.remainingBuffer !== undefined;
      const isInstant = sb.remainingMs <= 0 && !isBuffer && !isArmed && sb.remainingTicks === undefined;
      return {
        id: `roaming:${sb.consumableId}:${sb.slot}`,
        consumableId: sb.consumableId as ConsumableType,
        family: def?.family ?? 'economy',
        source: 'roaming-coverage' as const,
        sourceId: sb.slot,
        startedAt: now,
        expiresAt: isArmed || isBuffer ? now + 60_000 : now + sb.remainingMs,
        durationMs: isArmed || isBuffer ? 60_000 : sb.remainingMs,
        displayState: isArmed ? 'armed' as const : isInstant ? 'recent' as const : 'active' as const,
        value: sb.remainingBuffer ?? sb.remainingTicks ?? sb.ordnanceNextFireSeconds,
      };
    });
    return { buffs: [...nonRoaming, ...roaming] };
  }),

  startCleanup: (intervalMs = 1000) => {
    const handle = window.setInterval(() => get().pruneExpired(Date.now()), intervalMs);
    return () => window.clearInterval(handle);
  },
}));
