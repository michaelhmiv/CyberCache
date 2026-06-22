import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

const createClientMock = vi.fn(() => ({
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: 'player-1' } }, error: null })),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

const REPO = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8');
}

beforeEach(() => {
  createClientMock.mockClear();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_SERVICE_KEY;
});

describe('Chef route auth request scoping', () => {
  it('does not mutate a shared Supabase auth session per request', () => {
    const auth = readSource('src/server/routes/chefRouteAuth.ts');
    expect(auth).not.toContain('let _supabase');
    expect(auth).not.toContain('auth.setSession');
    expect(auth).not.toContain('applyJwt');
  });

  it('builds a request-scoped Supabase client with the authenticated bearer JWT', () => {
    const auth = readSource('src/server/routes/chefRouteAuth.ts');
    expect(auth).toContain('getAuthenticatedSupabase');
    expect(auth).toContain('Authorization: `Bearer ${jwt}`');
    expect(auth).toContain('return { playerId: authedPlayerId, supabase: createSupabaseClient(jwt) }');
  });

  it('passes the caller JWT as a request-scoped Authorization header without setSession mutation', async () => {
    const { getAuthenticatedSupabase } = await import('@/server/routes/chefRouteAuth');
    const req = { headers: { authorization: 'Bearer user-jwt' } } as unknown as Request;

    const result = await getAuthenticatedSupabase(req, undefined, 'player-1');

    expect(result.playerId).toBe('player-1');
    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(createClientMock.mock.calls[0][2]?.global).toBeUndefined();
    expect(createClientMock.mock.calls[1][2]?.global?.headers?.Authorization).toBe('Bearer user-jwt');
    expect(createClientMock.mock.results[0].value.auth.getUser).toHaveBeenCalledWith('user-jwt');
    expect(createClientMock.mock.results[1].value.auth.getUser).not.toHaveBeenCalled();
  });

  it('authoritative routes use the request-scoped authenticated client', () => {
    const claim = readSource('src/server/routes/roamingHandler.ts');
    const settlement = readSource('src/server/routes/settleOffline.ts');
    expect(claim).toContain('getAuthenticatedSupabase');
    expect(claim).not.toContain('const supabase = getSupabase();');
    expect(settlement).toContain('getAuthenticatedSupabase');
    expect(settlement).not.toContain('const supabase = getSupabase();');
  });
});
