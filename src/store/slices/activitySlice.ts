import { create } from 'zustand';
import type { ActiveActivity, ActivityKind, BossPhase, StartActivityInput } from '@/types/activity';
import { IDLE_ACTIVITY, isProductiveActivity } from '@/types/activity';
import { trackRoamStart, trackRoamStop } from '@/lib/analytics/analytics';
import { migrateActivityForBossCollapse } from '@/lib/activity/activityMigration';
import {
  clearActiveActivity,
  getMyActiveActivity,
  heartbeatActiveActivity,
  startActiveActivity,
} from '@/lib/api/activityService';

export interface ActivityState {
  current: ActiveActivity;
  hydrated: boolean;
  pending: boolean;
  error: string | null;
  /**
   * The last occupation displacement, human-readable (audit H-02) —
   * set when a start() ends a different productive occupation, so
   * the switch is disclosed instead of silent. Null when no
   * displacement is waiting to be read.
   */
  displacementNotice: string | null;
  clearDisplacementNotice: () => void;
  setCurrent: (activity: ActiveActivity) => void;
  setBossPhase: (phase: BossPhase) => void;
  reset: () => void;
  hydrate: () => Promise<ActiveActivity>;
  start: (input: StartActivityInput) => Promise<ActiveActivity>;
  clear: () => Promise<ActiveActivity>;
  heartbeat: () => Promise<ActiveActivity>;
}

/** Short names for the displacement notice (the full labels read as sentences). */
const DISPLACEMENT_NAMES: Partial<Record<ActivityKind, string>> = {
  roaming_loot: 'Roaming',
  boss_fight: 'Boss fight',
  crafting: 'Crafting',
  endless_run: 'Endless run',
  extraction: 'Extraction',
  salvaging: 'Salvaging',
  workshop_service: 'Workshop service',
  market_listing: 'Market listing',
};

/**
 * The displacement notice for a switch, or null when nothing was
 * displaced (no productive previous occupation, or a same-kind
 * restart — a roam changing areas is a new roam, not a lost one).
 * Crafting PAUSES (bench jobs progress only while Crafting holds
 * the slot, and resume when it does again); everything else ends.
 */
export function displacementNoticeFor(previousKind: ActivityKind, nextKind: ActivityKind): string | null {
  if (previousKind === nextKind) return null;
  if (!isProductiveActivity(previousKind)) return null;
  const previous = DISPLACEMENT_NAMES[previousKind];
  const next = DISPLACEMENT_NAMES[nextKind];
  if (!previous || !next) return null;
  return previousKind === 'crafting'
    ? `Crafting paused — ${next} started. Bench jobs resume when Crafting holds the slot again.`
    : `${previous} ended — ${next} started.`;
}

const toMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Activity request failed.'
);

export const useActivityStore = create<ActivityState>()((set, get) => ({
  current: IDLE_ACTIVITY,
  hydrated: false,
  pending: false,
  error: null,
  displacementNotice: null,

  clearDisplacementNotice: () => set({ displacementNotice: null }),

  setCurrent: (activity) => set({ current: migrateActivityForBossCollapse(activity) as ActiveActivity, hydrated: true, error: null }),

  /**
   * Flip the boss phase on the active activity. No-op if the current
   * activity isn't a boss_fight. This is how the boss prep modal's
   * "Start Fight" button commits the prep→fight transition without
   * starting a new activity (which would race with the chef).
   */
  setBossPhase: (phase) => set((s) => {
    if (s.current.kind !== 'boss_fight') return s;
    if (s.current.bossPhase === phase) return s;
    return { current: { ...s.current, bossPhase: phase } };
  }),

  reset: () => set({ current: IDLE_ACTIVITY, hydrated: false, pending: false, error: null, displacementNotice: null }),

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
    const previous = get().current;
    set({ pending: true, error: null });
    try {
      const activity = await startActiveActivity(input);
      set({
        current: migrateActivityForBossCollapse(activity) as ActiveActivity,
        hydrated: true,
        pending: false,
        error: null,
        // Disclose the displacement (audit H-02): settle-and-switch
        // is the law, but the switch was silent — a rail tap paused
        // a running bench or ended a roam with no word said.
        displacementNotice: displacementNoticeFor(previous.kind, input.kind) ?? get().displacementNotice,
      });
      // Analytics: a roam ends when the slot is cleared OR handed to
      // anything else (another area counts as a new roam, not a
      // continuation); a roam begins on every fresh roaming start.
      const leavingRoam = previous.kind === 'roaming_loot'
        && (input.kind !== 'roaming_loot' || input.targetId !== previous.targetId);
      if (leavingRoam) trackRoamStop();
      if (input.kind === 'roaming_loot' && (previous.kind !== 'roaming_loot' || input.targetId !== previous.targetId)) {
        trackRoamStart(input.targetId ?? 'unknown');
      }
      return activity;
    } catch (error) {
      set({ pending: false, error: toMessage(error) });
      throw error;
    }
  },

  clear: async () => {
    const previous = get().current;
    set({ pending: true, error: null });
    try {
      const activity = await clearActiveActivity();
      set({ current: migrateActivityForBossCollapse(activity) as ActiveActivity, hydrated: true, pending: false, error: null });
      if (previous.kind === 'roaming_loot') trackRoamStop();
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
