import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const claimRouteSource = readFileSync(resolve(process.cwd(), 'src/server/routes/claim.ts'), 'utf8');

describe('Chef route authority boundaries', () => {
  it('does not use the legacy player_items table path', () => {
    expect(claimRouteSource).not.toContain("from('player_items')");
    expect(claimRouteSource).not.toContain(".eq('owner_id'");
  });

  it('derives mutation player identity from Supabase Auth instead of trusting the body', () => {
    expect(claimRouteSource).toContain('requireAuthenticatedPlayerId');
    expect(claimRouteSource).toContain('supabase.auth.getUser(jwt)');
    const roamSource = readFileSync(resolve(process.cwd(), 'src/server/routes/roamingHandler.ts'), 'utf8');
    expect(roamSource).toContain('const claim: ClaimRequest = { ...body, playerId }');
    expect(claimRouteSource).toContain('const request: BossAttemptRequest = { ...body, playerId, attemptNonce }');
  });

  it('routes salvage through the verified recycle RPC', () => {
    expect(claimRouteSource).toContain("supabase.rpc('cc_recycle_item'");
    expect(claimRouteSource).not.toContain('calculateSalvageYield');
  });
});
