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

/**
 * Progress within the current mastery level, mirroring the server
 * curve (cc_mastery_level, db/migrations/0004): advancing from level
 * L to L+1 costs L^2 * 100 XP. Display math only — the summary rows'
 * mastery_level from the server stays authoritative.
 */
export function masteryLevelProgress(totalXp: number): { intoLevel: number; levelSpan: number; fraction: number } {
  let level = 1;
  let remaining = Math.max(0, Math.floor(Number(totalXp) || 0));
  for (;;) {
    const levelSpan = level * level * 100;
    if (remaining < levelSpan) {
      return { intoLevel: remaining, levelSpan, fraction: levelSpan > 0 ? remaining / levelSpan : 0 };
    }
    remaining -= levelSpan;
    level += 1;
  }
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
