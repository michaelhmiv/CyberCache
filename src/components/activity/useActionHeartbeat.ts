/**
 * useActionHeartbeat — Foreground live-sync heartbeat for the Action
 * screen (Home's live-action surface renders the same screen).
 *
 * OWNER CADENCE (Michael, 2026-11-02): one heartbeat per second while
 * the screen is foregrounded and an action can tick. He heard the
 * cost side (60x today's call rate) and chose engagement: "I just
 * need it to be engaging." ACTION_HEARTBEAT_INTERVAL_MS is the ONE
 * place that owns this cadence — re-tune here, nowhere else.
 *
 * The guards that make a 1s poll safe:
 *  - In-flight skip: a beat that finds the previous heartbeat still
 *    pending is skipped outright — requests never stack or queue.
 *  - Visibility pause: no requests while the document is hidden;
 *    the cadence resumes on its own when the app returns.
 *  - Failure backoff: after a failed heartbeat, attempts wait
 *    ACTION_HEARTBEAT_RETRY_MS before the next try — a down server
 *    is never spun against at 1s. A success restores the 1s cadence.
 */

import { useEffect } from 'react';

/** Foreground heartbeat cadence — the single re-tune point. */
export const ACTION_HEARTBEAT_INTERVAL_MS = 1000;

/** Wait before retrying after a failed heartbeat. */
export const ACTION_HEARTBEAT_RETRY_MS = 5000;

export function useActionHeartbeat(enabled: boolean, heartbeat: () => Promise<unknown>): void {
  useEffect(() => {
    if (!enabled) return undefined;
    let inFlight = false;
    let nextAttemptAt = 0;
    const iv = window.setInterval(() => {
      // Visibility pause: a hidden app sends nothing.
      if (typeof document !== 'undefined' && document.hidden) return;
      // In-flight skip: never overlap or queue heartbeat requests.
      if (inFlight) return;
      // Failure backoff gate.
      if (Date.now() < nextAttemptAt) return;
      inFlight = true;
      heartbeat()
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
    }, ACTION_HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(iv);
  }, [enabled, heartbeat]);
}
