import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authService from '../lib/api/authService';
import * as profileService from '../lib/api/profileService';
import type { ApiUser } from '../lib/api/session';
import { settleActiveActivityRewards } from '../lib/activity/activitySettlement';
import { ensureInitialBundle } from '../lib/api/initialBundle';
import { syncRuntimeItemsForUser } from '../lib/api/runtimeStateService';
import { syncRuntimeProfile } from '../lib/api/verifiedStateSync';
import { initializeNativeAuth } from '../lib/nativeAuth';
import type { NativeAuthDiagnostic, NativeAuthDiagnosticError } from '../lib/nativeAuth';
import {
  resetRuntimeStoresToInitialState,
  restoreRuntimeStoresFromSupabase,
  saveCurrentRuntimeStores,
  startRuntimeStorePersistence,
  stopRuntimeStorePersistence,
} from '../store/runtimeSupabaseSync';
import { useActivityStore } from '../store';
import { loadCombatStats, saveCombatStats } from '../store/combatStatsSupabaseSync';
import type { AccountState } from './accountState';
import { toMessage } from './errorText';
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

function toNativeAuthDiagnostic(error: unknown): NativeAuthDiagnostic | null {
  if (!error || typeof error !== 'object') return null;
  return (error as NativeAuthDiagnosticError).nativeAuthDiagnostic ?? null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [rawUser, setRawUser] = useState<ApiUser | null>(null);
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(() => parseInitialAuthMode());
  const [authMessage, setAuthMessage] = useState<string | null>(() => parseAuthStatusMessage());
  const [authError, setAuthError] = useState<string | null>(null);
  const [authDiagnostic, setAuthDiagnostic] = useState<NativeAuthDiagnostic | null>(null);

  const clearAuthStatus = useCallback(() => {
    setAuthError(null);
    setAuthDiagnostic(null);
    setAuthMessage(null);
  }, []);

  const loadUser = useCallback(async (nextUser: ApiUser | null) => {
    stopRuntimeStorePersistence();
    resetRuntimeStoresToInitialState();
    useActivityStore.getState().reset();
    setRawUser(nextUser);
    setUser(toAuthSessionUser(nextUser));
    if (!nextUser) {
      setAccount(null);
      return;
    }

    let profile = await profileService.ensureProfile(nextUser);

    // Initial bundle (flow-fix F1): every account receives its
    // starter economy exactly once — the op shipped with a Chef route
    // and a client wrapper but no caller, so accounts started at zero
    // forever. The grant is gated on the profile's own claim flag and
    // the SQL refuses a second claim, so running this on every
    // bootstrap is safe for fresh and pre-existing accounts alike. On
    // grant, re-read the profile so the account state below carries
    // the bundled balances; the op already synced stores itself.
    //
    // Audit UX-04: the runtime profile sync happens AFTER this
    // bundle attempt, not before it — the first values the resource
    // bar can paint already include the starter bundle, never a
    // frame of pre-bundle zeros. Until the sync below lands, the
    // player store's profileLoaded flag stays false and the bar
    // renders skeletons.
    try {
      const granted = await ensureInitialBundle(profile);
      if (granted) {
        profile = await profileService.ensureProfile(nextUser);
      }
    } catch (error) {
      console.warn('Initial bundle grant skipped:', error instanceof Error ? error.message : error);
    }

    syncRuntimeProfile(profile as Parameters<typeof syncRuntimeProfile>[0]);

    await syncRuntimeItemsForUser(nextUser.id);

    // Starter weapon: no client safety net is needed anymore. The
    // Chef seeds it server-side when the profile row is created
    // (db/migrations/0005 profile bootstrap + 0004's
    // trg_seed_starter_weapon), and the item sync above picks it up —
    // the same coverage the old cc_ensure_starter_weapon RPC provided.

    let restoredSnapshot = false;
    try {
      restoredSnapshot = await restoreRuntimeStoresFromSupabase(nextUser.id);
    } catch (error) {
      console.warn('Runtime Supabase snapshot hydrate skipped:', error instanceof Error ? error.message : error);
    }

    if (!restoredSnapshot) {
      await saveCurrentRuntimeStores(nextUser.id);
    }

    try {
      await useActivityStore.getState().hydrate();
      await settleActiveActivityRewards({ userId: nextUser.id });
    } catch (error) {
      console.warn('Active activity hydrate/settlement skipped:', error instanceof Error ? error.message : error);
    }

    // Hydrate combat stats. On first login this is a no-op (no row yet);
    // subsequent logins restore the persisted kill counts and playtime.
    try {
      const loaded = await loadCombatStats(nextUser.id);
      if (!loaded) await saveCombatStats(nextUser.id);
    } catch (error) {
      console.warn('Combat stats hydrate skipped:', error instanceof Error ? error.message : error);
    }

    startRuntimeStorePersistence(nextUser.id);
    setAccount(profileService.profileRowToAccountState(profile, nextUser));
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!rawUser) return;
    const profile = await profileService.ensureProfile(rawUser);
    syncRuntimeProfile(profile as Parameters<typeof syncRuntimeProfile>[0]);
    await syncRuntimeItemsForUser(rawUser.id);
    await useActivityStore.getState().hydrate();
    await settleActiveActivityRewards({ userId: rawUser.id });
    await saveCurrentRuntimeStores(rawUser.id);
    setAccount(profileService.profileRowToAccountState(profile, rawUser));
    setUser(toAuthSessionUser(rawUser));
  }, [rawUser]);

  useEffect(() => {
    initializeNativeAuth().catch((error) => console.warn('Native auth initialization failed:', error));

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
      stopRuntimeStorePersistence();
      useActivityStore.getState().reset();
      subscription.unsubscribe();
    };
  }, [loadUser]);

  const run = useCallback(async (action: () => Promise<AuthActionResult>): Promise<AuthActionResult> => {
    setActionLoading(true);
    setAuthError(null);
    setAuthDiagnostic(null);
    try {
      const result = await action();
      if (result.message) setAuthMessage(result.message);
      return result;
    } catch (error) {
      const message = toMessage(error);
      setAuthDiagnostic(toNativeAuthDiagnostic(error));
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

  const signInWithGoogle = useCallback(() => run(async () => {
    const nextUser = await authService.signInWithGoogle();
    await loadUser(nextUser);
    return { ok: true };
  }), [loadUser, run]);

  const registerWithEmail = useCallback((email: string, secret: string, username: string) => run(async () => {
    const nextUser = await authService.registerWithEmail(email, secret, username);
    if (nextUser) {
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
    await saveCurrentRuntimeStores(rawUser?.id ?? null);
    await authService.signOut();
    await loadUser(null);
    setAuthMode('guest');
    return { ok: true, message: 'Signed out.' };
  }), [loadUser, rawUser?.id, run]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    account,
    loading,
    actionLoading,
    authMode,
    authMessage,
    authError,
    authDiagnostic,
    setAuthMode,
    clearAuthStatus,
    continueAsGuest,
    signInWithEmail,
    signInWithGoogle,
    registerWithEmail,
    sendPasswordReset,
    updatePassword,
    markVerificationReminderSeen,
    signOut,
    refreshAccount,
  }), [user, account, loading, actionLoading, authMode, authMessage, authError, authDiagnostic, clearAuthStatus, continueAsGuest, signInWithEmail, signInWithGoogle, registerWithEmail, sendPasswordReset, updatePassword, markVerificationReminderSeen, signOut, refreshAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
