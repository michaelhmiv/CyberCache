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
    expect(handler).toContain(".select('last_claimed_tick, consumables')");
    expect(handler).toContain('consumableInventory');
    expect(handler).toContain('claimWithConsumables');
    expect(handler).toContain("supabase.rpc('cc_consume_roaming_consumables'");
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
