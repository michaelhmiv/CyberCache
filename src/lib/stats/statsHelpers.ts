export interface NamedCount {
  name: string;
  count: number;
}

export function topBreakdown(
  entries: Record<string, number> | null | undefined,
  limit = 3
): NamedCount[] {
  if (!entries) return [];
  return Object.entries(entries)
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Kill/death ratio from the two ledger numbers themselves
 * (gear-truth slice). The stats summary's own ratio field is
 * kills / NULLIF(deaths, 0) — null at zero deaths, which is the
 * correct "no ratio exists yet" signal; callers must not coerce
 * that null to 0. Zero deaths → null here, and the display form
 * is '—' (the public profile's convention for a null ratio).
 */
export function killDeathRatio(kills: number, deaths: number): number | null {
  return deaths > 0 ? kills / deaths : null;
}

export function formatKillDeathRatio(kills: number, deaths: number): string {
  const ratio = killDeathRatio(kills, deaths);
  return ratio != null ? ratio.toFixed(2) : '—';
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
