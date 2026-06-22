import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('workflow regression audit', () => {
  it('Action screen treats boss prep as boss_fight + bossPhase, not a dead ActivityKind branch', () => {
    const source = read('screens/ActionScreenContextual.tsx');

    expect(source).toContain("const isBossPrep = currentKind === 'boss_fight' && bossPhase === 'prep'");
    expect(source).toContain('if (isBossPrep) return <BossPrepPanel');
    expect(source).toContain("(label === 'Boss Prep' && isBossPrep)");
    expect(source).not.toMatch(/currentKind === ['"]boss_prep['"]/);
  });

  it('runtime display snapshots do not persist or restore boss attempt history', () => {
    const source = read('store/runtimeSupabaseSync.ts');
    expect(source).not.toContain('attemptHistory');
  });

  it('Market My Listings price sort matches the descending label', () => {
    const source = read('screens/MarketScreen.tsx');
    expect(source).toContain('<option value="price">Sort: Price ↓</option>');
    expect(source).toContain("if (myListSort === 'price') return b.price - a.price;");
  });

  it('Dashboard secondary boss action opens boss targeting when no boss is selected instead of cracking caches', () => {
    const source = read('screens/DashboardScreen.tsx');
    expect(source).toContain("if (!currentBoss) {\n      onNavigate('fight');");
    expect(source).toContain("secondaryActionLabel={currentBoss ? 'Prep Boss' : 'Choose Boss'}");
  });
});
