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
    // Audit fix A (CONS-03): the terminal 'resolved' phase keeps the
    // same panel mounted for the result.
    expect(source).toContain('if (isBossPrep || isBossFight || isBossResolved)');
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

  it('Home stage secondary boss action opens boss targeting when a boss fight is staged instead of cracking caches', () => {
    // Flow-fix F16, Wave B form: the diorama lives on Home's stage
    // (ActionScreenContextual) now. Its secondary action during a
    // boss fight is "Choose Boss" and fires the App-level boss
    // chooser via onOpenBossSelect — never a cache or tab switch.
    // (Behavioral coverage: flowScreens F16 successor test.)
    const source = read('screens/ActionScreenContextual.tsx');
    expect(source).toContain("if (currentKind === 'boss_fight') {\n      onOpenBossSelect();");
    expect(source).toContain("currentKind === 'boss_fight' ? 'Choose Boss'");
  });
});
