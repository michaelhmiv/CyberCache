/**
 * SubpagesDemo — PROTOTYPE harness (design/hunter-subpages-rank-research,
 * 2026-11-05). NOT shipped UI: a fixture stage for the Hunter-subpage
 * design pass, served only at /subpages-demo?page=rank|research
 * (main.tsx branches before the real app mounts). This branch dies
 * with the prototype; it is never a shipping path.
 *
 * Fixtures are REAL data shapes: both pages render state views
 * derived by the game's own pure derivations — cacheRankStateView
 * (src/content/cacheRank.ts) and researchStateView
 * (src/content/research.ts) — from crafted server-fact inputs, the
 * same inputs the Chef routes supply. Spend / enroll / cancel are
 * local fixture state machines that re-derive the view through the
 * same functions, so every number on screen is the game's math.
 */
import React, { useMemo, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import {
  cacheRankStateView,
  type CacheRankBonusId,
  type CacheRankTrackView,
} from '@/content/cacheRank';
import {
  RESEARCH_LEVER_DEFAULTS,
  researchStateView,
  type ResearchCourseView,
  type ResearchFacts,
} from '@/content/research';
import { xpToNextLevel } from '@/content/simulation';
import { CacheRankPlatePage } from './subpages/CacheRankPlatePage';
import { ResearchPlatePage } from './subpages/ResearchPlatePage';
import { BONE, BONE_FAINT } from './subpages/plateKit';

const STOPS: Array<{ id: string; label: string; icon: PxIconName }> = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'collections', label: 'Collections', icon: 'shelf' },
  { id: 'cacheRank', label: 'Cache Rank', icon: 'chevs' },
  { id: 'research', label: 'Research', icon: 'book' },
  { id: 'trees', label: 'Skill Trees', icon: 'nodes' },
  { id: 'standings', label: 'Standings', icon: 'flag' },
  { id: 'account', label: 'Account', icon: 'cog' },
];

const Rail: React.FC<{ active: string }> = ({ active }) => {
  const railRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>('[data-active="true"]');
    if (rail && chip) rail.scrollLeft = Math.max(0, chip.offsetLeft - 10);
  }, [active]);
  return (
  <div ref={railRef} className="flex gap-1.5 overflow-x-auto pb-3" aria-hidden="true">
    {STOPS.map((stop) => {
      const isActive = stop.id === active;
      return (
        <span
          key={stop.id}
          data-active={isActive ? 'true' : undefined}
          className="flex min-h-[44px] shrink-0 items-center gap-1.5 px-2.5 text-[11px] font-black uppercase tracking-wide"
          style={{
            border: '2px solid #000',
            backgroundColor: isActive ? '#1D1811' : 'rgba(6,5,4,0.55)',
            color: isActive ? BONE : BONE_FAINT,
            boxShadow: isActive ? 'inset 0 0 0 1px rgba(163,152,134,0.35)' : undefined,
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

/* ─── Cache Rank fixture ─────────────────────────────────────────── */

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

  return <CacheRankPlatePage state={state} busyTrack={busyTrack} onSpend={onSpend} />;
};

/* ─── Research fixture ───────────────────────────────────────────── */

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const HOUR = 3_600_000;

const RESEARCH_FACTS_0: ResearchFacts = {
  workshopBenches: 2,
  credits: 41250,
  completed: [
    { courseId: 'shop_fundamentals', completedAt: '2026-09-18T12:00:00.000Z' },
    { courseId: 'production_systems', completedAt: '2026-10-21T12:00:00.000Z' },
    { courseId: 'wrench_basics', completedAt: '2026-09-26T12:00:00.000Z' },
    { courseId: 'street_economics', completedAt: '2026-10-03T12:00:00.000Z' },
  ],
  activeEnrollment: {
    courseId: 'powertrain_systems',
    enrolledAt: new Date(NOW - Math.round(0.62 * 48 * HOUR)).toISOString(),
    completesAt: new Date(NOW - Math.round(0.62 * 48 * HOUR) + 48 * HOUR).toISOString(),
    costCredits: 15000,
    durationMs: 48 * HOUR,
  },
  nowMs: NOW,
};

const ResearchDemo: React.FC<{ openTrack: boolean }> = ({ openTrack }) => {
  const [facts, setFacts] = useState<ResearchFacts>(() =>
    openTrack ? { ...RESEARCH_FACTS_0, activeEnrollment: null } : RESEARCH_FACTS_0,
  );
  const [busy, setBusy] = useState(false);

  const state = useMemo(() => researchStateView(facts, RESEARCH_LEVER_DEFAULTS), [facts]);

  const onEnroll = (course: ResearchCourseView) => {
    if (busy || !course.canEnroll) return;
    setBusy(true);
    window.setTimeout(() => {
      setFacts((prev) => ({
        ...prev,
        credits: prev.credits - course.costNow,
        activeEnrollment: {
          courseId: course.id,
          enrolledAt: new Date(NOW).toISOString(),
          completesAt: new Date(NOW + course.durationNowMs).toISOString(),
          costCredits: course.costNow,
          durationMs: course.durationNowMs,
        },
      }));
      setBusy(false);
    }, 200);
  };

  const onCancel = () => {
    if (busy) return;
    setBusy(true);
    window.setTimeout(() => {
      setFacts((prev) => ({ ...prev, activeEnrollment: null }));
      setBusy(false);
    }, 200);
  };

  return <ResearchPlatePage state={state} busy={busy} onEnroll={onEnroll} onCancel={onCancel} />;
};

/* ─── Stage ──────────────────────────────────────────────────────── */

export const SubpagesDemo: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const page = params.get('page') === 'research' ? 'research' : 'rank';
  const openTrack = params.get('state') === 'open';
  return (
    <div className="bl-page min-h-screen">
      <div className="mx-auto max-w-[430px] px-2.5 py-3">
        <Rail active={page === 'research' ? 'research' : 'cacheRank'} />
        {page === 'research' ? <ResearchDemo openTrack={openTrack} /> : <RankDemo />}
      </div>
    </div>
  );
};
