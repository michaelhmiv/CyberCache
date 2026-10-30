import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const claimRouteSource = readFileSync(resolve(process.cwd(), 'src/server/routes/claim.ts'), 'utf8');
// The canonical /api/claim handler lives in roamingHandler.ts; claim.ts's
// duplicate was removed in B3 (it was shadowed by chefRoutes mount order).
const roamingHandlerSource = readFileSync(resolve(process.cwd(), 'src/server/routes/roamingHandler.ts'), 'utf8');

describe('Chef route authority boundaries', () => {
  it('does not use the legacy player_items table path', () => {
    expect(claimRouteSource).not.toContain("from('player_items')");
    expect(claimRouteSource).not.toContain(".eq('owner_id'");
  });

  it('derives mutation player identity from the verified Chef JWT instead of trusting the body', () => {
    // Route B (B6): the June handlers verified a Supabase-issued token
    // per request; the port verifies the Chef JWT (B1) the same way —
    // identity comes from the token's subject, never the request body.
    const authSource = readFileSync(resolve(process.cwd(), 'src/server/routes/chefRouteAuth.ts'), 'utf8');
    expect(claimRouteSource).toContain('getAuthenticatedChefPlayer');
    expect(authSource).toContain('verifyAccessToken(config.jwtSecret, token)');
    expect(authSource).toContain('verified.claims.sub');
    expect(roamingHandlerSource).toContain('const claim: ClaimRequest = { ...body, playerId }');
    expect(claimRouteSource).toContain('const request: BossAttemptRequest = {');
    expect(claimRouteSource).toContain('playerLevel: serverLevel');
    expect(claimRouteSource).toContain('playerCredits: serverCredits');
    // Phase 0 boss loop: the prepared consumable set is validated
    // against DB inventory (resolvePreparedConsumables) instead of
    // the June whole-inventory substitution.
    expect(claimRouteSource).toContain('consumables: resolved.prepared');
    expect(claimRouteSource).toContain('pityCount: serverPityCount');
  });

  it('routes salvage through the verified recycle RPC', () => {
    // Route B (B6): the handler calls the gameplay store, whose Postgres
    // implementation invokes the B3-ported cc_recycle_item.
    expect(claimRouteSource).toContain('store.recycleItem');
    const gameplayStore = readFileSync(resolve(process.cwd(), 'src/server/gameplay/store.ts'), 'utf8');
    expect(gameplayStore).toContain('cc_recycle_item');
    expect(claimRouteSource).not.toContain('calculateSalvageYield');
  });
});
