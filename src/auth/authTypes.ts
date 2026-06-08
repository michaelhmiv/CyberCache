import type { AccountState } from './accountState';

export type AuthMode = 'guest' | 'login' | 'register' | 'forgot_password' | 'reset_password';

export interface AuthSessionUser {
  id: string;
  email: string | null;
  isAnonymous: boolean;
}

export interface AuthActionResult {
  ok: boolean;
  message?: string;
}

export interface AuthContextValue {
  user: AuthSessionUser | null;
  account: AccountState | null;
  loading: boolean;
  actionLoading: boolean;
  authMode: AuthMode;
  authMessage: string | null;
  authError: string | null;
  setAuthMode: (mode: AuthMode) => void;
  clearAuthStatus: () => void;
  continueAsGuest: () => Promise<AuthActionResult>;
  signInWithEmail: (email: string, password: string) => Promise<AuthActionResult>;
  registerWithEmail: (email: string, password: string, username: string) => Promise<AuthActionResult>;
  sendPasswordReset: (email: string) => Promise<AuthActionResult>;
  updatePassword: (password: string) => Promise<AuthActionResult>;
  markVerificationReminderSeen: () => Promise<AuthActionResult>;
  signOut: () => Promise<AuthActionResult>;
  refreshAccount: () => Promise<void>;
}

export interface AuthRedirectConfig {
  confirmedUrl: string;
  resetPasswordUrl: string;
}

export function getAuthRedirectConfig(origin = globalThis.location?.origin ?? ''): AuthRedirectConfig {
  return {
    confirmedUrl: `${origin}/?auth=confirmed`,
    resetPasswordUrl: `${origin}/?auth=reset-password`,
  };
}

export function parseInitialAuthMode(search = globalThis.location?.search ?? ''): AuthMode {
  const params = new URLSearchParams(search);
  const auth = params.get('auth');
  if (auth === 'reset-password') return 'reset_password';
  return 'guest';
}

export function parseAuthStatusMessage(search = globalThis.location?.search ?? ''): string | null {
  const params = new URLSearchParams(search);
  const auth = params.get('auth');
  if (auth === 'confirmed') return 'Email confirmed. Your account access has been refreshed.';
  if (auth === 'reset-password') return 'Choose a new password to finish account recovery.';
  return null;
}

export function toAuthSessionUser(user: unknown): AuthSessionUser | null {
  if (!user || typeof user !== 'object') return null;
  const candidate = user as { id?: string; email?: string | null; is_anonymous?: boolean; app_metadata?: Record<string, unknown> };
  if (!candidate.id) return null;
  return {
    id: candidate.id,
    email: candidate.email ?? null,
    isAnonymous: Boolean(candidate.is_anonymous ?? candidate.app_metadata?.is_anonymous ?? !candidate.email),
  };
}
