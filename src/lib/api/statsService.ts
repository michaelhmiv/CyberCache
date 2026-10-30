/**
 * Stats service (Route B, slice B4) — transport swap onto the Chef
 * read routes. Same signatures and error semantics as the Supabase
 * version: failures log and return null.
 */
import { apiRequest } from './http';

export interface PlayerPublicStats {
  user_id: string;
  username: string | null;
  display_name: string | null;
  player_level: number;
  player_xp: number;
  credits: number;
  scrap: number;
  cache_tokens: number;
  cache_token_parts: number;
  total_kills: number;
  total_deaths: number;
  kill_death_ratio: number;
  highest_boss_tier: number;
  longest_kill_streak: number;
  active_play_seconds: number;
  idle_play_seconds: number;
  kills_by_area: Record<string, number>;
  kills_by_weapon_type: Record<string, number>;
  kills_by_element: Record<string, number>;
  net_worth: number;
  total_items: number;
  weapons_owned: number;
  legendary_items: number;
  highest_item_level: number;
  total_mastery_xp: number;
  highest_mastery_level: number;
  last_active_at: string;
  joined_at: string;
}

export async function getMyStatsSummary(): Promise<PlayerPublicStats | null> {
  try {
    return (await apiRequest<PlayerPublicStats | null>('/stats/me')) ?? null;
  } catch (error) {
    console.error('getMyStatsSummary error:', error);
    return null;
  }
}

export async function getPublicStats(userId: string): Promise<PlayerPublicStats | null> {
  try {
    return (await apiRequest<PlayerPublicStats | null>(`/players/${userId}/public-stats`)) ?? null;
  } catch (error) {
    console.error('getPublicStats error:', error);
    return null;
  }
}
