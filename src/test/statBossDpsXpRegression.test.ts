import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('Character stat boss DPS regression', () => {
  it('boss-relative Effective DPS includes boss-specific skill bonuses', () => {
    const stats = readSource('src/lib/stats/characterStats.ts');
    expect(stats).toContain('bossSkillBonus');
    expect(stats).toContain("skillTotal(spentSkills, 'bossDamageMod')");
    expect(stats).toContain("skillTotal(spentSkills, 'weaknessMatchDamage')");
    expect(stats).toContain('totalDpsForBoss = baseDpsForBoss * (1 + weaponDamageBonus + affixDamageBonus + bossSkillBonus + cacheRankDamageBonus)');
  });

  it('roaming XP formula includes skill tree xpBoostMod', () => {
    const chef = readSource('src/server/chef.ts');
    expect(chef).toContain('skillBonuses.xpBoostMod');
  });
});
