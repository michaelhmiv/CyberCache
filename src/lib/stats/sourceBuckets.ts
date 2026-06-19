export const STAT_SOURCE_BUCKETS = [
  'base',
  'gear',
  'weapon',
  'skill',
  'activity',
  'consumable',
  'server',
  'runtime',
] as const;

export type StatSourceBucket = typeof STAT_SOURCE_BUCKETS[number];

export const STAT_SOURCE_BUCKET_LABEL: Record<StatSourceBucket, string> = {
  base: 'Base chassis',
  gear: 'Gear',
  weapon: 'Weapons',
  skill: 'Skill tree',
  activity: 'Activity modules',
  consumable: 'Consumables',
  server: 'Server override',
  runtime: 'Runtime modifier',
};

export const STAT_SOURCE_BUCKET_BADGE: Record<StatSourceBucket, string> = {
  base: 'base',
  gear: 'gear',
  weapon: 'wpn',
  skill: 'skl',
  activity: 'act',
  consumable: 'cons',
  server: 'srv',
  runtime: 'run',
};

export function isTransientStatSourceBucket(bucket: StatSourceBucket): boolean {
  return bucket === 'consumable';
}
