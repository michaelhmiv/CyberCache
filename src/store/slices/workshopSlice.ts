import { create } from 'zustand';
import { WorkshopQueue } from '../../types/workshop';

export interface WorkshopState {
  unlockedBenchCount: number;
  activeQueues: WorkshopQueue[];
  unlockBench: () => void;
  addQueue: (queue: WorkshopQueue) => void;
  removeQueue: (queueId: string) => void;
  claimQueue: (queueId: string) => WorkshopQueue | null;
  getCompletedCount: (queueId: string) => number;
}

export const useWorkshopStore = create<WorkshopState>()((set, get) => ({
  unlockedBenchCount: 1,
  activeQueues: [],

  unlockBench: () =>
    set((s) => ({
      unlockedBenchCount: Math.min(3, s.unlockedBenchCount + 1),
    })),

  addQueue: (queue) =>
    set((s) => ({
      activeQueues: [...s.activeQueues, queue],
    })),

  removeQueue: (queueId) =>
    set((s) => ({
      activeQueues: s.activeQueues.filter((q) => q.id !== queueId),
    })),

  claimQueue: (queueId) => {
    const queue = get().activeQueues.find((q) => q.id === queueId);
    if (!queue) return null;
    const elapsed = Date.now() - queue.startedAt;
    const completedCount = Math.min(queue.count, Math.floor(elapsed / queue.durationMs));
    const newClaimed = Math.min(completedCount, queue.count);
    if (newClaimed <= queue.claimedCount) return null;

    const updated = { ...queue, claimedCount: newClaimed };
    if (updated.claimedCount >= updated.count) {
      set((s) => ({
        activeQueues: s.activeQueues.filter((q) => q.id !== queueId),
      }));
    } else {
      set((s) => ({
        activeQueues: s.activeQueues.map((q) => (q.id === queueId ? updated : q)),
      }));
    }
    return updated;
  },

  getCompletedCount: (queueId) => {
    const queue = get().activeQueues.find((q) => q.id === queueId);
    if (!queue) return 0;
    const elapsed = Date.now() - queue.startedAt;
    const completed = Math.min(queue.count, Math.floor(elapsed / queue.durationMs));
    return completed - queue.claimedCount;
  },
}));
