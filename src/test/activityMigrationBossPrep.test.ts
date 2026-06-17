import { describe, it, expect } from 'vitest';
import { migrateActivityForBossCollapse } from '@/lib/activity/activityMigration';

describe('migrateActivityForBossCollapse', () => {
  it('renames boss_prep to boss_fight with bossPhase prep', () => {
    const out = migrateActivityForBossCollapse({
      kind: 'boss_prep' as any,
      startedAt: 't',
    } as any);
    expect(out.kind).toBe('boss_fight');
    expect(out.bossPhase).toBe('prep');
  });

  it('back-fills bossPhase prep for pre-collapse boss_fight rows', () => {
    const out = migrateActivityForBossCollapse({
      kind: 'boss_fight',
      startedAt: 't',
    } as any);
    expect(out.bossPhase).toBe('prep');
  });

  it('leaves bossPhase alone if already set on a boss_fight row', () => {
    const out = migrateActivityForBossCollapse({
      kind: 'boss_fight',
      bossPhase: 'fight',
    } as any);
    expect(out.bossPhase).toBe('fight');
  });

  it('passes through non-boss activities unchanged', () => {
    const input = { kind: 'crafting' as const, startedAt: 't' };
    const out = migrateActivityForBossCollapse(input as any);
    expect(out).toEqual(input);
  });

  it('is idempotent — running twice produces the same output', () => {
    const first = migrateActivityForBossCollapse({ kind: 'boss_prep' as any } as any);
    const second = migrateActivityForBossCollapse(first);
    expect(second).toEqual(first);
  });
});
