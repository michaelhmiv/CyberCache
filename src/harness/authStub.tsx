/**
 * HARNESS ONLY — dev stub for '@/auth/AuthProvider', aliased in
 * vite.config.ts for this throwaway rendering tree so MarketScreen
 * can mount without a Supabase session. Returns a signed-in guest
 * identity; every action is a no-op. Never imported by the app
 * bundle (the alias exists only in this tree's vite config).
 */
import React from 'react';

const stubValue = {
  user: { id: 'vendorqty-harness' },
  account: null,
  signInWithGoogle: async () => undefined,
  actionLoading: false,
  signOut: async () => undefined,
  session: null,
  loading: false,
  refreshAccount: async () => undefined,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// The stub intentionally returns the loose shape above; the real
// hook's context type is wider than the harness needs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useAuth(): any {
  return stubValue;
}
