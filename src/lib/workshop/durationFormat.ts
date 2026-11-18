/**
 * Bench duration formats — the Workshop's own hand, shared.
 *
 * Extracted from WorkshopScreen (craft-info V1 port, 2026-11-17)
 * as the canonical home: the Home bench rundown prints a job's
 * stored per-unit duration and remaining time, and those words
 * must be the same words the Workshop prints for the same
 * numbers — one formatter, so they can't drift. Behavior is
 * WorkshopScreen's, verbatim:
 *   formatDuration(243,960,000) -> "67h 46m"; (600,000) -> "10m 00s"
 *   formatDurationShort(600,000) -> "10m"; (54,000,000) -> "15h"
 *
 * WorkshopScreen and RepairServiceSection still carry file-local
 * copies of formatDuration; adopting this module there is a
 * mechanical follow-up, kept out of the port PR so the Workshop
 * panel's files stay untouched while a parallel PR works them.
 */

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  return `${secs}s`;
}

/** Compact per-unit / totals durations: 12m, 1h30, 4h. */
export function formatDurationShort(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  return `${mins}m`;
}
