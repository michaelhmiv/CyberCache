import React, { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { LeaderboardMetricPicker } from '@/components/leaderboard/LeaderboardMetricPicker';
import { LeaderboardList } from '@/components/leaderboard/LeaderboardList';
import { getLeaderboard, type LeaderboardEntry, type LeaderboardMetric, type LeaderboardPeriod } from '@/lib/supabase/leaderboardService';
import { getPublicProfile, type PlayerPublicProfile } from '@/lib/supabase/publicProfileService';
import { PublicProfilePanel } from '@/components/profile/PublicProfilePanel';

interface LeaderboardsScreenProps {
  onNavigate?: (screen: string) => void;
}

export const LeaderboardsScreen: React.FC<LeaderboardsScreenProps> = () => {
  const { user } = useAuth();
  const [metric, setMetric] = useState<LeaderboardMetric>('level');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<PlayerPublicProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLeaderboard(metric, period, 100).then((data) => {
      if (cancelled) return;
      setEntries(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [metric, period]);

  useEffect(() => {
    if (!selectedPlayerId) return;
    let cancelled = false;
    getPublicProfile(selectedPlayerId).then((data) => {
      if (cancelled) return;
      setSelectedProfile(data);
    });
    return () => { cancelled = true; };
  }, [selectedPlayerId]);

  return (
    <div className="bl-page space-y-3 p-4 pb-20">
      <ResourceBar />

      <div className="flex items-center gap-2">
        <Trophy size={18} className="text-amber" />
        <div className="text-lg font-black uppercase tracking-wide text-text-primary">Leaderboards</div>
      </div>

      <LeaderboardMetricPicker
        metric={metric}
        period={period}
        onMetricChange={setMetric}
        onPeriodChange={setPeriod}
      />

      <LeaderboardList
        entries={entries}
        myPlayerId={user?.id}
        loading={loading}
        onRowClick={(playerId) => {
          setSelectedProfile(null);
          setSelectedPlayerId(playerId);
        }}
      />

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
    </div>
  );
};

export default LeaderboardsScreen;
