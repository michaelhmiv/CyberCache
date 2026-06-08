import { RARITIES, type RarityDef } from '../constants/rarities';
import { DropSource, Rarity } from '../types/game';
import { pickWeighted } from '../lib/utils/rng';

export type RarityWeightMap = Partial<Record<Rarity, number>>;

export interface RarityRollOptions {
  source: DropSource;
  zoneWeights?: Record<string, number>;
  cacheLegendaryMultiplier?: number;
}

export interface CacheRarityOdd {
  rarity: Rarity;
  chance: number;
}

export const CACHE_RARITY_ODDS: CacheRarityOdd[] = [
  { rarity: Rarity.Rare, chance: 0.6 },
  { rarity: Rarity.Epic, chance: 0.32 },
  { rarity: Rarity.Legendary, chance: 0.08 },
];

export function getCacheRarityOdds(): CacheRarityOdd[] {
  return CACHE_RARITY_ODDS.map((entry) => ({ ...entry }));
}

export function resolveRarityWeights(options: RarityRollOptions): RarityWeightMap {
  const { source, zoneWeights, cacheLegendaryMultiplier = 1.5 } = options;

  if (zoneWeights) {
    return Object.values(Rarity).reduce<RarityWeightMap>((weights, rarity) => {
      weights[rarity] = zoneWeights[rarity] ?? 0;
      return weights;
    }, {});
  }

  return Object.values(Rarity).reduce<RarityWeightMap>((weights, rarity) => {
    const base = RARITIES[rarity].dropWeight;
    weights[rarity] = source === DropSource.CacheForged && rarity === Rarity.Legendary
      ? base * cacheLegendaryMultiplier
      : base;
    return weights;
  }, {});
}

export function rollRarityForDrop(
  options: RarityRollOptions,
  rng: () => number
): RarityDef {
  const weightMap = resolveRarityWeights(options);
  const rarities = Object.values(RARITIES);
  const weights = rarities.map((rarity) => weightMap[rarity.id] ?? 0);
  return pickWeighted(rarities, weights, rng);
}

export function rollCacheRarity(rng: () => number): Rarity {
  const roll = rng();
  let cumulative = 0;

  for (const entry of CACHE_RARITY_ODDS) {
    cumulative += entry.chance;
    if (roll <= cumulative) return entry.rarity;
  }

  return CACHE_RARITY_ODDS[CACHE_RARITY_ODDS.length - 1].rarity;
}

export function validateCacheRarityOdds(): boolean {
  const total = CACHE_RARITY_ODDS.reduce((sum, entry) => sum + entry.chance, 0);
  return Math.abs(total - 1) < 0.000001 && CACHE_RARITY_ODDS.every((entry) => entry.chance >= 0 && entry.chance <= 1);
}
