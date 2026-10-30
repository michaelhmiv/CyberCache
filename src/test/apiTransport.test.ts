/**
 * Chef api transport + session lifecycle (Route B, slice B4).
 *
 * Covers the contract the Supabase client used to provide implicitly:
 *  - success responses pass through with the session's bearer token;
 *  - Chef error envelopes map to ApiError { status, code, message };
 *  - network failures surface as friendly copy, never a raw
 *    "Failed to fetch" (audit finding A1);
 *  - a 401 triggers exactly one refresh + one retry;
 *  - a rejected refresh (rotation reuse / revoked) lands the app in
 *    the signed-out state: stored session dropped;
 *  - session lifecycle: guest create persists, Google sign-in while
 *    a guest session exists sends the guest bearer (link path),
 *    logout revokes best-effort and always clears local state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prefStore = vi.hoisted(() => new Map<string, string>());
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefStore.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { prefStore.set(key, value); },
    remove: async ({ key }: { key: string }) => { prefStore.delete(key); },
  },
}));

const googleTokenMock = vi.hoisted(() => vi.fn(async () => 'google-id-token'));
vi.mock('@/lib/nativeAuth', () => ({
  getGoogleIdTokenNative: () => googleTokenMock(),
}));

import { ApiError, apiRequest } from '@/lib/api/http';
import {
  getSessionSync,
  resetSessionStateForTests,
  setSession,
  type ChefSession,
} from '@/lib/api/session';
import * as authService from '@/lib/api/authService';

const SESSION_KEY = 'cybercache.chef.session.v1';

interface FetchCall {
  url: string;
  init: RequestInit;
}

let fetchCalls: FetchCall[] = [];
let fetchQueue: Array<() => Promise<unknown>> = [];

// Faithful-enough model of the Fetch Response surface the transport
// actually uses: http.ts reads status/ok + text() (then JSON-parses
// itself), session.ts's refresh reads ok + json().
const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
});

const queueJson = (status: number, body: unknown) => {
  fetchQueue.push(async () => jsonResponse(status, body));
};

const sessionBody = (overrides: Partial<ChefSession> = {}): ChefSession => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  refreshExpiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
  account: { id: 'player-1', email: null, isGuest: true, emailVerified: false },
  ...overrides,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

 beforeEach(() => {
  fetchCalls = [];
  fetchQueue = [];
  prefStore.clear();
  resetSessionStateForTests();
  googleTokenMock.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    const next = fetchQueue.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    return next();
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('returns parsed JSON and attaches the session bearer token', async () => {
    await setSession(sessionBody());
    queueJson(200, { ok: true });
    const data = await apiRequest<{ ok: boolean }>('/profile/me');
    expect(data).toEqual({ ok: true });
    expect(fetchCalls[0].url).toMatch(/\/api\/profile\/me$/);
    expect((fetchCalls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });

  it('maps Chef error envelopes to ApiError code + message', async () => {
    queueJson(409, { error: 'email_taken', message: 'That email is already registered.' });
    const error = await apiRequest('/auth/register', { method: 'POST', body: {}, auth: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'email_taken', message: 'That email is already registered.' });
  });

  it('never surfaces a raw "Failed to fetch" (audit A1)', async () => {
    fetchQueue.push(async () => { throw new TypeError('Failed to fetch'); });
    const error = await apiRequest('/profile/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('network');
    expect((error as ApiError).message).not.toContain('Failed to fetch');
    expect((error as ApiError).message).toContain('Could not reach the server');
  });

  it('refreshes once on 401 and retries with the rotated token', async () => {
    await setSession(sessionBody());
    queueJson(401, { error: 'invalid_token', message: 'expired' });
    queueJson(200, sessionBody({ accessToken: 'access-2', refreshToken: 'refresh-2' }));
    queueJson(200, { ok: true });

    const data = await apiRequest<{ ok: boolean }>('/profile/me');
    expect(data).toEqual({ ok: true });
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[1].url).toMatch(/\/api\/auth\/refresh$/);
    expect(JSON.parse(String(fetchCalls[1].init.body))).toEqual({ refreshToken: 'refresh-1' });
    expect((fetchCalls[2].init.headers as Record<string, string>).Authorization).toBe('Bearer access-2');
    expect(getSessionSync()?.refreshToken).toBe('refresh-2');
  });

  it('drops the session (signed-out state) when the refresh is rejected', async () => {
    await setSession(sessionBody());
    await flush();
    expect(prefStore.has(SESSION_KEY)).toBe(true);
    queueJson(401, { error: 'invalid_token', message: 'expired' });
    queueJson(401, { error: 'refresh_reuse', message: 'Refresh token reuse detected; session revoked.' });

    const error = await apiRequest('/profile/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    // No retry after a rejected refresh, and the local session is gone.
    expect(fetchCalls).toHaveLength(2);
    expect(getSessionSync()).toBeNull();
    await flush();
    expect(prefStore.has(SESSION_KEY)).toBe(false);
  });
});

describe('session lifecycle', () => {
  it('guest start creates and persists a session', async () => {
    queueJson(200, sessionBody());
    const user = await authService.signInAsGuest();
    expect(user).toEqual({ id: 'player-1', email: null, isAnonymous: true });
    expect(fetchCalls[0].url).toMatch(/\/api\/auth\/guest$/);
    expect((fetchCalls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    await flush();
    const stored = JSON.parse(prefStore.get(SESSION_KEY) ?? 'null') as ChefSession | null;
    expect(stored?.refreshToken).toBe('refresh-1');
  });

  it('Google sign-in while a guest session exists sends the guest bearer (link path)', async () => {
    await setSession(sessionBody());
    queueJson(200, sessionBody({
      accessToken: 'access-google',
      refreshToken: 'refresh-google',
      account: { id: 'player-1', email: 'm@example.com', isGuest: false, emailVerified: true },
    }));

    const user = await authService.signInWithGoogle();
    expect(googleTokenMock).toHaveBeenCalledTimes(1);
    expect(user).toEqual({ id: 'player-1', email: 'm@example.com', isAnonymous: false });
    // Pin the exact path: a suffix-only match once let a doubled
    // '/api/api/auth/google' (a live 404 on device) pass green.
    expect(new URL(fetchCalls[0].url).pathname).toBe('/api/auth/google');
    expect((fetchCalls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
    expect(JSON.parse(String(fetchCalls[0].init.body))).toEqual({ idToken: 'google-id-token' });
    expect(getSessionSync()?.accessToken).toBe('access-google');
  });

  it('logout revokes the refresh token and clears local state', async () => {
    await setSession(sessionBody());
    queueJson(204, null);
    await authService.signOut();
    expect(fetchCalls[0].url).toMatch(/\/api\/auth\/logout$/);
    expect(JSON.parse(String(fetchCalls[0].init.body))).toEqual({ refreshToken: 'refresh-1' });
    expect(getSessionSync()).toBeNull();
    await flush();
    expect(prefStore.has(SESSION_KEY)).toBe(false);
  });

  it('logout still clears local state when the revoke call fails', async () => {
    await setSession(sessionBody());
    fetchQueue.push(async () => { throw new TypeError('Failed to fetch'); });
    await authService.signOut();
    expect(getSessionSync()).toBeNull();
  });
});
