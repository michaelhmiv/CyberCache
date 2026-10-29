/**
 * Chef-issued JWTs (Route B, slice B1).
 *
 * The Chef is its own identity provider on Railway: it issues HS256 access
 * tokens (1h) and opaque rotating refresh tokens (30d, stored hashed).
 * Implemented on Node's crypto only — no new JWT dependency — with
 * constant-time signature comparison and strict alg/typ checks.
 */
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const CHEF_JWT_ISSUER = 'cybercache-chef';
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccessTokenClaims {
  sub: string;
  iss: string;
  typ: 'access';
  iat: number;
  exp: number;
  jti: string;
  guest: boolean;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(secret: string, signingInput: string): string {
  return createHmac('sha256', secret).update(signingInput).digest('base64url');
}

export function issueAccessToken(secret: string, accountId: string, isGuest: boolean, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const claims: AccessTokenClaims = {
    sub: accountId,
    iss: CHEF_JWT_ISSUER,
    typ: 'access',
    iat,
    exp: iat + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomBytes(12).toString('base64url'),
    guest: isGuest,
  };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.${sign(secret, `${header}.${payload}`)}`;
}

export type VerifyResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_issuer' | 'wrong_type' };

export function verifyAccessToken(secret: string, token: string, now = new Date()): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, payload, signature] = parts;
  let headerJson: { alg?: string; typ?: string };
  let claims: AccessTokenClaims;
  try {
    headerJson = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (headerJson.alg !== 'HS256' || headerJson.typ !== 'JWT') return { ok: false, reason: 'malformed' };
  const expected = sign(secret, `${header}.${payload}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  if (claims.iss !== CHEF_JWT_ISSUER) return { ok: false, reason: 'wrong_issuer' };
  if (claims.typ !== 'access') return { ok: false, reason: 'wrong_type' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return { ok: false, reason: 'malformed' };
  return { ok: true, claims };
}

/** Refresh tokens are opaque; only their SHA-256 hash is ever stored. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
