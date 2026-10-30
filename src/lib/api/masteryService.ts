/**
 * Mastery service (Route B, slice B4) — transport swap onto the Chef
 * read routes. Same signatures; failures return [] as before.
 */
import { apiRequest } from './http';

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
  try {
    return rows<MasterySummaryRow>(await apiRequest('/mastery/summary'));
  } catch {
    return [];
  }
}

export async function getMasteryLeaderboard(masteryId: string, limitCount = 25): Promise<MasteryLeaderboardRow[]> {
  try {
    return rows<MasteryLeaderboardRow>(
      await apiRequest(`/mastery/leaderboard?masteryId=${encodeURIComponent(masteryId)}&limit=${limitCount}`),
    );
  } catch {
    return [];
  }
}
