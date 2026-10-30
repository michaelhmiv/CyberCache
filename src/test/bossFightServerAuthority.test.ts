import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('Boss fight server authority regression', () => {
  it('reads player profile from the database before processing boss attempt', () => {
    const route = readSource('src/server/routes/claim.ts');
    // Route B (B6): the profile read goes through the gameplay store;
    // its Postgres select is keyed by the JWT-derived player id.
    const store = readSource('src/server/gameplay/store.ts');
    expect(store).toContain('player_level, credits, consumables, boss_state');
    expect(store).toContain('from public.profiles where id = $1');
    expect(route).toContain('store.getBossProfile(playerId)');
    expect(route.indexOf('store.getBossProfile(playerId)')).toBeLessThan(route.indexOf('processBossAttempt(request)'));
  });

  it('honors the prepared consumable set, validated against DB inventory', () => {
    const route = readSource('src/server/routes/claim.ts');
    // Phase 0 boss loop: the June handler discarded the body's
    // consumables and substituted the ENTIRE DB inventory
    // (`consumables: serverConsumables`), so player prep could never
    // matter. The shipped contract now validates the player's chosen
    // prepared set against the DB-owned counts and passes exactly
    // that set to the Chef.
    expect(route).toContain('resolvePreparedConsumables(body.consumables, ownedConsumables)');
    expect(route).toContain('consumables: resolved.prepared');
    expect(route).toContain('profile.consumables');
    expect(route).not.toContain('serverConsumables');
  });

  it('enforces boss unlocks and derives the entry fee from server state', () => {
    const route = readSource('src/server/routes/claim.ts');
    expect(route).toContain('unlockedBossIds');
    expect(route).toContain("error: 'Boss locked'");
    expect(route).toContain('bossDef.entryCost');
    expect(route).toContain('bossDef.rematchCost');
    expect(route).toContain('entryFee');
  });

  it('overrides client-supplied playerCredits and playerLevel with DB values', () => {
    const route = readSource('src/server/routes/claim.ts');
    expect(route).toContain('playerLevel: serverLevel');
    expect(route).toContain('playerCredits: serverCredits');
    expect(route).toContain('serverCredits');
  });

  it('overrides client-supplied pityCount with DB boss_state pity counters', () => {
    const route = readSource('src/server/routes/claim.ts');
    expect(route).toContain('pityCount: serverPityCount');
    expect(route).toContain('serverPityCounters');
    // Route B (B6): pity lives in boss_state.pityCounters — the June
    // handler selected a `pity_counters` COLUMN that never existed in
    // the schema, so the read always failed; the port derives the
    // counters from boss_state, which cc_apply_chef_boss_attempt
    // itself maintains.
    expect(route).toContain('boss_state');
    expect(route).toContain('pityCounters');
  });

  it('still authenticates the player before reading profile', () => {
    const route = readSource('src/server/routes/claim.ts');
    expect(route).toContain('getAuthenticatedChefPlayer');
  });
});
