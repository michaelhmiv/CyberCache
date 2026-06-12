/**
 * Offline Recap Slice
 *
 * Holds the most recent offline settlement result for UI display.
 * The OfflineRecap component consumes this store and renders a
 * durable "While You Were Away" card that persists until dismissed.
 *
 * Not persisted to runtime snapshots — settlement recap is
 * display-only and should not survive across sessions.
 */

import { create } from 'zustand';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';

export interface OfflineRecapState {
  /** The most recent settlement result, or null if none. */
  lastSettlement: SettlementRecap | null;
  /** Whether the user has dismissed the current recap. */
  dismissed: boolean;
  /** Set the settlement result and reset dismissed. */
  setSettlement: (recap: SettlementRecap) => void;
  /** Dismiss the current recap. */
  dismiss: () => void;
  /** Reset entirely (e.g. on sign out). */
  reset: () => void;
}

export const useOfflineRecapStore = create<OfflineRecapState>()((set) => ({
  lastSettlement: null,
  dismissed: false,
  setSettlement: (recap) => set({ lastSettlement: recap, dismissed: false }),
  dismiss: () => set({ dismissed: true }),
  reset: () => set({ lastSettlement: null, dismissed: false }),
}));
