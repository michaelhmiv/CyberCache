import express from 'express';
import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetGoogleKeyCache, verifyGoogleIdToken, GoogleTokenError } from '../server/auth/google';
import { mountAuthRoutes } from '../server/auth/routes';
import { InMemoryAuthStore } from '../server/auth/store';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'test-key-1', alg: 'RS256', use: 'sig' };
const fetcher = async () => ({ keys: [jwk] });

function googleToken(claims: Record<string, unknown>, key: KeyObject = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key-1' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-sub-123',
    email: 'Player@Gmail.com',
    email_verified: true,
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  })).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key).toString('base64url')}`;
}

describe('verifyGoogleIdToken', () => {
  it('accepts a properly signed token and normalizes the identity', async () => {
    resetGoogleKeyCache();
    const identity = await verifyGoogleIdToken(googleToken({}), [CLIENT_ID], fetcher);
    expect(identity).toEqual({ subject: 'google-sub-123', email: 'player@gmail.com', emailVerified: true });
  });

  it('rejects wrong audience, wrong issuer, expiry, and bad signatures', async () => {
    resetGoogleKeyCache();
    await expect(verifyGoogleIdToken(googleToken({ aud: 'other-client' }), [CLIENT_ID], fetcher)).rejects.toBeInstanceOf(GoogleTokenError);
    await expect(verifyGoogleIdToken(googleToken({ iss: 'https://evil.example' }), [CLIENT_ID], fetcher)).rejects.toBeInstanceOf(GoogleTokenError);
    await expect(verifyGoogleIdToken(googleToken({ exp: Math.floor(Date.now() / 1000) - 5 }), [CLIENT_ID], fetcher)).rejects.toBeInstanceOf(GoogleTokenError);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(verifyGoogleIdToken(googleToken({}, other.privateKey), [CLIENT_ID], fetcher)).rejects.toBeInstanceOf(GoogleTokenError);
  });
});

describe('POST /api/auth/google', () => {
  let base = '';
  let server: ReturnType<typeof express.application.listen>;
  const store = new InMemoryAuthStore();

  beforeAll(async () => {
    resetGoogleKeyCache();
    const app = express();
    app.use(express.json());
    mountAuthRoutes(app, store, { jwtSecret: 'test-secret-at-least-32-chars-long!!', googleClientIds: [CLIENT_ID], googleJwksFetcher: fetcher });
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
    const first = await post('/api/auth/google', { idToken: googleToken({}) });
    expect(first.status).toBe(200);
    expect(first.json.account).toMatchObject({ email: 'player@gmail.com', isGuest: false, emailVerified: true });
    const second = await post('/api/auth/google', { idToken: googleToken({}) });
    expect(second.json.account.id).toBe(first.json.account.id);
  });

  it('links Google to an existing guest session, keeping the guest account id', async () => {
    const guest = await post('/api/auth/guest', {});
    const linked = await post('/api/auth/google', { idToken: googleToken({ sub: 'google-sub-guest', email: 'guest@gmail.com' }) }, guest.json.accessToken);
    expect(linked.status).toBe(200);
    expect(linked.json.account.id).toBe(guest.json.account.id);
    expect(linked.json.account.email).toBe('guest@gmail.com');
    // Linking promotes the account in place (audit A-01): it stops being a
    // guest, so the economy gate and the client both treat it as verified.
    expect(linked.json.account).toMatchObject({ isGuest: false, emailVerified: true });
    // The session issued at link time no longer carries the guest claim —
    // the claim downstream gates read (audit A-01, second half).
    const claims = JSON.parse(Buffer.from(linked.json.accessToken.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.guest).toBe(false);
    // And a later bare Google sign-in lands on that same account.
    const again = await post('/api/auth/google', { idToken: googleToken({ sub: 'google-sub-guest', email: 'guest@gmail.com' }) });
    expect(again.json.account.id).toBe(guest.json.account.id);
    expect(again.json.account.isGuest).toBe(false);
  });


  it('refuses a link when the Google identity is bound to a different account (audit A-12)', async () => {
    // Account A binds subject S through a bare sign-in.
    const a = await post('/api/auth/google', { idToken: googleToken({ sub: 'google-sub-bound', email: 'bound@gmail.com' }) });
    expect(a.status).toBe(200);
    // Guest B, signed in with progress at stake, tries to link S.
    const guest = await post('/api/auth/guest', {});
    const conflict = await post(
      '/api/auth/google',
      { idToken: googleToken({ sub: 'google-sub-bound', email: 'bound@gmail.com' }) },
      guest.json.accessToken,
    );
    // Not a bare 200 session for A: an explicit 409 link conflict, and
    // no session material for either account in the response.
    expect(conflict.status).toBe(409);
    expect(conflict.json.error).toBe('identity_link_conflict');
    expect(conflict.json.message).toContain('already linked to another hunter');
    expect(conflict.json.accessToken).toBeUndefined();
    expect(conflict.json.account).toBeUndefined();
    // B's own session is untouched by the refusal.
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${guest.json.accessToken}` } });
    expect(me.status).toBe(200);
    expect((await me.json()).account.id).toBe(guest.json.account.id);
    // Controls: bare sign-in with S still lands on A, and A re-linking
    // its own identity (link id === bound id) still succeeds.
    const bare = await post('/api/auth/google', { idToken: googleToken({ sub: 'google-sub-bound', email: 'bound@gmail.com' }) });
    expect(bare.status).toBe(200);
    expect(bare.json.account.id).toBe(a.json.account.id);
    const ownRelink = await post(
      '/api/auth/google',
      { idToken: googleToken({ sub: 'google-sub-bound', email: 'bound@gmail.com' }) },
      a.json.accessToken,
    );
    expect(ownRelink.status).toBe(200);
    expect(ownRelink.json.account.id).toBe(a.json.account.id);
  });

  it('rejects a forged token with a stable error code', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = await post('/api/auth/google', { idToken: googleToken({ sub: 'attacker' }, other.privateKey) });
    expect(forged.status).toBe(401);
    expect(forged.json.error).toBe('invalid_google_token');
  });

  it('logs the rejected token aud/iss claims in the failure diagnostic (F1)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const forged = await post('/api/auth/google', { idToken: googleToken({ sub: 'attacker' }, other.privateKey) });
      expect(forged.status).toBe(401);
      expect(forged.json.error).toBe('invalid_google_token');
      const diag = warn.mock.calls.map((call) => String(call[0]))
        .find((line) => line.includes('[chef-auth] google sign-in rejected'));
      expect(diag).toBeDefined();
      // The claims come from the rejected token's own payload. Before
      // the F1 fix the catch block's read of `idToken` threw a
      // ReferenceError (swallowed by the inner guard), so this line
      // always printed 'unparseable' and carried no diagnostic value.
      expect(diag).toContain(`aud=${CLIENT_ID}`);
      expect(diag).toContain('iss=https://accounts.google.com');
      expect(diag).not.toContain('unparseable');
    } finally {
      warn.mockRestore();
    }
  });

  it('still answers 401 (nothing throws) when the rejected token is unparseable garbage (F1)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const garbage = await post('/api/auth/google', { idToken: 'not-a-jwt' });
      expect(garbage.status).toBe(401);
      expect(garbage.json.error).toBe('invalid_google_token');
      const diag = warn.mock.calls.map((call) => String(call[0]))
        .find((line) => line.includes('[chef-auth] google sign-in rejected'));
      expect(diag).toBeDefined();
      expect(diag).toContain('unparseable');
    } finally {
      warn.mockRestore();
    }
  });
});
