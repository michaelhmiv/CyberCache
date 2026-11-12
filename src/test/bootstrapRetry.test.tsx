/**
 * Audit X-08 — a session-restore whose profile bootstrap fails must
 * land in a terminal, retryable error state — never in the main UI
 * with skeleton bars forever and a static error card.
 *
 * The failure: loadUser awaited ensureProfile outside any guard
 * after the session user was already set, so App entered the main UI
 * half-loaded (profileLoaded could never become true) and the only
 * recovery was a full reload the UI never suggested. The provider
 * now records bootstrapError and exposes retryBootstrap; App renders
 * the terminal state (pinned here at the provider seam).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  ensureProfile: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock('@/lib/api/authService', () => ({
  getCurrentSession: hoisted.getCurrentSession,
  onAuthStateChange: vi.fn(() => ({ unsubscribe: vi.fn() })),
  registerWithEmail: vi.fn(),
  sendPasswordReset: vi.fn(),
  signInAsGuest: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(async () => {}),
  updatePassword: vi.fn(),
  markVerificationReminderSeen: vi.fn(async () => {}),
}));

vi.mock('@/lib/api/profileService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/profileService')>();
  return { ...actual, ensureProfile: hoisted.ensureProfile };
});

vi.mock('@/lib/api/initialBundle', () => ({
  ensureInitialBundle: vi.fn(async () => null),
  isInitialBundleClaimed: vi.fn(() => true),
}));

vi.mock('@/lib/nativeAuth', () => ({
  initializeNativeAuth: vi.fn(async () => {}),
}));

vi.mock('@/store/runtimeSupabaseSync', () => ({
  resetRuntimeStoresToInitialState: vi.fn(),
  restoreRuntimeStoresFromSupabase: vi.fn(async () => true),
  saveCurrentRuntimeStores: vi.fn(async () => {}),
  startRuntimeStorePersistence: vi.fn(),
  stopRuntimeStorePersistence: vi.fn(),
}));

vi.mock('@/store/combatStatsSupabaseSync', () => ({
  loadCombatStats: vi.fn(async () => true),
  saveCombatStats: vi.fn(async () => {}),
}));

vi.mock('@/lib/activity/activitySettlement', () => ({
  settleActiveActivityRewards: vi.fn(async () => {}),
}));

vi.mock('@/lib/api/runtimeStateService', () => ({
  syncRuntimeItemsForUser: vi.fn(async () => {}),
}));

import { AuthProvider, useAuth } from '@/auth/AuthProvider';

const fakeUser = {
  id: 'user-1',
  email: 'hunter@example.com',
  isAnonymous: false,
} as never;

const fakeProfile = {
  id: 'user-1',
  username: 'hunter',
  display_name: null,
  player_level: 3,
  player_xp: 0,
  credits: 100,
  scrap: 0,
  cache_tokens: 0,
  materials: {},
  essences: {},
  consumables: {},
  skill_spends: {},
  boss_state: {},
  last_idle_claim_at: '2026-11-02T00:00:00.000Z',
  last_claimed_tick: 0,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-02T00:00:00.000Z',
  account_type: 'verified',
  email: 'hunter@example.com',
  email_verified_at: '2026-11-01T00:00:00.000Z',
  verification_grace_expires_at: null,
  verification_reminder_last_seen_at: null,
} as never;

function Probe() {
  const { bootstrapError, retryBootstrap, account, loading } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="bootstrap-error">{bootstrapError ?? ''}</div>
      <div data-testid="account">{account ? 'set' : 'unset'}</div>
      <button type="button" onClick={retryBootstrap}>Retry</button>
    </div>
  );
}

describe('audit X-08 — bootstrap failure is terminal and retryable', () => {
  afterEach(() => cleanup());

  it('a failed profile fetch sets bootstrapError with no account; Retry recovers when the server returns', async () => {
    hoisted.getCurrentSession.mockResolvedValue({ user: fakeUser });
    hoisted.ensureProfile
      .mockRejectedValueOnce(new Error('Could not reach the server'))
      .mockResolvedValue(fakeProfile);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // Terminal state: error recorded, no half-loaded account.
    await waitFor(() => {
      expect(screen.getByTestId('bootstrap-error').textContent).toBe('Could not reach the server');
    });
    expect(screen.getByTestId('account').textContent).toBe('unset');

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByTestId('bootstrap-error').textContent).toBe('');
      expect(screen.getByTestId('account').textContent).toBe('set');
    });
    expect(hoisted.ensureProfile).toHaveBeenCalledTimes(2);
  });
});
