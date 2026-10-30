/**
 * Progression service (Route B, slice B4) — transport swap onto the
 * Chef read route. Same signature and error semantics as the Supabase
 * version: failures return []. (`metric` stays a client-side concern —
 * extractMetricSeries — exactly as before; the route ignores it just
 * like the old query did.)
 */
import { apiRequest } from './http';

export interface PlayerProgressionSnapshot {
  id: number;
  player_id: string;
  snapshot_at: string;
  source: string;
  snapshot_version: number;
  level: number | null;
  xp: number | null;
  credits: number | null;
  scrap: number | null;
  total_kills: number | null;
  total_deaths: number | null;
  net_worth: number | null;
  total_items: number | null;
  weapons_owned: number | null;
  legendary_items: number | null;
  highest_item_level: number | null;
  total_mastery_xp: number | null;
  highest_mastery_level: number | null;
  highest_boss_tier: number | null;
  active_action: string | null;
  metadata: Record<string, unknown>;
}

export type ProgressionMetric =
  | 'level'
  | 'xp'
  | 'credits'
  | 'scrap'
  | 'total_kills'
  | 'total_deaths'
  | 'net_worth'
  | 'total_items'
  | 'weapons_owned'
  | 'legendary_items'
  | 'highest_item_level'
  | 'total_mastery_xp'
  | 'highest_mastery_level'
  | 'highest_boss_tier';

export interface SnapshotQueryOptions {
  metric?: ProgressionMetric;
  sources?: string[];
  since?: string;
  until?: string;
  limit?: number;
}

export async function getMyProgressionSnapshots(
  options: SnapshotQueryOptions = {}
): Promise<PlayerProgressionSnapshot[]> {
  const params = new URLSearchParams();
  if (options.sources && options.sources.length > 0) {
    params.set('source', options.sources.join(','));
  }
  if (options.since) {
    params.set('since', options.since);
  }
  if (options.until) {
    params.set('until', options.until);
  }
  if (options.limit) {
    params.set('limit', String(options.limit));
  }

  const query = params.toString();
  try {
    const data = await apiRequest<PlayerProgressionSnapshot[] | null>(
      `/progression/snapshots${query ? `?${query}` : ''}`,
    );
    return data ?? [];
  } catch (error) {
    console.error('getMyProgressionSnapshots error:', error);
    return [];
  }
}

export function extractMetricSeries(
  snapshots: PlayerProgressionSnapshot[],
  metric: ProgressionMetric
): { at: string; value: number }[] {
  return snapshots
    .map((s) => {
      const raw = s[metric];
      const value = raw === null || raw === undefined || Number.isNaN(raw) ? 0 : Number(raw);
      return { at: s.snapshot_at, value };
    });
}
