import React from 'react';

/**
 * Harness-only auth stub (THROWAWAY, 2026-11-13): identities need
 * an object with id/email; the numbers-home page renders offline,
 * so the stub reports a settled guest session (copied verbatim
 * from the dash/numbers tree — the vite config rewrites every
 * AuthProvider import specifier to this file).
 */
const USER = { id: 'numbers-home-harness', email: null };

export function useAuth() {
  return {
    user: USER,
    loading: false,
    playerId: USER.id,
    guest: true,
    signOut: async () => undefined,
    linkGoogle: async () => undefined,
    session: null,
  } as Record<string, unknown>;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
export default AuthProvider;
