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

// ---------------------------------------------------------------------------
// Weekly races (0035) — GET /api/leaderboard/weekly. Unlike the
// all-time board above, failures THROW: the weekly panel renders its
// own error + retry state instead of swallowing into an empty board.
// Every value is folded server-side from verified records; the
// previous week's rewards were actually paid by settlement.
// ---------------------------------------------------------------------------

export interface WeeklyRaceEntry {
  rank: number;
  player_id: string;
  username: string | null;
  value: number;
  reached_at: string;
}

export interface WeeklyRaceReward {
  rank: number;
  cache_keys: number;
  buff_bonus: number;
  buff_hours: number;
  buff_expires_at: string | null;
}

export interface WeeklyRaceBoard {
  id: string;
  label: string;
  unit: string;
  blurb: string;
  min_qualifying_value: number;
  entries: WeeklyRaceEntry[];
  participant_count: number;
  /** The caller's standing, even outside entries; null when unranked. */
  me: { rank: number; value: number } | null;
  /** Previous week only: the caller's settled reward, or null. */
  my_reward: WeeklyRaceReward | null;
}

export interface WeeklyLeaderboards {
  week: { key: string; start: string; ends_at: string };
  races: WeeklyRaceBoard[];
  previous_week: {
    key: string;
    start: string;
    ends_at: string;
    settled: boolean;
    settled_at: string | null;
    races: WeeklyRaceBoard[];
  };
  /** The caller's strongest active drop-luck buff, if any. */
  my_drop_buff: { bonus: number; expires_at: string } | null;
}

export async function getWeeklyLeaderboards(): Promise<WeeklyLeaderboards> {
  return apiRequest<WeeklyLeaderboards>('/leaderboard/weekly');
}
