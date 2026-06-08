import type { AccountState } from './accountState';

export type AuthMode = 'guest' | 'login' | 'register' | 'forgot_password' | 'reset_password';

export interface AuthSessionUser {
  id: string;
  email: string | null;
  isAnonymous: boolean;
}

export interface AuthContextValue {
  user: AuthSessionUser | null;
  account: AccountState | null;
  loading: boolean;
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  continueAsGuest: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, username: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccount: () => Promise<void>;
}

export interface AuthRedirectConfig {
  confirmedUrl: string;
  resetPasswordUrl: string;
}

export function getAuthRedirectConfig(origin = window.location.origin): AuthRedirectConfig {
  return {
    confirmedUrl: `${origin}/?auth=confirmed`,
    resetPasswordUrl: `${origin}/?auth=reset-password`,
  };
}

export function parseInitialAuthMode(search = window.location.search): AuthMode {
  const params = new URLSearchParams(search);
  const auth = params.get('auth');
  if (auth === 'reset-password') return 'reset_password';
  return 'guest';
}
