import { create } from 'zustand';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';

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
  startCleanup: (intervalMs = 1000) => {
    const handle = window.setInterval(() => get().pruneExpired(Date.now()), intervalMs);
    return () => window.clearInterval(handle);
  },
}));
