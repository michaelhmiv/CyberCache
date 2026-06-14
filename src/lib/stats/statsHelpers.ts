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

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
