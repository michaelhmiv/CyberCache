import { describe, it, expect } from 'vitest';
import {
  pickAreaMonster,
  resolveAreaMonsters,
  defaultMonstersForTier,
  getAreaTier,
} from '@/lib/combat/areaMonsterSelector';
import { MONSTERS, MONSTER_IDS } from '@/constants/monsters';
import { ROAMING_AREAS, getRoamingArea } from '@/constants/roamingAreas';

describe('areaMonsterSelector', () => {
  describe('defaultMonstersForTier', () => {
    it('returns dustwaste monsters for unlockLevel 1-3', () => {
      for (const lvl of [1, 2, 3]) {
        const m = defaultMonstersForTier(lvl);
        expect(m.length).toBeGreaterThanOrEqual(3);
        expect(m.every((mon) => mon.id.startsWith('dustwaste'))).toBe(true);
      }
    });

    it('returns redline monsters for unlockLevel 4-7', () => {
      for (const lvl of [4, 5, 6, 7]) {
        const m = defaultMonstersForTier(lvl);
        expect(m.length).toBeGreaterThanOrEqual(3);
        expect(m.every((mon) => mon.id.startsWith('redline'))).toBe(true);
      }
    });

    it('returns ironwood monsters for unlockLevel 8-11', () => {
      for (const lvl of [8, 9, 10, 11]) {
        const m = defaultMonstersForTier(lvl);
        expect(m.every((mon) => mon.id.startsWith('ironwood'))).toBe(true);
      }
    });

    it('returns blastforge monsters for unlockLevel 12-15', () => {
      for (const lvl of [12, 13, 14, 15]) {
        const m = defaultMonstersForTier(lvl);
        expect(m.every((mon) => mon.id.startsWith('blastforge'))).toBe(true);
      }
    });

    it('returns helix monsters for unlockLevel 25+', () => {
      for (const lvl of [25, 30, 50]) {
        const m = defaultMonstersForTier(lvl);
        expect(m.every((mon) => mon.id.startsWith('helix'))).toBe(true);
      }
    });

    it('clamps to tier 1 at unlockLevel 0', () => {
      const m = defaultMonstersForTier(0);
      expect(m.every((mon) => mon.id.startsWith('dustwaste'))).toBe(true);
    });
  });

  describe('getAreaTier', () => {
    it('unlockLevel 1-3 → tier 1', () => {
      expect(getAreaTier(1)).toBe(1);
      expect(getAreaTier(3)).toBe(1);
    });
    it('unlockLevel 4-7 → tier 2', () => {
      expect(getAreaTier(4)).toBe(2);
      expect(getAreaTier(7)).toBe(2);
    });
  });

  describe('resolveAreaMonsters', () => {
    it('returns explicit monsterIds when configured', () => {
      const resolved = resolveAreaMonsters({
        monsterIds: ['dustwaste_brute', 'dustwaste_drone'],
        unlockLevel: 1,
      });
      expect(resolved.map((m) => m.id).sort()).toEqual(['dustwaste_brute', 'dustwaste_drone']);
    });

    it('falls back to tier-derived default when monsterIds is empty', () => {
      const resolved = resolveAreaMonsters({ unlockLevel: 1 });
      expect(resolved.every((m) => m.id.startsWith('dustwaste'))).toBe(true);
    });

    it('falls back to tier-derived default when monsterIds has only invalid ids', () => {
      const resolved = resolveAreaMonsters({
        monsterIds: ['nonexistent_monster'],
        unlockLevel: 4,
      });
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved.every((m) => m.id.startsWith('redline'))).toBe(true);
    });
  });

  describe('pickAreaMonster', () => {
    it('returns null only when no monsters are configured (impossible in practice)', () => {
      // The fallback ensures we always have monsters — even an empty
      // explicit list falls back to the tier default.
      const picked = pickAreaMonster({ unlockLevel: 1 });
      expect(picked).not.toBeNull();
    });

    it('uses explicit monsterWeights when provided', () => {
      // Pin RNG to 0 → first item by weight order.
      const zeroRng = () => 0;
      const picked = pickAreaMonster(
        {
          monsterIds: ['dustwaste_raider', 'dustwaste_elite'],
          monsterWeights: { dustwaste_raider: 100, dustwaste_elite: 0.0001 },
          unlockLevel: 1,
        },
        zeroRng
      );
      expect(picked?.id).toBe('dustwaste_raider');
    });

    it('respects monsterWeights that heavily favor elites', () => {
      // Many rolls at varied RNG should all pick the elite.
      const picked = pickAreaMonster(
        {
          monsterIds: ['dustwaste_raider', 'dustwaste_elite'],
          monsterWeights: { dustwaste_raider: 0.001, dustwaste_elite: 100 },
          unlockLevel: 1,
        },
        () => Math.random() // 0..1
      );
      // Elite is 100, raider is 0.001 — almost certainly picked.
      expect(picked?.id).toBe('dustwaste_elite');
    });

    it('all existing ROAMING_AREAS have valid monsterIds that resolve', () => {
      for (const area of ROAMING_AREAS) {
        if (!area.monsterIds) continue; // areas without explicit rosters use defaults
        for (const id of area.monsterIds) {
          expect(MONSTER_IDS.has(id)).toBe(true);
        }
        const resolved = resolveAreaMonsters(area);
        expect(resolved.length).toBeGreaterThan(0);
      }
    });
  });

  describe('roaming area monsterIds are tier-consistent', () => {
    it('Dustwaste Frontier uses only tier 1 monsters', () => {
      const area = getRoamingArea('dustwaste_frontier');
      const resolved = resolveAreaMonsters(area);
      expect(resolved.every((m) => m.id.startsWith('dustwaste'))).toBe(true);
    });

    it('HelixWorks Labyrinth uses only tier 7 monsters', () => {
      const area = getRoamingArea('helixworks_labyrinth');
      const resolved = resolveAreaMonsters(area);
      expect(resolved.every((m) => m.id.startsWith('helix'))).toBe(true);
    });

    it('all configured monsterIds reference real monsters', () => {
      for (const area of ROAMING_AREAS) {
        if (!area.monsterIds) continue;
        for (const id of area.monsterIds) {
          const m = MONSTERS.find((mon) => mon.id === id);
          expect(m, `area ${area.id} references unknown monster ${id}`).toBeDefined();
        }
      }
    });
  });
});
