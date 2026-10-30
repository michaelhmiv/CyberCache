/**
 * Leaderboard service (Route B, slice B4) — transport swap onto the
 * Chef read routes. Same signatures and error semantics as the
 * Supabase version: failures return [] / null.
 */
import { apiRequest } from './http';

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
  try {
    const data = await apiRequest<LeaderboardEntry[] | null>(
      `/leaderboard?metric=${encodeURIComponent(metric)}&period=${encodeURIComponent(period)}&limit=${limit}`,
    );
    return data ?? [];
  } catch (error) {
    console.error('getLeaderboard error:', error);
    return [];
  }
}

export async function getMyLeaderboardRank(
  metric: LeaderboardMetric,
  period: LeaderboardPeriod = 'all_time',
): Promise<MyLeaderboardRank | null> {
  try {
    return (await apiRequest<MyLeaderboardRank | null>(
      `/leaderboard/me?metric=${encodeURIComponent(metric)}&period=${encodeURIComponent(period)}`,
    )) ?? null;
  } catch (error) {
    console.error('getMyLeaderboardRank error:', error);
    return null;
  }
}
