/**
 * Sign in with Apple (iOS launch, Track 3) — the Apple twin of
 * chefAuthGoogle.test.ts, plus the brief's account rule:
 *
 * - Apple identity tokens verify against Apple's JWKS pattern
 *   (issuer, audience = bundle id, expiry, RS256 signature), with
 *   Apple's boolean-or-string email_verified normalized.
 * - Same VERIFIED email across Apple and Google resolves to the
 *   SAME player account: the second provider's identity links to
 *   the identity-backed account that owns the address.
 * - No silent merge anywhere else: differing emails create their
 *   own account, an unverified email never claims an owned address,
 *   and a password-only account keeps the audit A-13 email_taken
 *   refusal — for Apple exactly as for Google.
 * - Private-relay emails are first-class account emails.
 * - Guest → Apple link at transact time upgrades the guest in
 *   place (audit A-01), and the A-12 link conflict holds.
 */
import express from 'express';
import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetAppleKeyCache, verifyAppleIdToken, AppleTokenError } from '../server/auth/apple';
import { resetGoogleKeyCache } from '../server/auth/google';
import { mountAuthRoutes } from '../server/auth/routes';
import { InMemoryAuthStore, PgAuthStore, type PgQuery } from '../server/auth/store';

const BUNDLE_ID = 'com.michaelhmiv.cybercache';
const GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'apple-key-1', alg: 'RS256', use: 'sig' };
const fetcher = async () => ({ keys: [jwk] });

