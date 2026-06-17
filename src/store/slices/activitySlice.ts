import { create } from 'zustand';
import type { ActiveActivity, StartActivityInput } from '@/types/activity';
import { IDLE_ACTIVITY } from '@/types/activity';
import { migrateActivityForBossCollapse } from '@/lib/activity/activityMigration';
import {
  clearActiveActivity,
  getMyActiveActivity,
  heartbeatActiveActivity,
  startActiveActivity,
} from '@/lib/supabase/activityService';

export interface ActivityState {
  current: ActiveActivity;
  hydrated: boolean;
  pending: boolean;
  error: string | null;
  setCurrent: (activity: ActiveActivity) => void;
  reset: () => void;
  hydrate: () => Promise<ActiveActivity>;
  start: (input: StartActivityInput) => Promise<ActiveActivity>;
  clear: () => Promise<ActiveActivity>;
  heartbeat: () => Promise<ActiveActivity>;
}

const toMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Activity request failed.'
);

export const useActivityStore = create<ActivityState>()((set) => ({
  current: IDLE_ACTIVITY,
  hydrated: false,
  pending: false,
  error: null,

  setCurrent: (activity) => set({ current: migrateActivityForBossCollapse(activity) as ActiveActivity, hydrated: true, error: null }),

  reset: () => set({ current: IDLE_ACTIVITY, hydrated: false, pending: false, error: null }),

  hydrate: async () => {
    set({ pending: true, error: null });
    try {
      const activity = await getMyActiveActivity();
      set({ current: migrateActivityForBossCollapse(activity) as ActiveActivity, hydrated: true, pending: false, error: null });
      return activity;
    } catch (error) {
      set({ pending: false, hydrated: true, error: toMessage(error) });
      throw error;
    }
  },

  start: async (input) => {
    set({ pending: true, error: null });
    try {
      const activity = await startActiveActivity(input);
      set({ current: migrateActivityForBossCollapse(activity) as ActiveActivity, hydrated: true, pending: false, error: null });
      return activity;
    } catch (error) {
      set({ pending: false, error: toMessage(error) });
      throw error;
    }
  },

  clear: async () => {
    set({ pending: true, error: null });
    try {
      const activity = await clearActiveActivity();
      set({ current: migrateActivityForBossCollapse(activity) as ActiveActivity, hydrated: true, pending: false, error: null });
      return activity;
    } catch (error) {
      set({ pending: false, error: toMessage(error) });
      throw error;
    }
  },

  heartbeat: async () => {
    try {
      const activity = await heartbeatActiveActivity();
      set({ current: migrateActivityForBossCollapse(activity) as ActiveActivity, hydrated: true, error: null });
      return activity;
    } catch (error) {
      set({ error: toMessage(error) });
      throw error;
    }
  },
}));
