/**
 * RankPaperDemo — PROTOTYPE harness (design/hunter-subpages-rank-d,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Hunter-subpage
 * design pass, served only at /subpages-demo?page=rank (main.tsx
 * branches before the real app mounts). This branch dies with the
 * prototype; it is never a shipping path.
 *
 * The fixture is REAL data shapes only: the page renders the state
 * view derived by the game's own pure derivation —
 * cacheRankStateView (src/content/cacheRank.ts) — from crafted
 * server-fact inputs, the same inputs the Chef route supplies, and
 * the SAME fixture facts as variant A (level 52, the same spends,
 * 12 tokens held) so the five looks compare on identical truth.
 * Spends are a local fixture state machine that mutates the facts
 * and re-derives the view through the same function, so every
 * number on screen is the game's math.
 */
import React, { useMemo, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import {
  cacheRankStateView,
  type CacheRankBonusId,
  type CacheRankTrackView,
} from '@/content/cacheRank';
import { xpToNextLevel } from '@/content/simulation';
import { CacheRankLedgerPage } from './rankpaper/CacheRankLedgerPage';
import { DIM, GROUND, INK, RULE } from './rankpaper/paperTokens';

const STOPS: Array<{ id: string; label: string; icon: PxIconName }> = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'collections', label: 'Collections', icon: 'shelf' },
  { id: 'cacheRank', label: 'Cache Rank', icon: 'chevs' },
  { id: 'research', label: 'Research', icon: 'book' },
  { id: 'trees', label: 'Skill Trees', icon: 'nodes' },
  { id: 'standings', label: 'Standings', icon: 'flag' },
  { id: 'account', label: 'Account', icon: 'cog' },
];

/** Harness chrome only: the Hunter doors as a clerk's tab strip. */
const Rail: React.FC = () => {
  const railRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>('[data-active="true"]');
    if (rail && chip) rail.scrollLeft = Math.max(0, chip.offsetLeft - 10);
  }, []);
  return (
    <div ref={railRef} className="flex gap-1.5 overflow-x-auto pb-3" aria-hidden="true">
      {STOPS.map((stop) => {
        const isActive = stop.id === 'cacheRank';
        return (
          <span
            key={stop.id}
            data-active={isActive ? 'true' : undefined}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 px-2.5 text-[11px] font-black uppercase tracking-wide"
            style={{
              border: isActive ? `2px solid ${INK}` : `1.5px solid ${RULE}`,
              backgroundColor: isActive ? '#241A10' : 'rgba(18,12,6,0.55)',
              color: isActive ? INK : DIM,
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

/* ─── Cache Rank fixture — identical facts to variant A ──────────── */

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

export const RankPaperDemo: React.FC = () => {
  const [spends, setSpends] = useState(RANK_SPENDS_0);
  const [tokens, setTokens] = useState(RANK_TOKENS_0);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  const [selected, setSelected] = useState<CacheRankTrackView | null>(null);

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

  return (
    <div className="min-h-screen" style={{ backgroundColor: GROUND }}>
      <div className="mx-auto max-w-[430px] px-2.5 py-3">
        <Rail />
        <CacheRankLedgerPage
          state={state}
          busyTrack={busyTrack}
          selected={selected}
          onSpend={onSpend}
          onOpen={setSelected}
        />
      </div>
    </div>
  );
};
