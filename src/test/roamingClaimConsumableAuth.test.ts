import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('Roaming claim server authority regression', () => {
  it('canonical roaming claim reads consumable inventory from profiles table', () => {
    const handler = readSource('src/server/routes/roamingHandler.ts');
    // Route B (B6): the read goes through the gameplay store — its SQL
    // selects the same columns from profiles.
    const store = readSource('src/server/gameplay/store.ts');
    expect(store).toContain('select player_level, skill_spends, last_claimed_tick, consumables, scrap_remainder, credits_remainder, xp_remainder from public.profiles');
    expect(handler).toContain('store.getRoamingProfile(playerId)');
    expect(handler).toContain('consumableInventory');
    expect(handler).toContain('claimWithConsumables');
    expect(handler).toContain('store.consumeRoamingConsumables');
    expect(store).toContain('cc_consume_roaming_consumables');
  });

  it('canonical settlement handler passes consumer inventory to chef', () => {
    const settlement = readSource('src/server/routes/settleOffline.ts');
    expect(settlement).toContain('consumableInventory: (profile.consumables ?? {})');
  });

  it('claim result includes consumedConsumables for client sync', () => {
    const handler = readSource('src/server/routes/roamingHandler.ts');
    expect(handler).toContain('consumedConsumables');
  });
});
