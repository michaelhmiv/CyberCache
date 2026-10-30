/**
 * Auth service (Route B, slice B4) — the Chef auth endpoints behind the
 * same function surface the Supabase authService exposed.
 *
 * Chef surface (B1/B1.5): POST /api/auth/guest | register | login |
 * refresh | logout | google, GET /api/auth/me. Sessions are Chef
 * tokens owned by `src/lib/api/session.ts`; this module is the
 * action layer AuthProvider calls.
 *
 * Type change vs. the Supabase version (flagged in the B4 PR): the
 * Supabase `User`/`Session` types are replaced by ApiUser/ApiSession
 * ({ id, email, isAnonymous }) — the runtime shape AuthProvider and
 * accountState actually consumed.
 *
 * Dormant-by-design flows: email/password endpoints exist server-side
 * (tests/dev), but password reset/update have no Chef endpoint — the
 * spec defers reset-by-email until a mail provider is chosen, and the
 * product surface is guest + Google. Those two functions throw a clear
 * error instead of pretending to work.
 */
import { getGoogleIdTokenNative } from '../nativeAuth';
import { apiRequest } from './http';
import {
  getSessionSync,
  loadStoredSession,
  onSessionChange,
  refreshSession,
  sessionFromAuthBody,
  sessionToApiUser,
  setSession,
  type ApiUser,
  type ChefSession,
} from './session';
import { setUsername } from './usernameService';

export type { ApiUser } from './session';

export interface ApiSession {
  user: ApiUser;
}

export type AuthStateCallback = (session: ApiSession | null) => void;

interface AuthSessionBody {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  account: ChefSession['account'];
}

async function adoptSession(body: AuthSessionBody): Promise<ApiUser> {
  const session = sessionFromAuthBody(body);
  await setSession(session);
  return sessionToApiUser(session);
}

export async function getCurrentSession(): Promise<ApiSession | null> {
  let session = await loadStoredSession();
  if (!session) return null;
  // A stored session whose refresh window has closed is dead; drop it
  // so the app boots signed-out instead of failing every first call.
  if (Date.parse(session.refreshExpiresAt) <= Date.now()) {
    session = await refreshSession();
    if (!session) return null;
  }
  return { user: sessionToApiUser(session) };
}

export function onAuthStateChange(callback: AuthStateCallback): { unsubscribe: () => void } {
  return onSessionChange((session) => callback(session ? { user: sessionToApiUser(session) } : null));
}

export async function signInAsGuest(): Promise<ApiUser> {
  const body = await apiRequest<AuthSessionBody>('/auth/guest', { method: 'POST', auth: false });
  return adoptSession(body);
}

export async function signInWithEmail(email: string, password: string): Promise<ApiUser> {
  const body = await apiRequest<AuthSessionBody>('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });
  return adoptSession(body);
}

export async function registerWithEmail(email: string, password: string, username: string): Promise<ApiUser> {
  // With a live guest session the bearer rides along and the Chef
  // upgrades that account in place (same id, progress kept). Without
  // one, register simply creates the account.
  const body = await apiRequest<AuthSessionBody>('/auth/register', {
    method: 'POST',
    body: { email, password },
  });
  const user = await adoptSession(body);
  // The Supabase flow carried the chosen username in signup metadata
  // and the profile bootstrap applied it when valid. The Chef register
  // body has no username field, so apply it through the same validated
  // path every other rename uses; a taken/invalid name leaves the
  // account usernameless for the in-app username flow instead of
  // failing the registration.
  if (username.trim()) {
    try {
      await setUsername(username);
    } catch (error) {
      console.warn('[auth] post-register username set failed:', error);
    }
  }
  return user;
}

export async function sendPasswordReset(_email: string): Promise<void> {
  throw new Error('Password reset by email is not available yet. Sign in with Google or continue as a guest.');
}

export async function updatePassword(_newPassword: string): Promise<ApiUser> {
  throw new Error('Password update is not available yet. Sign in with Google or continue as a guest.');
}

export async function signInWithGoogle(): Promise<ApiUser> {
  const idToken = await getGoogleIdTokenNative();
  // With a live session the bearer rides along and the Chef links the
  // Google identity to the current account (guest keeps its id and
  // progress); without one it is a find-or-create sign-in.
  const body = await apiRequest<AuthSessionBody>('/auth/google', {
    method: 'POST',
    body: { idToken },
  });
  return adoptSession(body);
}

export async function signOut(): Promise<void> {
  const refreshToken = getSessionSync()?.refreshToken;
  try {
    if (refreshToken) {
      await apiRequest('/auth/logout', { method: 'POST', auth: false, body: { refreshToken } });
    }
  } catch (error) {
    // Server-side revoke is best-effort: the local session must clear
    // either way or the user can never actually sign out offline.
    console.warn('[auth] logout request failed; clearing local session anyway:', error);
  } finally {
    await setSession(null);
  }
}
