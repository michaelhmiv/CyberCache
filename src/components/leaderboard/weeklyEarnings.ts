import type {
  WeeklyLeaderboards,
  WeeklyRaceReward,
} from '@/lib/api/leaderboardService';

/**
 * Weekly earnings derivation — the Standings "Your Weekly
 * Earnings" panel's state, folded from the real weekly-races
 * payload (GET /api/leaderboard/weekly). Race rewards are paid by
 * settlement, so every state here describes money that has (or
 * will automatically) landed — never anything claimable.
 */

export interface WeeklyEarningRow {
  raceId: string;
  label: string;
  reward: WeeklyRaceReward;
}

export type WeeklyEarningsState =
  | { kind: 'earnings'; rows: WeeklyEarningRow[]; totalCacheKeys: number }
  | { kind: 'placed' }
  | { kind: 'pending' }
  | { kind: 'empty' };

/**
 * `earnings` only for a SETTLED week with rewards actually paid;
 * `pending` while a raced week awaits settlement; `placed` for a
 * settled week raced without a paid finish; `empty` otherwise.
 */
export function deriveWeeklyEarnings(data: WeeklyLeaderboards | null): WeeklyEarningsState {
  if (!data) return { kind: 'empty' };
  const prev = data.previous_week;
  if (!prev) return { kind: 'empty' };
  const rows: WeeklyEarningRow[] = (prev.races ?? [])
    .filter((race) => race.my_reward != null)
    .map((race) => ({ raceId: race.id, label: race.label, reward: race.my_reward as WeeklyRaceReward }));
  const raced = (prev.races ?? []).some((race) => race.me !== null || race.my_reward != null);
  if (prev.settled) {
    if (rows.length > 0) {
      return {
        kind: 'earnings',
        rows,
        totalCacheKeys: rows.reduce((sum, row) => sum + row.reward.cache_keys, 0),
      };
    }
    return raced ? { kind: 'placed' } : { kind: 'empty' };
  }
  return raced ? { kind: 'pending' } : { kind: 'empty' };
}
