import { supabase } from './client';

export interface PlayerPublicProfile {
  player_id: string;
  username: string | null;
  display_name: string | null;
  level: number;
  xp: number;
  net_worth: number;
  total_kills: number;
  total_deaths: number;
  kill_death_ratio: number;
  highest_boss_tier: number;
  total_mastery_xp: number;
  highest_mastery_level: number;
  legendary_items: number;
  total_items: number;
  weapons_owned: number;
  highest_item_level: number;
  joined_at: string;
  last_active_at: string;
}

export async function getPublicProfile(playerId: string): Promise<PlayerPublicProfile | null> {
  const { data, error } = await supabase.rpc('cc_get_public_profile', { _player_id: playerId });
  if (error) {
    console.error('getPublicProfile error:', error);
    return null;
  }
  return (data as PlayerPublicProfile[] | null)?.[0] ?? null;
}
