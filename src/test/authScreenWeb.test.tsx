/**
 * Audit A-02 — the web sign-in surface must not offer a dead
 * "Continue with Google" CTA or an open-by-default debug packet.
 *
 * On web, Google sign-in can only fail (nativeAuth refuses off-app
 * by design): the button's tap produced an error banner plus a
 * pretty-printed "Google debug packet", open by default.
 * SignInLockPrompt solved this exact problem in QC B3 (web renders
 * explanatory text, no button); AuthScreen now mirrors it. jsdom is
 * the web platform: Capacitor.isNativePlatform() is false here.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: null,
    account: null,
    loading: false,
    actionLoading: false,
    authMode: 'guest' as const,
    authMessage: null as string | null,
    authError: null as string | null,
    authDiagnostic: null,
    setAuthMode: vi.fn(),
    clearAuthStatus: vi.fn(),
    continueAsGuest: vi.fn(async () => ({ ok: true })),
    signInWithEmail: vi.fn(async () => ({ ok: true })),
    signInWithGoogle: vi.fn(async () => ({ ok: true })),
    registerWithEmail: vi.fn(async () => ({ ok: true })),
    sendPasswordReset: vi.fn(async () => ({ ok: true })),
    updatePassword: vi.fn(async () => ({ ok: true })),
    markVerificationReminderSeen: vi.fn(async () => ({ ok: true })),
    signOut: vi.fn(async () => ({ ok: true })),
    refreshAccount: vi.fn(async () => {}),
    bootstrapError: null,
    retryBootstrap: vi.fn(),
  },
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/components/common/AuthHero', () => ({
  AuthHero: () => <div data-testid="auth-hero" />,
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

import { AuthScreen } from '@/screens/AuthScreen';

describe('audit A-02 — AuthScreen on web', () => {
  afterEach(() => cleanup());

  it('offers no Google CTA, shows the app sign-in note, and still offers guest entry', () => {
    render(<AuthScreen />);
    expect(screen.queryByRole('button', { name: /Continue with Google/i })).toBeNull();
    expect(screen.getByTestId('auth-web-signin-note')).toBeTruthy();
    expect(screen.getByText(/guest preview/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue as Guest/i })).toBeTruthy();
    expect(hoisted.auth.signInWithGoogle).not.toHaveBeenCalled();
  });

  it('renders no debug packet before any sign-in attempt', () => {
    render(<AuthScreen />);
    expect(screen.queryByText(/Google debug packet/)).toBeNull();
  });
});
