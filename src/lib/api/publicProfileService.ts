/**
 * Public profile service (Route B, slice B4) — transport swap onto the
 * Chef read route. The RPC returned a row set and the client took the
 * first row; the Chef route returns the projection object directly
 * (404 when the player does not exist), which maps to the same
 * `| null` contract.
 */
import { apiRequest } from './http';

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
  try {
    return (await apiRequest<PlayerPublicProfile | null>(`/players/${playerId}/public-profile`)) ?? null;
  } catch (error) {
    console.error('getPublicProfile error:', error);
    return null;
  }
}
