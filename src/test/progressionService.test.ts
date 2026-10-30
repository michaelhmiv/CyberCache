import { describe, it, expect } from 'vitest';
import { extractMetricSeries, type PlayerProgressionSnapshot } from '../lib/api/progressionService';

function makeSnapshot(overrides: Partial<PlayerProgressionSnapshot> = {}): PlayerProgressionSnapshot {
  return {
    id: 1,
    player_id: '00000000-0000-0000-0000-000000000000',
    snapshot_at: '2026-06-14T00:00:00Z',
    source: 'daily_heartbeat',
    snapshot_version: 1,
    level: null,
    xp: null,
    credits: null,
    scrap: null,
    total_kills: null,
    total_deaths: null,
    net_worth: null,
    total_items: null,
    weapons_owned: null,
    legendary_items: null,
    highest_item_level: null,
    total_mastery_xp: null,
    highest_mastery_level: null,
    highest_boss_tier: null,
    active_action: null,
    metadata: {},
    ...overrides,
  };
}

describe('extractMetricSeries', () => {
  it('extracts a numeric metric preserving order', () => {
    const snapshots = [
      makeSnapshot({ snapshot_at: '2026-06-14T00:00:00Z', level: 1 }),
      makeSnapshot({ snapshot_at: '2026-06-14T01:00:00Z', level: 2 }),
      makeSnapshot({ snapshot_at: '2026-06-14T02:00:00Z', level: 3 }),
    ];
    const series = extractMetricSeries(snapshots, 'level');
    expect(series).toEqual([
      { at: '2026-06-14T00:00:00Z', value: 1 },
      { at: '2026-06-14T01:00:00Z', value: 2 },
      { at: '2026-06-14T02:00:00Z', value: 3 },
    ]);
  });

  it('coerces nulls to zero', () => {
    const snapshots = [makeSnapshot({ level: null })];
    const series = extractMetricSeries(snapshots, 'level');
    expect(series).toEqual([{ at: '2026-06-14T00:00:00Z', value: 0 }]);
  });
});
