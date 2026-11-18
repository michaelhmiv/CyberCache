import { create } from 'zustand';

/**
 * The lifted Chaos Chamber run view (first-screen fix R2, owner
 * ruling 2026-11-17).
 *
 * The run's facts used to live only in EndlessPanel's useState, one
 * panel below the fold — while the fold itself (the stage zone)
 * could not answer "how deep am I, what's at risk, what does death
 * pay, and how do I bank it". The panel now PUBLISHES a derived
 * view of the run it owns; the stage zone (ChamberRundown) renders
 * from this view and asks to bank through the intent counter below.
 *
 * The panel stays the sole owner of the run flow: it is the only
 * writer of `view`, and it executes bank requests through its own
 * shipped handler (end summary, stage transitions, error surface
 * all stay in the panel). This slice carries no server data of its
 * own — every field is copied from the panel's Chef responses.
 */
export interface EndlessRunView {
  runId: string;
  depthReached: number;
  startLevel: number;
  escrowCredits: number;
  escrowXp: number;
  escrowScrap: number;
  /** The death-rule payout percent from the panel's endless intel. */
  deathPayoutPercent: number;
  bestDepth: number;
  /** True while the panel has a Chef call in flight. */
  busy: boolean;
}

interface EndlessRunState {
  view: EndlessRunView | null;
  publish: (view: EndlessRunView | null) => void;
  /** Monotonic bank intent from the zone; the panel watches it. */
  bankRequests: number;
  requestBank: () => void;
}

export const useEndlessRunStore = create<EndlessRunState>((set) => ({
  view: null,
  publish: (view) => set({ view }),
  bankRequests: 0,
  requestBank: () => set((s) => ({ bankRequests: s.bankRequests + 1 })),
}));
