import type { ActiveActivity, BossPhase } from '@/types/activity';
import { DEFAULT_BOSS_PHASE } from '@/types/activity';

/**
 * One-shot migration for the boss_prep → boss_fight collapse.
 *
 *   - Pre-collapse `kind: 'boss_prep'` becomes `kind: 'boss_fight', bossPhase: 'prep'`.
 *   - Pre-collapse `kind: 'boss_fight'` without `bossPhase` gets `bossPhase: 'prep'`.
 *   - Everything else is passed through unchanged.
 *
 * This runs on every activity hydration. Idempotent: running it twice
 * on the same input produces the same output.
 */
export function migrateActivityForBossCollapse<T extends Partial<ActiveActivity>>(input: T): T {
  const raw = input as Record<string, unknown>;
  if (raw.kind === 'boss_prep') {
    return { ...input, kind: 'boss_fight' as ActiveActivity['kind'], bossPhase: DEFAULT_BOSS_PHASE };
  }
  if (raw.kind === 'boss_fight' && (raw.bossPhase == null || !(typeof raw.bossPhase === 'string' && (raw.bossPhase === 'prep' || raw.bossPhase === 'fight')))) {
    return { ...input, bossPhase: DEFAULT_BOSS_PHASE };
  }
  return input;
}
