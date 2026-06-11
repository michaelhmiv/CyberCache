import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Roaming reward authority', () => {
  it('does not award local kill-cycle XP before Chef rewards resolve', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/store/slices/idleTickerSlice.ts'), 'utf8');
    const killCycleStart = source.indexOf('const applyKillCycleTick');
    const chefClaimStart = source.indexOf('const chefResult = await submitClaim');
    expect(killCycleStart).toBeGreaterThanOrEqual(0);
    expect(chefClaimStart).toBeGreaterThan(killCycleStart);
    const localKillCycleBlock = source.slice(killCycleStart, chefClaimStart);
    expect(localKillCycleBlock).not.toContain('addXP(');
    expect(source).toContain('chefResult.rewards?.killsRecorded');
  });
});
