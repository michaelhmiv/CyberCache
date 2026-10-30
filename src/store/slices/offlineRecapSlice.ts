/**
 * Offline Recap Slice
 *
 * Holds the most recent offline settlement result for UI display.
 * The OfflineRecap component consumes this store and renders a
 * durable "While You Were Away" card that persists until dismissed.
 *
 * Phase 1: the last recap is also mirrored to on-device local storage
 * so it can be RE-OPENED after dismissal (the Dashboard carries the
 * re-entry point). The recap is a display-only copy of numbers the
 * server already settled — it is never an economy source and is
 * never written to runtime snapshots.
 */

import { create } from 'zustand';
import type { SettlementRecap } from '@/lib/activity/activitySettlement';

const STORAGE_KEY = 'cybercache.offlineRecap.v1';

interface PersistedRecap {
  recap: SettlementRecap;
  dismissed: boolean;
}

function loadPersistedRecap(): PersistedRecap | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedRecap;
    if (!parsed || typeof parsed !== 'object' || !parsed.recap) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistRecap(state: PersistedRecap | null): void {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — the recap still works for this session */
  }
}

export interface OfflineRecapState {
  /** The most recent settlement result, or null if none. */
  lastSettlement: SettlementRecap | null;
  /** Whether the user has dismissed the current recap. */
  dismissed: boolean;
  /** Set the settlement result and reset dismissed. */
  setSettlement: (recap: SettlementRecap) => void;
  /** Dismiss the current recap (it stays re-openable). */
  dismiss: () => void;
  /** Re-open the last recap after dismissal, numbers unchanged. */
  reopen: () => void;
  /** Reset entirely (e.g. on sign out). */
  reset: () => void;
}

const persisted = loadPersistedRecap();

export const useOfflineRecapStore = create<OfflineRecapState>()((set, get) => ({
  lastSettlement: persisted?.recap ?? null,
  dismissed: persisted?.dismissed ?? false,
  setSettlement: (recap) => {
    persistRecap({ recap, dismissed: false });
    set({ lastSettlement: recap, dismissed: false });
  },
  dismiss: () => {
    const { lastSettlement } = get();
    if (lastSettlement) persistRecap({ recap: lastSettlement, dismissed: true });
    set({ dismissed: true });
  },
  reopen: () => {
    const { lastSettlement } = get();
    if (!lastSettlement) return;
    persistRecap({ recap: lastSettlement, dismissed: false });
    set({ dismissed: false });
  },
  reset: () => {
    persistRecap(null);
    set({ lastSettlement: null, dismissed: false });
  },
}));
