/**
 * Sign in with Apple — the sign-in surface's platform branch
 * (iOS launch, Track 3). iOS offers Google AND Apple; Android
 * offers Google only, exactly as before. The web surface is pinned
 * separately by authScreenWeb.test.tsx (audit A-02).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ value: 'ios' }));

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
    signInWithApple: vi.fn(async () => ({ ok: true })),
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

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => platform.value,
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

describe('AuthScreen — native platform branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('on iOS offers Google and Apple, and the Apple button runs the Apple flow', () => {
    platform.value = 'ios';
    render(<AuthScreen />);
    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeTruthy();
    const apple = screen.getByRole('button', { name: /Continue with Apple/i });
    expect(apple).toBeTruthy();
    expect(screen.getByText(/Sign in with Apple or Google/i)).toBeTruthy();
    fireEvent.click(apple);
    expect(hoisted.auth.signInWithApple).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Continue as Guest/i })).toBeTruthy();
  });

  it('on Android offers Google only — no Apple button, unchanged copy', () => {
    platform.value = 'android';
    render(<AuthScreen />);
    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continue with Apple/i })).toBeNull();
    expect(screen.queryByText(/Apple or Google/i)).toBeNull();
    expect(hoisted.auth.signInWithApple).not.toBeCalled();
  });
});
