import { supabase } from './client';

export interface MasterySummaryRow {
  mastery_id: string;
  category: string;
  label: string;
  mastery_xp: number | string;
  mastery_level: number;
  rank: number;
}

export interface MasteryLeaderboardRow {
  rank: number;
  user_id: string;
  display_name: string;
  mastery_id: string;
  mastery_xp: number | string;
  mastery_level: number;
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function getMyMasterySummary(): Promise<MasterySummaryRow[]> {
  const { data, error } = await supabase.rpc('cc_my_mastery_summary');
  if (error) return [];
  return rows<MasterySummaryRow>(data);
}

export async function getMasteryLeaderboard(masteryId: string, limitCount = 25): Promise<MasteryLeaderboardRow[]> {
  const { data, error } = await supabase.rpc('cc_mastery_leaderboard', {
    target_mastery_id: masteryId,
    limit_count: limitCount,
  });
  if (error) return [];
  return rows<MasteryLeaderboardRow>(data);
}
