import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bossPrepSource = () => readFileSync(resolve(process.cwd(), 'src/components/fight/BossEncounterPanel.tsx'), 'utf8');

describe('BossEncounterPanel authority boundaries', () => {
  it('does not execute boss attempts or mutate progression directly', () => {
    const source = bossPrepSource();
    [
      'executeBossAttempt',
      'addCredits(',
      'addXP(',
      'removeConsumable(',
      'generateAndAdd(',
      'defeatBoss(',
      'resetPity(',
      'unlockBoss(',
      'incrementPity(',
      'removeCredits(',
    ].forEach((pattern) => {
      expect(source).not.toContain(pattern);
    });
  });

  it('does not contain a client fallback that generates boss loot', () => {
    const source = bossPrepSource();
    expect(source).toContain('verifyBossFight');
    expect(source).toContain('syncBossAttemptResult');
    expect(source).not.toMatch(/catch[\s\S]*Boss Drop[\s\S]*generateAndAdd/);
  });
});