function sign(payload: Record<string, unknown>, key: KeyObject = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'apple-key-1' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${signer.sign(key).toString('base64url')}`;
}

function appleToken(claims: Record<string, unknown>, key: KeyObject = privateKey): string {
  return sign({
    iss: 'https://appleid.apple.com',
    aud: BUNDLE_ID,
    sub: 'apple-sub-001',
    email: 'Player@Icloud.com',
    email_verified: true,
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  }, key);
}

function googleToken(claims: Record<string, unknown>): string {
  return sign({
    iss: 'https://accounts.google.com',
    aud: GOOGLE_CLIENT_ID,
    sub: 'google-sub-001',
    email: 'shared@example.com',
    email_verified: true,
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  });
}

describe('verifyAppleIdToken', () => {
  it('accepts a properly signed token and normalizes the identity', async () => {
    resetAppleKeyCache();
    const identity = await verifyAppleIdToken(appleToken({}), [BUNDLE_ID], fetcher);
    expect(identity).toEqual({ subject: 'apple-sub-001', email: 'player@icloud.com', emailVerified: true });
  });

  it('treats the string form of email_verified as verified, and its absence as unverified', async () => {
    resetAppleKeyCache();
    const stringForm = await verifyAppleIdToken(appleToken({ email_verified: 'true' }), [BUNDLE_ID], fetcher);
    expect(stringForm.emailVerified).toBe(true);
    const stringFalse = await verifyAppleIdToken(appleToken({ email_verified: 'false' }), [BUNDLE_ID], fetcher);
    expect(stringFalse.emailVerified).toBe(false);
    const absent = await verifyAppleIdToken(appleToken({ email_verified: undefined }), [BUNDLE_ID], fetcher);
    expect(absent.emailVerified).toBe(false);
  });

  it('passes a private-relay email through exactly as returned', async () => {
    resetAppleKeyCache();
    const identity = await verifyAppleIdToken(
      appleToken({ email: 'XyZ123@privaterelay.appleid.com', is_private_email: true }),
      [BUNDLE_ID],
      fetcher,
    );
    expect(identity.email).toBe('xyz123@privaterelay.appleid.com');
    expect(identity.emailVerified).toBe(true);
  });

  it('rejects wrong audience, wrong issuer, expiry, and bad signatures with stable reasons', async () => {
    resetAppleKeyCache();
    await expect(verifyAppleIdToken(appleToken({ aud: 'com.someone.else' }), [BUNDLE_ID], fetcher))
      .rejects.toMatchObject({ reason: 'wrong_audience' });
    await expect(verifyAppleIdToken(appleToken({ iss: 'https://evil.example' }), [BUNDLE_ID], fetcher))
      .rejects.toMatchObject({ reason: 'wrong_issuer' });
    await expect(verifyAppleIdToken(appleToken({ exp: Math.floor(Date.now() / 1000) - 5 }), [BUNDLE_ID], fetcher))
      .rejects.toMatchObject({ reason: 'expired' });
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(verifyAppleIdToken(appleToken({}, other.privateKey), [BUNDLE_ID], fetcher))
      .rejects.toBeInstanceOf(AppleTokenError);
  });

  it('rejects a token with no email claim as a subject-only identity (repeat sign-in shape)', async () => {
    resetAppleKeyCache();
    const identity = await verifyAppleIdToken(appleToken({ email: undefined, email_verified: undefined }), [BUNDLE_ID], fetcher);
    expect(identity).toEqual({ subject: 'apple-sub-001', email: null, emailVerified: false });
  });
});

describe('POST /api/auth/apple', () => {
  let base = '';
  let server: ReturnType<typeof express.application.listen>;
  const store = new InMemoryAuthStore();

  beforeAll(async () => {
    resetAppleKeyCache();
    resetGoogleKeyCache();
    const app = express();
    app.use(express.json());
    mountAuthRoutes(app, store, {
      jwtSecret: 'test-secret-at-least-32-chars-long!!',
      googleClientIds: [GOOGLE_CLIENT_ID],
      googleJwksFetcher: fetcher,
      appleClientIds: [BUNDLE_ID],
      appleJwksFetcher: fetcher,
    });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function post(path: string, body: unknown, token?: string) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: res.status === 204 ? null : await res.json() };
  }

  it('creates a verified account on first sign-in and returns the same account on the next', async () => {
    const first = await post('/api/auth/apple', { idToken: appleToken({}) });
    expect(first.status).toBe(200);
    expect(first.json.account).toMatchObject({ email: 'player@icloud.com', isGuest: false, emailVerified: true });
    const second = await post('/api/auth/apple', { idToken: appleToken({}) });
    expect(second.json.account.id).toBe(first.json.account.id);
  });

  it('creates an account on a private-relay email, stored as returned', async () => {
    const relay = await post('/api/auth/apple', {
      idToken: appleToken({ sub: 'apple-sub-relay', email: 'relay@privaterelay.appleid.com', is_private_email: true }),
    });
    expect(relay.status).toBe(200);
    expect(relay.json.account).toMatchObject({ email: 'relay@privaterelay.appleid.com', isGuest: false, emailVerified: true });
  });

  it('links Apple to an existing guest session at transact time, keeping the guest account id', async () => {
    const guest = await post('/api/auth/guest', {});
    const linked = await post(
      '/api/auth/apple',
      { idToken: appleToken({ sub: 'apple-sub-guest', email: 'guest@icloud.com' }) },
      guest.json.accessToken,
    );
    expect(linked.status).toBe(200);
    expect(linked.json.account.id).toBe(guest.json.account.id);
    expect(linked.json.account.email).toBe('guest@icloud.com');
    // Linking promotes the account in place (audit A-01), exactly as
    // the Google link does — including the session's guest claim.
    expect(linked.json.account).toMatchObject({ isGuest: false, emailVerified: true });
    const claims = JSON.parse(Buffer.from(linked.json.accessToken.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.guest).toBe(false);
    const again = await post('/api/auth/apple', { idToken: appleToken({ sub: 'apple-sub-guest', email: 'guest@icloud.com' }) });
    expect(again.json.account.id).toBe(guest.json.account.id);
  });

  it('refuses a link when the Apple identity is bound to a different account (audit A-12)', async () => {
    const a = await post('/api/auth/apple', { idToken: appleToken({ sub: 'apple-sub-bound', email: 'bound@icloud.com' }) });
    expect(a.status).toBe(200);
    const guest = await post('/api/auth/guest', {});
    const conflict = await post(
      '/api/auth/apple',
      { idToken: appleToken({ sub: 'apple-sub-bound', email: 'bound@icloud.com' }) },
      guest.json.accessToken,
    );
    expect(conflict.status).toBe(409);
    expect(conflict.json.error).toBe('identity_link_conflict');
    expect(conflict.json.accessToken).toBeUndefined();
    expect(conflict.json.account).toBeUndefined();
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${guest.json.accessToken}` } });
    expect(me.status).toBe(200);
    expect((await me.json()).account.id).toBe(guest.json.account.id);
  });

  it('resolves a bare Apple sign-in to the Google account that owns the same verified email', async () => {
    // The Google identity creates the account first (Android side).
    const google = await post('/api/auth/google', { idToken: googleToken({}) });
    expect(google.status).toBe(200);
    // A bare Apple sign-in with the same verified email lands on the
    // SAME account — no second account, no merge prompt.
    const apple = await post('/api/auth/apple', {
      idToken: appleToken({ sub: 'apple-sub-shared', email: 'shared@example.com' }),
    });
    expect(apple.status).toBe(200);
    expect(apple.json.account.id).toBe(google.json.account.id);
    expect(apple.json.account.email).toBe('shared@example.com');
    // The Apple identity is now linked to that account: a guest
    // trying to link it elsewhere meets the A-12 conflict, and both
    // providers keep landing on the one account.
    const guest = await post('/api/auth/guest', {});
    const conflict = await post(
      '/api/auth/apple',
      { idToken: appleToken({ sub: 'apple-sub-shared', email: 'shared@example.com' }) },
      guest.json.accessToken,
    );
    expect(conflict.status).toBe(409);
    expect(conflict.json.error).toBe('identity_link_conflict');
    const googleAgain = await post('/api/auth/google', { idToken: googleToken({}) });
    expect(googleAgain.json.account.id).toBe(google.json.account.id);
    const appleAgain = await post('/api/auth/apple', {
      idToken: appleToken({ sub: 'apple-sub-shared', email: 'shared@example.com' }),
    });
    expect(appleAgain.json.account.id).toBe(google.json.account.id);
  });

  it('resolves the other direction too: Apple first, then Google with the same verified email', async () => {
    const apple = await post('/api/auth/apple', {
      idToken: appleToken({ sub: 'apple-sub-first', email: 'applefirst@example.com' }),
    });
    expect(apple.status).toBe(200);
    const google = await post('/api/auth/google', {
      idToken: googleToken({ sub: 'google-sub-second', email: 'applefirst@example.com' }),
    });
    expect(google.status).toBe(200);
    expect(google.json.account.id).toBe(apple.json.account.id);
  });

  it('never merges on differing emails: a different verified email is its own account', async () => {
    const google = await post('/api/auth/google', {
      idToken: googleToken({ sub: 'google-sub-solo', email: 'solo-google@example.com' }),
    });
    const apple = await post('/api/auth/apple', {
      idToken: appleToken({ sub: 'apple-sub-solo', email: 'solo-apple@icloud.com' }),
    });
    expect(apple.status).toBe(200);
    expect(apple.json.account.id).not.toBe(google.json.account.id);
  });

  it('never merges on an UNVERIFIED email: the owned address refuses with email_taken', async () => {
    const google = await post('/api/auth/google', {
      idToken: googleToken({ sub: 'google-sub-verified', email: 'verified@example.com' }),
    });
    expect(google.status).toBe(200);
    const apple = await post('/api/auth/apple', {
      idToken: appleToken({ sub: 'apple-sub-unverified', email: 'verified@example.com', email_verified: false }),
    });
    expect(apple.status).toBe(409);
    expect(apple.json.error).toBe('email_taken');
    // The Google account is untouched and still the one that signs in.
    const googleAgain = await post('/api/auth/google', {
      idToken: googleToken({ sub: 'google-sub-verified', email: 'verified@example.com' }),
    });
    expect(googleAgain.json.account.id).toBe(google.json.account.id);
  });

  it('never claims a password-only account by verified email (audit A-13 holds for Apple)', async () => {
    const registered = await post('/api/auth/register', { email: 'password-owner@example.com', password: 'correct horse battery' });
    expect(registered.status).toBe(201);
    const apple = await post('/api/auth/apple', {
      idToken: appleToken({ sub: 'apple-sub-claim', email: 'password-owner@example.com' }),
    });
    expect(apple.status).toBe(409);
    expect(apple.json.error).toBe('email_taken');
    const login = await post('/api/auth/login', { email: 'password-owner@example.com', password: 'correct horse battery' });
    expect(login.status).toBe(200);
    expect(login.json.account.id).toBe(registered.json.account.id);
  });

  it('rejects a forged token with a stable error code and logs its public claims', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const forged = await post('/api/auth/apple', { idToken: appleToken({ sub: 'attacker' }, other.privateKey) });
      expect(forged.status).toBe(401);
      expect(forged.json.error).toBe('invalid_apple_token');
      const diag = warn.mock.calls.map((call) => String(call[0]))
        .find((line) => line.includes('[chef-auth] apple sign-in rejected'));
      expect(diag).toBeDefined();
      expect(diag).toContain(`aud=${BUNDLE_ID}`);
      expect(diag).toContain('iss=https://appleid.apple.com');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('cross-provider resolution — PgAuthStore parity', () => {
  const NOW = new Date('2026-11-18T00:00:00.000Z');
  const OWNER = {
    id: 'owner-account-id',
    email: 'shared@example.com',
    is_guest: false,
    email_verified_at: NOW,
    created_at: NOW,
  };

  it('links the incoming identity to the identity-backed owner and sessions as the owner', async () => {
    const seen: string[] = [];
    const db: PgQuery = {
      query: async (text: string) => {
        seen.push(text);
        if (text.includes('select account_id from auth_identities')) return { rows: [] };
        if (text.includes('insert into auth_accounts')) {
          // The email is owned: the unique violation is what sends
          // the flow into the resolution branch.
          const err = new Error('duplicate key value violates unique constraint') as Error & { code?: string };
          err.code = '23505';
          throw err;
        }
        if (text.includes('from auth_accounts where email')) return { rows: [OWNER] };
        if (text.includes('select 1 as one from auth_identities')) return { rows: [{ one: 1 }] };
        if (text.includes('insert into auth_identities')) return { rows: [] };
        if (text.includes('insert into auth_refresh_tokens')) return { rows: [] };
        throw new Error(`unexpected query in this parity fake: ${text.slice(0, 60)}`);
      },
    };
    const store = new PgAuthStore(db);
    const session = await store.loginWithIdentity(
      'apple',
      { subject: 'apple-sub-pg', email: 'shared@example.com', emailVerified: true },
      NOW,
    );
    expect(session.account.id).toBe('owner-account-id');
    expect(seen.some((q) => q.includes('insert into auth_identities'))).toBe(true);
  });

  it('a password-only owner (no identity rows) still refuses via the unique violation', async () => {
    const db: PgQuery = {
      query: async (text: string) => {
        if (text.includes('select account_id from auth_identities')) return { rows: [] };
        if (text.includes('insert into auth_accounts')) {
          const err = new Error('duplicate key value violates unique constraint') as Error & { code?: string };
          err.code = '23505';
          throw err;
        }
        if (text.includes('from auth_accounts where email')) return { rows: [OWNER] };
        if (text.includes('select 1 as one from auth_identities')) return { rows: [] };
        throw new Error(`unexpected query in this parity fake: ${text.slice(0, 60)}`);
      },
    };
    const store = new PgAuthStore(db);
    await expect(
      store.loginWithIdentity('apple', { subject: 'apple-sub-pg2', email: 'shared@example.com', emailVerified: true }, NOW),
    ).rejects.toMatchObject({ code: 'email_taken' });
  });
});
