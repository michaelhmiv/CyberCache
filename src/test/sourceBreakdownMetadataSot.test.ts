import { describe, expect, it } from 'vitest';
import {
  STAT_SOURCE_BUCKETS,
  STAT_SOURCE_BUCKET_BADGE,
  STAT_SOURCE_BUCKET_LABEL,
  isTransientStatSourceBucket,
} from '@/lib/stats/sourceBuckets';

describe('source breakdown metadata single source of truth', () => {
  it('defines the canonical bucket order once', () => {
    expect(STAT_SOURCE_BUCKETS).toEqual([
      'base', 'gear', 'weapon', 'skill', 'activity', 'consumable', 'server', 'runtime',
    ]);
  });

  it('has labels and badges for every bucket', () => {
    for (const bucket of STAT_SOURCE_BUCKETS) {
      expect(STAT_SOURCE_BUCKET_LABEL[bucket]).toBeTruthy();
      expect(STAT_SOURCE_BUCKET_BADGE[bucket]).toBeTruthy();
    }
  });

  it('marks consumables as transient', () => {
    expect(isTransientStatSourceBucket('consumable')).toBe(true);
    expect(isTransientStatSourceBucket('gear')).toBe(false);
  });
});
