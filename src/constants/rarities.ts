import { Rarity } from '../types/game';

export interface RarityDef {
  id: Rarity;
  name: string;
  color: string;
  affixCount: { min: number; max: number };
  rollQualityBias: number; // added to roll
  specialEffectChance: number;
  scrapMultiplier: number;
  dropWeight: number;
}

export const RARITIES: Record<Rarity, RarityDef> = {
  [Rarity.Common]: {
    id: Rarity.Common,
    name: 'Common',
    color: '#A5A7B5',
    affixCount: { min: 0, max: 1 },
    rollQualityBias: 0,
    specialEffectChance: 0,
    scrapMultiplier: 1.0,
    dropWeight: 60,
  },
  [Rarity.Uncommon]: {
    id: Rarity.Uncommon,
    name: 'Uncommon',
    color: '#7CFC00',
    affixCount: { min: 1, max: 1 },
    rollQualityBias: 5,
    specialEffectChance: 0,
    scrapMultiplier: 1.5,
    dropWeight: 25,
  },
  [Rarity.Rare]: {
    id: Rarity.Rare,
    name: 'Rare',
    color: '#5AA7FF',
    affixCount: { min: 2, max: 2 },
    rollQualityBias: 10,
    specialEffectChance: 0.05,
    scrapMultiplier: 2.5,
    dropWeight: 10,
  },
  [Rarity.Epic]: {
    id: Rarity.Epic,
    name: 'Epic',
    color: '#FF9DF5',
    affixCount: { min: 3, max: 3 },
    rollQualityBias: 15,
    specialEffectChance: 0.15,
    scrapMultiplier: 4.0,
    dropWeight: 4,
  },
  [Rarity.Legendary]: {
    id: Rarity.Legendary,
    name: 'Legendary',
    color: '#FFEA3A',
    affixCount: { min: 4, max: 5 },
    rollQualityBias: 20,
    specialEffectChance: 1.0,
    scrapMultiplier: 8.0,
    dropWeight: 1,
  },
};

export function rollQualityLabel(q: number): string {
  if (q >= 96) return 'God Roll';
  if (q >= 81) return 'Excellent';
  if (q >= 61) return 'Strong';
  if (q >= 41) return 'Standard';
  if (q >= 21) return 'Low';
  return 'Poor';
}
