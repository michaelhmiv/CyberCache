import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { ResourceBar } from '@/components/layout/ResourceBar';
import {
  getLeaderboard,
  getMyLeaderboardRank,
  getWeeklyLeaderboards,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type MyLeaderboardRank,
  type WeeklyLeaderboards,
} from '@/lib/api/leaderboardService';
import { WeeklyEarningsPanel } from '@/components/leaderboard/WeeklyEarningsPanel';
import {
  BoardConsole,
  ConsoleHead,
  FinalsArchive,
  RaceChannels,
} from '@/components/leaderboard/StandingsConsole';
import { METRIC_SHORT } from '@/components/leaderboard/standingsConsoleTokens';
import { getPublicProfile, type PlayerPublicProfile } from '@/lib/api/publicProfileService';
import { PublicProfilePanel } from '@/components/profile/PublicProfilePanel';
import { PlayerProfileSheet } from '@/components/profile/PlayerProfileSheet';
import { useHunterLooks } from '@/lib/pixel/useHunterLooks';

interface LeaderboardsScreenProps {
  onNavigate?: (screen: string) => void;
}

const ALL_METRICS = Object.keys(METRIC_SHORT) as LeaderboardMetric[];

type MyRankMap = Partial<Record<LeaderboardMetric, MyLeaderboardRank | null>>;

/** The viewer's own rank on every channel for one period — the
 *  board selector bank's readouts, the pinned MY READING, and the
 *  head bank's field size all fold from these real /leaderboard/me
 *  reads. A channel the viewer has no standing on reads null. */
function useMyRanks(period: LeaderboardPeriod, nonce: number): MyRankMap {
  const [ranks, setRanks] = useState<MyRankMap>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(ALL_METRICS.map(async (m) => {
      // The service folds failures to null; the try also covers a
      // synchronously-throwing transport (and bare-factory mocks in
      // screen tests, which lack this export entirely).
      try {
        return await getMyLeaderboardRank(m, period);
      } catch {
        return null;
      }
    }))
      .then((results) => {
        if (cancelled) return;
        const next: MyRankMap = {};
        ALL_METRICS.forEach((m, i) => {
          next[m] = results[i];
        });
        setRanks(next);
      })
      .catch(() => {
        // getMyLeaderboardRank already folds failures to null; a
        // rejected batch simply leaves the readouts dark.
        if (!cancelled) setRanks({});
      });
    return () => { cancelled = true; };
  }, [period, nonce]);
  return ranks;
}

/**
 * The race channels: the current week's numbered channels and last
 * week's finals archive, both folding from the one weekly payload
 * the board fetched. Looks for every racer are batched in one read.
 */
const RacesSection: React.FC<{
  data: WeeklyLeaderboards | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  myPlayerId?: string | null;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ data, loading, error, onRetry, myPlayerId, onSelectPlayer }) => {
  // Standings portraits (0053): every racer's worn look, batched —
  // one read for the current channels and the finals archive.
  const lookIds = useMemo(() => {
    if (!data) return myPlayerId ? [myPlayerId] : [];
    const ids = new Set<string>();
    for (const race of [...data.races, ...data.previous_week.races]) {
      for (const e of race.entries) ids.add(e.player_id);
    }
    if (myPlayerId) ids.add(myPlayerId);
    return [...ids];
  }, [data, myPlayerId]);
  const looks = useHunterLooks(lookIds);

  return (
    <>
      <RaceChannels
        data={data}
        loading={loading}
        error={error}
        onRetry={onRetry}
        myPlayerId={myPlayerId}
        looks={looks}
        onSelectPlayer={onSelectPlayer}
      />
      <FinalsArchive
        data={data}
        loading={loading}
        myPlayerId={myPlayerId}
        looks={looks}
        onSelectPlayer={onSelectPlayer}
      />
    </>
  );
};

/**
 * The board itself. Under the guest-visibility law (2026-11-01) it
 * renders for every session: the read routes accept any Chef JWT
 * (guests included), so a guest sees the real standings — the fetch
 * is no longer gated. Fetch failures land in a visible error state
 * with a retry; the pre-gate version chained `.then()` with no
 * `.catch`, so any failure left an eternal spinner.
 *
 * One weekly fetch feeds the console head, the settlement readout
 * (the Standings badge's destination — the settled record sits at
 * the top of the page, where the signal that brought the player
 * here resolves), and the race channels; a weekly failure never
 * takes the global board down with it.
 *
 * Presentation is the Instrument-panel register (owner pick B,
 * 2026-11-05): squared rack panels, inset LCD readouts, LED deltas
 * and segment meters against the leader.
 */
