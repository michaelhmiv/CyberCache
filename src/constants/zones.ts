export interface ZoneDef {
  id: string;
  regionName: string;
  stage: number;
  recommendedPower: number;
  enemyType: string;
  elementTendency: string;
  idleCreditsPerMinute: number;
  idleScrapPerMinute: number;
  dropPoolRarityWeights: Record<string, number>;
  bossUnlockCondition: string;
}

export const DUSTWASTE_ZONES: ZoneDef[] = Array.from({ length: 10 }, (_, i) => ({
  id: `dustwaste_${i + 1}`,
  regionName: 'Dustwaste Frontier',
  stage: i + 1,
  recommendedPower: 50 + i * 80,
  enemyType: i < 3 ? 'Scavenger Drone' : i < 6 ? 'Sand Raider' : 'Ironclad Construct',
  elementTendency: i < 4 ? 'Kinetic' : i < 7 ? 'Fire' : 'Corrosive',
  idleCreditsPerMinute: 10 + i * 5,
  idleScrapPerMinute: 2 + i * 1,
  dropPoolRarityWeights: {
    Common: Math.max(10, 60 - i * 4),
    Uncommon: 25 + i * 2,
    Rare: 10 + i * 1,
    Epic: Math.min(10, 2 + i * 0.8),
    Legendary: Math.min(5, 0.5 + i * 0.3),
  },
  bossUnlockCondition: i === 2 ? 'dune_tyrant' : i === 5 ? 'siltstalker' : i === 9 ? 'heap_guard' : '',
}));
