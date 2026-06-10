import { describe, it, expect } from 'vitest';
import { pickNextTarget, xpForKill, shouldShowSpawnEffect } from '@/lib/combat/killCycleHelpers';
import { requireMonster } from '@/constants/monsters';

describe('killCycleHelpers', () => {
  describe('pickNextTarget', () => {
    it('returns null for an empty roster', () => {
      expect(pickNextTarget([], null)).toBeNull();
    });

    it('returns the only monster for a single-member roster', () => {
      const roster = [requireMonster('dustwaste_raider')];
      expect(pickNextTarget(roster, null)?.id).toBe('dustwaste_raider');
      expect(pickNextTarget(roster, 'dustwaste_raider')?.id).toBe('dustwaste_raider');
    });

    it('returns the first roster member when previousId is null', () => {
      const roster = [requireMonster('dustwaste_raider'), requireMonster('dustwaste_drone')];
      expect(pickNextTarget(roster, null)?.id).toBe('dustwaste_raider');
    });

    it('returns the first roster member when previousId is not in roster', () => {
      const roster = [requireMonster('dustwaste_raider'), requireMonster('dustwaste_drone')];
      expect(pickNextTarget(roster, 'unknown_monster')?.id).toBe('dustwaste_raider');
    });

    it('rotates to the next monster in the roster', () => {
      const roster = [
        requireMonster('dustwaste_raider'),
        requireMonster('dustwaste_drone'),
        requireMonster('dustwaste_brute'),
      ];
      expect(pickNextTarget(roster, 'dustwaste_raider')?.id).toBe('dustwaste_drone');
      expect(pickNextTarget(roster, 'dustwaste_drone')?.id).toBe('dustwaste_brute');
      expect(pickNextTarget(roster, 'dustwaste_brute')?.id).toBe('dustwaste_raider'); // wrap
    });

    it('never returns the same monster twice in a row (roster > 1)', () => {
      const roster = [
        requireMonster('dustwaste_raider'),
        requireMonster('dustwaste_drone'),
      ];
      for (let i = 0; i < 10; i += 1) {
        const last = useKillCycleStoreStub.lastKilled ?? 'dustwaste_raider';
        const next = pickNextTarget(roster, last);
        expect(next?.id).not.toBe(last);
        useKillCycleStoreStub.lastKilled = next?.id ?? null;
      }
    });
  });

  describe('xpForKill', () => {
    it('returns the monster.xpReward for the base case', () => {
      const monster = requireMonster('dustwaste_raider');
      expect(xpForKill(monster)).toBe(monster.xpReward);
    });

    it('applies a weakness bonus multiplier', () => {
      const monster = requireMonster('dustwaste_raider');
      expect(xpForKill(monster, { weaknessBonus: 0.5 })).toBe(Math.floor(monster.xpReward * 1.5));
    });

    it('floors fractional XP', () => {
      const monster = requireMonster('dustwaste_drone'); // xpReward 9
      // 9 * 1.333 = 11.997 → floor to 11
      expect(xpForKill(monster, { weaknessBonus: 0.333 })).toBe(11);
    });
  });

  describe('shouldShowSpawnEffect', () => {
    it('returns true for any monster (placeholder for future logic)', () => {
      expect(shouldShowSpawnEffect(requireMonster('dustwaste_raider'))).toBe(true);
      expect(shouldShowSpawnEffect(requireMonster('dustwaste_elite'))).toBe(true);
    });
  });
});

// Local stub to keep the rotation test self-contained.
const useKillCycleStoreStub: { lastKilled: string | null } = { lastKilled: null };
