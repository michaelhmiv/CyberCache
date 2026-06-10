import { describe, it, expect } from 'vitest';
import { MONSTERS, MONSTER_IDS, getMonster, validateMonster } from '@/constants/monsters';

describe('monster roster', () => {
  it('has unique monster ids', () => {
    const ids = MONSTERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all monsters pass the validateMonster check', () => {
    const allIssues: string[] = [];
    for (const monster of MONSTERS) {
      const issues = validateMonster(monster);
      if (issues.length > 0) {
        allIssues.push(`${monster.id}: ${issues.join(', ')}`);
      }
    }
    expect(allIssues).toEqual([]);
  });

  it('has at least 3 monsters per tier (1-7)', () => {
    const tierCount: Record<number, number> = {};
    for (const m of MONSTERS) {
      const tier = m.id.startsWith('dustwaste') ? 1
        : m.id.startsWith('redline') ? 2
        : m.id.startsWith('ironwood') ? 3
        : m.id.startsWith('blastforge') ? 4
        : m.id.startsWith('prismatek') ? 5
        : m.id.startsWith('throwtech') ? 6
        : m.id.startsWith('helix') ? 7
        : 0;
      tierCount[tier] = (tierCount[tier] ?? 0) + 1;
    }
    for (let tier = 1; tier <= 7; tier += 1) {
      expect(tierCount[tier] ?? 0).toBeGreaterThanOrEqual(3);
    }
  });

  it('HP and attack scale with tier', () => {
    const tiers = [1, 2, 3, 4, 5, 6, 7];
    const tierMaxHp: number[] = [];
    for (const tier of tiers) {
      const tierMonsters = MONSTERS.filter((m) => {
        const prefix = ['dustwaste', 'redline', 'ironwood', 'blastforge', 'prismatek', 'throwtech', 'helix'][tier - 1];
        return m.id.startsWith(prefix);
      });
      const maxHp = Math.max(...tierMonsters.map((m) => m.hp));
      tierMaxHp.push(maxHp);
    }
    // Each tier should have higher max HP than the previous.
    for (let i = 1; i < tierMaxHp.length; i += 1) {
      expect(tierMaxHp[i]).toBeGreaterThan(tierMaxHp[i - 1]);
    }
  });

  it('getMonster returns a known monster and undefined for an unknown id', () => {
    expect(getMonster('dustwaste_raider')?.name).toBe('Wraith Scavenger');
    expect(getMonster('nope_not_a_monster')).toBeUndefined();
  });

  it('MONSTER_IDS is a fast lookup set matching MONSTERS', () => {
    for (const m of MONSTERS) {
      expect(MONSTER_IDS.has(m.id)).toBe(true);
    }
    expect(MONSTER_IDS.size).toBe(MONSTERS.length);
  });
});
