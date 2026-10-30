import { getCombatStatsRow, saveCombatStatsRow } from '@/lib/api/combatStatsService';
import { useCombatStatsStore } from '@/store/slices/combatStatsSlice';

type CombatStatsRow = {
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
};

const rowFromState = (userId: string, state: ReturnType<typeof useCombatStatsStore.getState>): CombatStatsRow => ({
  user_id: userId,
  total_kills: state.totalKills,
  total_deaths: state.totalDeaths,
  longest_kill_streak: state.longestKillStreak,
  last_kill_at: state.lastKillAt ? new Date(state.lastKillAt).toISOString() : null,
  run_started_at: state.runStartedAt ? new Date(state.runStartedAt).toISOString() : null,
  kills_by_area: state.killsByArea,
  kills_by_weapon_type: state.killsByWeaponType as Record<string, number>,
  kills_by_boss: state.killsByBoss,
  kills_by_element: state.killsByElement as Record<string, number>,
  highest_boss_tier: state.highestBossTier,
  active_play_seconds: state.activePlaySeconds,
  idle_play_seconds: state.idlePlaySeconds,
  updated_at: new Date().toISOString(),
});

const stateFromRow = (row: CombatStatsRow): Partial<ReturnType<typeof useCombatStatsStore.getState>> => ({
  totalKills: row.total_kills,
  totalDeaths: row.total_deaths,
  longestKillStreak: row.longest_kill_streak,
  lastKillAt: row.last_kill_at ? new Date(row.last_kill_at).getTime() : null,
  runStartedAt: row.run_started_at ? new Date(row.run_started_at).getTime() : null,
  killsByArea: row.kills_by_area,
  killsByWeaponType: row.kills_by_weapon_type as ReturnType<typeof useCombatStatsStore.getState>['killsByWeaponType'],
  killsByBoss: row.kills_by_boss,
  killsByElement: row.kills_by_element as ReturnType<typeof useCombatStatsStore.getState>['killsByElement'],
  highestBossTier: row.highest_boss_tier,
  activePlaySeconds: row.active_play_seconds,
  idlePlaySeconds: row.idle_play_seconds,
});

/**
 * Persist the current combat-stats slice to the Chef. Called from the
 * idle ticker and on auth transitions. Best-effort: failures are logged
 * and discarded (the in-memory state is still authoritative until the
 * next successful save).
 */
export async function saveCombatStats(userId: string): Promise<void> {
  if (!userId) return;
  const row = rowFromState(userId, useCombatStatsStore.getState());
  try {
    await saveCombatStatsRow(row);
  } catch (error) {
    console.warn('[combatStats] save failed:', error instanceof Error ? error.message : error);
  }
}

/**
 * Hydrate the combat-stats slice from the Chef. Called once on auth.
 * Returns true on success, false if the row doesn't exist yet (fresh user).
 */
export async function loadCombatStats(userId: string): Promise<boolean> {
  if (!userId) return false;
  let data: CombatStatsRow | null;
  try {
    data = await getCombatStatsRow();
  } catch (error) {
    console.warn('[combatStats] load failed:', error instanceof Error ? error.message : error);
    return false;
  }
  if (!data) return false;
  useCombatStatsStore.getState().setAll(stateFromRow(data));
  return true;
}
