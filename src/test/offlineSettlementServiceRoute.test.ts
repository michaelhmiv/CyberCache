import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

describe('offline settlement route contract', () => {
  it('server index mounts the route override bundle', () => {
    const index = readSource('src/server/index.ts');
    expect(index).toContain("from './routes/chefRoutes'");
  });

  it('offline settlement route passes the verified player id into the RPC', () => {
    const route = readSource('src/server/routes/settleOffline.ts');
    expect(route).toContain('requireAuthenticatedPlayerId');
    expect(route).toContain("cc_settle_offline_roaming");
    expect(route).toContain('_player_id: playerId');
  });

  it('offline settlement overload uses the route-verified player id', () => {
    const migration = readSource('supabase/migrations/20260612174500_add_player_id_offline_settlement_rpc.sql');
    expect(migration).toContain('_player_id uuid');
    expect(migration).toContain('actor uuid := _player_id');
    expect(migration).not.toContain('actor uuid := auth.uid()');
  });
});
