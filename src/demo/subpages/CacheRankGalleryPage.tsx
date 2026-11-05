/**
 * CacheRankGalleryPage — PROTOTYPE (design/hunter-subpages-rank-c).
 * Variant C, "Showcase": Cache Rank hung as a gallery wall.
 * Full build lands in the next commit; this stub keeps the harness
 * compiling for the checkpoint push.
 */
import React from 'react';
import type { CacheRankStateView, CacheRankTrackView } from '@/content/cacheRank';

export const CacheRankGalleryPage: React.FC<{
  state: CacheRankStateView;
  busyTrack: string | null;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ state }) => (
  <div className="px-4 pb-10" style={{ color: '#F5EFE6' }}>
    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, letterSpacing: '0.05em' }}>
      Cache Rank
    </div>
    <p className="text-[12px]" style={{ color: '#A2957F' }}>
      Level {state.level} · {state.tokens} tokens in hand · {state.tokensEarned} earned
    </p>
  </div>
);
