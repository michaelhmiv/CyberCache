/**
 * Initial Bundle Reveal Slice (audit FR-02)
 *
 * Holds the one fresh initial-bundle grant of THIS session so the
 * StarterBundleReveal card can present it. Session-memory only —
 * deliberately NOT persisted: the grant happens exactly once per
 * account (server-enforced), AuthProvider sets this store only in
 * the session whose bootstrap performed the grant, and a reload
 * must never resurrect the reveal for an already-granted account.
 *
 * Display state only — the granted balances/items are economy truth
 * owned by the profile and item rows the op already synced; this
 * store is the announcement, never a source.
 */

import { create } from 'zustand';
import type { InitialBundleGrant } from '@/lib/api/initialBundle';

export interface InitialBundleRevealState {
  /** The fresh grant to announce, or null when there is nothing to show. */
  grant: InitialBundleGrant | null;
  /** Present a fresh grant (set by AuthProvider right after it lands). */
  show: (grant: InitialBundleGrant) => void;
  /** Dismiss the reveal (the player collected it). */
  dismiss: () => void;
  /** Clear on session change so a previous hunter's reveal never lingers. */
  reset: () => void;
}

export const useInitialBundleRevealStore = create<InitialBundleRevealState>()((set) => ({
  grant: null,
  show: (grant) => set({ grant }),
  dismiss: () => set({ grant: null }),
  reset: () => set({ grant: null }),
}));
