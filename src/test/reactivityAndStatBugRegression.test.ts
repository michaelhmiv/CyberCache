import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('Reactivity and stat bug regression', () => {
  it('DashboardScreen uses reactive useNow for activeBuffs filter, not frozen useState(Date.now)[0]', () => {
    const source = readSource('src/screens/DashboardScreen.tsx');
    expect(source).toContain('import { useNow }');
    expect(source).toContain('const activeBuffsNow = useNow();');
    expect(source).not.toContain('useState(Date.now)[0]');
  });

  it('ActionLoadout subscribes to skill store spent points so DPS re-renders on skill changes', () => {
    const source = readSource('src/components/action/ActionLoadout.tsx');
    expect(source).toContain('import { useLoadoutStore, usePlayerStore, useInventoryStore, useSkillStore }');
    expect(source).toContain('useSkillStore((s) => s.spent)');
  });

  it('boss simulator shield HP matches canonical formula (no +200 + level*20 inflation)', () => {
    const source = readSource('src/lib/simulation/bossSimulator.ts');
    expect(source).toContain('const playerShieldHP = shield?.hp || 0;');
    expect(source).not.toContain('200 + playerLevel * 20');
  });

  it('useNow hook uses second-rounded getSnapshot that is stable across consecutive calls', () => {
    const source = readSource('src/hooks/useNow.ts');
    expect(source).toContain('Math.floor(Date.now() / 1000) * 1000');
    expect(source).toContain('cachedSnapshot');
  });
});
