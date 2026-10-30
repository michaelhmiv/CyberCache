/**
 * Chef route auth — request scope (Route B, slice B6).
 *
 * The June suite proved the Supabase-era property that mattered: each
 * request's identity was resolved from THAT request's bearer token —
 * a request-scoped verifier client, never a shared or user-agnostic
 * one — and a body playerId disagreeing with the token was rejected.
 * On Route B the credential is the Chef JWT (B1) and verification is
 * stateless HMAC checking, which makes the property structural: there
 * is no client object to scope. This suite proves the same contract
 * against getAuthenticatedChefPlayer directly: header or body token,
 * per-request resolution with no bleed between requests, 401 for
 * missing/invalid tokens, 403 for a mismatched claimed playerId.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { ChefRouteError, getAuthenticatedChefPlayer } from '../server/routes/chefRouteAuth';
import { issueAccessToken } from '../server/auth/tokens';
import type { AuthConfig } from '../server/auth/routes';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const config: AuthConfig = { jwtSecret: SECRET };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function reqWith(headerToken?: string): Request {
  return {
    header: (name: string) =>
      name.toLowerCase() === 'authorization' && headerToken ? `Bearer ${headerToken}` : undefined,
  } as unknown as Request;
}

describe('Chef route auth request scope', () => {
  it('resolves identity from the Authorization header token', () => {
    const token = issueAccessToken(SECRET, A, false);
    expect(getAuthenticatedChefPlayer(config, reqWith(token))).toBe(A);
  });

  it('resolves identity from the body jwt when no header is present', () => {
    const token = issueAccessToken(SECRET, B, true);
    expect(getAuthenticatedChefPlayer(config, reqWith(), token)).toBe(B);
  });

  it('prefers the header token over the body jwt', () => {
    const headerToken = issueAccessToken(SECRET, A, false);
    const bodyToken = issueAccessToken(SECRET, B, false);
    expect(getAuthenticatedChefPlayer(config, reqWith(headerToken), bodyToken)).toBe(A);
  });

  it('resolves each request independently — no cross-request bleed', () => {
    const tokenA = issueAccessToken(SECRET, A, false);
    const tokenB = issueAccessToken(SECRET, B, false);
    expect(getAuthenticatedChefPlayer(config, reqWith(tokenA))).toBe(A);
    expect(getAuthenticatedChefPlayer(config, reqWith(tokenB))).toBe(B);
    expect(getAuthenticatedChefPlayer(config, reqWith(tokenA))).toBe(A);
  });

  it('rejects a missing token with the June 401 shape', () => {
    try {
      getAuthenticatedChefPlayer(config, reqWith());
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ChefRouteError);
      expect((err as ChefRouteError).status).toBe(401);
      expect((err as ChefRouteError).message).toBe('Authentication required');
      expect((err as ChefRouteError).detail).toBe('Missing bearer token');
    }
  });

  it('rejects an invalid token with 401', () => {
    expect(() => getAuthenticatedChefPlayer(config, reqWith('not-a-token'))).toThrowError(
      expect.objectContaining({ status: 401, message: 'Authentication required' }),
    );
    const foreign = issueAccessToken('a-different-secret-that-is-long-enough', A, false);
    expect(() => getAuthenticatedChefPlayer(config, reqWith(foreign))).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('rejects a claimed playerId that disagrees with the token (403)', () => {
    const token = issueAccessToken(SECRET, A, false);
    expect(() => getAuthenticatedChefPlayer(config, reqWith(token), undefined, B)).toThrowError(
      expect.objectContaining({ status: 403, message: 'Player mismatch' }),
    );
    // A matching claim passes.
    expect(getAuthenticatedChefPlayer(config, reqWith(token), undefined, A)).toBe(A);
  });

  it('keeps verification stateless — no external auth client in the module', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server/routes/chefRouteAuth.ts'), 'utf8');
    expect(source).toContain('verifyAccessToken');
    expect(source).not.toContain('createClient');
    expect(source).not.toContain('@supabase');
  });
});
