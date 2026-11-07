/**
 * Extraction feed store — the settled-pass signal (Motion M4a).
 *
 * The extraction settle's only client recipient is the panel's
 * state read (GET /api/extraction/state settles first, then
 * returns the passes that read just finalized). Before M4a those
 * passes terminated in the panel as a text card and the stage
 * never heard about them. The panel now republishes each settled
 * pass here, and the Home stage (LiveTurfDiorama) consumes the
 * feed with the workshop mirror's seen-set discipline — history
 * at first view never replays; a pass presents once.
 *
 * Presentation only: the feed carries server facts the Chef
 * already settled (pass identity + its itemized finds). Nothing
 * here rolls, prices, or awards anything — the stage reads it to
 * show finds rising off the sift rig, exactly as the salvage
 * feed carries recycle results to the bench's completion beat.
 *
 * A pass is identified by its index — the all-time sequential
 * pass number the server stamps at creation — so the same pass
 * can never enter the feed twice, even if a read is repeated.
 */
import { create } from 'zustand';
import type { ChefExtractionPass } from '@/lib/chef/chefClient';

export interface ExtractionPassFeedEvent {
  /** Stable per pass: `extraction-pass-<index>`. */
  id: string;
  pass: ChefExtractionPass;
  timestamp: number;
}

interface ExtractionFeedState {
  /** Newest first, capped — the stage only ever presents fresh
   *  arrivals, and the panel keeps the written record. */
  passes: ExtractionPassFeedEvent[];
  pushPass: (pass: ChefExtractionPass) => void;
}

export const extractionPassFeedId = (pass: ChefExtractionPass): string =>
  `extraction-pass-${pass.index}`;

const MAX_FEED_PASSES = 12;

export const useExtractionFeedStore = create<ExtractionFeedState>((set) => ({
  passes: [],
  pushPass: (pass) => {
    const id = extractionPassFeedId(pass);
    set((s) => {
      if (s.passes.some((e) => e.id === id)) return s;
      return {
        passes: [{ id, pass, timestamp: Date.now() }, ...s.passes].slice(0, MAX_FEED_PASSES),
      };
    });
  },
}));
