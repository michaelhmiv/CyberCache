import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Roaming reward authority — source-level contract tests.
 *
 * In the server-authoritative architecture the idle ticker performs NO
 * local simulation. These tests read the source directly to enforce the
 * structural contract that can't be verified by store assertions alone:
 *   - The local sim functions (applyKillCycleTick, applySurvivalTick,
 *     applyBossFightTick, rollPreviewEvents) no longer exist.
 *   - The only store-writing path after a claim is applyServerRewards.
 *   - The ticker sends claims via submitClaim and reads the server's
 *     killsRecorded tally (no local kill-cycle XP attribution).
 *   - boss_fight activities are a no-op for the ticker.
 *   - playerSlice has no addXP/addCredits/addScrap/_pending — rewards are
 *     applied via the pure-replace syncFromServer.
 */
const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('Roaming reward authority', () => {
  it('the idle ticker has no local kill-cycle simulation — applyKillCycleTick was removed', () => {
    const source = readSource('src/store/slices/idleTickerSlice.ts');
    expect(source).not.toContain('applyKillCycleTick');
    expect(source).not.toContain('applySurvivalTick');
    expect(source).not.toContain('applyBossFightTick');
    expect(source).not.toContain('rollPreviewEvents');
  });

  it('the only store-writing path after a claim is applyServerRewards', () => {
    const source = readSource('src/store/slices/idleTickerSlice.ts');
    expect(source).toContain('const applyServerRewards');
    // applyServerRewards is the sole writer — it delegates to syncVerifiedResult
    // for the profile/items/loadout, then syncs killCycle + survival from the
    // server's authoritative payload.
    expect(source).toContain('syncVerifiedResult(payload)');
    expect(source).toContain('syncFromServer');
  });

  it('the ticker sends claims to the Chef via submitClaim and reads kills from rewards.killsRecorded', () => {
    const source = readSource('src/store/slices/idleTickerSlice.ts');
    expect(source).toContain("await import('@/lib/chef/chefClient')");
    expect(source).toContain('submitClaim');
    expect(source).toContain('chefResult.rewards?.killsRecorded');
  });

  it('the ticker is a no-op for boss_fight activities (boss fights are resolved by RPC, not per-tick sim)', () => {
    const source = readSource('src/store/slices/idleTickerSlice.ts');
    expect(source).toContain("activity.kind !== 'roaming_loot'");
  });

  it('does not award local kill-cycle XP — playerSlice has no addXP/addCredits/_pending', () => {
    const source = readSource('src/store/slices/playerSlice.ts');
    // The local reward-mutation methods were removed; resources are set
    // exclusively via the server's pure-replace syncFromServer.
    expect(source).not.toContain('addXP(');
    expect(source).not.toContain('addCredits(');
    expect(source).not.toContain('addScrap(');
    expect(source).not.toContain('addCacheKeys(');
    expect(source).not.toContain('addCacheKeyFragments(');
    expect(source).not.toContain('_pending');
    expect(source).toContain('syncFromServer');
  });
});
