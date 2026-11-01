/**
 * Login Streak Panel Slice (dashboard-top slice, 2026-11-01)
 *
 * Session-scoped holder for the Chef's login-streak state view
 * (0036). The streak panel used to fetch into component-local
 * state on mount; the Dashboard top redesign turned the panel
 * into a pop-up behind an icon, and TWO consumers now need the
 * same state at different times:
 *
 *  - the Dashboard streak ICON (mounts with the Dashboard) —
 *    its mount performs the daily check-in fetch, because the
 *    check-in must NOT be gated on opening the pop-up;
 *  - the LoginStreakPanel itself (inside the pop-up, and on the
 *    Leaderboards guest preview) — renders this state.
 *
 * One load per session: `load()` fetches only from 'idle' or
 * 'error' (an unreachable Chef retries on a later mount, exactly
 * like the panel's old mount-effect did); once 'ready', every
 * consumer reads the same result. The grant's profile snapshot
 * syncs here, once, at load — the same sync the panel performed.
 * Reset by AuthProvider on every user change, like the other
 * session-scoped stores, so an account switch never inherits
 * the previous account's streak.
 */

import { create } from 'zustand';
import { getLoginStreakState, type ChefLoginStreakResult } from '@/lib/chef/chefClient';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';

export type PanelLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface LoginStreakPanelState {
  result: ChefLoginStreakResult | null;
  loadState: PanelLoadState;
  /** Fetch the state view once per session (the daily check-in). */
  load: () => Promise<void>;
  /** Replace the held state (a fresh view returned by an op). */
  applyResult: (result: ChefLoginStreakResult) => void;
  reset: () => void;
}

let inFlight: Promise<void> | null = null;

export const useLoginStreakStore = create<LoginStreakPanelState>()((set, get) => ({
  result: null,
  loadState: 'idle',
  load: () => {
    const { loadState } = get();
    if (loadState === 'loading') return inFlight ?? Promise.resolve();
    if (loadState === 'ready') return Promise.resolve();
    set({ loadState: 'loading' });
    inFlight = getLoginStreakState()
      .then((next) => {
        set({ result: next, loadState: 'ready' });
        if (next.profile) {
          syncVerifiedResult(next as unknown as Record<string, unknown>);
        }
      })
      .catch(() => {
        // Chef unreachable: the panel stays hidden and the icon
        // stays neutral (their designed unreachable-Chef states);
        // a later mount retries from 'error'.
        set({ loadState: 'error' });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },
  applyResult: (result) => set({ result, loadState: 'ready' }),
  reset: () => {
    inFlight = null;
    set({ result: null, loadState: 'idle' });
  },
}));
