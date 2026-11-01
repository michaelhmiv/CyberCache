/**
 * Offline Recap Slice
 *
 * Holds the most recent offline settlement result for UI display.
 * The OfflineRecapCard consumes this store (inside the Dashboard
 * level pop-up since the 2026-11-01 dashboard-top redesign) and
 * renders a durable "While You Were Away" card.
 *
 * Phase 1: the last recap is also mirrored to on-device local storage
 * so it can be RE-OPENED after dismissal (the level pop-up carries
 * the re-entry point). The recap is a display-only copy of numbers
 * the server already settled — it is never an economy source and is
 * never written to runtime snapshots.
 *
 * Short-absence suppression (owner's rule, 2026-11-01): a return
 * after UNDER 5 minutes away must not auto-present. The settlement
 * still applies (rewards already landed server-side); the summary
 * is simply tucked — stored already-dismissed so no consumer
 * (away beacon, pop-up) announces it, while the card stays
 * readable on demand in the level pop-up. The rule is applied
 * HERE, at the single entry seam (every settlement writer calls
 * setSettlement), and again at hydration, so all consumers agree
 * without re-deriving it.
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
  /**
   * Whether the current recap has been acknowledged. Also true
   * from the moment of entry for a short-absence settlement
   * (< 5 minutes away): tucked, never auto-presented, still
   * readable on demand.
   */
  dismissed: boolean;
  /** Set the settlement result (short absences enter dismissed). */
  setSettlement: (recap: SettlementRecap) => void;
  /** Dismiss the current recap (it stays re-openable). */
  dismiss: () => void;
  /** Re-open the last recap after dismissal, numbers unchanged. */
  reopen: () => void;
  /** Reset entirely (e.g. on sign out). */
  reset: () => void;
}

/** Absences under this never auto-present the recap (owner's rule). */
export const RECAP_SHORT_ABSENCE_MS = 300_000;

/**
 * The away duration a settlement reports, per variant: roaming
 * carries `elapsedMs`; crafting and extraction carry
 * `advancedMs` inside their sections. Null when the shape
 * reports no duration (never suppress what we cannot measure).
 */
export function recapAwayDurationMs(recap: SettlementRecap): number | null {
  if ('crafting' in recap) return recap.crafting.advancedMs;
  if ('extraction' in recap) return recap.extraction.advancedMs;
  return recap.elapsedMs;
}

/** True when the settlement's absence was under 5 minutes. */
export function isShortAbsenceRecap(recap: SettlementRecap): boolean {
  const awayMs = recapAwayDurationMs(recap);
  return typeof awayMs === 'number' && awayMs < RECAP_SHORT_ABSENCE_MS;
}

const persisted = loadPersistedRecap();
// A recap persisted by an older build could carry a short
// absence as un-dismissed; the suppression rule applies at
// hydration too, so the tucked state survives the upgrade.
const persistedDismissed = persisted
  ? persisted.dismissed || isShortAbsenceRecap(persisted.recap)
  : false;

export const useOfflineRecapStore = create<OfflineRecapState>()((set, get) => ({
  lastSettlement: persisted?.recap ?? null,
  dismissed: persistedDismissed,
  setSettlement: (recap) => {
    const dismissed = isShortAbsenceRecap(recap);
    persistRecap({ recap, dismissed });
    set({ lastSettlement: recap, dismissed });
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
