import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('DPS consolidation and XP boss regression', () => {
  it('processBossAttempt re-derives DPS server-side from gear objects', () => {
    const chef = readSource('src/server/chef.ts');
    expect(chef).toContain('serverGearEffectiveDps');
    expect(chef).toContain('computeEffectiveDpsFromGear');
    expect(chef).toContain('effectiveDps: serverGearEffectiveDps');
  });

  it('boss XP includes skill tree xpBoostMod (previously only relic affixes)', () => {
    const chef = readSource('src/server/chef.ts');
    expect(chef).toContain('request.skillBonuses?.xpBoostMod ?? 0');
  });

  it('boss XP includes class mod affix xpBoostMod', () => {
    const chef = readSource('src/server/chef.ts');
    expect(chef).toContain("request.classMod?.affixes.forEach");
  });

  it('dead shield helper functions are removed', () => {
    const survival = readSource('src/lib/combat/loadoutSurvival.ts');
    expect(survival).not.toContain('equippedShieldRechargeRate');
    expect(survival).not.toContain('equippedShieldMitigation');
  });
});
