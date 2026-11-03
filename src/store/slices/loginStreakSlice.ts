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
 *
 * Poster-plate rebuild (streak audit D1–D3, 2026-11-03):
 *
 *  - ANNOUNCEMENT, NOT A CLAIM (D1). A fresh grant's pulse is an
 *    announcement — the reward already banked server-side at the
 *    check-in read; there is nothing to claim. The announcement
 *    lives only until the player acknowledges it.
 *  - ACKNOWLEDGEMENT (D2). `acknowledge()` records the held
 *    grant's key in `seenGrantKey`; the announcement derivation
 *    (TopBar pill, panel celebration, wallet tick) reads it, so
 *    opening the sheet and tapping "Back to the hunt" ends the
 *    signal for the rest of the session — and because the key is
 *    kept in this store (not component state), it cannot
 *    resurrect on a remount. It is keyed per grant: a later
 *    day's grant carries a different key and announces again.
 *    No localStorage copy exists on purpose: after an app
 *    restart the Chef replays the day's claim with
 *    `alreadyClaimed = true`, so a stale local flag could only
 *    ever suppress a grant the server says is fresh.
 *  - DAY-BOUNDARY REVALIDATION (D3). `revalidate()` re-reads
 *    when the client UTC day has rolled since the held result
 *    landed, so a session kept alive across 00:00 UTC records
 *    the new day's check-in instead of showing yesterday. The
 *    client day is a STALENESS HEURISTIC ONLY — it decides when
 *    to re-ask the Chef; every day, streak, and amount the UI
 *    prints remains the Chef's.
 *  - WALLET TICK. `tickedGrantKey` records which grant the
 *    Strip's count-up beat has already played for, so the beat
 *    fires once per grant and never replays on remount.
 */

import { create } from 'zustand';
import { getLoginStreakState, type ChefLoginStreakResult } from '@/lib/chef/chefClient';
import { loginStreakUtcDay } from '@/content/loginStreak';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';

export type PanelLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface LoginStreakPanelState {
  result: ChefLoginStreakResult | null;
  loadState: PanelLoadState;
  /** Client UTC day captured when the held result landed (D3
   *  staleness heuristic only — never a displayed fact). */
  resultDay: string | null;
  /** Key of the fresh grant the player has acknowledged (D2). */
  seenGrantKey: string | null;
  /** Key of the fresh grant whose wallet tick has played. */
  tickedGrantKey: string | null;
  /** Fetch the state view once per session (the daily check-in). */
  load: () => Promise<void>;
  /** Re-read when a live session crossed the UTC day boundary
   *  since the held result landed (D3); a no-op otherwise. */
  revalidate: () => Promise<void>;
  /** Mark the held fresh grant seen — ends its announcement. */
  acknowledge: () => void;
  /** Record that the Strip's wallet tick played for a grant. */
  markWalletTicked: (key: string) => void;
  /** Replace the held state (a fresh view returned by an op). */
  applyResult: (result: ChefLoginStreakResult) => void;
  reset: () => void;
}

/**
 * The identity of one fresh grant: the day it landed on plus
 * the grant's own facts. Two different grants never share a key
 * within a session (a second grant requires a later day or a
 * different streak), and the same grant always produces the
 * same key — so acknowledgement and the wallet tick can key on
 * it without ever suppressing a genuinely new grant. Returns
 * null when the result holds no fresh grant.
 */
export function loginStreakGrantKey(
  result: ChefLoginStreakResult | null,
  resultDay: string | null,
): string | null {
  const granted = result?.granted;
  if (!granted || granted.alreadyClaimed || granted.streakLength === null) return null;
  return [
    resultDay ?? 'undated',
    granted.streakLength,
    granted.cycleDay ?? 0,
    granted.tier ?? 0,
    granted.creditsAwarded,
    granted.fragmentsAwarded,
    granted.cacheKeysAwarded,
  ].join(':');
}

/**
 * The announcement derivation (D1): a fresh grant is being
 * announced exactly while it exists and has not been
 * acknowledged. Already-claimed results never announce, and an
 * acknowledged announcement never resurrects.
 */
export function loginStreakAnnouncement(
  result: ChefLoginStreakResult | null,
  resultDay: string | null,
  seenGrantKey: string | null,
): boolean {
  const key = loginStreakGrantKey(result, resultDay);
  return key !== null && key !== seenGrantKey;
}

let inFlight: Promise<void> | null = null;

export const useLoginStreakStore = create<LoginStreakPanelState>()((set, get) => {
  const fetchStreak = (): Promise<void> => {
    if (inFlight) return inFlight;
    set({ loadState: 'loading' });
    inFlight = getLoginStreakState()
      .then((next) => {
        set({ result: next, loadState: 'ready', resultDay: loginStreakUtcDay(new Date()) });
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
  };

  return {
    result: null,
    loadState: 'idle',
    resultDay: null,
    seenGrantKey: null,
    tickedGrantKey: null,
    load: () => {
      const { loadState } = get();
      if (loadState === 'loading') return inFlight ?? Promise.resolve();
      if (loadState === 'ready') return Promise.resolve();
      return fetchStreak();
    },
    revalidate: () => {
      const { loadState, resultDay } = get();
      if (loadState !== 'ready') return get().load();
      // Same client day as the held result: nothing can have
      // rolled — the Chef's answer would be the same replay.
      if (resultDay === loginStreakUtcDay(new Date())) return Promise.resolve();
      return fetchStreak();
    },
    acknowledge: () => {
      const { result, resultDay, seenGrantKey } = get();
      const key = loginStreakGrantKey(result, resultDay);
      if (key !== null && key !== seenGrantKey) set({ seenGrantKey: key });
    },
    markWalletTicked: (key) => {
      if (get().tickedGrantKey !== key) set({ tickedGrantKey: key });
    },
    applyResult: (result) =>
      set({ result, loadState: 'ready', resultDay: loginStreakUtcDay(new Date()) }),
    reset: () => {
      inFlight = null;
      set({
        result: null,
        loadState: 'idle',
        resultDay: null,
        seenGrantKey: null,
        tickedGrantKey: null,
      });
    },
  };
});
