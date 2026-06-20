import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('server-authoritative loadout invariant', () => {
  it('ActionScreenContextual does not feed best inventory weapon into activity truth', () => {
    const source = read('src/screens/ActionScreenContextual.tsx');
    expect(source).not.toMatch(/activityWeapon[\s\S]{0,240}best[A-Za-z]*Weapon/);
    expect(source).not.toMatch(/buildRoamingLootActivity\([^\n]*best[A-Za-z]*Weapon/);
    expect(source).not.toMatch(/buildBossFightActivity\([^\n]*best[A-Za-z]*Weapon/);
  });

  it('BossPrepModal does not fill equipped slots from inventory fallback', () => {
    const source = read('src/components/fight/BossPrepModal.tsx');
    expect(source).not.toMatch(/loadout\.getWeapon\('[^']+'\)\s*\|\|\s*inventory\.getWeapons/);
  });

  it('LiveTurfDiorama does not render a fallback weapon when weapon is absent', () => {
    const source = read('src/components/dashboard/LiveTurfDiorama.tsx');
    expect(source).not.toContain('patrol kit');
    expect(source).not.toMatch(/WeaponIllustration[\s\S]{0,240}weapon=\{weapon\}[\s\S]{0,240}fallback/);
  });

  it('WeaponIllustration fallback is opt-in only', () => {
    const source = read('src/components/weapon/WeaponIllustration.tsx');
    expect(source).toContain('allowFallbackSpec');
    expect(source).toMatch(/if \(!weapon && !allowFallbackSpec\) return null/);
  });

  it('BossSelectModal does not use inventory weapon before equipped weapon for projection', () => {
    const source = read('src/components/fight/BossSelectModal.tsx');
    // After fix: equipped weapons are checked FIRST, inventory only as
    // clearly-labeled preview when nothing is equipped.
    // Guard: no raw inventory.getWeapons() before loadout.getWeapon in the
    // same expression chain.
    expect(source).not.toMatch(/inventory\.getWeapons\(\)[\s\S]{0,120}\?\?\s*loadout\.getWeapon/);
  });
});
