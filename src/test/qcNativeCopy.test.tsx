/**
 * QC fix slice D — native variants of the B3 landing honesty change.
 *
 * The web build's AuthScreen / SignInLockPrompt copy changed (guest
 * preview honesty); the APP's copy and its working Google button must
 * be byte-for-byte the behavior players already have. This file pins
 * the native branch by reporting a native platform through the same
 * Capacitor seam the code reads.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => true },
  };
});

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    account: { accountType: 'guest' },
    authError: null,
    authMessage: null,
    authDiagnostic: null,
    signInWithGoogle: vi.fn(),
    continueAsGuest: vi.fn(),
    actionLoading: false,
  }),
}));

import { AuthScreen } from '@/screens/AuthScreen';
import { SignInLockPrompt } from '@/auth/SignInLockPrompt';

afterEach(() => {
  cleanup();
});

describe('Landing honesty — native app unchanged (QC B3)', () => {
  it('AuthScreen in the app keeps the original sign-in copy', () => {
    render(<AuthScreen />);
    expect(screen.getByText(/vendor yard is open to everyone/)).toBeTruthy();
    expect(screen.getByText(/keep your hunter on any device/)).toBeTruthy();
    expect(screen.queryByText(/guest preview/)).toBeNull();
  });

  it('the lock prompt in the app keeps its working Google button', () => {
    render(<SignInLockPrompt heading="Sign in to buy — your guest progress carries over" />);
    expect(
      screen.getByRole('button', { name: /Sign in with Google — keep your progress/ }),
    ).toBeTruthy();
    expect(screen.queryByTestId('signin-lock-web-note')).toBeNull();
  });
});
