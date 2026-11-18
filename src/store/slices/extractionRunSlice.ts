import { create } from 'zustand';
import type { ChefExtractionState } from '@/lib/chef/chefClient';

/**
 * The lifted extraction view (first-screen fix R2, owner ruling
 * 2026-11-17).
 *
 * Extraction is a view over another occupation's screen: the
 * delve's facts — site, method, pass clock, gear factor, and the
 * Deep Delve below-×0.80 warning — belong on the first screen (the
 * stage zone) even while the delve is PAUSED, which is exactly when
 * the shipped panel below never prints the warning. The panel now
 * PUBLISHES the state it already reads; ExtractRundown renders from
 * this view and asks to resume through the intent counter below.
 *
 * The panel stays the sole owner of the flow: it is the only
 * writer of `view`, its rendered output is unchanged, and a resume
 * request executes through the panel's own start path with the
 * SAVED site and method. `readAt` rides along so the zone can
 * interpolate the pass countdown between reads exactly the way the
 * panel does.
 */
export interface ExtractionRunView {
  state: ChefExtractionState;
  /** When the panel read `state` (its own countdown anchor). */
  readAt: number;
  /** True while the panel's start call is in flight. */
  starting: boolean;
}

interface ExtractionRunState {
  view: ExtractionRunView | null;
  publish: (view: ExtractionRunView | null) => void;
  /** Monotonic resume intent from the zone; the panel watches it. */
  resumeRequests: number;
  requestResume: () => void;
}

export const useExtractionRunStore = create<ExtractionRunState>((set) => ({
  view: null,
  publish: (view) => set({ view }),
  resumeRequests: 0,
  requestResume: () => set((s) => ({ resumeRequests: s.resumeRequests + 1 })),
}));
