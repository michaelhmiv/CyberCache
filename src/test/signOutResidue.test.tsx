/**
 * Audit A-08 — the previous account's "While You Were Away" recap
 * must not survive into the next account's session on the device.
 *
 * The recap store was missing from loadUser's account-scoped reset
 * list, and its persistence key is unscoped — so account A's recap
 * (earnings, items, time away) could re-open inside account B's
 * session on a shared device. loadUser now resets the recap when
 * the user changes or signs out (a same-user cold start keeps its
 * own recap — the re-open feature), and sign-out removes the
 * departing user's on-device runtime snapshot copy.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  ensureProfile: vi.fn(),
  getCurrentSession: vi.fn(),
  authCallback: null as ((session: { user: unknown } | null) => void) | null,
  clearLocalRuntimeSnapshot: vi.fn(async () => {}),
}));

vi.mock('@/lib/api/authService', () => ({
  getCurrentSession: hoisted.getCurrentSession,
  onAuthStateChange: vi.fn((cb: (session: { user: unknown } | null) => void) => {
    hoisted.authCallback = cb;
    return { unsubscribe: vi.fn() };
  }),
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

vi.mock('@/store/runtimeSupabaseSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/runtimeSupabaseSync')>();
  return {
    ...actual,
    clearLocalRuntimeSnapshot: hoisted.clearLocalRuntimeSnapshot,
    restoreRuntimeStoresFromSupabase: vi.fn(async () => true),
    saveCurrentRuntimeStores: vi.fn(async () => {}),
    startRuntimeStorePersistence: vi.fn(),
    stopRuntimeStorePersistence: vi.fn(),
  };
});

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
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';

const userA = { id: 'user-a', email: 'a@example.com', isAnonymous: false } as never;
const userB = { id: 'user-b', email: 'b@example.com', isAnonymous: false } as never;

const profileFor = (id: string) => ({
  id,
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
}) as never;

let signOutFn: (() => Promise<unknown>) | null = null;
function Probe() {
  const { account, signOut } = useAuth();
  useEffect(() => {
    signOutFn = signOut as () => Promise<unknown>;
  }, [signOut]);
  return <div data-testid="account">{account ? 'set' : 'unset'}</div>;
}

describe('audit A-08 — sign-out / account-switch residue', () => {
  afterEach(() => cleanup());

  it('an account switch clears the previous account\'s recap from store and storage', async () => {
    hoisted.getCurrentSession.mockResolvedValue({ user: userA });
    hoisted.ensureProfile.mockImplementation(async (u: { id: string }) => profileFor(u.id));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(document.querySelector('[data-testid="account"]')?.textContent).toBe('set'));

    // Account A settles offline earnings: the recap lands in the
    // store and the unscoped storage key.
    useOfflineRecapStore.getState().setSettlement({ elapsedMs: 3_600_000 } as never);
    expect(useOfflineRecapStore.getState().lastSettlement).not.toBeNull();
    expect(localStorage.getItem('cybercache.offlineRecap.v1')).not.toBeNull();

    // The session switches to account B (auth-state change).
    hoisted.authCallback?.({ user: userB });

    await waitFor(() => {
      expect(useOfflineRecapStore.getState().lastSettlement).toBeNull();
    });
    expect(localStorage.getItem('cybercache.offlineRecap.v1')).toBeNull();
  });

  it('sign-out clears the recap and removes the departing user\'s on-device snapshot', async () => {
    hoisted.getCurrentSession.mockResolvedValue({ user: userA });
    hoisted.ensureProfile.mockImplementation(async (u: { id: string }) => profileFor(u.id));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(document.querySelector('[data-testid="account"]')?.textContent).toBe('set'));

    useOfflineRecapStore.getState().setSettlement({ elapsedMs: 3_600_000 } as never);
    expect(localStorage.getItem('cybercache.offlineRecap.v1')).not.toBeNull();

    await signOutFn?.();

    expect(useOfflineRecapStore.getState().lastSettlement).toBeNull();
    expect(localStorage.getItem('cybercache.offlineRecap.v1')).toBeNull();
    expect(hoisted.clearLocalRuntimeSnapshot).toHaveBeenCalledWith('user-a');
  });
});
