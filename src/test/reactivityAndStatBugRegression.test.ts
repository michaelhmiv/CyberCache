import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('Reactivity and stat bug regression', () => {
  it('the activeBuffs expiry filter uses reactive useNow, not frozen useState(Date.now)[0]', () => {
    // The filter rode the deck until the Home consolidation
    // (2026-11-03) folded the buff glance into the hero
    // rundown's buff line — the reactive-clock law moved with
    // it. The deck's own clock (the gain-toast lane) is pinned
    // to the same law.
    const rundown = readSource('src/components/dashboard/HeroRundown.tsx');
    expect(rundown).toContain('import { useNow }');
    expect(rundown).toContain('const now = useNow();');
    expect(rundown).toContain('buff.expiresAt > now');
    expect(rundown).not.toContain('useState(Date.now)[0]');
    const deck = readSource('src/components/dashboard/DashboardDeck.tsx');
    expect(deck).toContain('const now = useNow();');
    expect(deck).not.toContain('useState(Date.now)[0]');
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
