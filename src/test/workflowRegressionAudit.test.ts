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
    // Wave C: the mode surface that lights for boss prep is the
    // Home mode rail now (the compact selector grid is gone) —
    // its boss stop lights across prep/fight/resolved, all of
    // which are boss_fight + phase, never a 'boss_prep' kind.
    expect(source).toContain("(isBossPrep || isBossFight || isBossResolved) ? 'boss'");
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

  it('Home boss selection opens a picker in place when a boss fight is staged instead of cracking caches', () => {
    // Flow-fix F16, drift-fix F2 form: the stage no longer carries
    // a Choose Boss door (its in-stage action bar is retired).
    // Boss selection from a staged fight lives on the boss
    // workspace: the encounter panel's Change Boss opens the
    // local picker sheet, and the App-level chooser stays wired
    // for the panels and the no-target fallback — never a cache
    // or tab switch. (Behavioral coverage: flowScreens F16
    // successor test.)
    const source = read('screens/ActionScreenContextual.tsx');
    expect(source).toContain('onChangeBoss={() => setShowBossPicker(true)}');
    expect(source).toContain('openBoss: onOpenBossSelect');
    expect(source).not.toContain("currentKind === 'boss_fight' ? 'Choose Boss'");
  });
});
