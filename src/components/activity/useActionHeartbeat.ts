/**
 * useActionHeartbeat — Foreground live-sync heartbeat for the Action
 * screen (Home's live-action surface renders the same screen).
 *
 * OWNER CADENCE (Michael, 2026-11-02): the heartbeat runs on the
 * game's own tick — one sync per 3-second system tick while the
 * screen is foregrounded and an action can tick. Michael first
 * asked for a 1-second sync for engagement, then aligned it to the
 * system tick: "if the whole game is based on 3-second ticks then
 * we can make it that… whatever the system tick is."
 * ACTION_HEARTBEAT_INTERVAL_MS is the ONE place that owns this
 * cadence — re-tune here, nowhere else.
 *
 * The guards that make the poll safe:
 *  - In-flight skip: a beat that finds the previous heartbeat still
 *    pending is skipped outright — requests never stack or queue.
 *  - Visibility pause: no requests while the document is hidden;
 *    the cadence resumes on its own when the app returns.
 *  - Failure backoff: after a failed heartbeat, attempts wait
 *    ACTION_HEARTBEAT_RETRY_MS before the next try — a down server
 *    is never spun against. A success restores the tick cadence.
 *
 * Foreground resume (owner report, 2026-11-02: returning from an
 * app switch left the stage sitting stale): mounting the surface
 * and returning it to visibility both sync IMMEDIATELY instead of
 * waiting out the interval phase — the stage must be live the
 * moment the player is looking at it. A resume beat also bypasses
 * an armed failure backoff: foregrounding is a fresh network
 * context, so a stale failure must not hold the sync hostage for
 * the rest of its window. If the resume beat itself fails, the
 * backoff re-arms from that failure exactly as before.
 *
 * The loop is armed by the ENABLED edge and the resume signals
 * only — never by the heartbeat callback's identity. The Action
 * screen derives its callback from the whole activity-store
 * object, whose identity changes on every store write, including
 * the write each beat itself lands; keying this effect on the
 * callback would turn every beat into an immediate successor — a
 * back-to-back sync/render loop for as long as the surface can
 * tick — and would reset the in-flight/backoff state each time.
 * The effect therefore always calls the LATEST callback through
 * a ref while its own lifecycle depends on `enabled` alone.
 */

import { useEffect, useRef } from 'react';

/**
 * Foreground heartbeat cadence — the single re-tune point.
 *
 * This IS the system tick: the whole game resolves on 3-second
 * ticks (damage contract, boss ticks, and the simulation
 * assumptions all use 3s), so the sync beats once per tick and can
 * never show state fresher than the tick that produced it. If the
 * game tick ever changes, this constant changes with it.
 */
export const ACTION_HEARTBEAT_INTERVAL_MS = 3_000;

/** Wait before retrying after a failed heartbeat. */
export const ACTION_HEARTBEAT_RETRY_MS = 5000;

export function useActionHeartbeat(enabled: boolean, heartbeat: () => Promise<unknown>): void {
  const heartbeatRef = useRef(heartbeat);
  useEffect(() => {
    heartbeatRef.current = heartbeat;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let inFlight = false;
    let nextAttemptAt = 0;

    const attempt = (resume = false) => {
      // Visibility pause: a hidden app sends nothing.
      if (typeof document !== 'undefined' && document.hidden) return;
      // In-flight skip: never overlap or queue heartbeat requests.
      if (inFlight) return;
      // Failure backoff gate. A foreground resume is the one
      // exception (see the header): it clears the gate up front;
      // if the resume beat itself fails, the catch below re-arms
      // the backoff from that failure.
      if (!resume && Date.now() < nextAttemptAt) return;
      if (resume) nextAttemptAt = 0;
      inFlight = true;
      heartbeatRef.current()
        .then(() => {
          nextAttemptAt = 0;
        })
        .catch((error) => {
          console.warn('Action heartbeat skipped:', error);
          nextAttemptAt = Date.now() + ACTION_HEARTBEAT_RETRY_MS;
        })
        .finally(() => {
          inFlight = false;
        });
    };

    // First sync is immediate — the surface never sits on a stale
    // snapshot for a whole tick waiting for the interval's first
    // fire. The interval then holds the 3s tick cadence.
    attempt();
    const iv = window.setInterval(() => attempt(), ACTION_HEARTBEAT_INTERVAL_MS);
    // Foreground resume: the moment the app is visible again, sync.
    // (pageshow covers bfcache restores, where visibilitychange may
    // not fire; its initial-load fire lands while the mount beat is
    // in flight and is skipped by the in-flight guard.)
    const onForeground = () => {
      if (typeof document === 'undefined' || !document.hidden) attempt(true);
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('pageshow', onForeground);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('pageshow', onForeground);
    };
  }, [enabled]);
}
