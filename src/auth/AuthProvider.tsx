import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import * as authService from '../lib/supabase/authService';
import * as profileService from '../lib/supabase/profileService';
import type { AccountState } from './accountState';
import {
  parseAuthStatusMessage,
  parseInitialAuthMode,
  toAuthSessionUser,
  type AuthActionResult,
  type AuthContextValue,
  type AuthMode,
  type AuthSessionUser,
} from './authTypes';

const AuthContext = createContext<AuthContextValue | null>(null);

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [rawUser, setRawUser] = useState<User | null>(null);
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(() => parseInitialAuthMode());
  const [authMessage, setAuthMessage] = useState<string | null>(() => parseAuthStatusMessage());
  const [authError, setAuthError] = useState<string | null>(null);

  const clearAuthStatus = useCallback(() => {
    setAuthError(null);
    setAuthMessage(null);
  }, []);

  const loadUser = useCallback(async (nextUser: User | null) => {
    setRawUser(nextUser);
    setUser(toAuthSessionUser(nextUser));
    if (!nextUser) {
      setAccount(null);
      return;
    }
    const nextAccount = await profileService.getAccountState(nextUser);
    setAccount(nextAccount);
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!rawUser) return;
    const nextAccount = await profileService.getAccountState(rawUser);
    setAccount(nextAccount);
    setUser(toAuthSessionUser(rawUser));
  }, [rawUser]);

  useEffect(() => {
    let mounted = true;
    authService.getCurrentSession()
      .then((session) => loadUser(session?.user ?? null))
      .catch((error) => mounted && setAuthError(toMessage(error)))
      .finally(() => mounted && setLoading(false));

    const subscription = authService.onAuthStateChange((session) => {
      loadUser(session?.user ?? null).catch((error) => setAuthError(toMessage(error)));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUser]);

  const run = useCallback(async (action: () => Promise<AuthActionResult>): Promise<AuthActionResult> => {
    setActionLoading(true);
    setAuthError(null);
    try {
      const result = await action();
      if (result.message) setAuthMessage(result.message);
      return result;
    } catch (error) {
      const message = toMessage(error);
      setAuthError(message);
      return { ok: false, message };
    } finally {
      setActionLoading(false);
    }
  }, []);

  const continueAsGuest = useCallback(() => run(async () => {
    const nextUser = await authService.signInAsGuest();
    await loadUser(nextUser);
    return { ok: true, message: 'Guest session started.' };
  }), [loadUser, run]);

  const signInWithEmail = useCallback((email: string, secret: string) => run(async () => {
    const nextUser = await authService.signInWithEmail(email, secret);
    await loadUser(nextUser);
    return { ok: true, message: 'Signed in.' };
  }), [loadUser, run]);

  const registerWithEmail = useCallback((email: string, secret: string, username: string) => run(async () => {
    const nextUser = await authService.registerWithEmail(email, secret, username);
    if (nextUser) {
      await profileService.ensureProfile(nextUser, { username });
      await loadUser(nextUser);
    }
    return { ok: true, message: 'Account created. Verify your email to unlock player economy features.' };
  }), [loadUser, run]);

  const sendPasswordReset = useCallback((email: string) => run(async () => {
    await authService.sendPasswordReset(email);
    return { ok: true, message: 'Recovery email sent.' };
  }), [run]);

  const updatePassword = useCallback((secret: string) => run(async () => {
    const nextUser = await authService.updatePassword(secret);
    await loadUser(nextUser);
    setAuthMode('login');
    return { ok: true, message: 'Account credential updated.' };
  }), [loadUser, run]);

  const markVerificationReminderSeen = useCallback(() => run(async () => {
    if (!account?.userId) return { ok: false, message: 'No profile loaded.' };
    await profileService.markVerificationReminderSeen(account.userId);
    await refreshAccount();
    return { ok: true };
  }), [account, refreshAccount, run]);

  const signOut = useCallback(() => run(async () => {
    await authService.signOut();
    await loadUser(null);
    setAuthMode('guest');
    return { ok: true, message: 'Signed out.' };
  }), [loadUser, run]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    account,
    loading,
    actionLoading,
    authMode,
    authMessage,
    authError,
    setAuthMode,
    clearAuthStatus,
    continueAsGuest,
    signInWithEmail,
    registerWithEmail,
    sendPasswordReset,
    updatePassword,
    markVerificationReminderSeen,
    signOut,
    refreshAccount,
  }), [user, account, loading, actionLoading, authMode, authMessage, authError, clearAuthStatus, continueAsGuest, signInWithEmail, registerWithEmail, sendPasswordReset, updatePassword, markVerificationReminderSeen, signOut, refreshAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
