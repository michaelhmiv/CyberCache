import { describe, it, expect } from 'vitest';
import { PRODUCTIVE_ACTIVITY_LABELS, IDLE_ACTIVITY, DEFAULT_BOSS_PHASE, isBossPhase } from '@/types/activity';
import type { BossPhase } from '@/types/activity';

describe('ActivityKind — boss_prep removed, bossPhase added', () => {
  it('does not include boss_prep in the union (via label map keys)', () => {
    const labels: Record<string, string> = PRODUCTIVE_ACTIVITY_LABELS;
    expect(labels.boss_prep).toBeUndefined();
  });

  it('still includes boss_fight with the right label', () => {
    expect(PRODUCTIVE_ACTIVITY_LABELS.boss_fight).toBe('Boss fight');
  });

  it('IDLE_ACTIVITY has bossPhase prep', () => {
    expect(IDLE_ACTIVITY.bossPhase).toBe('prep');
  });

  it('DEFAULT_BOSS_PHASE is prep', () => {
    expect(DEFAULT_BOSS_PHASE).toBe('prep');
  });

  it('isBossPhase narrows correctly', () => {
    expect(isBossPhase('prep')).toBe(true);
    expect(isBossPhase('fight')).toBe(true);
    expect(isBossPhase('nope')).toBe(false);
    expect(isBossPhase(null)).toBe(false);
    expect(isBossPhase(undefined)).toBe(false);
  });

  it('BossPhase type is "prep" | "fight"', () => {
    const valid: BossPhase[] = ['prep', 'fight'];
    expect(valid).toHaveLength(2);
  });
});
