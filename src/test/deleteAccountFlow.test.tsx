/**
 * In-app account deletion (Build 7 — App Review hardening,
 * Guideline 5.1.1(v)). Pins the client contract:
 *
 *  - The Danger Zone control opens a confirmation sheet that names
 *    what is deleted and that it cannot be undone.
 *  - Confirming calls POST /api/account/delete with the session
 *    bearer and NO body (identity comes from the session).
 *  - On success the local session is cleared — the stored record
 *    under cybercache.chef.session.v1 is removed and session
 *    listeners observe the signed-out state the App gate turns
 *    into the sign-in screen.
 *  - On failure the sheet stays open with a plain error (never the
 *    raw server text) and the session is kept.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Preferences } from '@capacitor/preferences';

vi.mock('@capacitor/preferences', () => {
  const store = new Map<string, string>();
  return {
    Preferences: {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
        store.set(key, value);
      }),
      remove: vi.fn(async ({ key }: { key: string }) => {
        store.delete(key);
      }),
    },
  };
});

vi.mock('@/lib/nativeAuth', () => ({
  getAppleIdTokenNative: vi.fn(),
  getGoogleIdTokenNative: vi.fn(),
}));

vi.mock('@/lib/analytics/analytics', () => ({
  trackGuestStart: vi.fn(),
  trackSignIn: vi.fn(),
}));

import { DeleteAccountControl } from '@/components/profile/DeleteAccountControl';
import {
  getSessionSync,
  onSessionChange,
  resetSessionStateForTests,
  setSession,
  type ChefSession,
} from '@/lib/api/session';

const SESSION: ChefSession = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  refreshExpiresAt: '2099-01-01T00:00:00.000Z',
  account: { id: 'account-1', email: null, isGuest: true, emailVerified: false },
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('DeleteAccountControl', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetSessionStateForTests();
    await setSession(SESSION);
  });

  it('confirm calls the delete endpoint and lands signed out', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const observed: Array<ChefSession | null> = [];
    const { unsubscribe } = onSessionChange((s) => observed.push(s));

    render(<DeleteAccountControl />);
    fireEvent.click(screen.getByTestId('delete-account-open'));

    // The sheet names the consequences before anything is called.
    const sheet = screen.getByTestId('delete-account-sheet');
    expect(sheet.textContent).toMatch(/no undo and no recovery/i);
    expect(sheet.textContent).toMatch(/market listings, and leaderboard places are deleted/i);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('delete-account-confirm'));

    await waitFor(() => expect(getSessionSync()).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/account/delete');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token-1');
    // The stored session record is gone and listeners saw sign-out.
    expect(Preferences.remove).toHaveBeenCalledWith({ key: 'cybercache.chef.session.v1' });
    expect(observed).toContain(null);
    unsubscribe();
  });

  it('failure shows a plain error, keeps the session, and never leaks server text', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(500, { error: 'internal', message: 'RAW SERVER TEXT: pg constraint blew up' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<DeleteAccountControl />);
    fireEvent.click(screen.getByTestId('delete-account-open'));
    fireEvent.click(screen.getByTestId('delete-account-confirm'));

    const error = await screen.findByTestId('delete-account-error');
    expect(error.textContent).toBe(
      'Could not delete your account. Check your connection and try again.',
    );
    expect(screen.queryByText(/RAW SERVER TEXT/)).toBeNull();
    // Still signed in, sheet still open for a retry.
    expect(getSessionSync()?.account.id).toBe('account-1');
    expect(screen.getByTestId('delete-account-sheet')).toBeTruthy();
    expect(Preferences.remove).not.toHaveBeenCalled();
  });

  it('cancel closes the sheet without calling the endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    render(<DeleteAccountControl />);
    fireEvent.click(screen.getByTestId('delete-account-open'));
    fireEvent.click(screen.getByTestId('delete-account-cancel'));

    await waitFor(() => expect(screen.queryByTestId('delete-account-sheet')).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSessionSync()?.account.id).toBe('account-1');
  });
});
