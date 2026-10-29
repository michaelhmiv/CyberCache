/**
 * Google identity verification (Route B, slice B1.5).
 *
 * The app signs in natively (Play services / Credential Manager via the
 * Capacitor social-login plugin) and hands the Chef a Google ID token.
 * The Chef verifies it properly: RS256 signature against Google's JWKS,
 * issuer, audience (our OAuth client ids), and expiry — then the caller
 * maps the token's subject to an account via auth_identities.
 */
import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

export interface GoogleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

export type JwksFetcher = () => Promise<{ keys: Record<string, unknown>[] }>;

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const CACHE_MS = 60 * 60 * 1000;

let cachedKeys: { fetchedAt: number; keys: Map<string, KeyObject> } | null = null;

export const defaultJwksFetcher: JwksFetcher = async () => {
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Google JWKS fetch failed: ${res.status}`);
  return (await res.json()) as { keys: Record<string, unknown>[] };
};

async function keyFor(kid: string, fetcher: JwksFetcher): Promise<KeyObject | null> {
  if (!cachedKeys || Date.now() - cachedKeys.fetchedAt > CACHE_MS) {
    const jwks = await fetcher();
    const keys = new Map<string, KeyObject>();
    for (const jwk of jwks.keys) {
      if (typeof jwk.kid === 'string') {
        try {
          keys.set(jwk.kid, createPublicKey({ key: jwk as never, format: 'jwk' }));
        } catch { /* skip unusable key */ }
      }
    }
    cachedKeys = { fetchedAt: Date.now(), keys };
  }
  return cachedKeys.keys.get(kid) ?? null;
}

/** Test hook: drop the JWKS cache between cases. */
export function resetGoogleKeyCache(): void {
  cachedKeys = null;
}

export class GoogleTokenError extends Error {
  constructor(public readonly reason: string) {
    super(`Google ID token rejected: ${reason}`);
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientIds: string[],
  fetcher: JwksFetcher = defaultJwksFetcher,
  now = new Date(),
): Promise<GoogleIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new GoogleTokenError('malformed');
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new GoogleTokenError('malformed');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new GoogleTokenError('bad_header');
  const key = await keyFor(header.kid, fetcher);
  if (!key) throw new GoogleTokenError('unknown_kid');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  let valid: boolean;
  try {
    valid = verifier.verify(key, Buffer.from(signatureB64, 'base64url'));
  } catch {
    throw new GoogleTokenError('bad_signature');
  }
  if (!valid) throw new GoogleTokenError('bad_signature');
  if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.has(payload.iss)) throw new GoogleTokenError('wrong_issuer');
  if (typeof payload.aud !== 'string' || !clientIds.includes(payload.aud)) throw new GoogleTokenError('wrong_audience');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now.getTime()) throw new GoogleTokenError('expired');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new GoogleTokenError('missing_subject');
  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    emailVerified: payload.email_verified === true,
  };
}
