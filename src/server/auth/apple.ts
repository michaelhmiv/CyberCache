/**
 * Apple identity verification (iOS launch, Track 3).
 *
 * The app signs in natively (ASAuthorization via the Capacitor
 * social-login plugin) and hands the Chef an Apple identity token.
 * The Chef verifies it the same way it verifies Google's: RS256
 * signature against Apple's JWKS, issuer, audience (our app's
 * bundle id / Services ids), and expiry — then the caller maps the
 * token's subject to an account via auth_identities.
 *
 * Apple specifics vs. Google: the issuer is the single
 * https://appleid.apple.com, the JWKS lives at
 * https://appleid.apple.com/auth/keys, and `email_verified` arrives
 * as a boolean OR the string "true" depending on the flow — both
 * mean verified. The email claim may be a private-relay address
 * (@privaterelay.appleid.com); it is stored exactly as returned —
 * a relay address is a first-class account email, never a reason
 * to demand the player's personal address.
 */
import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

export interface AppleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

export type AppleJwksFetcher = () => Promise<{ keys: Record<string, unknown>[] }>;

const APPLE_ISSUER = 'https://appleid.apple.com';
const JWKS_URL = 'https://appleid.apple.com/auth/keys';
const CACHE_MS = 60 * 60 * 1000;

let cachedKeys: { fetchedAt: number; keys: Map<string, KeyObject> } | null = null;

export const defaultAppleJwksFetcher: AppleJwksFetcher = async () => {
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Apple JWKS fetch failed: ${res.status}`);
  return (await res.json()) as { keys: Record<string, unknown>[] };
};

async function keyFor(kid: string, fetcher: AppleJwksFetcher): Promise<KeyObject | null> {
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
export function resetAppleKeyCache(): void {
  cachedKeys = null;
}

export class AppleTokenError extends Error {
  constructor(public readonly reason: string) {
    super(`Apple identity token rejected: ${reason}`);
  }
}

export async function verifyAppleIdToken(
  idToken: string,
  clientIds: string[],
  fetcher: AppleJwksFetcher = defaultAppleJwksFetcher,
  now = new Date(),
): Promise<AppleIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new AppleTokenError('malformed');
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new AppleTokenError('malformed');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AppleTokenError('bad_header');
  const key = await keyFor(header.kid, fetcher);
  if (!key) throw new AppleTokenError('unknown_kid');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  let valid: boolean;
  try {
    valid = verifier.verify(key, Buffer.from(signatureB64, 'base64url'));
  } catch {
    throw new AppleTokenError('bad_signature');
  }
  if (!valid) throw new AppleTokenError('bad_signature');
  if (payload.iss !== APPLE_ISSUER) throw new AppleTokenError('wrong_issuer');
  if (typeof payload.aud !== 'string' || !clientIds.includes(payload.aud)) throw new AppleTokenError('wrong_audience');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now.getTime()) throw new AppleTokenError('expired');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new AppleTokenError('missing_subject');
  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    // Apple sends email_verified as a boolean in the native flow and
    // as the string "true" in web/token-exchange flows; both count.
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  };
}
