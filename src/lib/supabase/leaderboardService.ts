import { supabase } from './client';

export type LeaderboardMetric =
  | 'level'
  | 'xp'
  | 'net_worth'
  | 'total_kills'
  | 'kdr'
  | 'highest_boss_tier'
  | 'total_mastery_xp'
  | 'highest_mastery_level'
  | 'legendary_items'
  | 'total_items';

export type LeaderboardPeriod = 'all_time' | 'weekly' | 'daily';

export interface LeaderboardEntry {
  rank: number;
  player_id: string;
  username: string | null;
  value: number;
  previous_value: number | null;
  trend: number;
}

export interface MyLeaderboardRank {
  rank: number;
  value: number;
  previous_value: number | null;
  trend: number;
  total_players: number;
}

export async function getLeaderboard(
  metric: LeaderboardMetric,
  period: LeaderboardPeriod = 'all_time',
  limit: number = 100,
): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('cc_get_leaderboard', {
    _metric: metric,
    _period: period,
    _limit: limit,
  });
  if (error) {
    console.error('getLeaderboard error:', error);
    return [];
  }
  return (data as LeaderboardEntry[] | null) ?? [];
}

export async function getMyLeaderboardRank(
  metric: LeaderboardMetric,
  period: LeaderboardPeriod = 'all_time',
): Promise<MyLeaderboardRank | null> {
  const { data, error } = await supabase.rpc('cc_get_my_leaderboard_rank', {
    _metric: metric,
    _period: period,
  });
  if (error) {
    console.error('getMyLeaderboardRank error:', error);
    return null;
  }
  return (data as MyLeaderboardRank[] | null)?.[0] ?? null;
}
