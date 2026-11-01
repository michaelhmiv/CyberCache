/**
 * Push Primer Slice (audit PERM-01)
 *
 * Session-scoped answer state for the notification primer on the
 * offline recap. Once the player answers the primer — "Notify me"
 * (whatever the OS decides) or "Not now" — it never appears again
 * that session. Deliberately NOT persisted: the offer is tied to a
 * fresh value moment (a new session's first offline settlement),
 * not a standing nag, and a new session may offer it again.
 */

import { create } from 'zustand';

export interface PushPrimerState {
  /** True once the player has answered the primer this session. */
  settled: boolean;
  /** Record the answer (either button) — the primer never re-nags this session. */
  settle: () => void;
  /** Clear on session change. */
  reset: () => void;
}

export const usePushPrimerStore = create<PushPrimerState>()((set) => ({
  settled: false,
  settle: () => set({ settled: true }),
  reset: () => set({ settled: false }),
}));
