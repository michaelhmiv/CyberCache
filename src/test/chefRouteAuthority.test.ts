import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const claimRouteSource = readFileSync(resolve(process.cwd(), 'src/server/routes/claim.ts'), 'utf8');

describe('Chef route authority boundaries', () => {
  it('does not use the legacy player_items table path', () => {
    expect(claimRouteSource).not.toContain("from('player_items')");
    expect(claimRouteSource).not.toContain(".eq('owner_id'");
  });

  it('derives mutation player identity from request-scoped Supabase Auth instead of trusting the body', () => {
    const authSource = readFileSync(resolve(process.cwd(), 'src/server/routes/chefRouteAuth.ts'), 'utf8');
    expect(claimRouteSource).toContain('getAuthenticatedSupabase');
    expect(authSource).toContain('verifier.auth.getUser(jwt)');
    expect(authSource).toContain('Authorization: `Bearer ${jwt}`');
    expect(claimRouteSource).toContain('const claim: ClaimRequest = { ...body, playerId }');
    expect(claimRouteSource).toContain('const request: BossAttemptRequest = { ...body, playerId, attemptNonce }');
  });

  it('routes salvage through the verified recycle RPC', () => {
    expect(claimRouteSource).toContain("supabase.rpc('cc_recycle_item'");
    expect(claimRouteSource).not.toContain('calculateSalvageYield');
  });
});
