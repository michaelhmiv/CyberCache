import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { FeatureGate } from '@/auth/FeatureGate';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { LeaderboardMetricPicker } from '@/components/leaderboard/LeaderboardMetricPicker';
import { LeaderboardList } from '@/components/leaderboard/LeaderboardList';
import { getLeaderboard, type LeaderboardEntry, type LeaderboardMetric, type LeaderboardPeriod } from '@/lib/api/leaderboardService';
import { getPublicProfile, type PlayerPublicProfile } from '@/lib/api/publicProfileService';
import { PublicProfilePanel } from '@/components/profile/PublicProfilePanel';

interface LeaderboardsScreenProps {
  onNavigate?: (screen: string) => void;
}

/**
 * The board itself — mounted only inside the FeatureGate below, so a
 * guest never fires the fetch the server will refuse (flow-fix F6).
 * Fetch failures land in a visible error state with a retry; the
 * previous version chained `.then()` with no `.catch`, so any failure
 * (including the predictable guest 401) left an eternal spinner.
 */
const LeaderboardBoard: React.FC = () => {
  const { user } = useAuth();
  const [metric, setMetric] = useState<LeaderboardMetric>('level');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<PlayerPublicProfile | null>(null);

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

  return (
    <>
      <LeaderboardMetricPicker
        metric={metric}
        period={period}
        onMetricChange={setMetric}
        onPeriodChange={setPeriod}
      />

      {error ? (
        <div className="border-2 border-red/50 bg-red/10 p-4 text-center">
          <div className="text-sm font-black text-red">Leaderboards unavailable</div>
          <div className="mt-1 text-xs text-text-muted">{error}</div>
          <button type="button" onClick={retry} className="bl-primary mt-3 px-4 py-2 text-xs font-black">Retry</button>
        </div>
      ) : (
        <LeaderboardList
          entries={entries}
          myPlayerId={user?.id}
          loading={loading}
          onRowClick={(playerId) => {
            setSelectedProfile(null);
            setSelectedPlayerId(playerId);
          }}
        />
      )}

      {selectedPlayerId && (
        <PublicProfilePanel
          open={!!selectedPlayerId}
          onClose={() => {
            setSelectedPlayerId(null);
            setSelectedProfile(null);
          }}
          profile={selectedProfile}
        />
      )}
    </>
  );
};

export const LeaderboardsScreen: React.FC<LeaderboardsScreenProps> = () => {
  return (
    <div className="bl-page space-y-3 p-4 pb-20">
      <ResourceBar />

      <div className="flex items-center gap-2">
        <span style={{ fontSize: 18 }} className="text-amber">♕</span>
        <div className="text-lg font-black uppercase tracking-wide text-text-primary">Leaderboards</div>
      </div>

      {/* Leaderboards require a verified account with a username
          (accountState.canUseFeature); guests see the lock and the
          Google upgrade path up front — the same FeatureGate
          treatment the market gets — instead of a doomed fetch. */}
      <FeatureGate feature="leaderboards">
        <LeaderboardBoard />
      </FeatureGate>
    </div>
  );
};

export default LeaderboardsScreen;
