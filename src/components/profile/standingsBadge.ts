import { useEffect, useState } from 'react';
import {
  getWeeklyLeaderboards,
  type WeeklyLeaderboards,
} from '@/lib/api/leaderboardService';

/**
 * Standings badge derivation (redesign v2, DESIGN.md §3 Hunter) —
 * the live badge on the Hunter Standings door. Every value derives
 * from the real weekly-races payload (GET /api/leaderboard/weekly,
 * the same wire the Standings stop renders):
 *
 * - Claimable count: last week's SETTLED races the caller placed in
 *   (settlement pays those rewards; the badge is the player's notice
 *   that they are waiting). Unsettled weeks count nothing — the
 *   rewards do not exist yet.
 * - Ends-soon: the current week closes within the final-24h window.
 * - Buff: the caller's active drop-luck buff, when one is running.
 *
 * No data, no badge: an unreachable Chef or an uneventful week
 * honestly produces the empty badge, never a hardcoded lure.
 */

/** A race week is "ending soon" inside its final 24 hours. */
export const STANDINGS_ENDS_SOON_MS = 24 * 60 * 60 * 1000;

export interface StandingsBadge {
  /** Settled previous-week races whose reward the caller earned. */
  claimableCount: number;
  /** Current week's close (ISO), when the payload carried one. */
  endsAt: string | null;
  /** True when the current week closes within STANDINGS_ENDS_SOON_MS. */
  endsSoon: boolean;
  /** The caller's active drop-luck buff, when one is running. */
  buff: { bonus: number; expiresAt: string } | null;
}

export const EMPTY_STANDINGS_BADGE: StandingsBadge = {
  claimableCount: 0,
  endsAt: null,
  endsSoon: false,
  buff: null,
};

export function deriveStandingsBadge(
  data: WeeklyLeaderboards | null,
  now: number,
): StandingsBadge {
  if (!data) return EMPTY_STANDINGS_BADGE;
  const prev = data.previous_week;
  const claimableCount = prev?.settled
    ? (prev.races ?? []).filter((race) => race.my_reward != null).length
    : 0;
  const endsAt = data.week?.ends_at ?? null;
  const endsMs = endsAt ? Date.parse(endsAt) : Number.NaN;
  const endsSoon =
    Number.isFinite(endsMs) &&
    endsMs - now > 0 &&
    endsMs - now <= STANDINGS_ENDS_SOON_MS;
  const buff = data.my_drop_buff
    ? { bonus: data.my_drop_buff.bonus, expiresAt: data.my_drop_buff.expires_at }
    : null;
  return { claimableCount, endsAt, endsSoon, buff };
}

/**
 * The door's badge fetch. Failures land as the empty badge (the door
 * still opens Standings; the stop itself owns the error + retry
 * state) — the door never blocks Hunter on a standings read.
 */
export function useStandingsBadge(): StandingsBadge {
  const [badge, setBadge] = useState<StandingsBadge>(EMPTY_STANDINGS_BADGE);
  useEffect(() => {
    let cancelled = false;
    getWeeklyLeaderboards()
      .then((data) => {
        if (!cancelled) setBadge(deriveStandingsBadge(data, Date.now()));
      })
      .catch(() => {
        // Unreachable Chef: the door renders unbadged by design.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return badge;
}
