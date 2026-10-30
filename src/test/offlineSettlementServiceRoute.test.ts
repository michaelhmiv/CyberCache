import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('offline settlement route contract', () => {
  it('server index mounts the gameplay route bundle', () => {
    // Route B (B6): the legacy gameplay routes mount from
    // src/server/gameplay/routes.ts inside the Route B gate.
    const index = readSource('src/server/index.ts');
    expect(index).toContain("from './gameplay/routes'");
    expect(index).toContain('mountGameplayRoutes');
  });

  it('offline settlement route passes the verified player id into the RPC', () => {
    // Route B (B6): identity comes from the Chef JWT helper, and the
    // store call carries the verified id into cc_settle_offline_roaming.
    const route = readSource('src/server/routes/settleOffline.ts');
    expect(route).toContain('getAuthenticatedChefPlayer');
    expect(route).toContain('store.settleOfflineRoaming(playerId, body.settlementNonce');
    const store = readSource('src/server/gameplay/store.ts');
    expect(store).toContain('cc_settle_offline_roaming');
  });

  it('offline settlement overload uses the route-verified player id', () => {
    // The ported definition lives in the Route B migration set (B6);
    // the auth.uid() overload was not ported.
    const migration = readSource('db/migrations/0007_chef_gameplay_appliers.sql');
    expect(migration).toContain('_player_id uuid');
    expect(migration).toContain('actor uuid := _player_id');
    expect(migration).not.toContain('actor uuid := auth.uid()');
  });
});
