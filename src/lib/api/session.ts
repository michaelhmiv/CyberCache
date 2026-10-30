/**
 * Chef session store (Route B, slice B4).
 *
 * Replaces the Supabase Auth session. The Chef issues its own tokens
 * (B1/B1.5): a 1h access JWT + a 30d rotating refresh token. This
 * module is the single owner of the client-side session:
 *
 * - Persistence: @capacitor/preferences (durable key-value storage on
 *   native + web), one JSON record under SESSION_STORAGE_KEY.
 * - An in-memory copy is the synchronous read path for the HTTP layer;
 *   `loadStoredSession()` hydrates it once at app start (AuthProvider's
 *   getCurrentSession does this).
 * - Refresh is single-flight: concurrent 401s share one /api/auth/refresh
 *   call. A rejected refresh (invalid or reused token) clears the
 *   session — the server revokes all sessions on refresh reuse — and
 *   listeners observe the signed-out state.
 * - Listeners mirror Supabase's onAuthStateChange contract: they fire on
 *   every session set/clear so AuthProvider can (re)load the user.
 */
import { Preferences } from '@capacitor/preferences';
import { apiUrl } from './config';

export interface ChefAccount {
  id: string;
  email: string | null;
  isGuest: boolean;
  emailVerified: boolean;
}

export interface ChefSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  account: ChefAccount;
}

/** The session-user shape the app consumes (was Supabase's `User`). */
export interface ApiUser {
  id: string;
  email: string | null;
  isAnonymous: boolean;
}

export function sessionToApiUser(session: ChefSession): ApiUser {
  return {
    id: session.account.id,
    email: session.account.email,
    isAnonymous: session.account.isGuest,
  };
}

const SESSION_STORAGE_KEY = 'cybercache.chef.session.v1';

let current: ChefSession | null = null;
let hydrated = false;
let hydratePromise: Promise<ChefSession | null> | null = null;
let refreshPromise: Promise<ChefSession | null> | null = null;

type SessionListener = (session: ChefSession | null) => void;
const listeners = new Set<SessionListener>();

function notify(): void {
  listeners.forEach((listener) => {
    try {
      listener(current);
    } catch (error) {
      console.warn('[api/session] listener failed:', error);
    }
  });
}

export function onSessionChange(listener: SessionListener): { unsubscribe: () => void } {
  listeners.add(listener);
  return {
    unsubscribe: () => {
      listeners.delete(listener);
    },
  };
}

function parseStoredSession(raw: string | null): ChefSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChefSession>;
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      !parsed.account ||
      typeof parsed.account.id !== 'string'
    ) {
      return null;
    }
    return parsed as ChefSession;
  } catch {
    return null;
  }
}

/** Hydrate the in-memory session from durable storage (idempotent). */
export function loadStoredSession(): Promise<ChefSession | null> {
  if (hydrated) return Promise.resolve(current);
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const { value } = await Preferences.get({ key: SESSION_STORAGE_KEY });
        current = parseStoredSession(value);
      } catch (error) {
        console.warn('[api/session] stored session read failed:', error);
        current = null;
      }
      hydrated = true;
      return current;
    })();
  }
  return hydratePromise;
}

/** Synchronous read for the HTTP layer; null until hydrated/signed in. */
export function getSessionSync(): ChefSession | null {
  return current;
}

export function getAccessTokenSync(): string | null {
  return current?.accessToken ?? null;
}

/** Set (or clear) the session: memory + durable storage + listeners. */
export async function setSession(session: ChefSession | null): Promise<void> {
  current = session;
  hydrated = true;
  try {
    if (session) {
      await Preferences.set({ key: SESSION_STORAGE_KEY, value: JSON.stringify(session) });
    } else {
      await Preferences.remove({ key: SESSION_STORAGE_KEY });
    }
  } catch (error) {
    console.warn('[api/session] session persistence failed:', error);
  }
  notify();
}

interface AuthSessionBody {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  account: ChefAccount;
}

export function sessionFromAuthBody(body: AuthSessionBody): ChefSession {
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    refreshExpiresAt: body.refreshExpiresAt,
    account: body.account,
  };
}

/**
 * Rotate the session via /api/auth/refresh. Single-flight: concurrent
 * callers share one request. Returns the new session, or null when
 * there is no session or the refresh token was rejected (in which case
 * the session is cleared — a reused refresh token revokes every
 * session server-side, so keeping local state would be a lie).
 *
 * Uses a raw fetch: the HTTP layer calls this on 401, so it must not
 * recurse into it.
 */
export function refreshSession(): Promise<ChefSession | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const stored = current ?? (await loadStoredSession());
      if (!stored) return null;
      try {
        const response = await fetch(apiUrl('/auth/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: stored.refreshToken }),
        });
        if (!response.ok) {
          await setSession(null);
          return null;
        }
        const next = sessionFromAuthBody((await response.json()) as AuthSessionBody);
        await setSession(next);
        return next;
      } catch (error) {
        // Network failure: keep the stored session (the refresh token
        // may still be valid); the caller surfaces the original error.
        console.warn('[api/session] refresh request failed:', error);
        return null;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** Test seam: drop all in-memory state (storage is left to the mock). */
export function resetSessionStateForTests(): void {
  current = null;
  hydrated = false;
  hydratePromise = null;
  refreshPromise = null;
  listeners.clear();
}
