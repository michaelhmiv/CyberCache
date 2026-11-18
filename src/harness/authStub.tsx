import React from 'react';

/**
 * Harness stub for '@/auth/AuthProvider' — wired ONLY into the
 * trees captures through vite.trees.config.ts (the app build
 * never resolves this file). The Hunter tree calls useAuth deep
 * inside, and the real provider's session bootstrap resets the
 * runtime stores the harness seeds, so the screen tests' mock
 * shape stands in: a settled, signed-in-shaped auth value with
 * no-op actions and no network. Mirrors the craft-info round's
 * stub (src/test/craftConsolidation.test.tsx's AuthProvider mock
 * is the shape's source), extended with the provider component
 * itself (a passthrough) for import sites that take both.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const noopAsync = async () => {};
const noop = () => {};

export function useAuth() {
  return {
    user: { id: 'user-1' },
    account: null,
    session: null,
    loading: false,
    actionLoading: false,
    authMode: 'signed-in',
    authMessage: null,
    authError: null,
    authDiagnostic: null,
    bootstrapError: null,
    signInWithGoogle: noopAsync,
    signInWithEmail: noopAsync,
    registerWithEmail: noopAsync,
    sendPasswordReset: noopAsync,
    updatePassword: noopAsync,
    continueAsGuest: noopAsync,
    signOut: noopAsync,
    refreshAccount: noopAsync,
    retryBootstrap: noopAsync,
    markVerificationReminderSeen: noop,
    clearAuthStatus: noop,
  } as never;
}
