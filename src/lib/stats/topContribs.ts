/**
 * pickTopContributions — flatten all `contributions` arrays across the
 * summary's metrics, filter out zero-value entries, sort by absolute
 * value (largest first), and take the top N.
 *
 * Pure helper, kept in its own file (not colocated with the
 * CharacterStatBar component) so React Fast Refresh isn't broken by
 * non-component exports in a components file.
 *
 * This is the data layer behind the "Top 3 source contribution" strip
 * added in PR #5 of the HUD plan. The strip surfaces the largest
 * contributions across all metrics so the player can read "this is
 * why my damage is what it is" without tapping the SOURCES button.
 *
 * Returning the slice as-is (not the indices) keeps the helper
 * trivially testable. The caller can map the result into the strip
 * markup without re-sorting.
 */
import type { CharacterStatSummary } from './characterStats';

export function pickTopContributions(summary: CharacterStatSummary, n: number) {
  const all = summary.all.flatMap((metric) => metric.contributions);
  return all
    .filter((c) => c.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, Math.max(0, n));
}
