/**
 * Decrypt-hang regression pins (2026-11-11).
 *
 * Owner report: opening a cache on device shook on the DECRYPTING
 * overlay forever — no beam, no reveal. Root cause chain:
 *
 *  1. The Chef transport (http.ts) awaited `fetch` with NO timeout
 *     anywhere, so a request whose response never arrived produced
 *     a promise that never settled.
 *  2. `verifiedOps.op()` awaited TWO such requests in sequence on
 *     the cache-open path — POST /ops/make-item, then (after the
 *     server had already granted the item) the display-only runtime
 *     snapshot PUT — so a stall in either froze ChestScreen's
 *     `opening` state (and its shaking overlay) indefinitely.
 *  3. The session refresh fetch shared the same unbounded shape,
 *     wedging the transport's 401 retry the same way.
 *
 * These tests pin the fix at each layer, through the REAL transport
 * and the REAL verifiedOps (fetch stubbed at the global):
 *  - a never-answering request rejects as ApiError code 'timeout';
 *  - a 401 whose refresh never answers still surfaces the 401;
 *  - makeItem resolves promptly with the granted result even while
 *    the snapshot PUT hangs unanswered — the save is display
 *    hydration only and is no longer on the op's critical path.
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

// Analytics rides Firebase; it is never a gate and is stubbed out.
vi.mock('@/lib/analytics/analytics', () => ({
  trackCacheOpen: vi.fn(),
  trackCraftQueue: vi.fn(),
  trackEquip: vi.fn(),
  trackMarketList: vi.fn(),
  trackSalvage: vi.fn(),
}));

import { ApiError, apiRequest } from '@/lib/api/http';
import { refreshSession, resetSessionStateForTests, setSession, type ChefSession } from '@/lib/api/session';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { startRuntimeStorePersistence, stopRuntimeStorePersistence } from '@/store/runtimeSupabaseSync';

/** A fetch that never answers — it only rejects when aborted, exactly
 *  like a real fetch on a stalled connection. */
const hangingFetch = vi.fn(
  (_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      });
    }),
);

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
});

const sessionBody = (): ChefSession => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  refreshExpiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
  account: { id: 'player-1', email: null, isGuest: true, emailVerified: false },
});

beforeEach(() => {
  prefStore.clear();
  resetSessionStateForTests();
  hangingFetch.mockClear();
});

afterEach(() => {
  stopRuntimeStorePersistence();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('transport timeout (http.ts)', () => {
  it('a request whose response never arrives rejects as a timeout instead of never settling', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const started = Date.now();
    const error = await apiRequest('/ops/make-item', {
      method: 'POST',
      body: { nonce: 'make:test' },
      auth: false,
      timeoutMs: 40,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'timeout' });
    expect((error as ApiError).message).toContain('took too long');
    // Settled on the timeout's schedule, not the server's (never).
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(hangingFetch).toHaveBeenCalledTimes(1);
  });

  it('a 401 whose refresh never answers still surfaces the original 401 (refresh is bounded too)', async () => {
    vi.useFakeTimers();
    await setSession(sessionBody());
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes('/auth/refresh')) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
            });
          });
        }
        return Promise.resolve(jsonResponse(401, { error: 'invalid_token', message: 'expired' }));
      }),
    );

    const pending = apiRequest('/profile/me').catch((e: unknown) => e);
    // The refresh ceiling is API_REQUEST_TIMEOUT_MS (15 s).
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'invalid_token' });
  });

  it('refreshSession resolves null (session kept) when the refresh response never arrives', async () => {
    vi.useFakeTimers();
    await setSession(sessionBody());
    vi.stubGlobal('fetch', hangingFetch);
    const pending = refreshSession();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).resolves.toBeNull();
  });
});

describe('verifiedOps: the snapshot save is not on the op critical path', () => {
  it('makeItem resolves promptly with the granted item even while the snapshot PUT never answers', async () => {
    const granted = { item: { id: 'cache-item-1' }, profile: { cache_tokens: 2 } };
    const fetchSpy = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('/runtime/snapshot')) {
        // The snapshot PUT hangs unanswered (abort-only), as in the
        // harness's hang-snapshot mode.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        });
      }
      return Promise.resolve(jsonResponse(200, granted));
    });
    vi.stubGlobal('fetch', fetchSpy);
    startRuntimeStorePersistence('player-1');

    const started = Date.now();
    const result = await verifiedOps.makeItem({ payment: 'key' });
    expect(result).toEqual(granted);
    // Promptly — not after the snapshot's 15 s timeout, and never
    // hostage to it at all. (Pre-fix this awaited the PUT, so the
    // reveal waited out the stall; with no timeout anywhere it
    // waited forever.)
    expect(Date.now() - started).toBeLessThan(5_000);
    // The save was still attempted in the background.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/runtime/snapshot'))).toBe(true);
  });

  it('a stalled make-item request surfaces as a timeout error the caller can show (no silent freeze)', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    startRuntimeStorePersistence('player-1');
    const started = Date.now();
    const error = await verifiedOps.makeItem({ payment: 'key' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);
});
