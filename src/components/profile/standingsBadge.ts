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
 * - Earnings count: last week's SETTLED races the caller earned a
 *   reward in. Settlement PAYS those rewards automatically (cache
 *   keys credited, drop-luck buff started — see
 *   src/server/leaderboards/store.ts); there is no claim op for
 *   race rewards, so the badge is a NOTICE that earnings landed,
 *   never a claim prompt. The record itself lives in the "Your
 *   Weekly Earnings" panel at the top of Standings.
 * - Unseen earnings: the earnings count until the player has viewed
 *   the earnings panel for that week (per-week seen marker below).
 *   This is what the door pill and the Hunter rail chip print — the
 *   notice clears once its destination has been seen, and a new
 *   settled week raises it again. Unsettled weeks count nothing —
 *   the rewards do not exist yet.
 * - Ends-soon: the current week closes within the final-24h window.
 * - Buff: the caller's active drop-luck buff, when one is running.
 *
 * No data, no badge: an unreachable Chef or an uneventful week
 * honestly produces the empty badge, never a hardcoded lure.
 */

/** A race week is "ending soon" inside its final 24 hours. */
export const STANDINGS_ENDS_SOON_MS = 24 * 60 * 60 * 1000;

/**
 * Seen marker for the earnings notice: the week key of the most
 * recent settled week whose earnings panel the player has viewed.
 * Stored per device — viewing the panel on this device is what
 * clears this device's badge.
 */
export const STANDINGS_EARNINGS_SEEN_KEY = 'cybercache.standingsEarningsSeenWeek';

/** Window event fired when the earnings panel marks a week seen. */
export const STANDINGS_EARNINGS_SEEN_EVENT = 'cybercache:standings-earnings-seen';

export function readStandingsEarningsSeenWeek(): string | null {
  try {
    return window.localStorage.getItem(STANDINGS_EARNINGS_SEEN_KEY);
  } catch {
    return null;
  }
}

export function markStandingsEarningsSeen(weekKey: string): void {
  try {
    window.localStorage.setItem(STANDINGS_EARNINGS_SEEN_KEY, weekKey);
    window.dispatchEvent(new CustomEvent(STANDINGS_EARNINGS_SEEN_EVENT, { detail: weekKey }));
  } catch {
    // Storage unavailable (private mode, tests): the badge simply
    // keeps its notice — never an error on the player's path.
  }
}

export interface StandingsBadge {
  /** Settled previous-week races whose reward the caller earned (already paid). */
  earningsCount: number;
  /** The settled week those earnings belong to; null when there are none. */
  earningsWeekKey: string | null;
  /** Earnings not yet seen on the Standings earnings panel. */
  unseenEarningsCount: number;
  /** Current week's close (ISO), when the payload carried one. */
  endsAt: string | null;
  /** True when the current week closes within STANDINGS_ENDS_SOON_MS. */
  endsSoon: boolean;
  /** The caller's active drop-luck buff, when one is running. */
  buff: { bonus: number; expiresAt: string } | null;
}

export const EMPTY_STANDINGS_BADGE: StandingsBadge = {
  earningsCount: 0,
  earningsWeekKey: null,
  unseenEarningsCount: 0,
  endsAt: null,
  endsSoon: false,
  buff: null,
};

export function deriveStandingsBadge(
  data: WeeklyLeaderboards | null,
  now: number,
  seenWeekKey: string | null = null,
): StandingsBadge {
  if (!data) return EMPTY_STANDINGS_BADGE;
  const prev = data.previous_week;
  const earningsCount = prev?.settled
    ? (prev.races ?? []).filter((race) => race.my_reward != null).length
    : 0;
  const earningsWeekKey = earningsCount > 0 ? (prev?.key ?? null) : null;
  const unseenEarningsCount =
    earningsWeekKey !== null && seenWeekKey !== earningsWeekKey ? earningsCount : 0;
  const endsAt = data.week?.ends_at ?? null;
  const endsMs = endsAt ? Date.parse(endsAt) : Number.NaN;
  const endsSoon =
    Number.isFinite(endsMs) &&
    endsMs - now > 0 &&
    endsMs - now <= STANDINGS_ENDS_SOON_MS;
  const buff = data.my_drop_buff
    ? { bonus: data.my_drop_buff.bonus, expiresAt: data.my_drop_buff.expires_at }
    : null;
  return { earningsCount, earningsWeekKey, unseenEarningsCount, endsAt, endsSoon, buff };
}

/**
 * The door's badge fetch. Failures land as the empty badge (the door
 * still opens Standings; the stop itself owns the error + retry
 * state) — the door never blocks Hunter on a standings read. The
 * badge re-derives when the earnings panel marks a week seen, so
 * following the notice to its panel clears the notice.
 */
export function useStandingsBadge(): StandingsBadge {
  const [badge, setBadge] = useState<StandingsBadge>(EMPTY_STANDINGS_BADGE);
  const [seenWeekKey, setSeenWeekKey] = useState<string | null>(() =>
    readStandingsEarningsSeenWeek(),
  );

  useEffect(() => {
    const onSeen = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setSeenWeekKey(typeof detail === 'string' ? detail : readStandingsEarningsSeenWeek());
    };
    window.addEventListener(STANDINGS_EARNINGS_SEEN_EVENT, onSeen);
    return () => window.removeEventListener(STANDINGS_EARNINGS_SEEN_EVENT, onSeen);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getWeeklyLeaderboards()
      .then((data) => {
        if (!cancelled) setBadge(deriveStandingsBadge(data, Date.now(), seenWeekKey));
      })
      .catch(() => {
        // Unreachable Chef: the door renders unbadged by design.
      });
    return () => {
      cancelled = true;
    };
  }, [seenWeekKey]);
  return badge;
}
