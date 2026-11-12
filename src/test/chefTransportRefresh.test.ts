/**
 * Audit A-06 — the chefClient raw-fetch family never refreshed on 401.
 *
 * apiRequest (lib/api/http) has always rotated the session once and
 * retried; the gameplay transport in chefClient (submitClaim,
 * settleOffline, verifyBossFight, resurrectViaChef, salvageItem, and
 * the endlessFetch tail) threw the 401 as a permanent failure. One hour
 * into a session — the access token's TTL — every ticker claim failed,
 * syncStalled tripped ("rewards are paused"), and roaming silently
 * stopped paying until reload or an unrelated apiRequest call happened
 * to refresh the shared session as a side effect.
 *
 * Pinned here, mirroring the apiTransport cases:
 *  - a 401 on a claim triggers exactly one /api/auth/refresh and one
 *    retry, and the claim resolves with the retried payload;
 *  - a rejected refresh surfaces the original 401 (the seam has
 *    already cleared the session — the signed-out state);
 *  - an explicit per-call jwt opts out: no refresh is attempted.
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

import { submitClaim, type ChefClaimRequest } from '@/lib/chef/chefClient';
import {
  getSessionSync,
  resetSessionStateForTests,
  setSession,
  type ChefSession,
} from '@/lib/api/session';

interface FetchCall {
  url: string;
  init: RequestInit;
}

let fetchCalls: FetchCall[] = [];
let fetchQueue: Array<() => Promise<unknown>> = [];

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
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

const claimRequest = (overrides: Partial<ChefClaimRequest> = {}): ChefClaimRequest => ({
  playerId: 'player-1',
  areaId: 'dustwaste',
  ticks: [],
  tickCount: 1,
  playerLevel: 12,
  ...overrides,
} as ChefClaimRequest);

beforeEach(() => {
  fetchCalls = [];
  fetchQueue = [];
  prefStore.clear();
  resetSessionStateForTests();
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

describe('chefClient transport — 401 refresh-and-retry (audit A-06)', () => {
  it('refreshes once on a 401 claim and resolves with the retried payload', async () => {
    await setSession(sessionBody());
    queueJson(401, { error: 'invalid_token', detail: 'expired' });
    queueJson(200, sessionBody({ accessToken: 'access-2', refreshToken: 'refresh-2' }));
    queueJson(200, { settled: true, marker: 'claim-paid' });

    const result = await submitClaim(claimRequest());
    expect(result).toMatchObject({ settled: true, marker: 'claim-paid' });

    // Exactly one refresh, exactly one retry, in order.
    expect(fetchCalls).toHaveLength(3);
    expect(fetchCalls[0].url).toMatch(/\/api\/claim$/);
    expect(fetchCalls[1].url).toMatch(/\/api\/auth\/refresh$/);
    expect(JSON.parse(String(fetchCalls[1].init.body))).toEqual({ refreshToken: 'refresh-1' });
    expect(fetchCalls[2].url).toMatch(/\/api\/claim$/);
    expect((fetchCalls[2].init.headers as Record<string, string>).Authorization).toBe('Bearer access-2');
    // The retry's body carries the rotated token too.
    expect(JSON.parse(String(fetchCalls[2].init.body)).jwt).toBe('access-2');
    expect(getSessionSync()?.refreshToken).toBe('refresh-2');
  });

  it('surfaces the original 401 when the refresh is rejected (session already cleared by the seam)', async () => {
    await setSession(sessionBody());
    queueJson(401, { error: 'invalid_token', detail: 'expired' });
    queueJson(401, { error: 'refresh_reuse', message: 'Refresh token reuse detected; session revoked.' });

    const error = await submitClaim(claimRequest()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { status?: number }).status).toBe(401);
    expect(fetchCalls).toHaveLength(2); // claim + refresh, no retry
    expect(getSessionSync()).toBeNull();
  });

  it('an explicit per-call jwt opts out — no refresh is attempted', async () => {
    await setSession(sessionBody());
    queueJson(401, { error: 'invalid_token', detail: 'expired' });

    const error = await submitClaim(claimRequest({ jwt: 'caller-owned-token' })).catch((e: unknown) => e);
    expect((error as { status?: number }).status).toBe(401);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toMatch(/\/api\/claim$/);
  });
});
