import { describe, it, expect } from 'vitest';
import type { ActiveActivity } from '@/types/activity';
import { migrateActivityForBossCollapse } from '@/lib/activity/activityMigration';

describe('migrateActivityForBossCollapse', () => {
  it('renames boss_prep to boss_fight with bossPhase prep', () => {
    // The pre-collapse input is a valid value but the literal 'boss_prep'
    // is no longer in the ActivityKind union — cast through unknown to
    // simulate a row loaded from old persisted state.
    const out = migrateActivityForBossCollapse({
      kind: 'boss_prep',
      startedAt: 't',
    } as unknown as ActiveActivity);
    expect(out.kind).toBe('boss_fight');
    expect(out.bossPhase).toBe('prep');
  });

  it('back-fills bossPhase prep for pre-collapse boss_fight rows', () => {
    const out = migrateActivityForBossCollapse({
      kind: 'boss_fight',
      startedAt: 't',
    } as Partial<ActiveActivity>);
    expect(out.bossPhase).toBe('prep');
  });

  it('leaves bossPhase alone if already set on a boss_fight row', () => {
    const out = migrateActivityForBossCollapse({
      kind: 'boss_fight',
      bossPhase: 'fight',
    } as Partial<ActiveActivity>);
    expect(out.bossPhase).toBe('fight');
  });

  it('passes through non-boss activities unchanged', () => {
    const input: Partial<ActiveActivity> = { kind: 'crafting', startedAt: 't' };
    const out = migrateActivityForBossCollapse(input);
    expect(out).toEqual(input);
  });

  it('is idempotent — running twice produces the same output', () => {
    const first = migrateActivityForBossCollapse({ kind: 'boss_prep' } as unknown as ActiveActivity);
    const second = migrateActivityForBossCollapse(first);
    expect(second).toEqual(first);
  });
});
