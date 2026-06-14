import { supabase } from './client';

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
  let query = supabase
    .from('player_progression_snapshots')
    .select('*')
    .order('snapshot_at', { ascending: true });

  if (options.sources && options.sources.length > 0) {
    query = query.in('source', options.sources);
  }
  if (options.since) {
    query = query.gte('snapshot_at', options.since);
  }
  if (options.until) {
    query = query.lte('snapshot_at', options.until);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) {
    console.error('getMyProgressionSnapshots error:', error);
    return [];
  }
  return (data as PlayerProgressionSnapshot[] | null) ?? [];
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
