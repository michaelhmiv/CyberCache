import React, { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { listEntranceProps } from '@/lib/animation/uiMotion';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { useAuth } from '@/auth/AuthProvider';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { LeaderboardMetricPicker } from '@/components/leaderboard/LeaderboardMetricPicker';
import { LeaderboardList } from '@/components/leaderboard/LeaderboardList';
import {
  getLeaderboard,
  getWeeklyLeaderboards,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type WeeklyLeaderboards,
  type WeeklyRaceBoard,
} from '@/lib/api/leaderboardService';
import { MobileCard } from '@/components/layout/MobileCard';
import { WeeklyEarningsPanel } from '@/components/leaderboard/WeeklyEarningsPanel';
import { getPublicProfile, type PlayerPublicProfile } from '@/lib/api/publicProfileService';
import { PublicProfilePanel } from '@/components/profile/PublicProfilePanel';
import { PlayerProfileSheet } from '@/components/profile/PlayerProfileSheet';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { resolveLookView } from '@/lib/pixel/lookResolution';
import { useHunterLooks } from '@/lib/pixel/useHunterLooks';

interface LeaderboardsScreenProps {
  onNavigate?: (screen: string) => void;
}

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const weekRangeLabel = (startIso: string, endsAtIso: string): string => {
  const lastDay = new Date(Date.parse(endsAtIso) - 86_400_000).toISOString();
  return `${shortDay(startIso)} – ${shortDay(lastDay)}`;
};

/**
 * One race's standings. Values render with tabular numerals and no
 * truncation (device-pass rule: numbers never ellipsize); only the
 * username may truncate. The caller's row is pinned below the top
 * entries when they rank outside them.
 */
const WeeklyRaceStandings: React.FC<{
  race: WeeklyRaceBoard;
  myPlayerId?: string | null;
  final?: boolean;
  /** Entrance stagger slot (§10 list entrances). */
  index?: number;
  /** Every racer row is a door to that hunter's profile (0058). */
  onSelectPlayer?: (playerId: string) => void;
}> = ({ race, myPlayerId, final, index = 0, onSelectPlayer }) => {
  const reduceMotion = useReducedMotion();
  // Standings portraits (0053): every racer's worn look, batched.
  const looks = useHunterLooks([
    ...race.entries.map((e) => e.player_id),
    ...(myPlayerId ? [myPlayerId] : []),
  ]);
  const inTop = race.entries.some((e) => e.player_id === myPlayerId);
  const reward = final ? race.my_reward : null;
  return (
    <motion.div {...listEntranceProps(index, reduceMotion)} className="space-y-1">
      <div className="flex items-baseline gap-2">
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">{race.label}</div>
        <div className="ml-auto whitespace-nowrap text-[10px] text-text-muted">
          {race.participant_count === 1 ? '1 racer' : `${race.participant_count} racers`}
        </div>
      </div>
      <div className="text-[10px] text-text-muted">{race.blurb}</div>
      {race.entries.length === 0 ? (
        <div className="py-1 text-[11px] text-text-muted">
          No qualifying runs yet{final ? '' : ' this week'}.
        </div>
      ) : (
        <div>
          {race.entries.map((entry) => (
            <button
              key={entry.player_id}
              type="button"
              data-testid={`standings-row-${entry.player_id}`}
              aria-label={`Open ${entry.username ?? 'Hunter'}'s profile`}
              onClick={() => onSelectPlayer?.(entry.player_id)}
              className={`flex w-full items-center gap-2 py-1 text-left ${entry.player_id === myPlayerId ? 'bg-amber/10' : ''}`}
            >
              <span className="w-7 shrink-0 text-right text-xs font-black text-amber">#{entry.rank}</span>
              {looks[entry.player_id] && (
                <span className="w-7 shrink-0" data-testid={`standings-portrait-${entry.player_id}`}>
                  <HunterPortrait look={resolveLookView(looks[entry.player_id])} className="h-9" />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-text-primary">
                {entry.username ?? 'Hunter'}
              </span>
              <span className="whitespace-nowrap text-xs font-black tabular-nums text-text-primary">
                {entry.value.toLocaleString('en-US')}
              </span>
              <span className="whitespace-nowrap text-[10px] text-text-muted">{race.unit}</span>
            </button>
          ))}
        </div>
      )}
      {race.me && !inTop && myPlayerId && (
        <button
          type="button"
          data-testid="standings-row-me"
          aria-label="Open your public profile"
          onClick={() => onSelectPlayer?.(myPlayerId)}
          className="flex w-full items-center gap-2 border-t border-amber/40 bg-amber/10 px-1 py-1 text-left"
        >
          <span className="w-7 shrink-0 text-right text-xs font-black text-amber">#{race.me.rank}</span>
          {looks[myPlayerId] && (
            <span className="w-7 shrink-0" data-testid="standings-portrait-me">
              <HunterPortrait look={resolveLookView(looks[myPlayerId])} className="h-9" />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-text-primary">You</span>
          <span className="whitespace-nowrap text-xs font-black tabular-nums text-text-primary">
            {race.me.value.toLocaleString('en-US')}
          </span>
          <span className="whitespace-nowrap text-[10px] text-text-muted">{race.unit}</span>
        </button>
      )}
      {reward && (
        <div className="border border-amber/50 bg-amber/10 px-2 py-1 text-[11px] font-bold text-text-primary">
          You finished #{reward.rank}
          {reward.cache_keys > 0 && <> — {reward.cache_keys} cache {reward.cache_keys === 1 ? 'key' : 'keys'} earned</>}
          {reward.buff_bonus > 0 && (
            <> · +{Math.round(reward.buff_bonus * 100)}% drop luck for {reward.buff_hours}h</>
          )}
        </div>
      )}
    </motion.div>
  );
};

/**
 * Weekly races (0035): the current week's live standings, the
 * caller's pinned rank, last week's finals + rewards, and the
 * caller's active drop-luck buff. Presentational — the fetch is
 * owned by WeeklySection below and shared with the earnings panel,
 * so the payload lands once for both.
 */
const WeeklyRacesPanel: React.FC<{
  data: WeeklyLeaderboards | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  myPlayerId?: string | null;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ data, loading, error, onRetry, myPlayerId, onSelectPlayer }) => {
  if (loading) {
    return (
      <MobileCard className="space-y-2" rarityColor="#FF9000">
        <div className="h-4 w-1/3 animate-pulse rounded bg-bg" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-bg" />
        ))}
      </MobileCard>
    );
  }

  if (error || !data) {
    return (
      <div className="border-2 border-red/50 bg-red/10 p-4 text-center">
        <div className="text-sm font-black text-red">Weekly races unavailable</div>
        <div className="mt-1 text-xs text-text-muted">{error ?? 'Weekly races could not be loaded.'}</div>
        <button
          type="button"
          onClick={onRetry}
          className="bl-primary mt-3 px-4 py-2 text-xs font-black"
        >
          Retry
        </button>
      </div>
    );
  }

  const prev = data.previous_week;
  const prevPlaced = prev.races.some((r) => r.my_reward !== null || r.me !== null);

  return (
    <MobileCard className="space-y-4" rarityColor="#FF9000">
      <div>
        <div className="flex items-center gap-2">
          <PxIcon name="flag" size={13} className="text-amber" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Weekly Races</div>
          <div className="ml-auto whitespace-nowrap text-[10px] text-text-muted">
            {weekRangeLabel(data.week.start, data.week.ends_at)}
          </div>
        </div>
        <div className="mt-1 text-[10px] text-text-muted">
          Top finishers win cache keys and drop luck when the week closes Monday 00:00 UTC.
        </div>
        {data.my_drop_buff && (
          <div className="mt-2 border border-amber/50 bg-amber/10 px-2 py-1 text-[11px] font-bold text-text-primary">
            Drop luck active: +{Math.round(data.my_drop_buff.bonus * 100)}% until {shortDay(data.my_drop_buff.expires_at)}
          </div>
        )}
      </div>

      {data.races.map((race, index) => (
        <WeeklyRaceStandings key={race.id} race={race} myPlayerId={myPlayerId} index={index} onSelectPlayer={onSelectPlayer} />
      ))}

      <div className="border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Last Week — Final</div>
          <div className="ml-auto whitespace-nowrap text-[10px] text-text-muted">
            {weekRangeLabel(prev.start, prev.ends_at)}
          </div>
        </div>
        {!prev.settled && (
          <div className="mt-1 text-[10px] text-text-muted">Rewards settle at the next daily heartbeat.</div>
        )}
        <div className="mt-2 space-y-4">
          {prev.races.map((race, index) => (
            <WeeklyRaceStandings key={race.id} race={race} myPlayerId={myPlayerId} final index={index} onSelectPlayer={onSelectPlayer} />
          ))}
        </div>
        {prev.settled && !prevPlaced && (
          <div className="mt-2 text-[11px] text-text-muted">You didn&apos;t place last week — this week is open.</div>
        )}
      </div>
    </MobileCard>
  );
};

/**
 * The weekly section: ONE fetch of the weekly payload feeding both
 * the "Your Weekly Earnings" panel (the Standings badge's
 * destination — the settled record sits at the very top of the
 * page, where the signal that brought the player here resolves)
 * and the races panel below it. Own error/retry state — a weekly
 * failure never takes the all-time board down with it.
 */
const WeeklySection: React.FC<{
  myPlayerId?: string | null;
  focusEarningsNonce?: number;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ myPlayerId, focusEarningsNonce = 0, onSelectPlayer }) => {
  const [data, setData] = useState<WeeklyLeaderboards | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getWeeklyLeaderboards()
      .then((boards) => {
        if (cancelled) return;
        setData(boards);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Weekly races could not be loaded.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <>
      <WeeklyEarningsPanel
        data={data}
        loading={loading}
        error={error}
        onRetry={retry}
        focusNonce={focusEarningsNonce}
      />
      <div id="weekly-races-card" className="scroll-mt-2">
        <WeeklyRacesPanel
          data={data}
          loading={loading}
          error={error}
          onRetry={retry}
          myPlayerId={myPlayerId}
          onSelectPlayer={onSelectPlayer}
        />
      </div>
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
 */
const LeaderboardBoard: React.FC<{ focusEarningsNonce?: number }> = ({ focusEarningsNonce = 0 }) => {
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

  return (
    <>
      <WeeklySection myPlayerId={user?.id} focusEarningsNonce={focusEarningsNonce} onSelectPlayer={openPlayer} />

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
          metric={metric}
          myPlayerId={user?.id}
          loading={loading}
          onRowClick={openPlayer}
        />
      )}

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
> = ({ embedded = false, focusEarningsNonce = 0 }) => {
  if (embedded) {
    // Hunter → Standings stop: the Hunter screen owns the chrome
    // (resource strip, rail, stop title), so the board mounts bare.
    return (
      <div className="space-y-3">
        <LeaderboardBoard focusEarningsNonce={focusEarningsNonce} />
      </div>
    );
  }
  return (
    <div className="bl-page space-y-3 p-4 pb-20">
      <ResourceBar onOpenSettings={() => onNavigate?.('settings')} />

      <div className="flex items-center gap-2">
        <PxIcon name="crown" size={17} className="text-amber" />
        <div className="text-lg font-black uppercase tracking-wide text-text-primary">Leaderboards</div>
      </div>

      {/* Guest-visibility law (2026-11-01): the boards render for
          every session with real data — guests included. The old
          FeatureGate lock wall (and the audit GUEST-01 consolation
          previews mounted above it) is gone: a guest's own streak
          and cache-rank progress live on the Dashboard and the
          Hunter profile, and this screen is the standings for
          everyone. Appearing under a name still takes a username —
          that rule lives in the fold, not in a view lock. */}
      <LeaderboardBoard />
    </div>
  );
};

export default LeaderboardsScreen;
