/**
 * Combat stats service (Route B, slice B4) — NEW service file for a
 * surface that never had one: combatStatsSupabaseSync used to hit the
 * combat_stats table directly through PostgREST. B4 adds the matching
 * Chef route pair (GET/PUT /api/stats/combat, own row only, identity
 * from the JWT) and this thin service over it, so the sync module
 * keeps its exact row contract.
 */
import { apiRequest } from './http';

export interface CombatStatsRow {
  user_id: string;
  total_kills: number;
  total_deaths: number;
  longest_kill_streak: number;
  last_kill_at: string | null;
  run_started_at: string | null;
  kills_by_area: Record<string, number>;
  kills_by_weapon_type: Record<string, number>;
  kills_by_boss: Record<string, number>;
  kills_by_element: Record<string, number>;
  highest_boss_tier: number;
  active_play_seconds: number;
  idle_play_seconds: number;
  updated_at: string;
}

export async function getCombatStatsRow(): Promise<CombatStatsRow | null> {
  return (await apiRequest<CombatStatsRow | null>('/stats/combat')) ?? null;
}

export async function saveCombatStatsRow(row: CombatStatsRow): Promise<void> {
  await apiRequest('/stats/combat', { method: 'PUT', body: row });
}
