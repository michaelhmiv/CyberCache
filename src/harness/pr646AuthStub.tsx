import React from 'react';

/**
 * PR #646 before/after harness stub for '@/auth/AuthProvider' —
 * wired ONLY into the stills captures through vite.pr646.config.ts
 * (the app build never resolves this file). Mode comes from
 * window.__PR646_AUTH__ (set by pr646Main before render):
 *   'verified' — a linked, named account (default screen seeds)
 *   'guest'    — an anonymous guest account (Account stop rows,
 *                guest sign-out confirm)
 *   'fresh'    — a brand-new registered account: no username, no
 *                hunter pick (the onboarding sequence in App)
 * The shape mirrors the screen tests' AuthProvider mock, extended
 * with signInWithApple and the provider component itself.
 */
type Mode = 'verified' | 'guest' | 'fresh' | 'out';

function mode(): Mode {
  return (window as unknown as { __PR646_AUTH__?: Mode }).__PR646_AUTH__ ?? 'verified';
}

const ACCOUNTS: Record<Mode, Record<string, unknown> | null> = {
  verified: {
    accountType: 'verified', isAnonymous: false, hasUsername: true,
    username: 'Vesper-9', email: 'vesper@example.com', userId: 'p1',
    emailVerifiedAt: '2026-11-01T00:00:00.000Z', hasHunterPick: true,
  },
  guest: {
    accountType: 'guest', isAnonymous: true, hasUsername: false,
    username: null, email: null, userId: 'p1',
    emailVerifiedAt: null, hasHunterPick: false,
  },
  fresh: {
    accountType: 'registered_unverified', isAnonymous: false, hasUsername: false,
    username: null, email: 'newhunter@example.com', userId: 'p1',
    emailVerifiedAt: null, hasHunterPick: false,
  },
  out: null,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const noopAsync = async () => {};
const noop = () => {};

export function useAuth() {
  const m = mode();
  const account = ACCOUNTS[m];
  return {
    user: m === 'out' ? null : {
      id: 'p1',
      email: (account?.email as string | null) ?? null,
      isAnonymous: m === 'guest',
    },
    account,
    session: null,
    loading: false,
    actionLoading: false,
    authMode: m === 'out' ? 'signed-out' : 'signed-in',
    authMessage: null,
    authError: null,
    authDiagnostic: null,
    bootstrapError: null,
    signInWithGoogle: noopAsync,
    signInWithApple: noopAsync,
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
