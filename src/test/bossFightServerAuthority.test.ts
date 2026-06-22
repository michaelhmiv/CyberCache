import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('Boss fight server authority regression', () => {
  it('reads player profile from Supabase before processing boss attempt', () => {
    const route = readSource('src/server/routes/claim.ts');
    expect(route).toContain(".from('profiles')");
    expect(route).toContain(".select('player_level, credits, consumables, pity_counters')");
    expect(route).toContain(".eq('id', playerId)");
  });

  it('overrides client-supplied consumables with DB-verified inventory', () => {
    const route = readSource('src/server/routes/claim.ts');
    expect(route).toContain('consumables: serverConsumables');
    expect(route).toContain('serverConsumables');
    expect(route).toContain('profile.consumables');
  });

  it('overrides client-supplied playerCredits and playerLevel with DB values', () => {
    const route = readSource('src/server/routes/claim.ts');
    expect(route).toContain('playerLevel: serverLevel');
    expect(route).toContain('playerCredits: serverCredits');
    expect(route).toContain('serverCredits');
  });

  it('overrides client-supplied pityCount with DB pity_counters', () => {
    const route = readSource('src/server/routes/claim.ts');
    expect(route).toContain('pityCount: serverPityCount');
    expect(route).toContain('serverPityCounters');
    expect(route).toContain('pity_counters');
  });

  it('still authenticates the player before reading profile', () => {
    const route = readSource('src/server/routes/claim.ts');
    expect(route).toContain('getAuthenticatedSupabase');
  });
});
