/**
 * SubpagesDemo — PROTOTYPE harness (design/hunter-subpages-rank-c,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Hunter-subpage
 * design pass, served only at /subpages-demo?page=rank (main.tsx
 * branches before the real app mounts). This branch dies with the
 * prototype; it is never a shipping path.
 *
 * Variant C — "Showcase": Cache Rank as a gallery wall.
 *
 * The fixture is REAL data shapes only: the page renders the state
 * view derived by the game's own pure derivation —
 * cacheRankStateView (src/content/cacheRank.ts) — from crafted
 * server-fact inputs, the same inputs the Chef route supplies, and
 * the SAME fixture facts as variant A (Level 52, XP 38% in, the same
 * seven spend counts, 12 tokens held). Spend is a local fixture
 * state machine that re-derives the view through the same function,
 * so every number on screen is the game's math.
 */
import React, { useMemo, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import {
  cacheRankStateView,
  type CacheRankBonusId,
  type CacheRankTrackView,
} from '@/content/cacheRank';
import { xpToNextLevel } from '@/content/simulation';
import { CacheRankGalleryPage } from './subpages/CacheRankGalleryPage';

const STOPS: Array<{ id: string; label: string; icon: PxIconName }> = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'collections', label: 'Collections', icon: 'shelf' },
  { id: 'cacheRank', label: 'Cache Rank', icon: 'chevs' },
  { id: 'research', label: 'Research', icon: 'book' },
  { id: 'trees', label: 'Skill Trees', icon: 'nodes' },
  { id: 'standings', label: 'Standings', icon: 'flag' },
  { id: 'account', label: 'Account', icon: 'cog' },
];

/** The harness rail — deliberately quieter than the page it frames. */
const Rail: React.FC<{ active: string }> = ({ active }) => {
  const railRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>('[data-active="true"]');
    if (rail && chip) rail.scrollLeft = Math.max(0, chip.offsetLeft - 10);
  }, [active]);
  return (
    <div ref={railRef} className="flex gap-1.5 overflow-x-auto px-2.5 pb-4 pt-3" aria-hidden="true">
      {STOPS.map((stop) => {
        const isActive = stop.id === active;
        return (
          <span
            key={stop.id}
            data-active={isActive ? 'true' : undefined}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 px-2.5 text-[11px] font-bold uppercase tracking-wide"
            style={{
              border: `1px solid ${isActive ? 'rgba(245,239,230,0.55)' : 'rgba(245,239,230,0.16)'}`,
              color: isActive ? '#F5EFE6' : '#A2957F',
              backgroundColor: 'rgba(255,255,255,0.02)',
            }}
          >
            <PxIcon name={stop.icon} size={14} />
            {stop.label}
          </span>
        );
      })}
    </div>
  );
};

/* ─── Cache Rank fixture (identical facts to variant A) ──────────── */

const RANK_LEVEL = 52;
const RANK_SPENDS_0: Record<CacheRankBonusId, number> = {
  credits: 10,
  xp: 6,
  scrap: 4,
  damage: 3,
  maxHp: 5,
  cacheQuality: 2,
  marketProceeds: 4,
};
/** entitlement(52) = 81; the spends above cost 69 → 12 tokens held. */
const RANK_TOKENS_0 = 12;
const RANK_XP_INTO = Math.floor(xpToNextLevel(RANK_LEVEL) * 0.38);

const RankDemo: React.FC = () => {
  const [spends, setSpends] = useState(RANK_SPENDS_0);
  const [tokens, setTokens] = useState(RANK_TOKENS_0);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);

  const state = useMemo(
    () =>
      cacheRankStateView({
        level: RANK_LEVEL,
        playerXp: RANK_XP_INTO,
        tokens,
        grantLevel: RANK_LEVEL,
        spends,
      }),
    [spends, tokens],
  );

  const onSpend = (track: CacheRankTrackView) => {
    if (busyTrack || track.maxed || track.nextCost === null || tokens < track.nextCost) return;
    setBusyTrack(track.id);
    const cost = track.nextCost;
    window.setTimeout(() => {
      setSpends((prev) => ({ ...prev, [track.id]: prev[track.id] + 1 }));
      setTokens((prev) => prev - cost);
      setBusyTrack(null);
    }, 200);
  };

  return <CacheRankGalleryPage state={state} busyTrack={busyTrack} onSpend={onSpend} />;
};

/* ─── Stage ──────────────────────────────────────────────────────── */

export const SubpagesDemo: React.FC = () => (
  <div className="min-h-screen" style={{ backgroundColor: '#0A0806' }}>
    <div className="mx-auto max-w-[430px]">
      <Rail active="cacheRank" />
      <RankDemo />
    </div>
  </div>
);