const LeaderboardBoard: React.FC<{ focusEarningsNonce?: number; bareHead?: boolean }> = ({
  focusEarningsNonce = 0,
  bareHead = false,
}) => {
  const { user } = useAuth();
  const [metric, setMetric] = useState<LeaderboardMetric>('level');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<PlayerPublicProfile | null>(null);
  const [fullProfileOpen, setFullProfileOpen] = useState(false);

  const [weekly, setWeekly] = useState<WeeklyLeaderboards | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(true);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [weeklyReloadKey, setWeeklyReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getWeeklyLeaderboards()
      .then((boards) => {
        if (cancelled) return;
        setWeekly(boards);
        setWeeklyError(null);
        setWeeklyLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setWeeklyError(err instanceof Error ? err.message : 'Weekly races could not be loaded.');
        setWeeklyLoading(false);
      });
    return () => { cancelled = true; };
  }, [weeklyReloadKey]);

  const retryWeekly = useCallback(() => setWeeklyReloadKey((k) => k + 1), []);

  const myRanks = useMyRanks(period, reloadKey);
  // "My best rk" is an all-time fact; when another period is
  // selected the head bank reads a dedicated all-time pass.
  const allTimeRanks = useMyRanks('all_time', reloadKey);
  const headRanks = period === 'all_time' ? myRanks : allTimeRanks;
  const bestRank = useMemo(() => {
    const rs = ALL_METRICS.map((m) => headRanks[m]?.rank).filter(
      (r): r is number => r != null,
    );
    return rs.length > 0 ? Math.min(...rs) : null;
  }, [headRanks]);
  const totalPlayers = useMemo(() => {
    for (const m of ALL_METRICS) {
      const tp = myRanks[m]?.total_players;
      if (tp != null) return tp;
    }
    return null;
  }, [myRanks]);

  const openPlayer = useCallback((playerId: string) => {
    setFullProfileOpen(false);
    setSelectedProfile(null);
    setSelectedPlayerId(playerId);
  }, []);

  // All state writes happen inside the promise callbacks (never
  // synchronously in the effect body): first load shows the spinner
  // from the initial state; refetches keep the current board/error on
  // screen until the new result lands.
  useEffect(() => {
    let cancelled = false;
    getLeaderboard(metric, period, 100)
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Leaderboards could not be loaded.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [metric, period, reloadKey]);

  useEffect(() => {
    if (!selectedPlayerId) return;
    let cancelled = false;
    getPublicProfile(selectedPlayerId)
      .then((data) => {
        if (cancelled) return;
        setSelectedProfile(data);
      })
      .catch(() => {
        // A profile that fails to load simply never opens; the board
        // behind it stays usable.
        if (cancelled) return;
        setSelectedPlayerId(null);
        setSelectedProfile(null);
      });
    return () => { cancelled = true; };
  }, [selectedPlayerId]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // Board portraits: the visible rows' worn looks, batched.
  const myId = user?.id;
  const boardLookIds = useMemo(
    () => [...new Set([...entries.slice(0, 50).map((e) => e.player_id), ...(myId ? [myId] : [])])],
    [entries, myId],
  );
  const boardLooks = useHunterLooks(boardLookIds);

  const myRankNumbers = useMemo(() => {
    const out: Partial<Record<LeaderboardMetric, number | null>> = {};
    for (const m of ALL_METRICS) out[m] = myRanks[m]?.rank ?? null;
    return out;
  }, [myRanks]);

  return (
    <>
      <ConsoleHead
        week={weekly?.week ?? null}
        totalPlayers={totalPlayers}
        bestRank={bestRank}
        dropBuff={weekly?.my_drop_buff ?? null}
        bare={bareHead}
      />

      <WeeklyEarningsPanel
        data={weekly}
        loading={weeklyLoading}
        error={weeklyError}
        onRetry={retryWeekly}
        focusNonce={focusEarningsNonce}
      />

      {error ? (
        <div className="border-2 border-red/50 bg-red/10 p-4 text-center">
          <div className="text-sm font-black text-red">Leaderboards unavailable</div>
          <div className="mt-1 text-xs text-text-muted">{error}</div>
          <button type="button" onClick={retry} className="bl-primary mt-3 px-4 py-2 text-xs font-black">Retry</button>
        </div>
      ) : (
        <BoardConsole
          metric={metric}
          period={period}
          onMetricChange={setMetric}
          onPeriodChange={setPeriod}
          entries={entries}
          loading={loading}
          myPlayerId={user?.id}
          myRank={myRanks[metric] ?? null}
          myRanks={myRankNumbers}
          looks={boardLooks}
          totalPlayers={totalPlayers}
          onRowClick={openPlayer}
        />
      )}

      <RacesSection
        data={weekly}
        loading={weeklyLoading}
        error={weeklyError}
        onRetry={retryWeekly}
        myPlayerId={user?.id}
        onSelectPlayer={openPlayer}
      />

      {selectedPlayerId && (
        <PublicProfilePanel
          open={!!selectedPlayerId}
          onClose={() => {
            setFullProfileOpen(false);
            setSelectedPlayerId(null);
            setSelectedProfile(null);
          }}
          profile={selectedProfile}
          onViewFull={() => setFullProfileOpen(true)}
        />
      )}

      <PlayerProfileSheet
        open={fullProfileOpen}
        profile={selectedProfile}
        onClose={() => setFullProfileOpen(false)}
      />
    </>
  );
};

export const LeaderboardsScreen: React.FC<
  LeaderboardsScreenProps & { embedded?: boolean; focusEarningsNonce?: number }
> = ({ embedded = false, focusEarningsNonce = 0, onNavigate }) => {
  if (embedded) {
    // Hunter → Standings stop: the Hunter screen owns the chrome
    // (resource strip, rail, stop title), so the board mounts bare.
    return (
      <div className="space-y-3">
        <LeaderboardBoard focusEarningsNonce={focusEarningsNonce} bareHead />
      </div>
    );
  }
  return (
    <div className="bl-page space-y-3 p-4 pb-20">
      <ResourceBar onOpenSettings={() => onNavigate?.('settings')} />

      {/* Guest-visibility law (2026-11-01): the boards render for
          every session with real data — guests included. The old
          FeatureGate lock wall (and the audit GUEST-01 consolation
          previews mounted above it) is gone: a guest's own streak
          and cache-rank progress live on the Dashboard and the
          Hunter profile, and this screen is the standings for
          everyone. Appearing under a name still takes a username —
          that rule lives in the fold, not in a view lock. */}
      <LeaderboardBoard focusEarningsNonce={focusEarningsNonce} />
    </div>
  );
};

export default LeaderboardsScreen;
