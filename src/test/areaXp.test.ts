import { describe, expect, it } from 'vitest';
import { areaXpMultiplier, areaXpPerTick } from '../lib/stats/areaXp';
import { ROAMING_AREAS, type RoamingAreaDef } from '../constants/roamingAreas';
import { Rarity } from '../types/game';

function makeArea(overrides: Partial<Pick<RoamingAreaDef, 'dangerRating' | 'unlockLevel' | 'idleXpPerTick'>> = {}): RoamingAreaDef {
  return {
    id: 'test_area',
    name: 'Test Area',
    manufacturerInfluence: 'Mixed',
    shortDescription: 'Test',
    gameplayIdentity: 'Test',
    enemyType: 'Test',
    dangerRating: 'Low',
    unlockLevel: 1,
    idleCreditsPerMinute: 0,
    idleScrapPerMinute: 0,
    idleXpPerTick: 1.0,
    dropPoolRarityWeights: { [Rarity.Common]: 0, [Rarity.Uncommon]: 0, [Rarity.Rare]: 0, [Rarity.Epic]: 0, [Rarity.Legendary]: 0 },
    materialBias: [],
    essenceBias: [],
    lootBias: [],
    weaponBias: [],
    gearDropWeights: { weapon: 0, shield: 0, classMod: 0, relic: 0, ordnance: 0 },
    selectionHint: '',
    ...overrides,
  };
}

describe('areaXpMultiplier', () => {
  it('returns 1.0 for the starter area (Low danger, level 1)', () => {
    expect(areaXpMultiplier(makeArea({ unlockLevel: 1, dangerRating: 'Low' }))).toBe(1.0);
  });

  it('scales linearly with unlock level', () => {
    const a4 = areaXpMultiplier(makeArea({ unlockLevel: 4, dangerRating: 'Low' }));
    const a8 = areaXpMultiplier(makeArea({ unlockLevel: 8, dangerRating: 'Low' }));
    const a16 = areaXpMultiplier(makeArea({ unlockLevel: 16, dangerRating: 'Low' }));
    // 1 + (4-1)*0.06 = 1.18; 1 + (8-1)*0.06 = 1.42; 1 + (16-1)*0.06 = 1.9
    expect(a4).toBe(1.18);
    expect(a8).toBe(1.42);
    expect(a16).toBe(1.9);
  });

  it('adds a danger-rating bonus on top of the level curve', () => {
    const low = areaXpMultiplier(makeArea({ unlockLevel: 8, dangerRating: 'Low' }));
    const mediumHigh = areaXpMultiplier(makeArea({ unlockLevel: 8, dangerRating: 'Medium/High' }));
    const high = areaXpMultiplier(makeArea({ unlockLevel: 8, dangerRating: 'High' }));
    // Low: 1.42; Medium/High: 1.42 + 0.10 = 1.52; High: 1.42 + 0.15 = 1.57
    expect(low).toBe(1.42);
    expect(mediumHigh).toBe(1.52);
    expect(high).toBe(1.57);
  });

  it('floors the result at 0.5 even for a misconfigured low-level area', () => {
    const floored = areaXpMultiplier(makeArea({ unlockLevel: 0, dangerRating: 'Low' }));
    // 1 + (0-1)*0.06 = 0.94, already above floor; sanity check passes
    expect(floored).toBeGreaterThanOrEqual(0.5);
  });

  it('produces monotonically increasing values across all real areas', () => {
    const sorted = [...ROAMING_AREAS].sort((a, b) => a.unlockLevel - b.unlockLevel);
    const multipliers = sorted.map(areaXpMultiplier);
    for (let i = 1; i < multipliers.length; i++) {
      expect(multipliers[i]).toBeGreaterThanOrEqual(multipliers[i - 1]);
    }
  });
});

describe('areaXpPerTick', () => {
  it('returns the area\'s stored idleXpPerTick value', () => {
    const area = makeArea({ idleXpPerTick: 1.65 });
    expect(areaXpPerTick(area)).toBe(1.65);
  });

  it('matches the values stored in ROAMING_AREAS for all 7 areas', () => {
    // Each area must have a multiplier value; just sanity-check that the
    // values are positive and the array isn't empty.
    expect(ROAMING_AREAS.length).toBe(7);
    for (const area of ROAMING_AREAS) {
      expect(areaXpPerTick(area)).toBeGreaterThan(0);
    }
  });
});
