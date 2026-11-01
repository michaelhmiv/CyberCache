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
    // Phase 0 Slice 1: one BossEncounterPanel serves both phases (prep
    // stages the attempt; fight animates the Chef's returned outcome).
    expect(source).toContain('if (isBossPrep || isBossFight)');
    expect(source).toContain('return <BossEncounterPanel');
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
    // Flow-fix F16: "Choose Boss" opens the App-level boss chooser via
    // the onOpenBossSelect callback (a bare tab switch into a boss-less
    // Fight tab was the audited break); navigation is only the fallback
    // when no chooser is wired.
    expect(source).toContain('if (onOpenBossSelect) {\n        onOpenBossSelect();');
    expect(source).toContain("secondaryActionLabel={currentBoss ? 'Prep Boss' : 'Choose Boss'}");
  });
});
