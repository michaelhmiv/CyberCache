import { supabase } from './client';

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
  const { data, error } = await supabase.rpc('cc_my_stats_summary');
  if (error) {
    console.error('getMyStatsSummary error:', error);
    return null;
  }
  return (data as PlayerPublicStats | null) ?? null;
}

export async function getPublicStats(userId: string): Promise<PlayerPublicStats | null> {
  const { data, error } = await supabase.rpc('cc_public_stats', { user_id: userId });
  if (error) {
    console.error('getPublicStats error:', error);
    return null;
  }
  return (data as PlayerPublicStats | null) ?? null;
}
