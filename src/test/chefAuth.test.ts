import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../server/auth/passwords';
import { mountAuthRoutes } from '../server/auth/routes';
import { InMemoryAuthStore } from '../server/auth/store';
import { hashRefreshToken, issueAccessToken, newRefreshToken, verifyAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';

describe('Chef access tokens', () => {
  it('round-trips a token and exposes claims', () => {
    const token = issueAccessToken(SECRET, 'acct-1', true, new Date('2026-01-01T00:00:00Z'));
    const result = verifyAccessToken(SECRET, token, new Date('2026-01-01T00:30:00Z'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe('acct-1');
      expect(result.claims.guest).toBe(true);
      expect(result.claims.exp - result.claims.iat).toBe(3600);
    }
  });

  it('rejects tampered, wrong-secret, and expired tokens', () => {
    const token = issueAccessToken(SECRET, 'acct-1', false, new Date('2026-01-01T00:00:00Z'));
    const [h, , s] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'acct-2', iss: 'cybercache-chef', typ: 'access', iat: 1, exp: 9999999999, jti: 'x', guest: false })).toString('base64url');
    expect(verifyAccessToken(SECRET, `${h}.${forgedPayload}.${s}`).ok).toBe(false);
    expect(verifyAccessToken('another-secret', token).ok).toBe(false);
    expect(verifyAccessToken(SECRET, token, new Date('2026-01-01T02:00:01Z'))).toEqual({ ok: false, reason: 'expired' });
    expect(verifyAccessToken(SECRET, 'not-a-jwt').ok).toBe(false);
  });

  it('hashes refresh tokens deterministically without storing the token', () => {
    const { token, hash } = newRefreshToken();
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toContain(token);
    expect(token.length).toBeGreaterThan(32);
  });
});

describe('scrypt passwords', () => {
  it('verifies the right password only', () => {
    const stored = hashPassword('correct horse battery');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct horse battery', stored)).toBe(true);
    expect(verifyPassword('wrong password', stored)).toBe(false);
    expect(verifyPassword('correct horse battery', 'garbage')).toBe(false);
  });
});

describe('InMemoryAuthStore flows', () => {
  it('guest -> upgrade keeps the account id; login works after upgrade', async () => {
    const store = new InMemoryAuthStore();
    const now = new Date();
    const guest = await store.createGuest(now);
    expect(guest.account.isGuest).toBe(true);
    const upgraded = await store.register('Hunter@Example.com', 'long-enough-password', now, guest.account.id);
    expect(upgraded.account.id).toBe(guest.account.id);
    expect(upgraded.account.email).toBe('hunter@example.com');
    const login = await store.login('hunter@example.com', 'long-enough-password', now);
    expect(login.account.id).toBe(guest.account.id);
    await expect(store.login('hunter@example.com', 'nope-nope-nope', now)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(store.register('hunter@example.com', 'another-password', now)).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('refresh rotates, and reuse of the old token revokes all sessions', async () => {
    const store = new InMemoryAuthStore();
    const now = new Date();
    const first = await store.register('rotator@example.com', 'long-enough-password', now);
    const second = await store.refresh(first.refreshToken, now);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(store.refresh(first.refreshToken, now)).rejects.toMatchObject({ code: 'refresh_reuse' });
    // The reuse above revoked every session, including the fresh one.
    await expect(store.refresh(second.refreshToken, now)).rejects.toMatchObject({ code: 'refresh_reuse' });
  });

  it('logout revokes the presented session', async () => {
    const store = new InMemoryAuthStore();
    const now = new Date();
    const session = await store.register('leaver@example.com', 'long-enough-password', now);
    await store.logout(session.refreshToken);
    await expect(store.refresh(session.refreshToken, now)).rejects.toBeTruthy();
  });
});

describe('auth routes (HTTP)', () => {
  let base = '';
  let server: ReturnType<typeof express.application.listen>;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountAuthRoutes(app, new InMemoryAuthStore(), { jwtSecret: SECRET });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function call(path: string, body?: unknown, token?: string) {
    const res = await fetch(`${base}${path}`, {
      method: body === undefined && !token ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = res.status === 204 ? null : await res.json();
    return { status: res.status, json };
  }

  it('guest, upgrade via bearer, me, refresh, logout over HTTP', async () => {
    const guest = await call('/api/auth/guest', {});
    expect(guest.status).toBe(201);
    expect(guest.json.account.isGuest).toBe(true);

    const upgraded = await call('/api/auth/register', { email: 'http@example.com', password: 'long-enough-password' }, guest.json.accessToken);
    expect(upgraded.status).toBe(201);
    expect(upgraded.json.account.id).toBe(guest.json.account.id);
    expect(upgraded.json.account.email).toBe('http@example.com');

    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${upgraded.json.accessToken}` } });
    expect(me.status).toBe(200);
    expect((await me.json()).account.email).toBe('http@example.com');

    const refreshed = await call('/api/auth/refresh', { refreshToken: upgraded.json.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.json.refreshToken).not.toBe(upgraded.json.refreshToken);

    const badLogin = await call('/api/auth/login', { email: 'http@example.com', password: 'wrong-password' });
    expect(badLogin.status).toBe(401);
    expect(badLogin.json.error).toBe('invalid_credentials');

    const noAuth = await fetch(`${base}/api/auth/me`);
    expect(noAuth.status).toBe(401);
  });
});
